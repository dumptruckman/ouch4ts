import { dirname, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { cognitiveComplexity, fileComplexity } from "./cognitive.js";
import { recursiveFunctions } from "./recursion.js";
import { readLcov } from "./lcov.js";

export interface AnalysisOptions {
  sources: readonly { path: string; text: string }[];
  lcov: string;
  projectRoot?: string;
}

/** Analyze original JavaScript and TypeScript sources against LCOV mapped to those sources. */
export function analyze({ sources, lcov, projectRoot = process.cwd() }: AnalysisOptions) {
  return analyzeReport({ sources, lcov, projectRoot }).entries;
}

/** Return function and file scores from the same parsed sources. */
export function analyzeReport({ sources, lcov, projectRoot = process.cwd() }: AnalysisOptions) {
  const coverage = readLcov(lcov, projectRoot);
  const { program, parsed } = parseSources(sources, projectRoot);
  const recursive = recursiveFunctions(parsed.map(entry => entry.source), program.getTypeChecker());
  const files = parsed.map(({ path, source }) => ({
    file: relative(projectRoot, resolve(projectRoot, path)).split(sep).join("/"), ...fileComplexity(source, recursive),
  }));
  const entries = parsed.flatMap(({ path, source }) => {
    const analyzer = new SourceAnalyzer(source, coverage.get(resolve(projectRoot, path)), projectRoot, recursive);
    analyzer.visit(source);
    return analyzer.entries;
  }).sort(compareFunctionScores);
  files.sort((a, b) => b.cognitive - a.cognitive || a.file.localeCompare(b.file));
  return { entries, files };
}

function compareFunctionScores(a: ReturnType<typeof scoreFunction>, b: ReturnType<typeof scoreFunction>) {
  return (b.ouch ?? -1) - (a.ouch ?? -1) || a.file.localeCompare(b.file) || a.line - b.line;
}

class SourceAnalyzer {
  readonly entries: ReturnType<typeof scoreFunction>[] = [];

  constructor(private readonly source: ts.SourceFile, private readonly lines: Map<number, number> | undefined,
    private readonly root: string, private readonly recursive: ReadonlySet<ts.SignatureDeclaration>) {}

  visit(node: ts.Node, scope = "") {
    if (isRuntimeFunction(node)) {
      const name = scope + functionName(node, this.source);
      this.entries.push(scoreFunction(node, this.source, this.lines, name, this.root, this.recursive));
      ts.forEachChild(node, child => this.visit(child, name + "."));
      return;
    }
    const container = className(node);
    const nestedScope = container ? scope + container + "." : scope;
    ts.forEachChild(node, child => this.visit(child, nestedScope));
  }
}

function parseSources(sources: AnalysisOptions["sources"], root: string) {
  const parsed = sources.map(({ path, text }) => ({
    path, source: ts.createSourceFile(resolve(root, path), text, ts.ScriptTarget.Latest, true),
  }));
  const byPath = new Map(parsed.map(({ source }) => [source.fileName, source]));
  const directories = sourceDirectories(byPath.keys());
  const options = {
    noLib: true, allowJs: true, types: [],
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  };
  const program = ts.createProgram([...byPath.keys()], options, {
    ...ts.createCompilerHost(options),
    getCurrentDirectory: () => resolve(root),
    getSourceFile: file => byPath.get(resolve(root, file)),
    fileExists: file => byPath.has(resolve(root, file)),
    readFile: file => byPath.get(resolve(root, file))?.text,
    directoryExists: directory => directories.has(resolve(root, directory)),
    getDirectories: () => [],
    realpath: file => resolve(root, file),
  });
  for (const { path, source } of parsed) validateSourceSyntax(program, path, source);
  return { program, parsed };
}

function sourceDirectories(paths: Iterable<string>) {
  const directories = new Set<string>();
  for (const path of paths) {
    for (let directory = dirname(path); !directories.has(directory); directory = dirname(directory)) directories.add(directory);
  }
  return directories;
}

function validateSourceSyntax(program: ts.Program, path: string, source: ts.SourceFile) {
  const [error] = program.getSyntacticDiagnostics(source);
  if (error) throw new Error(`${path}: syntax error: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`);
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
  return assignedFunctionName(node, source) ?? unassignedFunctionName(node, source);
}

function unassignedFunctionName(node: RuntimeFunction, source: ts.SourceFile) {
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
  name: string, root: string, recursive: ReadonlySet<ts.SignatureDeclaration>) {
  const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const endLine = source.getLineAndCharacterOfPosition(node.end - 1).line + 1;
  const { complexity, range, nestedRanges } = functionStructure(node, source);
  const fraction = functionCoverage(lines, range, nestedRanges);
  const cognitive = cognitiveComplexity(node, recursive);
  return {
    name, file: relative(root, resolve(root, source.fileName)).split(sep).join("/"), line, endLine, complexity, cognitive,
    ...functionScores(complexity, cognitive, fraction),
  };
}

function functionScores(complexity: number, cognitive: number, fraction: number | null) {
  if (fraction === null) return { coverage: null, crap: null, ouch: null };
  const crap = complexity ** 2 * (1 - fraction) ** 3 + complexity;
  return { coverage: fraction * 100, crap, ouch: crap + cognitive };
}

function functionStructure(node: RuntimeFunction, source: ts.SourceFile) {
  const range = bodyRange(node, source);
  const counter = new FunctionSyntaxCounter(source);
  ts.forEachChild(node, child => counter.count(child));
  return { complexity: counter.complexity, range, nestedRanges: counter.nestedRanges };
}

class FunctionSyntaxCounter {
  readonly nestedRanges: NonNullable<ReturnType<typeof bodyRange>>[] = [];
  complexity = 1;

  constructor(private readonly source: ts.SourceFile) {}

  count(child: ts.Node) {
    if (isRuntimeFunction(child)) {
      this.recordNestedRange(child);
      return;
    }
    if (isDecision(child)) this.complexity++;
    ts.forEachChild(child, node => this.count(node));
  }

  private recordNestedRange(node: RuntimeFunction) {
    const nested = bodyRange(node, this.source);
    if (nested) this.nestedRanges.push(nested);
  }
}

function functionCoverage(lines: Map<number, number> | undefined, range: ReturnType<typeof bodyRange>,
  nestedRanges: NonNullable<ReturnType<typeof bodyRange>>[]) {
  const executable = [...(lines ?? [])].filter(([number]) => range && number >= range[0] && number <= range[1] &&
    !nestedRanges.some(([start, end]) => number >= start && number <= end));
  return executable.length === 0 ? null
    : executable.filter(([, hits]) => hits > 0).length / executable.length;
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
    isShortCircuitExpression(node);
}

function isShortCircuitExpression(node: ts.Node) {
  return ts.isBinaryExpression(node) && shortCircuitOperators.has(node.operatorToken.kind);
}

function hasDefaultValue(node: ts.Node) {
  return (ts.isParameter(node) || ts.isBindingElement(node)) && node.initializer !== undefined;
}

function isOptionalChainStep(node: ts.Node) {
  return (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node)) &&
    node.questionDotToken !== undefined;
}

function bodyRange(node: RuntimeFunction, source: ts.SourceFile) {
  const statements = bodyStatements(node.body);
  const first = statements[0];
  const last = statements.at(-1);
  if (!first || !last) return null;
  return [source.getLineAndCharacterOfPosition(first.getStart(source)).line + 1,
    source.getLineAndCharacterOfPosition(last.end - 1).line + 1] as const;
}

function bodyStatements(body: ts.ConciseBody) {
  return ts.isBlock(body) ? body.statements : [body];
}
