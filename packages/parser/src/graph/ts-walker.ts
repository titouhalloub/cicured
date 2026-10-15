import {
  dedupe,
  field,
  lineOf,
  parseRoot,
  nodeText,
  stripQuotes,
  walkTree,
  type LanguageWalker,
  type RawFileGraph,
  type SyntaxNodeLike,
} from "./walker";

/** Callee identifier for a call expression, or null. */
function calleeName(callee: SyntaxNodeLike | null): string | null {
  if (callee === null) return null;
  if (callee.type === "identifier") return nodeText(callee);
  if (callee.type === "member_expression") {
    const prop = field(callee, "property");
    return prop === null ? null : nodeText(prop);
  }
  return null;
}

function emptyGraph(relPath: string): RawFileGraph {
  return { path: relPath, imports: [], functions: [] };
}

/**
 * tree-sitter TypeScript/TSX walker.
 *
 * This is the FALLBACK path: codegraph.ts keeps the tsc compiler API as the
 * primary TS/JS extractor (accurate resolution) and only dispatches here when
 * there is no tsconfig.json, or for tsx/jsx files the tsc project ignores.
 */
export const tsWalker: LanguageWalker = {
  id: "ts",
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"],
  walk(source: string, relPath: string): RawFileGraph {
    try {
      const root = parseRoot("ts", source);
      if (root === null) return emptyGraph(relPath);
      const imports: string[] = [];
      const fns: RawFileGraph["functions"] = [];
      const fnNodes: Array<{ node: SyntaxNodeLike; name: string }> = [];

      walkTree(root, (node) => {
        // imports and re-exports with a `source` string literal
        if (node.type === "import_statement" || node.type === "export_statement") {
          const src = field(node, "source");
          if (src !== null) imports.push(stripQuotes(nodeText(src)));
          return;
        }
        if (node.type === "function_declaration" || node.type === "method_definition") {
          const name = field(node, "name");
          if (name !== null) fnNodes.push({ node, name: nodeText(name) });
          return;
        }
        // const foo = () => {} / function
        if (node.type === "variable_declarator") {
          const name = field(node, "name");
          const value = field(node, "value");
          if (
            name !== null &&
            value !== null &&
            (value.type === "arrow_function" || value.type === "function" || value.type === "function_expression")
          ) {
            fnNodes.push({ node, name: nodeText(name) });
          }
        }
      });

      for (const { node, name } of fnNodes) {
        const calls: string[] = [];
        walkTree(node, (inner) => {
          if (inner.type === "call_expression") {
            const cname = calleeName(field(inner, "function"));
            if (cname !== null) calls.push(cname);
          }
        });
        fns.push({ name, line: lineOf(node), callsTo: dedupe(calls) });
      }

      return { path: relPath, imports: dedupe(imports), functions: fns };
    } catch {
      return emptyGraph(relPath);
    }
  },
};
