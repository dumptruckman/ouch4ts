import { relative, resolve, sep } from "node:path";
import ts from "typescript";
import { cognitiveComplexity } from "./cognitive.js";

export interface AnalysisOptions {
  sources: readonly { path: string; text: string }[];
  lcov: string;
  projectRoot?: string;
}

/** Analyze original JavaScript and TypeScript sources against LCOV mapped to those sources. */
export function analyze({ sources, lcov, projectRoot = process.cwd() }: AnalysisOptions) {
  const coverage = readLcov(lcov, projectRoot);
  return sources.flatMap(({ path, text }) => {
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const options = { noResolve: true, noLib: true, allowJs: true };
    const program = ts.createProgram([path], options, {
      ...ts.createCompilerHost(options),
      getSourceFile: file => resolve(file) === resolve(path) ? source : undefined,
    });
    const [error] = program.getSyntacticDiagnostics(source);
    if (error) throw new Error(`${path}: syntax error: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`);
    const entries: ReturnType<typeof scoreFunction>[] = [];
    const lines = coverage.get(resolve(projectRoot, path));
    function visit(node: ts.Node, scope = "") {
      if (isRuntimeFunction(node)) {
        const name = scope + functionName(node, source);
        entries.push(scoreFunction(node, source, lines, name, projectRoot));
        ts.forEachChild(node, child => visit(child, name + "."));
        return;
      }
      const container = className(node);
      ts.forEachChild(node, child => visit(child, container ? scope + container + "." : scope));
    }
    visit(source);
    return entries;
  }).sort((a, b) => (b.ouch ?? -1) - (a.ouch ?? -1) || a.file.localeCompare(b.file) || a.line - b.line);
}

function className(node: ts.Node) {
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) return node.name?.text;
}

type RuntimeFunction = (
  ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration |
  ts.GetAccessorDeclaration | ts.SetAccessorDeclaration | ts.ConstructorDeclaration
) & { body: ts.ConciseBody };

function isRuntimeFunction(node: ts.Node): node is RuntimeFunction {
  return runtimeFunctionKinds.has(node.kind) && "body" in node && node.body !== undefined;
}

const runtimeFunctionKinds = new Set([
  ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.FunctionExpression, ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration, ts.SyntaxKind.GetAccessor, ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.Constructor,
]);

function accessorPrefix(node: RuntimeFunction) {
  if (ts.isGetAccessorDeclaration(node)) return "get ";
  if (ts.isSetAccessorDeclaration(node)) return "set ";
  return "";
}

function functionName(node: RuntimeFunction, source: ts.SourceFile) {
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (node.name) return accessorPrefix(node) + node.name.getText(source);
  const assigned = assignedFunctionName(node, source);
  if (assigned !== undefined) return assigned;
  if (ts.isFunctionDeclaration(node)) return "default";
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `<anonymous@${line + 1}:${character + 1}>`;
}

function assignedFunctionName(node: RuntimeFunction, source: ts.SourceFile) {
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) {
    return parent.name.getText(source);
  }
}

function scoreFunction(node: RuntimeFunction, source: ts.SourceFile, lines: Map<number, number> | undefined,
  name: string, root: string) {
  const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const endLine = source.getLineAndCharacterOfPosition(node.end - 1).line + 1;
  const range = bodyRange(node, source);
  const nestedRanges: NonNullable<ReturnType<typeof bodyRange>>[] = [];
  let complexity = 1;
  function count(child: ts.Node) {
    if (isRuntimeFunction(child)) {
      const nested = bodyRange(child, source);
      if (nested) nestedRanges.push(nested);
      return;
    }
    if (isDecision(child)) complexity++;
    ts.forEachChild(child, count);
  }
  ts.forEachChild(node, count);
  const executable = [...(lines ?? [])].filter(([number]) => range && number >= range[0] && number <= range[1] &&
    !nestedRanges.some(([start, end]) => number >= start && number <= end));
  const fraction = executable.length === 0 ? null
    : executable.filter(([, hits]) => hits > 0).length / executable.length;
  const cognitive = cognitiveComplexity(node);
  const crap = fraction === null ? null : complexity ** 2 * (1 - fraction) ** 3 + complexity;
  return {
    name, file: relative(root, resolve(root, source.fileName)).split(sep).join("/"), line, endLine, complexity, cognitive,
    coverage: fraction === null ? null : fraction * 100,
    crap,
    ouch: crap === null ? null : crap + cognitive,
  };
}

