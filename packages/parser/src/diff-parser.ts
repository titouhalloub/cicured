/**
 * Unified-diff parsing for the diff-scoped PR reviewer (v2).
 *
 * Maps each `@@` hunk onto GitHub's review-comment `position`: the number of
 * lines down from the FIRST `@@` hunk header of that file's diff. The first
 * line after that header is 1, and every later diff line (context, `-`, `+`,
 * and even subsequent `@@` headers) keeps counting. A comment's offset within
 * its own hunk therefore only equals its GitHub position for the file's first
 * hunk; later hunks must shift by `positionBase` before being posted.
 */
export interface DiffHunk {
  /** Repository-relative path — the `b/` side of `diff --git a/… b/…`. */
  path: string;
  /** The raw hunk header, e.g. `"@@ -10,7 +10,9 @@ function foo() {"`. */
  header: string;
  /** Every diff line after the header until the next hunk or file boundary. */
  lines: string[];
  /** First line of the hunk in the NEW file (the `+` side of the header). */
  startLine: number;
  /**
   * GitHub `position` of `lines[0]` minus 1: how many diff lines sit between
   * this hunk's `@@` header and the file's first `@@` header (0 for the first
   * hunk). GitHub position of `lines[k]` = `positionBase + (k + 1)`.
   */
  positionBase: number;
}

const FILE_HEADER_RE = /^diff --git a\/(.+?) b\/(.+)$/;
const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

interface OpenHunk {
  header: string;
  /** rawLines index of this hunk's own `@@` header line. */
  startIndex: number;
  startLine: number;
  lines: string[];
}

/**
 * Parses a unified diff (as returned by GitHub's `application/vnd.github.v3.diff`
 * media type) into structured hunks. Never throws: malformed input simply
 * yields fewer hunks. Binary files produce no hunks (no `@@` headers).
 */
export function parseDiff(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const rawLines = diff.split(/\r?\n/);

  let path: string | null = null;
  // rawLines index of the current file's FIRST `@@` header — GitHub measures
  // every position in this file from there.
  let fileHeaderIndex = -1;
  let open: OpenHunk | null = null;

  const flush = (): void => {
    if (path !== null && open !== null) {
      // Drop the trailing empty line produced by the diff's final newline.
      if (open.lines.at(-1) === "") open.lines.pop();
      hunks.push({
        path,
        header: open.header,
        lines: open.lines,
        startLine: open.startLine,
        positionBase: open.startIndex - fileHeaderIndex,
      });
    }
    open = null;
  };

  for (const [index, line] of rawLines.entries()) {
    const fileMatch = FILE_HEADER_RE.exec(line);
    if (fileMatch) {
      flush();
      path = fileMatch[2] ?? null;
      fileHeaderIndex = -1;
      continue;
    }
    const hunkMatch = HUNK_HEADER_RE.exec(line);
    if (hunkMatch) {
      flush();
      if (fileHeaderIndex === -1) fileHeaderIndex = index;
      open = {
        header: line,
        startIndex: index,
        startLine: Number(hunkMatch[1]),
        lines: [],
      };
      continue;
    }
    if (open !== null) open.lines.push(line);
  }
  flush();
  return hunks;
}