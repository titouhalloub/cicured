import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import {
  CodeGraph as CodeGraphSchema,
  type CodeGraph,
  type CodeGraphFile,
  type CodeGraphFunction,
  type CodeGraphWarning,
} from "@sft/schemas";
import * as ts from "typescript";

const execFileAsync = promisify(execFile);

export interface BuildOptions {
  rootDir: string;
  testFilePatterns?: string[];
  excludePatterns?: string[];
  maxFiles?: number;
}

export const DEFAULT_TEST_PATTERNS: readonly string[] = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
];

export const DEFAULT_EXCLUDE_PATTERNS: readonly string[] = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.next/**",
  "**/coverage/**",
  "**/.sft/**",
];

export const DEFAULT_MAX_FILES = 5000;

/** Cache location relative to the repo root. */
const CACHE_DIR = ".sft";
const CACHE_FILE = "graph.json";

function cacheHours(): number {
  const raw = process.env.SFT_GRAPH_CACHE_HOURS;
  const parsed = raw === undefined ? Number.NaN : Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Minimal glob → RegExp. Supports `**` (any depth), `*` (any non-separator)
 * and `?`. Sufficient for the fixed pattern shapes above; not a general
 * glob engine.
 */
function globToRegExp(pattern: string): RegExp {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      let j = i;
      while (pattern[j] === "*") j++;
      if (pattern[j] === "/") {
        re += "(?:.*/)?";
        i = j + 1;
      } else {
        re += ".*";
        i = j;
      }
      continue;
    }
    if (c === "?") {
      re += "[^/]";
      i += 1;
      continue;
    }
    if ("\\^$.|+()[]{}".includes(c)) re += `\\${c}`;
    else re += c;
    i += 1;
  }
  return new RegExp(`^${re}$`);
}

function matchesAny(relPath: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(relPath));
}

function isUnder(rootDir: string, absPath: string): boolean {
  const rel = path.relative(rootDir, absPath);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function discoverFiles(rootDir: string, exclude: readonly string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = toPosix(path.relative(rootDir, abs));
      if (entry.isDirectory()) {
        if (matchesAny(`${rel}/`, exclude)) continue;
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.d\.ts$/.test(entry.name)) continue;
      if (matchesAny(rel, exclude)) continue;
      found.push(abs);
    }
  };
  walk(rootDir);
  return found.sort();
}

/** Resolves `tsconfig.json` when present; otherwise discovers source files. */
function createProgram(
  rootDir: string,
  exclude: readonly string[],
): ts.Program {
  const configPath = path.join(rootDir, "tsconfig.json");
  if (existsSync(configPath)) {
    const parsed = ts.parseConfigFileTextToJson(
      configPath,
      readFileSync(configPath, "utf8"),
    );
    if (parsed.error === undefined) {
      // ts.sys satisfies ParseConfigHost (fileExists/readFile/readDirectory/
      // useCaseSensitiveFileNames); TS collects config errors on the returned
      // ParsedCommandLine instead of a reporter callback.
      const resolved = ts.parseJsonConfigFileContent(
        parsed.config,
        ts.sys,
        rootDir,
        undefined,
        configPath,
      );
      if (resolved.errors.length > 0) {
        // An unusable config falls back to direct discovery. TS collects
        // config errors on the returned ParsedCommandLine rather than throwing,
        // so this branch is deliberately silent - buildCodeGraph is best-effort
        // and callers must not depend on a program being produced.
        return ts.createProgram(discoverFiles(rootDir, exclude), {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          ...resolved.options,
        });
      }
      return ts.createProgram(resolved.fileNames, resolved.options);
    }
  }
  const fallback: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  };
  return ts.createProgram(discoverFiles(rootDir, exclude), fallback);
}

/**
 * Resolves a relative specifier to an absolute file path that is actually in
 * the graph, working purely against the discovered file set — never the
 * filesystem. That keeps excluded specifiers from becoming phantom nodes and
 * makes the output byte-identical on Windows and Linux.
 *
 * Bare specifiers (`react`, `@sft/schemas`) return null and are treated as out
 * of scope by the caller: node_modules is not part of the repo graph.
 */