const decisionKinds = new Set([
  ts.SyntaxKind.IfStatement, ts.SyntaxKind.ConditionalExpression, ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement, ts.SyntaxKind.ForOfStatement, ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement, ts.SyntaxKind.CatchClause, ts.SyntaxKind.CaseClause,
]);

const shortCircuitOperators = new Set([
  ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

function isDecision(node: ts.Node) {
  return decisionKinds.has(node.kind) || hasDefaultValue(node) || isOptionalChainStep(node) ||
    (ts.isBinaryExpression(node) && shortCircuitOperators.has(node.operatorToken.kind));
}

function hasDefaultValue(node: ts.Node) {
  return (ts.isParameter(node) || ts.isBindingElement(node)) && node.initializer !== undefined;
}

function isOptionalChainStep(node: ts.Node) {
  return (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node)) &&
    node.questionDotToken !== undefined;
}

function bodyRange(node: RuntimeFunction, source: ts.SourceFile) {
  const first = ts.isBlock(node.body) ? node.body.statements[0] : node.body;
  const last = ts.isBlock(node.body) ? node.body.statements.at(-1) : node.body;
  if (!first || !last) return null;
  return [source.getLineAndCharacterOfPosition(first.getStart(source)).line + 1,
    source.getLineAndCharacterOfPosition(last.end - 1).line + 1] as const;
}

function readLcov(text: string, root: string) {
  const files = new Map<string, Map<number, number>>();
  let lines: Map<number, number> | undefined;
  for (const record of text.split(/\r?\n/)) {
    lines = readCoverageRecord(record, root, files, lines);
  }
  validateLcovComplete(files, lines);
  return files;
}

function readCoverageRecord(record: string, root: string, files: Map<string, Map<number, number>>,
  lines: Map<number, number> | undefined) {
  if (record.startsWith("SF:")) return sourceCoverage(record, root, files, lines);
  if (record === "end_of_record") return undefined;
  if (record.startsWith("DA:")) recordLineCoverage(record, lines);
  return lines;
}

function sourceCoverage(record: string, root: string, files: Map<string, Map<number, number>>,
  current: Map<number, number> | undefined) {
  if (current || record.length === 3) throw new Error("Invalid LCOV source record");
  const path = resolve(root, record.slice(3));
  const lines = files.get(path) ?? new Map<number, number>();
  files.set(path, lines);
  return lines;
}

function recordLineCoverage(record: string, lines: Map<number, number> | undefined) {
  if (!lines) throw new Error(`Invalid LCOV line record: ${record}`);
  const { line, hits } = parseLineCoverage(record);
  lines.set(line, (lines.get(line) ?? 0) + hits);
}

function parseLineCoverage(record: string) {
  const [line, hits] = record.slice(3).split(",").map(Number);
  if (!isSafeCount(line, 1) || !isSafeCount(hits, 0) || !/^\d+,\d+(?:,.*)?$/.test(record.slice(3))) {
    throw new Error(`Invalid LCOV line record: ${record}`);
  }
  return { line, hits };
}

function isSafeCount(value: number | undefined, minimum: number): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= minimum;
}

function validateLcovComplete(files: Map<string, Map<number, number>>, current: Map<number, number> | undefined) {
  if (current) throw new Error("Incomplete LCOV report: missing end_of_record");
  if (files.size === 0) throw new Error("LCOV report contains no source records");
}
