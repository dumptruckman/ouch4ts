import ts from "typescript";

/** Measure a function and its nested functions using the Cognitive Complexity whitepaper. */
export function cognitiveComplexity(node: ts.FunctionLikeDeclaration, recursive: ReadonlySet<ts.SignatureDeclaration>) {
  const counter = new CognitiveCounter(recursive);
  counter.visitFunction(node, 0, 0);
  return counter.complexity;
}

class CognitiveCounter {
  complexity = 0;
  private readonly countedLogical = new Set<ts.BinaryExpression>();

  constructor(private readonly recursive: ReadonlySet<ts.SignatureDeclaration>) {}

  visit(node: ts.Node, nesting: number, functionDepth: number) {
    if (ts.isFunctionLike(node)) {
      for (const expression of definitionExpressions(node)) this.visit(expression, nesting, functionDepth);
      this.visitFunction(node, nesting, functionDepth);
      return;
    }
    this.complexity += controlFlowIncrement(node, nesting) + logicalIncrement(node, this.countedLogical);
    const nested = nestedChildren(node);
    ts.forEachChild(node, child => {
      this.visit(child, nesting + Number(nested.includes(child)), functionDepth);
    });
  }

  visitFunction(node: ts.SignatureDeclaration, nesting: number, functionDepth: number) {
    if (!("body" in node) || node.body === undefined) return;
    this.complexity += Number(this.recursive.has(node));
    const declarative = isDeclarativeFunction(node.body) && !node.parameters.some(hasStructuralCode);
    const nested = nesting + Number(functionDepth > 0 && !declarative);
    const depth = functionDepth + Number(!declarative);
    for (const parameter of node.parameters) this.visit(parameter, nested, depth);
    this.visit(node.body, nested, depth);
  }
}

const declarationKinds = new Set([
  ts.SyntaxKind.VariableStatement, ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.InterfaceDeclaration, ts.SyntaxKind.TypeAliasDeclaration, ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.ModuleDeclaration,
]);

function isDeclarativeFunction(body: ts.ConciseBody) {
  return ts.isBlock(body) && body.statements.every(isDeclaration) && !hasStructuralCode(body);
}

function isDeclaration(node: ts.Statement) {
  if (declarationKinds.has(node.kind)) return true;
  if (!ts.isExpressionStatement(node) || !ts.isBinaryExpression(node.expression)) return false;
  if (node.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
  let value = node.expression.right;
  while (ts.isParenthesizedExpression(value)) value = value.expression;
  return ts.isFunctionExpression(value) || ts.isArrowFunction(value) || ts.isClassExpression(value);
}

function hasStructuralCode(node: ts.Node): boolean {
  if (ts.isFunctionLike(node)) return definitionExpressions(node).some(hasStructuralCode);
  return isStructural(node) || ts.forEachChild(node, hasStructuralCode) === true;
}

/** File cognitive complexity counts each syntax node once, including module-level code. */
export function fileComplexity(source: ts.SourceFile, recursive: ReadonlySet<ts.SignatureDeclaration>) {
  let complexity = 0;
  let functions = 0;
  function visit(node: ts.Node) {
    if (ts.isFunctionLike(node) && "body" in node && node.body !== undefined) {
      complexity++;
      functions++;
    }
    if (fileDecisionKinds.has(node.kind) || isLogicalExpression(node)) complexity++;
    ts.forEachChild(node, visit);
  }
  visit(source);
  const counter = new CognitiveCounter(recursive);
  counter.visit(source, 0, 0);
  return { complexity, cognitive: counter.complexity, functions };
}

const fileDecisionKinds = new Set([
  ts.SyntaxKind.IfStatement, ts.SyntaxKind.ConditionalExpression, ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement, ts.SyntaxKind.ForOfStatement, ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement, ts.SyntaxKind.CaseClause, ts.SyntaxKind.DefaultClause,
]);

function isStructural(node: ts.Node) {
  if (ts.isIfStatement(node)) return !(ts.isIfStatement(node.parent) && node.parent.elseStatement === node);
  return isNestingStructure(node);
}

export function definitionExpressions(node: ts.SignatureDeclaration) {
  if (!("body" in node) || node.body === undefined) return [];
  const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
  return [...computedNameExpressions(node.name), ...decorators.map(decorator => decorator.expression)];
}

function computedNameExpressions(name: ts.DeclarationName | undefined) {
  return name !== undefined && ts.isComputedPropertyName(name) ? [name.expression] : [];
}

function controlFlowIncrement(node: ts.Node, nesting: number) {
  if (ts.isIfStatement(node)) return conditionIncrement(node, nesting);
  if (isNestingStructure(node)) return nesting + 1;
  if (ts.isBreakStatement(node) || ts.isContinueStatement(node)) return Number(node.label !== undefined);
  return 0;
}

function conditionIncrement(node: ts.IfStatement, nesting: number) {
  const isElseIf = ts.isIfStatement(node.parent) && node.parent.elseStatement === node;
  const condition = isElseIf ? 1 : nesting + 1;
  const alternative = node.elseStatement !== undefined && !ts.isIfStatement(node.elseStatement);
  return condition + Number(alternative);
}

function isNestingStructure(node: ts.Node) {
  return ts.isIterationStatement(node, false) || ts.isSwitchStatement(node) ||
    ts.isCatchClause(node) || ts.isConditionalExpression(node);
}

function nestedChildren(node: ts.Node): readonly ts.Node[] {
  if (ts.isIterationStatement(node, false)) return [node.statement];
  if (ts.isCaseBlock(node)) return node.clauses;
  if (ts.isCatchClause(node)) return [node.block];
  return conditionalBranches(node);
}

function conditionalBranches(node: ts.Node): readonly ts.Node[] {
  if (ts.isConditionalExpression(node)) return [node.whenTrue, node.whenFalse];
  if (!ts.isIfStatement(node)) return [];
  if (node.elseStatement === undefined || ts.isIfStatement(node.elseStatement)) return [node.thenStatement];
  return [node.thenStatement, node.elseStatement];
}

const logicalOperators = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken,
]);

function isLogicalExpression(node: ts.Node): node is ts.BinaryExpression {
  return ts.isBinaryExpression(node) && logicalOperators.has(node.operatorToken.kind);
}

function logicalIncrement(node: ts.Node, counted: Set<ts.BinaryExpression>) {
  if (!isLogicalExpression(node) || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || counted.has(node)) return 0;
  const sequence = logicalSequence(node);
  for (const expression of sequence) counted.add(expression);
  return logicalSequenceCost(sequence);
}

function logicalSequenceCost(sequence: ts.BinaryExpression[]) {
  let complexity = 0;
  let previous: ts.SyntaxKind | undefined;
  for (const expression of sequence) {
    const operator = expression.operatorToken.kind;
    if (operator !== previous) complexity++;
    previous = operator;
  }
  return complexity;
}

function logicalSequence(node: ts.Node): ts.BinaryExpression[] {
  if (ts.isParenthesizedExpression(node)) return logicalSequence(node.expression);
  if (!isLogicalExpression(node) || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) return [];
  return [...logicalSequence(node.left), node, ...logicalSequence(node.right)];
}
