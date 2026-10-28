import ts from "typescript";
import { definitionExpressions } from "./cognitive.js";

type CallGraph = Map<ts.SignatureDeclaration, Set<ts.SignatureDeclaration>>;

/** Identify functions in direct or indirect cycles of statically resolved calls. */
export function recursiveFunctions(sources: readonly ts.SourceFile[], checker: ts.TypeChecker) {
  const graph: CallGraph = new Map();
  const written = writtenSymbols(sources, checker);
  function visit(node: ts.Node, caller?: ts.SignatureDeclaration) {
    if (ts.isFunctionLike(node)) {
      if (!("body" in node) || node.body === undefined) return;
      graph.set(node, new Set());
      for (const expression of definitionExpressions(node)) visit(expression, caller);
      for (const parameter of node.parameters) visit(parameter, node);
      visit(node.body, node);
      return;
    }
    if (caller && (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node))) {
      const target = callTarget(node, checker, written);
      if (target) graph.get(caller)!.add(target);
    }
    if (caller) for (const target of accessorTargets(node, checker, written)) graph.get(caller)!.add(target);
    ts.forEachChild(node, child => visit(child, caller));
  }
  for (const source of sources) visit(source);
  return new Set([...graph.keys()].filter(node => returnsTo(node, graph)));
}

function accessorTargets(node: ts.Node, checker: ts.TypeChecker, written?: ReadonlySet<ts.Symbol>) {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return [];
  if (written && isWrittenTarget(node, checker, written)) return [];
  const { read, write } = propertyUse(node);
  const members = boundMembers(node, checker, new Set());
  const declarations = members.length ? members : expressionSymbol(node, checker)?.declarations;
  return declarations?.filter(
    (declaration): declaration is ts.GetAccessorDeclaration | ts.SetAccessorDeclaration =>
      (read && ts.isGetAccessorDeclaration(declaration)) || (write && ts.isSetAccessorDeclaration(declaration)),
  ) ?? [];
}

function propertyUse(node: ts.Expression) {
  let expression: ts.Node = node;
  for (let container = assignmentContainer(expression); container; container = assignmentContainer(expression)) expression = container;
  const parent = expression.parent;
  if (ts.isDeleteExpression(parent)) return { read: false, write: false };
  if (ts.isBinaryExpression(parent) && parent.left === expression &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
    return { read: parent.operatorToken.kind !== ts.SyntaxKind.EqualsToken, write: true };
  }
  const update = (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
    (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken);
  return { read: true, write: update };
}

function assignmentContainer(node: ts.Node) {
  const parent = node.parent;
  if (isExpressionWrapper(parent)) return parent;
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) return parent;
  if (ts.isObjectLiteralExpression(parent) && (ts.isPropertyAssignment(node) || ts.isSpreadAssignment(node))) return parent;
  if (ts.isArrayLiteralExpression(parent)) return parent;
  if ((ts.isSpreadElement(parent) || ts.isSpreadAssignment(parent)) && parent.expression === node) return parent;
}

function callTarget(node: ts.CallExpression | ts.NewExpression | ts.TaggedTemplateExpression,
  checker: ts.TypeChecker, written: ReadonlySet<ts.Symbol>) {
  const expression = ts.isTaggedTemplateExpression(node) ? node.tag : node.expression;
  if (isWrittenTarget(expression, checker, written)) return;
  if (ts.isElementAccessExpression(expression) && constantKey(expression.argumentExpression, checker) === undefined) return;
  const value = boundValue(expression, checker, new Set()) ?? symbolValue(expressionSymbol(expression, checker), checker, new Set());
  if (value && hasImplementation(value) && !ts.isGetAccessorDeclaration(value) && !ts.isSetAccessorDeclaration(value)) return value;
  const declaration = checker.getResolvedSignature(node)?.declaration;
  if (!declaration) return;
  if ("name" in declaration && declaration.name) {
    const symbol = checker.getSymbolAtLocation(declaration.name);
    if (symbol && written.has(symbol)) return;
  }
  if (hasImplementation(declaration)) return declaration;
  if (ts.isConstructorDeclaration(declaration)) {
    return declaration.parent.members.find((member): member is ts.ConstructorDeclaration =>
      ts.isConstructorDeclaration(member) && member.body !== undefined);
  }
  if ("name" in declaration && declaration.name) {
    return checker.getSymbolAtLocation(declaration.name)?.declarations?.find(hasImplementation);
  }
}

