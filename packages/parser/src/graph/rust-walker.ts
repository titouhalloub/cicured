import {
  dedupe,
  field,
  lineOf,
  parseRoot,
  nodeText,
  walkTree,
  type LanguageWalker,
  type RawFileGraph,
  type SyntaxNodeLike,
} from "./walker";

function emptyGraph(relPath: string): RawFileGraph {
  return { path: relPath, imports: [], functions: [] };
}

/**
 * Extracts the leading module path of a `use` declaration as a resolver
 * specifier. Rust's `crate` root becomes `crate://module`; `super`/`self` are
 * file-relative (`../`, `./`). Any other leading segment is emitted raw (e.g.
 * `mycrate::a::sym` or `serde::Deserialize`) — the resolver matches it against
 * Cargo.toml's package name and silently drops external crates. Only the first
 * two segments matter for the edge; deeper segments are symbols.
 */
function usePathToLocal(useText: string): string | null {
  const idx = useText.indexOf("use");
  if (idx === -1) return null;
  const path = useText.slice(idx + 3).replace(/;\s*$/, "").trim();
  const segs = path.split("::").map((s) => s.trim()).filter(Boolean);
  if (segs.length < 2) return null;
  const first = segs[0];
  if (first === "crate") return `crate://${segs[1]}`;
  if (first === "super") return `../${segs[1]}`;
  if (first === "self") return `./${segs[1]}`;
  return `${segs[0]}::${segs[1]}`;
}

function calleeName(fn: SyntaxNodeLike): string | null {
  if (fn.type === "identifier") return nodeText(fn);
  if (fn.type === "scoped_identifier") {
    const name = field(fn, "name");
    return name === null ? null : nodeText(name);
  }
  if (fn.type === "field_expression") {
    const f = field(fn, "field");
    return f === null ? null : nodeText(f);
  }
  return null;
}

/** tree-sitter-rust walker. */
export const rustWalker: LanguageWalker = {
  id: "rust",
  extensions: [".rs"],
  walk(source: string, relPath: string): RawFileGraph {
    try {
      const root = parseRoot("rust", source);
      if (root === null) return emptyGraph(relPath);
      const imports: string[] = [];
      const fns: RawFileGraph["functions"] = [];
      const fnNodes: Array<{ node: SyntaxNodeLike; name: string }> = [];

      walkTree(root, (node) => {
        if (node.type === "mod_item") {
          // `mod foo;` (file module) has no body; `mod foo { }` is inline.
          const hasBody = node.children.some((c) => c.type === "declaration_list");
          const name = field(node, "name");
          if (!hasBody && name !== null) imports.push(`./${nodeText(name)}`);
          return;
        }
        if (node.type === "use_declaration") {
          const local = usePathToLocal(nodeText(node));
          if (local !== null) imports.push(local);
          return;
        }
        if (node.type === "function_item") {
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
            const cname = calleeName(fn);
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
