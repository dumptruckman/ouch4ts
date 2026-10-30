import ts from "typescript";
import { recursiveCallNodes } from "./cycles.js";
import {
  assignmentContainer, definitionExpressions, hasImplementation, isAccessor, isAssignment, isAssignmentReference,
  isAssignmentTo, isInitializedDeclaration, isInvocation, isPropertyAccess, isUpdate, unwrapExpression,
} from "./syntax.js";
import type { Invocation, PropertyAccess } from "./syntax.js";

type CallGraph = Map<ts.SignatureDeclaration, Set<ts.SignatureDeclaration>>;
const noWrittenSymbols: ReadonlySet<ts.Symbol> = new Set();

/** Identify functions in direct or indirect cycles of statically resolved calls. */
export function recursiveFunctions(sources: readonly ts.SourceFile[], checker: ts.TypeChecker) {
  const builder = new CallGraphBuilder(checker, writtenSymbols(sources, checker));
  for (const source of sources) builder.visit(source);
  return recursiveCallNodes(builder.graph);
}

class CallGraphBuilder {
  readonly graph: CallGraph = new Map();

  constructor(private readonly checker: ts.TypeChecker, private readonly written: ReadonlySet<ts.Symbol>) {}

  visit(node: ts.Node, caller?: ts.SignatureDeclaration) {
    if (ts.isFunctionLike(node)) {
      this.visitFunction(node, caller);
      return;
    }
    if (caller) this.recordCalls(node, caller);
    ts.forEachChild(node, child => this.visit(child, caller));
  }

  private visitFunction(node: ts.SignatureDeclaration, caller: ts.SignatureDeclaration | undefined) {
    if (!hasImplementation(node)) return;
    this.graph.set(node, new Set());
    definitionExpressions(node).forEach(expression => this.visit(expression, caller));
    node.parameters.forEach(parameter => this.visit(parameter, node));
    this.visit(node.body, node);
  }

  private recordCalls(node: ts.Node, caller: ts.SignatureDeclaration) {
    if (isInvocation(node)) this.addTarget(caller, callTarget(node, this.checker, this.written));
    for (const target of accessorTargets(node, this.checker, this.written)) this.addTarget(caller, target);
  }

  private addTarget(caller: ts.SignatureDeclaration, target: ts.SignatureDeclaration | undefined) {
    if (target) this.graph.get(caller)!.add(target);
  }
}

function accessorTargets(node: ts.Node, checker: ts.TypeChecker, written?: ReadonlySet<ts.Symbol>) {
  if (!isPropertyAccess(node)) return [];
  if (isWrittenAccess(node, checker, written)) return [];
  const use = propertyUse(node);
  return memberDeclarations(node, checker, written).filter(declaration => isUsedAccessor(declaration, use));
}

function isWrittenAccess(node: PropertyAccess, checker: ts.TypeChecker, written: ReadonlySet<ts.Symbol> | undefined) {
  return written !== undefined && isWrittenTarget(node, checker, written);
}

function memberDeclarations(node: PropertyAccess, checker: ts.TypeChecker, written = noWrittenSymbols) {
  return new BindingLookup(checker, written).resolveMembers(node);
}

function symbolDeclarations(symbol: ts.Symbol | undefined) {
  return symbol?.declarations ?? [];
}

function isUsedAccessor(node: ts.Declaration, use: ReturnType<typeof propertyUse>): node is ts.GetAccessorDeclaration | ts.SetAccessorDeclaration {
  if (ts.isGetAccessorDeclaration(node)) return use.read;
  return ts.isSetAccessorDeclaration(node) && use.write;
}

function propertyUse(node: ts.Expression) {
  let expression: ts.Node = node;
  for (let container = assignmentContainer(expression); container; container = assignmentContainer(expression)) expression = container;
  return assignedPropertyUse(expression);
}