function writtenSymbols(sources: readonly ts.SourceFile[], checker: ts.TypeChecker) {
  const written = new Set<ts.Symbol>();
  function record(node: ts.Node) {
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const symbol = expressionSymbol(node, checker) ??
        ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) ? expressionSymbol(node.expression, checker) : undefined);
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && accessorTargets(node, checker).length) return;
      if (symbol && !symbol.declarations?.some(declaration =>
        ts.isGetAccessorDeclaration(declaration) || ts.isSetAccessorDeclaration(declaration))) written.add(symbol);
      return;
    }
    ts.forEachChild(node, record);
  }
  function visit(node: ts.Node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) record(node.left);
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) record(node.operand);
    ts.forEachChild(node, visit);
  }
  for (const source of sources) visit(source);
  return written;
}

function expressionSymbol(node: ts.Expression, checker: ts.TypeChecker) {
  let symbol: ts.Symbol | undefined;
  if (ts.isElementAccessExpression(node)) {
    const key = constantKey(node.argumentExpression, checker);
    if (key !== undefined) symbol = checker.getTypeAtLocation(node.expression).getProperty(key);
  } else {
    symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node) ? node.name : node);
  }
  return symbol && (symbol.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(symbol) : symbol;
}

function isWrittenTarget(value: ts.Expression, checker: ts.TypeChecker, written: ReadonlySet<ts.Symbol>): boolean {
  const node = unwrapExpression(value);
  const symbol = expressionSymbol(node, checker);
  if (symbol && written.has(symbol)) return true;
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return isWrittenTarget(node.expression, checker, written);
  }
  return false;
}

function boundValue(node: ts.Expression, checker: ts.TypeChecker, seen: Set<ts.Symbol>): ts.Node | undefined {
  const expression = unwrapExpression(node);
  if (ts.isIdentifier(expression)) return symbolValue(checker.getSymbolAtLocation(expression), checker, seen);
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    const member = boundMembers(expression, checker, seen)[0];
    if (member && ts.isPropertyAssignment(member)) return boundValue(member.initializer, checker, seen);
    if (member && ts.isShorthandPropertyAssignment(member)) return symbolValue(checker.getShorthandAssignmentValueSymbol(member), checker, seen);
    return member;
  }
  return expression;
}

function isExpressionWrapper(node: ts.Node) {
  return ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
    || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node);
}

function unwrapExpression(node: ts.Expression) {
  while (isExpressionWrapper(node)) node = node.expression;
  return node;
}

function boundMembers(node: ts.PropertyAccessExpression | ts.ElementAccessExpression, checker: ts.TypeChecker, seen: Set<ts.Symbol>) {
  const owner = boundValue(node.expression, checker, seen);
  const name = ts.isPropertyAccessExpression(node) ? node.name.text : constantKey(node.argumentExpression, checker);
  if (!owner || !ts.isObjectLiteralExpression(owner) || name === undefined) return [];
  return owner.properties.filter(property => propertyName(property.name, checker) === name);
}

function symbolValue(symbol: ts.Symbol | undefined, checker: ts.TypeChecker, seen: Set<ts.Symbol>): ts.Node | undefined {
  if (!symbol) return;
  if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  if (seen.has(symbol)) return;
  seen.add(symbol);
  for (const declaration of symbol.declarations ?? []) {
    if (hasImplementation(declaration)) return declaration;
    if ((ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration)) && declaration.initializer) {
      return boundValue(declaration.initializer, checker, seen);
    }
  }
}

function propertyName(node: ts.Node | undefined, checker: ts.TypeChecker): string | undefined {
  if (!node) return;
  if (ts.isComputedPropertyName(node)) return constantKey(node.expression, checker);
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
}

function constantKey(node: ts.Expression, checker: ts.TypeChecker) {
  const type = checker.getTypeAtLocation(node);
  if (type.isStringLiteral() || type.isNumberLiteral()) return String(type.value);
}

function hasImplementation(node: ts.Node): node is ts.FunctionLikeDeclaration & { body: ts.ConciseBody } {
  return ts.isFunctionLike(node) && "body" in node && node.body !== undefined;
}

function returnsTo(start: ts.SignatureDeclaration, graph: CallGraph) {
  const pending = [...graph.get(start) ?? []];
  const seen = new Set<ts.SignatureDeclaration>();
  for (const target of pending) {
    if (target === start) return true;
    if (seen.has(target)) continue;
    seen.add(target);
    pending.push(...graph.get(target) ?? []);
  }
  return false;
}
