import { relative, resolve, sep } from "node:path";
import ts from "typescript";

export interface AnalysisOptions {
  sources: readonly { path: string; text: string }[];
  lcov: string;
  projectRoot?: string;
}

/** Analyze original TypeScript sources against an LCOV report remapped to those sources. */
export function analyze({ sources, lcov, projectRoot = process.cwd() }: AnalysisOptions) {
  const coverage = readLcov(lcov, projectRoot);
  return sources.flatMap(({ path, text }) => {
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const options = { noResolve: true, noLib: true };
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
      const container = (ts.isClassDeclaration(node) || ts.isClassExpression(node)) ? node.name?.text : undefined;
      ts.forEachChild(node, child => visit(child, container ? scope + container + "." : scope));
    }
    visit(source);
    return entries;
  }).sort((a, b) => (b.crap ?? -1) - (a.crap ?? -1) || a.file.localeCompare(b.file) || a.line - b.line);
}

type RuntimeFunction = (
  ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration |
  ts.GetAccessorDeclaration | ts.SetAccessorDeclaration | ts.ConstructorDeclaration
) & { body: ts.ConciseBody };

function isRuntimeFunction(node: ts.Node): node is RuntimeFunction {
  return (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)) && node.body !== undefined;
}

function functionName(node: RuntimeFunction, source: ts.SourceFile) {
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (node.name) {
    const prefix = ts.isGetAccessorDeclaration(node) ? "get " : ts.isSetAccessorDeclaration(node) ? "set " : "";
    return prefix + node.name.getText(source);
  }
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) {
    return parent.name.getText(source);
  }
  if (ts.isFunctionDeclaration(node)) return "default";
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `<anonymous@${line + 1}:${character + 1}>`;
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
    if (ts.isIfStatement(child) || ts.isConditionalExpression(child) || ts.isForStatement(child) ||
      ts.isForInStatement(child) || ts.isForOfStatement(child) || ts.isWhileStatement(child) ||
      ts.isDoStatement(child) || ts.isCatchClause(child) || ts.isCaseClause(child) ||
      ((ts.isParameter(child) || ts.isBindingElement(child)) && child.initializer !== undefined) ||
      ((ts.isPropertyAccessExpression(child) || ts.isElementAccessExpression(child) || ts.isCallExpression(child)) &&
        child.questionDotToken !== undefined) ||
      (ts.isBinaryExpression(child) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken,
        ts.SyntaxKind.QuestionQuestionEqualsToken].includes(child.operatorToken.kind))) complexity++;
    ts.forEachChild(child, count);
  }
  ts.forEachChild(node, count);
  const executable = [...(lines ?? [])].filter(([number]) => range && number >= range[0] && number <= range[1] &&
    !nestedRanges.some(([start, end]) => number >= start && number <= end));
  const fraction = executable.length === 0 ? null
    : executable.filter(([, hits]) => hits > 0).length / executable.length;
  return {
    name, file: relative(root, resolve(root, source.fileName)).split(sep).join("/"), line, endLine, complexity,
    coverage: fraction === null ? null : fraction * 100,
    crap: fraction === null ? null : complexity ** 2 * (1 - fraction) ** 3 + complexity,
  };
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
    if (record.startsWith("SF:")) {
      if (lines || record.length === 3) throw new Error("Invalid LCOV source record");
      const path = resolve(root, record.slice(3));
      lines = files.get(path) ?? new Map<number, number>();
      files.set(path, lines);
    } else if (record.startsWith("DA:")) {
      const [line, hits] = record.slice(3).split(",").map(Number);
      if (!lines || line === undefined || hits === undefined || !Number.isSafeInteger(line) || line < 1 ||
        !Number.isSafeInteger(hits) || hits < 0 || !/^\d+,\d+(?:,.*)?$/.test(record.slice(3))) {
        throw new Error(`Invalid LCOV line record: ${record}`);
      }
      lines.set(line, (lines.get(line) ?? 0) + hits);
    } else if (record === "end_of_record") {
      lines = undefined;
    }
  }
  if (lines) throw new Error("Incomplete LCOV report: missing end_of_record");
  if (files.size === 0) throw new Error("LCOV report contains no source records");
  return files;
}