function resolveModule(
  fromAbs: string,
  spec: string,
  rootDir: string,
  knownByRel: ReadonlySet<string>,
): string | null {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return null;
  const fromRel = toPosix(path.relative(rootDir, fromAbs));
  const base = path.posix.join(path.posix.dirname(fromRel), spec);
  const normalized = path.posix.normalize(base);
  for (const candidate of [
    `${normalized}.ts`,
    `${normalized}.tsx`,
    `${normalized}/index.ts`,
    `${normalized}/index.tsx`,
  ]) {
    if (knownByRel.has(candidate)) return candidate;
  }
  return null;
}

function collectCalls(node: ts.Node, out: Set<string>): void {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee)) out.add(callee.text);
    else if (ts.isPropertyAccessExpression(callee)) out.add(callee.name.text);
  }
  ts.forEachChild(node, (child) => collectCalls(child, out));
}

interface RawFile {
  rel: string;
  abs: string;
  isTest: boolean;
  /** Repo-relative forward-slash paths of resolved relative imports. */
  imports: string[];
  /** Same as `imports` — parallel array kept for the edge passes. */
  importEdges: string[];
  functions: CodeGraphFunction[];
  /** Every identifier bound by an import or named as a callee in this file. */
  referenced: string[];
}

function extractImports(
  sf: ts.SourceFile,
  resolve: (spec: string) => string | null,
): { display: string[]; edges: string[]; unresolved: string[] } {
  const display: string[] = [];
  const edges: string[] = [];
  const unresolved: string[] = [];
  const visit = (node: ts.Node): void => {
    let spec: string | undefined;
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      spec = node.moduleSpecifier.text;
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      spec = node.moduleSpecifier.text;
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      spec = node.arguments[0].text;
    }
    if (spec !== undefined) {
      if (!spec.startsWith("./") && !spec.startsWith("../")) {
        // Bare specifiers (react, node:fs, @scope/pkg) are out of scope.
        // No edge, no display entry, no warning.
      } else {
        const resolvedRel = resolve(spec);
        if (resolvedRel !== null) {
          edges.push(resolvedRel);
          display.push(resolvedRel);
        } else {
          unresolved.push(spec);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { display, edges, unresolved };
}

function referencedNames(sf: ts.SourceFile): string[] {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause;
      if (clause.name) names.add(clause.name.text);
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          names.add(clause.namedBindings.name.text);
        } else {
          for (const el of clause.namedBindings.elements) names.add(el.name.text);
        }
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) names.add(callee.text);
      else if (ts.isPropertyAccessExpression(callee)) names.add(callee.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...names];
}

function isExported(node: ts.Node): boolean {
  const flags = ts.getCombinedModifierFlags(node as ts.Declaration);
  return (flags & ts.ModifierFlags.Export) !== 0;
}

/**
 * Function declarations, arrow/function expressions bound to a const, and
 * methods of exported classes. `file` is rewritten by the caller once the
 * repo-relative path is known.
 */
function extractFunctions(sf: ts.SourceFile): CodeGraphFunction[] {
  const out: CodeGraphFunction[] = [];
  const push = (name: string, body: ts.Node): void => {
    const calls = new Set<string>();
    collectCalls(body, calls);
    out.push({
      name,
      file: sf.fileName,
      line: sf.getLineAndCharacterOfPosition(body.getStart(sf)).line + 1,
      callsTo: [...calls].sort(),
      calledBy: [],
      referencedIn: [],
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      push(node.name.text, node);
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer)) &&
      ts.isIdentifier(node.name)
    ) {
      push(node.name.text, node.initializer);
    } else if (
      ts.isMethodDeclaration(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
    ) {
      const parent = node.parent;
      const inExportedClass =
        parent !== undefined &&
        (ts.isClassDeclaration(parent) || ts.isClassExpression(parent)) &&
        isExported(parent);
      if (inExportedClass) push(node.name.getText(sf), node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function emptyGraph(rootDir: string, gitSha: string | null, reason: string): CodeGraph {
  return {
    version: 1,
    repoRoot: toPosix(rootDir),
    gitSha,
    builtAt: new Date().toISOString(),
    files: [],
    warnings: [{ path: toPosix(rootDir), reason }],
  };
}

async function readGitSha(rootDir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: rootDir,
      timeout: 5000,
      windowsHide: true,
    });
    const sha = stdout.trim();
    return sha.length > 0 ? sha : null;
  } catch {
    return null;
  }
}

/** Files reachable from `start` via import edges, breadth-first, depth-capped. */
function reachableFrom(
  start: string,
  edges: Map<string, string[]>,
  depthCap: number,
): Set<string> {
  const seen = new Set<string>();
  let frontier = edges.get(start) ?? [];
  let depth = 0;
  while (frontier.length > 0 && depth < depthCap) {
    const next: string[] = [];
    for (const f of frontier) {
      if (seen.has(f)) continue;
      seen.add(f);
      next.push(...(edges.get(f) ?? []));
    }
    frontier = next;
    depth += 1;
  }
  return seen;
}

/**
 * Builds the code graph for `rootDir`. Never throws: any failure yields an
 * empty graph with a single warning naming the error.
 */
export async function buildCodeGraph(opts: BuildOptions): Promise<CodeGraph> {
  const rootDir = path.resolve(opts.rootDir);
  const testPatterns = opts.testFilePatterns ?? [...DEFAULT_TEST_PATTERNS];
  const exclude = opts.excludePatterns ?? [...DEFAULT_EXCLUDE_PATTERNS];
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;

  try {
    const gitSha = await readGitSha(rootDir);

    // Content-addressed cache: same commit ⇒ same graph, so reuse it.
    const cached = await readCachedGraph(rootDir, gitSha);
    if (cached !== null) return cached;

    const program = createProgram(rootDir, exclude);
    const raw: RawFile[] = [];
    for (const sf of program.getSourceFiles()) {
      if (!isUnder(rootDir, sf.fileName)) continue;
      const rel = toPosix(path.relative(rootDir, sf.fileName));
      if (matchesAny(rel, exclude)) continue;
      const isTest = matchesAny(rel, testPatterns);
      raw.push({
        rel,
        abs: sf.fileName,
        isTest,
        imports: [],
        importEdges: [],
        functions: extractFunctions(sf),
        referenced: referencedNames(sf),
      });
    }

    if (raw.length > maxFiles) {
      return emptyGraph(
        rootDir,
        gitSha,
        `file count ${raw.length} exceeds maxFiles ${maxFiles}`,
      );
    }

    if (raw.length === 0) {
      // A missing/unreadable root, or a root with no TS sources. Same shape as
      // the maxFiles overflow: empty graph + one warning naming the cause.
      return emptyGraph(
        rootDir,
        gitSha,
        `no source files found under ${toPosix(rootDir)}`,
      );
    }

    // Resolve imports only against files that are actually in the graph, so an
    // excluded or unresolvable spec never becomes a phantom node.
    const knownByRel = new Set(raw.map((f) => f.rel));
    const importWarnings: CodeGraphWarning[] = [];
    for (const file of raw) {
      const sf = program.getSourceFile(file.abs);
      if (sf === undefined) continue;
      const resolve = (spec: string): string | null =>
        resolveModule(file.abs, spec, rootDir, knownByRel);
      const { display, edges, unresolved } = extractImports(sf, resolve);
      file.imports = display;
      file.importEdges = edges;
      for (const spec of unresolved) {
        importWarnings.push({
          path: file.rel,
          reason: `unresolved import: ${spec}`,
        });
      }
    }


    // Second pass — reverse indexes, keyed by repo-relative path throughout.
    const edges = new Map<string, string[]>(
      raw.map((f) => [f.rel, [...new Set(f.importEdges)]]),
    );
    const reach = new Map<string, Set<string>>(
      raw.map((f) => [f.rel, reachableFrom(f.rel, edges, 5)]),
    );
    const importedBy = new Map<string, string[]>(raw.map((f) => [f.rel, []]));
    for (const file of raw) {
      for (const target of edges.get(file.rel) ?? []) {
        const list = importedBy.get(target);
        if (list !== undefined) list.push(file.rel);
      }
    }
    for (const list of importedBy.values()) list.sort();

    // calledBy / referencedIn: a caller counts when it lives in the same file
    // or in a file that (transitively) imports the defining file. Without the
    // import qualification any same-named function anywhere would link.
    for (const file of raw) {
      for (const fn of file.functions) {
        const callers = new Set<string>();
        const referencers = new Set<string>();
        for (const other of raw) {
          if (other.rel === file.rel) continue;
          if (!(reach.get(other.rel) ?? new Set()).has(file.rel)) continue;
          for (const otherFn of other.functions) {
            if (otherFn.callsTo.includes(fn.name)) callers.add(otherFn.name);
          }
          if (other.referenced.includes(fn.name)) referencers.add(other.rel);
        }
        // Same-file callers always count.
        for (const otherFn of file.functions) {
          if (otherFn.name !== fn.name && otherFn.callsTo.includes(fn.name)) {
            callers.add(otherFn.name);
          }
        }
        fn.calledBy = [...callers].sort();
        fn.referencedIn = [...referencers].sort();
      }
    }

    // Third pass — which test files transitively import each file?
    const testsFor = new Map<string, string[]>(raw.map((f) => [f.rel, []]));
    for (const file of raw) {
      if (!file.isTest) continue;
      for (const target of reach.get(file.rel) ?? new Set()) {
        const list = testsFor.get(target);
        if (list !== undefined && target !== file.rel) list.push(file.rel);
      }
    }
    for (const list of testsFor.values()) list.sort();

    const files: CodeGraphFile[] = raw.map((f) => ({
      path: f.rel,
      imports: [...f.imports],
      importedBy: importedBy.get(f.rel) ?? [],
      functions: f.functions.map((fn) => ({ ...fn, file: f.rel })),
      tests: testsFor.get(f.rel) ?? [],
    }));

    return {
      version: 1,
      repoRoot: toPosix(rootDir),
      gitSha,
      builtAt: new Date().toISOString(),
      files,
      warnings: importWarnings,
    };
  } catch (err) {
    return emptyGraph(
      rootDir,
      null,
      err instanceof Error ? err.message : String(err),
    );
  }
}



/** Looks up a file by its repo-relative path. */
export function findFile(
  graph: CodeGraph,
  relativePath: string,
): CodeGraphFile | null {
  const target = toPosix(relativePath);
  return graph.files.find((f) => f.path === target) ?? null;
}

/** Every function in the graph matching `name` — names are not unique. */
export function findFunction(
  graph: CodeGraph,
  name: string,
): CodeGraphFunction[] {
  return graph.files.flatMap((f) => f.functions.filter((fn) => fn.name === name));
}

export interface Neighborhood {
  file: CodeGraphFile;
  function?: CodeGraphFunction;
  callers: CodeGraphFunction[];
  callees: CodeGraphFunction[];
  tests: string[];
}

/**
 * Maps the blast radius of a finding: the file, the enclosing function (the
 * closest declaration at or above the reported line), everything that calls
 * it, everything it calls, and the test files covering it.
 */
export function blastRadiusFor(
  graph: CodeGraph,
  finding: { file: string; line: number },
): Neighborhood | null {
  const file = findFile(graph, finding.file);
  if (file === null) return null;

  const candidates = file.functions
    .filter((fn) => fn.line <= finding.line)
    .sort((a, b) => b.line - a.line);
  const fn = candidates[0];
  const calleeNames = fn === undefined ? [] : fn.callsTo;

  const callers =
    fn === undefined
      ? []
      : graph.files.flatMap((f) =>
          f.functions.filter(
            (c) => c.file !== file.path && fn.calledBy.includes(c.name),
          ),
        );
  const callees = graph.files.flatMap((f) =>
    f.functions.filter((c) => calleeNames.includes(c.name)),
  );

  return { file, function: fn, callers, callees, tests: file.tests };
}

function cachePathFor(rootDir: string): string {
  return path.join(rootDir, CACHE_DIR, CACHE_FILE);
}

/**
 * Reads the cached graph, honouring commit and TTL. Returns null when there
 * is no usable cache so the caller rebuilds.
 */
export async function readCachedGraph(
  rootDir: string,
  gitSha: string | null,
): Promise<CodeGraph | null> {
  if (gitSha === null) return null;
  const cachePath = cachePathFor(rootDir);
  if (!existsSync(cachePath)) return null;
  try {
    const parsed = CodeGraphSchema.parse(
      JSON.parse(readFileSync(cachePath, "utf8")),
    );
    if (parsed.gitSha !== gitSha) return null;
    const ageHours = (Date.now() - new Date(parsed.builtAt).getTime()) / 3_600_000;
    if (!Number.isFinite(ageHours) || ageHours > cacheHours()) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persists the graph to `<rootDir>/.sft/graph.json`. Best-effort. */
export async function writeCachedGraph(
  rootDir: string,
  graph: CodeGraph,
): Promise<void> {
  try {
    mkdirSync(path.join(rootDir, CACHE_DIR), { recursive: true });
    writeFileSync(
      cachePathFor(rootDir),
      `${JSON.stringify(graph, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // A read-only or missing workspace must not fail the build.
  }
}