function assignedPropertyUse(expression: ts.Node) {
  const parent = expression.parent;
  if (ts.isDeleteExpression(parent)) return { read: false, write: false };
  return assignmentUse(expression) ?? { read: true, write: isUpdate(parent) };
}

function assignmentUse(expression: ts.Node) {
  const parent = expression.parent;
  if (isAssignmentTo(parent, expression)) {
    return { read: parent.operatorToken.kind !== ts.SyntaxKind.EqualsToken, write: true };
  }
  if (loopAssignmentTarget(parent) === expression) return { read: false, write: true };
}

function callTarget(node: Invocation, checker: ts.TypeChecker, written: ReadonlySet<ts.Symbol>) {
  const expression = invocationExpression(node);
  if (!isResolvableCall(expression, checker, written)) return;
  const value = new BindingLookup(checker, written).resolveValue(expression);
  return invocationImplementation(node, value, checker, written);
}

function invocationImplementation(node: Invocation, value: ts.Node | undefined, checker: ts.TypeChecker, written: ReadonlySet<ts.Symbol>) {
  if (!value) return;
  if (isCallableImplementation(value)) return value;
  return signatureImplementation(checker.getResolvedSignature(node)?.declaration, checker, written);
}

function invocationExpression(node: Invocation) {
  return ts.isTaggedTemplateExpression(node) ? node.tag : node.expression;
}

function isResolvableCall(expression: ts.Expression, checker: ts.TypeChecker, written: ReadonlySet<ts.Symbol>) {
  if (isWrittenTarget(expression, checker, written)) return false;
  return !ts.isElementAccessExpression(expression) || constantKey(expression.argumentExpression, checker) !== undefined;
}

function isCallableImplementation(node: ts.Node | undefined): node is ts.FunctionLikeDeclaration & { body: ts.ConciseBody } {
  return node !== undefined && hasImplementation(node) && !isAccessor(node);
}

function declarationSymbol(node: ts.SignatureDeclaration | ts.JSDocSignature, checker: ts.TypeChecker) {
  if ("name" in node && node.name) return checker.getSymbolAtLocation(node.name);
}

function signatureImplementation(declaration: ts.Signature["declaration"], checker: ts.TypeChecker, written: ReadonlySet<ts.Symbol>) {
  if (!declaration) return;
  const symbol = declarationSymbol(declaration, checker);
  if (isWrittenSymbol(symbol, written)) return;
  return implementationDeclaration(declaration, symbol);
}

function implementationDeclaration(declaration: ts.SignatureDeclaration | ts.JSDocSignature, symbol: ts.Symbol | undefined) {
  if (hasImplementation(declaration)) return declaration;
  if (ts.isConstructorDeclaration(declaration)) return declaration.parent.members.find(isImplementedConstructor);
  return symbolImplementation(symbol);
}

function symbolImplementation(symbol: ts.Symbol | undefined) {
  return symbol?.declarations?.find(hasImplementation);
}

function isImplementedConstructor(node: ts.ClassElement): node is ts.ConstructorDeclaration & { body: ts.Block } {
  return ts.isConstructorDeclaration(node) && node.body !== undefined;
}

function writtenSymbols(sources: readonly ts.SourceFile[], checker: ts.TypeChecker) {
  const collector = new WrittenSymbolCollector(checker);
  for (const source of sources) collector.visit(source);
  return collector.written;
}

class WrittenSymbolCollector {
  readonly written = new Set<ts.Symbol>();

  constructor(private readonly checker: ts.TypeChecker) {}

  private record(node: ts.Node) {
    if (isAssignmentReference(node)) {
      this.recordSymbol(assignedSymbol(node, this.checker));
      return;
    }
    ts.forEachChild(node, child => this.recordAssignmentChild(node, child));
  }

  private recordAssignmentChild(parent: ts.Node, child: ts.Node) {
    if (assignmentContainer(child) === parent || isAssignmentTo(parent, child)) this.record(child);
  }

