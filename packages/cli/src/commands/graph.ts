import { buildCodeGraph, writeCachedGraph } from "@sft/parser";
import { banner, dim, fail, pass, warn } from "../ui";

/** Builds a code graph of the current repo. Never throws. */
export async function graphCommand(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const rootDir = process.cwd();

  const graph = await buildCodeGraph({ rootDir });

  if (json) {
    process.stdout.write(`${JSON.stringify(graph, null, 2)}\n`);
    return 0;
  }

  await writeCachedGraph(rootDir, graph);

  const fileCount = graph.files.length;
  const functionCount = graph.files.reduce((n, f) => n + f.functions.length, 0);
  const edgeCount = graph.files.reduce(
    (n, f) => n + f.imports.length + f.importedBy.length,
    0,
  );

  console.log(banner("Code graph"));
  console.log(`  ${pass("✓")} files:       ${fileCount}`);
  console.log(`  ${pass("✓")} functions:   ${functionCount}`);
  console.log(`  ${pass("✓")} edges:       ${edgeCount}`);
  console.log(`  ${dim("cached to .sft/graph.json")}`);

  for (const w of graph.warnings) {
    console.log(`  ${warn("⚠")} ${w.path}: ${w.reason}`);
  }

  if (fileCount === 0) {
    console.log(`  ${fail("✗")} no source files found — check tsconfig.json`);
    return 1;
  }

  return 0;
}
