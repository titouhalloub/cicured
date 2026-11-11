import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runRunner } from "./helpers";

const shimDir = mkdtempSync(path.join(tmpdir(), "sft-semgrep-shim-"));

beforeAll(() => {
  const script = `const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write("1.0.0\\n");
  process.exit(0);
}
const outputArg = args.find((arg) => arg.startsWith("--output="));
if (!outputArg) {
  process.stderr.write("missing --output path\\n");
  process.exit(2);
}
const results = Array.from({ length: 501 }, (_, index) => ({
  check_id: "javascript.lang.security.test-rule",
  path: `src/file-${index}.ts`,
  start: { line: index + 1, col: 2 },
  extra: { message: "Potential security issue", severity: "ERROR" },
}));
fs.writeFileSync(outputArg.slice("--output=".length), JSON.stringify({ results }), "utf8");
process.stdout.write("fake semgrep scan completed\\n");
`;
  writeFileSync(path.join(shimDir, "semgrep.js"), script, "utf8");
  if (process.platform === "win32") {
    writeFileSync(
      path.join(shimDir, "semgrep.cmd"),
      '@echo off\r\nnode "%~dp0semgrep.js" %*\r\n',
      "utf8",
    );
  } else {
    const shim = path.join(shimDir, "semgrep");
    writeFileSync(shim, '#!/usr/bin/env node\n' + script, "utf8");
    chmodSync(shim, 0o755);
  }
});

afterAll(() => {
  rmSync(shimDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

describe("runner Semgrep structured output", () => {
  it("reads the complete JSON output file and surfaces the result cap", async () => {
    const outcome = await runRunner({}, { PATH: shimDir });

    expect(outcome.exitCode).toBe(0);
    const task = outcome.report?.tasks.find((entry) => entry.name === "Security") as
      | (NonNullable<typeof outcome.report>["tasks"][number] & {
          structuredFindings?: Array<{
            severity: string;
            category: string;
            ruleId: string;
            file: string;
            line: number;
            col: number;
            message: string;
          }>;
        })
      | undefined;
    expect(task).toBeDefined();
    expect(task?.structuredFindings).toHaveLength(501);
    expect(task?.structuredFindings?.[0]).toMatchObject({
      severity: "error",
      category: "lint",
      ruleId: "javascript.lang.security.test-rule",
      file: "src/file-0.ts",
      line: 1,
      col: 2,
    });
    expect(task?.structuredFindings?.[500]).toMatchObject({
      severity: "warning",
      ruleId: "sft-semgrep-results-truncated",
    });
    expect(task?.stdout.length).toBeLessThanOrEqual(200_000);
  });
});