  private recordSymbol(symbol: ts.Symbol | undefined) {
    if (symbol) this.written.add(symbol);
  }

  visit(node: ts.Node) {
    const target = reassignedExpression(node);
    if (target) this.record(target);
    ts.forEachChild(node, child => this.visit(child));
  }
}

function reassignedExpression(node: ts.Node) {
  if (isAssignment(node)) return node.left;
  if (isUpdate(node)) return node.operand;
  return loopAssignmentTarget(node);
}

function loopAssignmentTarget(node: ts.Node) {
  if (!isForInOrOf(node)) return;
  if (!ts.isVariableDeclarationList(node.initializer)) return node.initializer;
}

function isForInOrOf(node: ts.Node): node is ts.ForInStatement | ts.ForOfStatement {
  return ts.isForInStatement(node) || ts.isForOfStatement(node);
}

function assignedSymbol(node: ts.Identifier | PropertyAccess, checker: ts.TypeChecker) {
  if (writesAccessor(node, checker)) return;
  const symbol = assignmentSymbol(node, checker);
  if (!isAccessorSymbol(symbol)) return symbol;
}

function writesAccessor(node: ts.Identifier | PropertyAccess, checker: ts.TypeChecker) {
  return isPropertyAccess(node) && accessorTargets(node, checker).length > 0;
}

function isAccessorSymbol(symbol: ts.Symbol | undefined) {
  return symbol?.declarations?.some(isAccessor) === true;
}

function assignmentSymbol(node: ts.Identifier | PropertyAccess, checker: ts.TypeChecker) {
  const symbol = expressionSymbol(node, checker);
  if (symbol || !isPropertyAccess(node)) return symbol;
  return expressionSymbol(node.expression, checker);
}

function expressionSymbol(node: ts.Expression, checker: ts.TypeChecker) {
  const symbol = referencedSymbol(node, checker);
  return resolveAlias(symbol, checker);
}

function referencedSymbol(node: ts.Expression, checker: ts.TypeChecker) {
  if (isPropertyAccess(node)) return propertySymbol(node, checker);
  if (ts.isShorthandPropertyAssignment(node.parent)) return checker.getShorthandAssignmentValueSymbol(node.parent);
  return checker.getSymbolAtLocation(node);
}

function propertySymbol(node: PropertyAccess, checker: ts.TypeChecker) {
  return ts.isElementAccessExpression(node) ? elementSymbol(node, checker) : checker.getSymbolAtLocation(node.name);
}

function elementSymbol(node: ts.ElementAccessExpression, checker: ts.TypeChecker) {
  const key = constantKey(node.argumentExpression, checker);
  return key === undefined ? undefined : checker.getTypeAtLocation(node.expression).getProperty(key);
}

function resolveAlias(symbol: ts.Symbol | undefined, checker: ts.TypeChecker) {
  if (symbol && (symbol.flags & ts.SymbolFlags.Alias)) return checker.getAliasedSymbol(symbol);
  return symbol;
}

function isWrittenTarget(value: ts.Expression, checker: ts.TypeChecker, written: ReadonlySet<ts.Symbol>): boolean {
  const node = unwrapExpression(value);
  const symbol = expressionSymbol(node, checker);
  if (isWrittenSymbol(symbol, written)) return true;
  return isWrittenOwner(node, checker, written);
}

function isWrittenSymbol(symbol: ts.Symbol | undefined, written: ReadonlySet<ts.Symbol>) {
  return symbol !== undefined && written.has(symbol);
}

function isWrittenOwner(node: ts.Expression, checker: ts.TypeChecker, written: ReadonlySet<ts.Symbol>): boolean {
  return isPropertyAccess(node) && isWrittenTarget(node.expression, checker, written);
}

/** Each lookup owns its alias-cycle guard; independent calls never share visited bindings. */
class BindingLookup {
  constructor(private readonly checker: ts.TypeChecker, private readonly written: ReadonlySet<ts.Symbol>,
    private readonly seen = new Set<ts.Symbol>()) {}

