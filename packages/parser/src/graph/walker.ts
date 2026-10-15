import { Language, Parser, type Node } from "web-tree-sitter";
import * as path from "node:path";
import { existsSync } from "node:fs";

/**
 * The language-agnostic intermediate shape every walker produces. The
 * reverse-index pass in codegraph.ts (importedBy / calledBy / referencedIn)
 * and the tests-detection BFS consume these fields and nothing else, so all
 * four languages collapse onto one uniform graph schema.
 */
export interface RawFileGraph {
  /** Repo-relative, forward-slash path. */
  path: string;
  /** Raw import specifiers, unresolved (the resolver lives in codegraph.ts). */
  imports: string[];
  functions: Array<{
    name: string;
    /** 1-indexed. */
    line: number;
    /** Names of functions called inside this function's body. */
    callsTo: string[];
  }>;
}

/**
 * A parser that turns one source file's text into a {@link RawFileGraph}.
 *
 * Contract: no I/O, no side effects, never throws — any parse failure returns
 * an empty graph. Languages are loaded up front via {@link initWalkers}, so
 * `walk` is synchronous.
 */
export interface LanguageWalker {
  /** "ts" | "python" | "go" | "rust". */
  id: string;
  /** Lower-cased extensions, including the leading dot. */
  extensions: string[];
  walk(source: string, relPath: string): RawFileGraph;
}

// ── web-tree-sitter bootstrap ─────────────────────────────────────────────

let bootstrapped = false;
const languages = new Map<string, Language>();

/** Resolves a grammar WASM file shipped inside its npm package. */
function wasmPath(specifier: string): string {
  // Sandbox override: when SFT_PARSER_GRAMMARS_DIR points at a flat directory of
  // pre-extracted grammar WASM files (as produced by the sandbox launcher), load
  // them from there instead of from inside the tree-sitter npm packages. This
  // keeps the sandbox self-contained since the WASM files are copied in instead
  // of being linked. Files are looked up by grammar key (see
  // GRAMMAR_FLAT_NAMES), with the npm package filename as a fallback.
  const grammarDir = process.env.SFT_PARSER_GRAMMARS_DIR;
  if (grammarDir) {
    const key = Object.keys(GRAMMAR_SPECS).find((k) => GRAMMAR_SPECS[k] === specifier);
    if (key !== undefined) {
      for (const name of GRAMMAR_FLAT_NAMES[key] ?? []) {
        const candidate = path.resolve(grammarDir, name);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  // The grammar packages ship the .wasm inside their npm package; resolve it
  // relative to the package that owns this bundle (works both in the source tree
  // and inside the esbuild bundle).
  return require.resolve(specifier);
}

/** npm package subpaths of the grammar WASM files (resolved lazily). */
const GRAMMAR_SPECS: Record<string, string> = {
  ts: "tree-sitter-typescript/tree-sitter-typescript.wasm",
  tsx: "tree-sitter-typescript/tree-sitter-tsx.wasm",
  python: "tree-sitter-python/tree-sitter-python.wasm",
  go: "tree-sitter-go/tree-sitter-go.wasm",
  rust: "tree-sitter-rust/tree-sitter-rust.wasm",
};

/** Flat directory layout expected from the sandbox launcher (SFT_PARSER_GRAMMARS_DIR).
 *
 * The grammar key is the registry key ("ts", "tsx", "python", "go", "rust"); the
 * first candidate is what a plain `cp` of the extracted WASM file produces, and
 * the second is the full npm package filename, so the lookup works for either
 * naming scheme:
 *
 *   ts:      typescript.wasm       tree-sitter-typescript.wasm
 *   tsx:     tsx.wasm              tree-sitter-tsx.wasm
 *   python:  python.wasm           tree-sitter-python.wasm
 *   go:      go.wasm               tree-sitter-go.wasm
 *   rust:    rust.wasm             tree-sitter-rust.wasm
 */
const GRAMMAR_FLAT_NAMES: Record<string, string[]> = {
  ts: ["typescript.wasm", "tree-sitter-typescript.wasm"],
  tsx: ["tsx.wasm", "tree-sitter-tsx.wasm"],
  python: ["python.wasm", "tree-sitter-python.wasm"],
  go: ["go.wasm", "tree-sitter-go.wasm"],
  rust: ["rust.wasm", "tree-sitter-rust.wasm"],
};

/** Loads every grammar once. Safe to call repeatedly; idempotent. */
export async function initWalkers(): Promise<void> {
  if (bootstrapped) return;
  await Parser.init();
  for (const [key, spec] of Object.entries(GRAMMAR_SPECS)) {
    languages.set(key, await Language.load(wasmPath(spec)));
  }
  bootstrapped = true;
}

/** Builds a fresh parser bound to a previously loaded grammar. */
export function makeParser(grammarKey: string): Parser {
  const language = languages.get(grammarKey);
  if (language === undefined) {
    throw new Error(`tree-sitter grammar not loaded: ${grammarKey}`);
  }
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

/**
 * Parses `source` with the given grammar and returns the root node, or null if
 * parsing failed (tree-sitter returns null only on an internal/OOM condition).
 * Walkers already guard with try/catch, so null is handled there too.
 */
export function parseRoot(grammarKey: string, source: string): SyntaxNodeLike | null {
  const tree = makeParser(grammarKey).parse(source);
  return tree === null ? null : tree.rootNode;
}

// ── AST helpers shared by every walker ────────────────────────────────────

export type SyntaxNodeLike = Node;

/** Pre-order descent over the whole subtree rooted at `node`. */
export function walkTree(node: SyntaxNodeLike, visit: (n: SyntaxNodeLike) => void): void {
  visit(node);
  for (const child of node.children) {
    walkTree(child, visit);
  }
}

/** The source text covered by a node. */
export function nodeText(node: SyntaxNodeLike): string {
  return node.text;
}

/** 1-indexed line of the node's start. */
export function lineOf(node: SyntaxNodeLike): number {
  return node.startPosition.row + 1;
}

/** Field-named child, or null. */
export function field(node: SyntaxNodeLike, name: string): SyntaxNodeLike | null {
  return node.childForFieldName(name);
}

/** Strips surrounding quotes / backticks from a literal's text. */
export function stripQuotes(text: string): string {
  return text.replace(/^["'`]/, "").replace(/["'`]$/, "");
}

/** Order-preserving de-duplication. */
export function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

// ── Walker registry + dispatch ────────────────────────────────────────────
//
// Imported after the helpers above; safe under ESM's cyclic-import rules
// because each walker module only *uses* walker.ts's helpers inside walk(),
// never at module-eval time.
import { pythonWalker } from "./python-walker";
import { goWalker } from "./go-walker";
import { rustWalker } from "./rust-walker";
import { tsWalker } from "./ts-walker";

/** Every language walker, in registration order. */
export const WALKERS: readonly LanguageWalker[] = [
  tsWalker,
  pythonWalker,
  goWalker,
  rustWalker,
];

/** Picks the walker for a repo-relative path by extension, or null. */
export function walkerForFile(relPath: string): LanguageWalker | null {
  const lower = relPath.toLowerCase();
  for (const walker of WALKERS) {
    if (walker.extensions.some((ext) => lower.endsWith(ext))) return walker;
  }
  return null;
}

/** The non-TypeScript extensions the multi-language walkers handle. */
export const WALKER_SOURCE_EXTENSIONS: readonly string[] = [
  ".py",
  ".pyi",
  ".go",
  ".rs",
];
