import { readFileSync } from "node:fs";
import path from "node:path";

const CONTEXT_LINES = 5;
const MAX_SNIPPET_LINES = 50;

/**
 * Reads a snippet around a finding's line from the working directory.
 * Strips the sandbox path prefix (/workspace/repo/) if present.
 * Returns "" if the file is missing or unreadable. Never throws.
 */
export function snippetFor(finding: {
  file: string;
  line: number;
}, cwd: string = process.cwd()): string {
  const rel = finding.file.replace(/^\/workspace\/repo\//, "");
  const abs = path.isAbsolute(rel) ? rel : path.join(cwd, rel);

  let lines: string[];
  try {
    lines = readFileSync(abs, "utf8").split("\n");
  } catch {
    return "";
  }

  const line = Math.max(1, finding.line);
  const start = Math.max(0, line - 1 - CONTEXT_LINES);
  const end = Math.min(lines.length, line + CONTEXT_LINES);
  const slice = lines.slice(start, end);

  if (slice.length > MAX_SNIPPET_LINES) {
    return slice.slice(0, MAX_SNIPPET_LINES).join("\n");
  }
  return slice.join("\n");
}
