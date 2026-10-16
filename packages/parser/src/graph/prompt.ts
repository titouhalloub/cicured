import type { Neighborhood } from "../codegraph";

/**
 * Render a Neighborhood as the <codegraph_neighborhood> block used in
 * LLM prompts. Returns the empty string when the neighborhood is null
 * or undefined, so callers can concatenate unconditionally.
 *
 * Parity is contractual: the CLI and the worker must render identical
 * bytes for the same neighborhood.
 */
export function formatNeighborhoodBlock(
  n: Neighborhood | null | undefined,
): string {
  if (n == null) return "";
  const lines: string[] = [
    "Code graph neighborhood:",
    "<codegraph_neighborhood>",
    `File: ${n.file.path}`,
    `Function: ${n.function?.name ?? "(none)"} (line ${n.function?.line ?? 0})`,
  ];
  if (n.callers.length > 0) {
    lines.push("Called by:");
    for (const caller of n.callers) {
      lines.push(`  - ${caller.file}:${caller.line} ${caller.name}`);
    }
  }
  if (n.callees.length > 0) {
    lines.push("Calls:");
    for (const callee of n.callees) {
      lines.push(`  - ${callee.file}:${callee.line} ${callee.name}`);
    }
  }
  if (n.tests.length > 0) {
    lines.push("Tests that import this file:");
    for (const testPath of n.tests) {
      lines.push(`  - ${testPath}`);
    }
  }
  lines.push("</codegraph_neighborhood>");
  return lines.join("\n");
}
