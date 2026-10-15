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

function emptyGraph(relPath: string): RawFileGraph {
  return { path: relPath, imports: [], functions: [] };
}

/** tree-sitter-go walker. */
export const goWalker: LanguageWalker = {
  id: "go",
  extensions: [".go"],
  walk(source: string, relPath: string): RawFileGraph {
    try {
      const root = parseRoot("go", source);
      if (root === null) return emptyGraph(relPath);
      const imports: string[] = [];
      const fns: RawFileGraph["functions"] = [];
      const fnNodes: Array<{ node: SyntaxNodeLike; name: string }> = [];

      walkTree(root, (node) => {
        // import "path"  and  import ( "a"; "b" )
        if (node.type === "import_spec") {
          const p = field(node, "path");
          if (p !== null) imports.push(stripQuotes(nodeText(p)));
          return;
        }
        if (node.type === "function_declaration" || node.type === "method_declaration") {
          const name = field(node, "name");
          if (name !== null) fnNodes.push({ node, name: nodeText(name) });
        }
      });

      for (const { node, name } of fnNodes) {
        const calls: string[] = [];
        walkTree(node, (inner) => {
          if (inner.type === "call_expression") {
            const fn = field(inner, "function");
            if (fn === null) return;
            if (fn.type === "identifier") calls.push(nodeText(fn));
            else if (fn.type === "selector_expression") {
              const sel = field(fn, "field");
              if (sel !== null) calls.push(nodeText(sel));
            }
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