  resolveValue(node: ts.Expression): ts.Node | undefined {
    const expression = unwrapExpression(node);
    if (ts.isIdentifier(expression)) return this.symbolValue(this.checker.getSymbolAtLocation(expression));
    if (isPropertyAccess(expression)) return this.memberValue(this.resolveMembers(expression).at(-1));
    return expression;
  }

  private memberValue(member: ts.Declaration | undefined): ts.Node | undefined {
    if (!member) return;
    if (ts.isShorthandPropertyAssignment(member)) return this.symbolValue(this.checker.getShorthandAssignmentValueSymbol(member));
    return this.declarationValue(member);
  }

  resolveMembers(node: PropertyAccess): readonly ts.Declaration[] {
    const owner = this.resolveValue(node.expression);
    if (!owner) return [];
    if (!ts.isObjectLiteralExpression(owner)) return symbolDeclarations(expressionSymbol(node, this.checker));
    const name = accessName(node, this.checker);
    return name === undefined ? [] : this.objectMembers(owner, name) ?? [];
  }

  /** Undefined means absent; an empty list means a spread left the target unresolved. */
  private objectMembers(owner: ts.ObjectLiteralExpression, name: string): readonly ts.Declaration[] | undefined {
    const accessors: ts.Declaration[] = [];
    let members: readonly ts.Declaration[] | undefined;
    for (const property of [...owner.properties].reverse()) {
      if (ts.isSpreadAssignment(property)) {
        members = this.spreadMembers(property.expression, name);
        if (members !== undefined) break;
      } else if (propertyName(property.name, this.checker) === name) {
        if (!isAccessor(property)) {
          members = [property];
          break;
        }
        if (!accessors.some(accessor => accessor.kind === property.kind)) accessors.push(property);
      }
    }
    return accessors.length ? accessors : members;
  }

  private spreadMembers(expression: ts.Expression, name: string): readonly ts.Declaration[] | undefined {
    const lookup = new BindingLookup(this.checker, this.written, new Set(this.seen));
    const owner = lookup.resolveValue(expression);
    if (!owner) return [];
    if (ts.isObjectLiteralExpression(owner)) return lookup.objectMembers(owner, name);
    return symbolDeclarations(this.checker.getTypeAtLocation(expression).getProperty(name));
  }

  private symbolValue(symbol: ts.Symbol | undefined): ts.Node | undefined {
    const resolved = resolveAlias(symbol, this.checker);
    if (!this.canResolveSymbol(resolved)) return;
    this.seen.add(resolved);
    return this.declaredValue(resolved);
  }

  private canResolveSymbol(symbol: ts.Symbol | undefined): symbol is ts.Symbol {
    return symbol !== undefined && !this.written.has(symbol) && !this.seen.has(symbol);
  }

  private declaredValue(symbol: ts.Symbol): ts.Node | undefined {
    const declaration = symbol.valueDeclaration;
    if (declaration) return this.declarationValue(declaration);
  }

  private declarationValue(node: ts.Declaration): ts.Node | undefined {
    if (isInitializedDeclaration(node) || ts.isPropertyAssignment(node)) return this.resolveValue(node.initializer);
    return node;
  }
}

function accessName(node: PropertyAccess, checker: ts.TypeChecker) {
  return ts.isPropertyAccessExpression(node) ? node.name.text : constantKey(node.argumentExpression, checker);
}

function propertyName(name: ts.PropertyName, checker: ts.TypeChecker) {
  return ts.isComputedPropertyName(name) ? constantKey(name.expression, checker) : name.text;
}

function constantKey(node: ts.Expression, checker: ts.TypeChecker) {
  const type = checker.getTypeAtLocation(node);
  if (type.isStringLiteral() || type.isNumberLiteral()) return String(type.value);
}
