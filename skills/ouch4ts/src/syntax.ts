import ts from "typescript";

export type PropertyAccess = ts.PropertyAccessExpression | ts.ElementAccessExpression;
export type Invocation = ts.CallExpression | ts.NewExpression | ts.TaggedTemplateExpression;

export function isInvocation(node: ts.Node): node is Invocation {
  return ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node);
}

export function isPropertyAccess(node: ts.Node): node is PropertyAccess {
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
}

export function assignmentContainer(node: ts.Node) {
  const parent = node.parent;
  if (isExpressionWrapper(parent)) return parent;
  if (isDestructuringContainer(parent, node)) return parent;
}

function isDestructuringContainer(parent: ts.Node, child: ts.Node) {
  if (ts.isArrayLiteralExpression(parent)) return true;
  if (ts.isObjectLiteralExpression(parent)) return isObjectAssignmentElement(child);
  return containsAssignedExpression(parent, child);
}

function isObjectAssignmentElement(node: ts.Node) {
  return ts.isPropertyAssignment(node) || ts.isSpreadAssignment(node);
}

function containsAssignedExpression(parent: ts.Node, child: ts.Node) {
  if (ts.isPropertyAssignment(parent)) return parent.initializer === child;
  if (isSpread(parent)) return parent.expression === child;
  return false;
}

function isSpread(node: ts.Node): node is ts.SpreadElement | ts.SpreadAssignment {
  return ts.isSpreadElement(node) || ts.isSpreadAssignment(node);
}

export function isAssignmentTo(parent: ts.Node, expression: ts.Node): parent is ts.BinaryExpression {
  return isAssignment(parent) && parent.left === expression;
}

export function isAssignmentReference(node: ts.Node): node is ts.Identifier | PropertyAccess {
  return ts.isIdentifier(node) || isPropertyAccess(node);
}

export function isAssignment(node: ts.Node): node is ts.BinaryExpression {
  return ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind);
}

function isAssignmentOperator(kind: ts.SyntaxKind) {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

export function isUpdate(node: ts.Node): node is ts.PrefixUnaryExpression | ts.PostfixUnaryExpression {
  return isUnaryExpression(node) && updateOperators.has(node.operator);
}

function isUnaryExpression(node: ts.Node): node is ts.PrefixUnaryExpression | ts.PostfixUnaryExpression {
  return ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node);
}

export function isAccessor(node: ts.Node) {
  return ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
}

function isExpressionWrapper(node: ts.Node) {
  return ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
    || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node);
}

export function unwrapExpression(node: ts.Expression) {
  while (isExpressionWrapper(node)) node = node.expression;
  return node;
}

export function isInitializedDeclaration(node: ts.Node): node is (ts.VariableDeclaration | ts.PropertyDeclaration) & { initializer: ts.Expression } {
  return (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) && node.initializer !== undefined;
}

export function literalPropertyName(node: ts.Node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
}

export function hasImplementation(node: ts.Node): node is ts.FunctionLikeDeclaration & { body: ts.ConciseBody } {
  return ts.isFunctionLike(node) && "body" in node && node.body !== undefined;
}

export function hasFunctionBody(node: ts.SignatureDeclaration): node is ts.FunctionLikeDeclaration & { body: ts.ConciseBody } {
  return "body" in node && node.body !== undefined;
}

export function definitionExpressions(node: ts.SignatureDeclaration) {
  if (!hasFunctionBody(node)) return [];
  const decorators = functionDecorators(node);
  return [...computedNameExpressions(node.name), ...decorators.map(decorator => decorator.expression)];
}

function functionDecorators(node: ts.SignatureDeclaration) {
  return ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
}

function computedNameExpressions(name: ts.DeclarationName | undefined) {
  return name !== undefined && ts.isComputedPropertyName(name) ? [name.expression] : [];
}

export function isSimpleAssignment(node: ts.Node): node is ts.BinaryExpression {
  return ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken;
}

const updateOperators = new Set([ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken]);
