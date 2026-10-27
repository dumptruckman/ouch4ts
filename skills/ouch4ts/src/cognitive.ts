import ts from "typescript";

/** Measure each function independently, keeping nested function bodies out of its score. */
export function cognitiveComplexity(node: ts.FunctionLikeDeclaration) {
  let complexity = 0;
  const countedLogical = new Set<ts.BinaryExpression>();
  function visit(child: ts.Node, nesting: number) {
    if (ts.isFunctionLike(child)) {
      for (const expression of definitionExpressions(child)) visit(expression, nesting);
      return;
    }
    complexity += controlFlowIncrement(child, nesting);
    complexity += logicalIncrement(child, countedLogical);
    const nested = nestedChildren(child);
    ts.forEachChild(child, descendant => {
      visit(descendant, nesting + Number(nested.includes(descendant)));
    });
  }
  for (const parameter of node.parameters) visit(parameter, 0);
  if (node.body !== undefined) visit(node.body, 0);
  return complexity;
}

type FileFunction = {
  own: number; nested: number; nestingPenalty: number; structural: boolean; componentName: boolean; returnsJsx: boolean;
};

/** SonarJS file metrics count module code and aggregate nested functions with their lexical nesting. */
export function fileComplexity(source: ts.SourceFile) {
  let complexity = 0;
  let cognitive = 0;
  let functions = 0;
  const countedLogical = new Set<ts.BinaryExpression>();
  function visit(node: ts.Node, nesting: number, depth: number, top?: FileFunction) {
    if (ts.isFunctionLike(node)) {
      if (!("body" in node) || node.body === undefined) return;
      for (const expression of definitionExpressions(node)) visit(expression, nesting, depth, top);
      complexity++;
      functions++;
      const group = depth === 0 ? {
        own: 0, nested: 0, nestingPenalty: 0, structural: false,
        componentName: hasComponentName(node), returnsJsx: false,
      } : top;
      const functionNesting = nesting + Number(depth > 1);
      for (const parameter of node.parameters) visit(parameter, functionNesting, depth + 1, group);
      visit(node.body, functionNesting, depth + 1, group);
      if (depth === 0 && group) {
        const component = group.componentName && group.returnsJsx;
        cognitive += group.own + group.nested + (group.structural && !component ? group.nestingPenalty : 0);
      }
      return;
    }
    if (fileDecisionKinds.has(node.kind) || isLogicalExpression(node)) complexity++;
    const increment = controlFlowIncrement(node, nesting) + logicalIncrement(node, countedLogical);
    const structural = isStructural(node);
    if (depth === 0) cognitive += increment;
    else if (top && depth === 1) {
      top.own += increment;
      top.structural ||= structural;
      if (ts.isReturnStatement(node)) top.returnsJsx ||= isJsxReturn(node.expression);
    } else if (top) {
      top.nested += increment;
      top.nestingPenalty += Number(structural);
    }
    const nested = nestedChildren(node);
    ts.forEachChild(node, child => visit(child, nesting + Number(nested.includes(child)), depth, top));
  }
  visit(source, 0, 0);
  return { complexity, cognitive, functions };
}

function hasComponentName(node: ts.SignatureDeclaration) {
  let parent = node.parent;
  while (ts.isParenthesizedExpression(parent)) parent = parent.parent;
  const name = (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name
    ? node.name : ts.isVariableDeclaration(parent) ? parent.name : undefined;
  if (name === undefined || !ts.isIdentifier(name)) return false;
  return name.text[0] === name.text[0]?.toUpperCase();
}

function isJsxReturn(expression: ts.Expression | undefined): boolean {
  if (expression === undefined) return false;
  if (ts.isParenthesizedExpression(expression)) return isJsxReturn(expression.expression);
  return ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression) || ts.isJsxFragment(expression);
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

function definitionExpressions(node: ts.SignatureDeclaration) {
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
  if (!isLogicalExpression(node) || counted.has(node)) return 0;
  const sequence = logicalSequence(node);
  for (const expression of sequence) counted.add(expression);
  return isJsxShortCircuit(node) ? 0 : logicalSequenceCost(sequence);
}

function logicalSequenceCost(sequence: ts.BinaryExpression[]) {
  let complexity = 0;
  let previous: ts.SyntaxKind | undefined;
  for (const expression of sequence) {
    const operator = expression.operatorToken.kind;
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken && operator !== previous) complexity++;
    previous = operator;
  }
  return complexity;
}

function logicalSequence(node: ts.Node): ts.BinaryExpression[] {
  if (ts.isParenthesizedExpression(node)) return logicalSequence(node.expression);
  if (!isLogicalExpression(node)) return [];
  return [...logicalSequence(node.left), node, ...logicalSequence(node.right)];
}

function isJsxShortCircuit(node: ts.BinaryExpression) {
  let parent = node.parent;
  while (ts.isParenthesizedExpression(parent)) parent = parent.parent;
  return ts.isJsxExpression(parent) && hasUniformLogicalOperator(node, node.operatorToken.kind);
}

function hasUniformLogicalOperator(node: ts.Node, operator: ts.SyntaxKind): boolean {
  if (ts.isParenthesizedExpression(node)) return hasUniformLogicalOperator(node.expression, operator);
  if (!isLogicalExpression(node)) return !ts.isConditionalExpression(node);
  return node.operatorToken.kind === operator && hasUniformLogicalOperator(node.left, operator) &&
    hasUniformLogicalOperator(node.right, operator);
}
