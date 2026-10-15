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

/**
 * Converts a Python relative import specifier to a `./`-style path the shared
 * resolver understands. Python encodes depth in leading dots:
 *   `.b`        → ./b        (sibling module)
 *   `.pkg.mod`  → ./pkg/mod   (submodule)
 *   `..x`       → ../x        (parent package)
 */
function pythonRelToPath(spec: string): string {
  let dots = 0;
  while (spec[dots] === ".") dots += 1;
  const rest = spec.slice(dots).split(".").filter(Boolean).join("/");
  const prefix = dots <= 1 ? "./" : "../".repeat(dots - 1);
  return `${prefix}${rest}`;
}

function emptyGraph(relPath: string): RawFileGraph {
  return { path: relPath, imports: [], functions: [] };
}

/** tree-sitter-python walker. */
export const pythonWalker: LanguageWalker = {
  id: "python",
  extensions: [".py", ".pyi"],
  walk(source: string, relPath: string): RawFileGraph {
    try {
      const root = parseRoot("python", source);
      if (root === null) return emptyGraph(relPath);
      const imports: string[] = [];
      const fns: RawFileGraph["functions"] = [];
      const fnNodes: Array<{ node: SyntaxNodeLike; name: string }> = [];

      walkTree(root, (node) => {
        if (node.type === "import_from_statement") {
          const mod = field(node, "module_name");
          if (mod === null) return;
          const modText = nodeText(mod);
          if (modText.startsWith(".")) {
            if (/^\.+$/.test(modText)) {
              // `from . import b, c` — the imported names are sibling modules.
              for (const child of node.children) {
                if (child.type === "dotted_name") {
                  imports.push(pythonRelToPath(modText + nodeText(child)));
                }
              }
            } else {
              imports.push(pythonRelToPath(modText));
            }
          } else if (/^[A-Za-z_]\w*(\.\w+)*$/.test(modText)) {
            // Absolute dotted import (`pkg.mod`) — resolved against repo root
            // by codegraph's resolver. Stdlib names (os, sys) resolve to
            // nothing and stay silent.
            imports.push(modText);
          }
          return;
        }
        if (node.type === "import_statement") {
          // `import a.b.c` / `import a.b as c`
          const name = field(node, "name");
          if (name === null) return;
          if (name.type === "dotted_name") {
            imports.push(nodeText(name));
          } else if (name.type === "aliased_import") {
            const inner = field(name, "name");
            if (inner !== null && inner.type === "dotted_name") {
              imports.push(nodeText(inner));
            }
          }
          return;
        }
        if (node.type === "function_definition") {
          const name = field(node, "name");
          if (name !== null) fnNodes.push({ node, name: nodeText(name) });
        }
      });

      for (const { node, name } of fnNodes) {
        const calls: string[] = [];
        walkTree(node, (inner) => {
          if (inner.type === "call") {
            const fn = field(inner, "function");
            if (fn === null) return;
            if (fn.type === "identifier") calls.push(nodeText(fn));
            else if (fn.type === "attribute") {
              const attr = field(fn, "attribute");
              if (attr !== null) calls.push(nodeText(attr));
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
