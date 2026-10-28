import ts from "typescript";
import { definitionExpressions, hasImplementation, isSimpleAssignment, unwrapExpression } from "./syntax.js";

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
      this.visitDefinition(node, nesting, functionDepth);
      return;
    }
    this.complexity += controlFlowIncrement(node, nesting) + logicalIncrement(node, this.countedLogical);
    const nested = childrenWithDeeperNesting(node);
    ts.forEachChild(node, child => {
      this.visit(child, nesting + Number(nested.includes(child)), functionDepth);
    });
  }

  private visitDefinition(node: ts.SignatureDeclaration, nesting: number, functionDepth: number) {
    for (const expression of definitionExpressions(node)) this.visit(expression, nesting, functionDepth);
    this.visitFunction(node, nesting, functionDepth);
  }

  visitFunction(node: ts.SignatureDeclaration, nesting: number, functionDepth: number) {
    if (!hasImplementation(node)) return;
    this.complexity += Number(this.recursive.has(node));
    const executable = !isDeclarativeFunction(node);
    const nested = nesting + Number(isNestedExecutableFunction(functionDepth, executable));
    const depth = functionDepth + Number(executable);
    for (const parameter of node.parameters) this.visit(parameter, nested, depth);
    this.visit(node.body, nested, depth);
  }
}

function isNestedExecutableFunction(depth: number, executable: boolean) {
  return depth > 0 && executable;
}

const declarationKinds = new Set([
  ts.SyntaxKind.VariableStatement, ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.InterfaceDeclaration, ts.SyntaxKind.TypeAliasDeclaration, ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.ModuleDeclaration,
]);

function isDeclarativeFunction(node: ts.FunctionLikeDeclaration & { body: ts.ConciseBody }) {
  return isDeclarationBlock(node.body) && !hasStructuralCode(node.body) && !node.parameters.some(hasStructuralCode);
}

function isDeclarationBlock(body: ts.ConciseBody) {
  return ts.isBlock(body) && body.statements.every(isDeclaration);
}

function isDeclaration(node: ts.Statement) {
  if (declarationKinds.has(node.kind)) return true;
  if (!ts.isExpressionStatement(node)) return false;
  return isDefinitionAssignment(node.expression);
}

function isDefinitionAssignment(node: ts.Expression) {
  if (!isSimpleAssignment(node)) return false;
  const value = unwrapExpression(node.right);
  return definitionKinds.has(value.kind);
}

const definitionKinds = new Set([
  ts.SyntaxKind.FunctionExpression, ts.SyntaxKind.ArrowFunction, ts.SyntaxKind.ClassExpression,
]);

function hasStructuralCode(node: ts.Node): boolean {
  if (ts.isFunctionLike(node)) return definitionExpressions(node).some(hasStructuralCode);
  return isStructural(node) || ts.forEachChild(node, hasStructuralCode) === true;
}

/** File cognitive complexity counts each syntax node once, including module-level code. */
export function fileComplexity(source: ts.SourceFile, recursive: ReadonlySet<ts.SignatureDeclaration>) {
  const syntax = new FileSyntaxCounter();
  syntax.visit(source);
  const counter = new CognitiveCounter(recursive);
  counter.visit(source, 0, 0);
  return { complexity: syntax.complexity, cognitive: counter.complexity, functions: syntax.functions };
}

class FileSyntaxCounter {
  complexity = 0;
  functions = 0;

  visit(node: ts.Node) {
    const implemented = hasImplementation(node);
    this.functions += Number(implemented);
    this.complexity += Number(implemented) + Number(isFileDecision(node));
    ts.forEachChild(node, child => this.visit(child));
  }
}

function isFileDecision(node: ts.Node) {
  return fileDecisionKinds.has(node.kind) || isLogicalExpression(node);
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

function controlFlowIncrement(node: ts.Node, nesting: number) {
  if (ts.isIfStatement(node)) return conditionIncrement(node, nesting);
  if (isNestingStructure(node)) return nesting + 1;
  return Number(isLabeledJump(node));
}

function isLabeledJump(node: ts.Node) {
  return (ts.isBreakStatement(node) || ts.isContinueStatement(node)) && node.label !== undefined;
}

function conditionIncrement(node: ts.IfStatement, nesting: number) {
  const condition = isElseIf(node) ? 1 : nesting + 1;
  return condition + Number(hasFinalElse(node));
}

function isElseIf(node: ts.IfStatement) {
  return ts.isIfStatement(node.parent) && node.parent.elseStatement === node;
}

function hasFinalElse(node: ts.IfStatement): node is ts.IfStatement & { elseStatement: ts.Statement } {
  return node.elseStatement !== undefined && !ts.isIfStatement(node.elseStatement);
}

function isNestingStructure(node: ts.Node) {
  return ts.isIterationStatement(node, false) || ts.isSwitchStatement(node) ||
    ts.isCatchClause(node) || ts.isConditionalExpression(node);
}

function childrenWithDeeperNesting(node: ts.Node): readonly ts.Node[] {
  if (ts.isIterationStatement(node, false)) return [node.statement];
  if (ts.isCaseBlock(node)) return node.clauses;
  return catchBody(node) ?? conditionalBranches(node);
}

function catchBody(node: ts.Node) {
  if (ts.isCatchClause(node)) return [node.block];
}

function conditionalBranches(node: ts.Node): readonly ts.Node[] {
  if (ts.isConditionalExpression(node)) return [node.whenTrue, node.whenFalse];
  if (!ts.isIfStatement(node)) return [];
  return ifBranchesWithDeeperNesting(node);
}

function ifBranchesWithDeeperNesting(node: ts.IfStatement): readonly ts.Statement[] {
  return hasFinalElse(node) ? [node.thenStatement, node.elseStatement] : [node.thenStatement];
}

const logicalOperators = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken,
]);

function isLogicalExpression(node: ts.Node): node is ts.BinaryExpression {
  return ts.isBinaryExpression(node) && logicalOperators.has(node.operatorToken.kind);
}

function logicalIncrement(node: ts.Node, counted: Set<ts.BinaryExpression>) {
  if (!isUncountedLogicalExpression(node, counted)) return 0;
  const sequence = logicalSequence(node);
  for (const expression of sequence) counted.add(expression);
  return logicalSequenceCost(sequence);
}

function isUncountedLogicalExpression(node: ts.Node, counted: ReadonlySet<ts.BinaryExpression>): node is ts.BinaryExpression {
  return isBooleanLogicalExpression(node) && !counted.has(node);
}

function isBooleanLogicalExpression(node: ts.Node): node is ts.BinaryExpression {
  return isLogicalExpression(node) && node.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken;
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

function logicalSequence(node: ts.Expression): ts.BinaryExpression[] {
  node = unwrapExpression(node);
  if (!isBooleanLogicalExpression(node)) return [];
  return [...logicalSequence(node.left), node, ...logicalSequence(node.right)];
}
