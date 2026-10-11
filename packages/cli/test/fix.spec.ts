import { spawn } from "node:child_process";
import type * as ChildProcessModule from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/llm", () => ({
  suggestFix: vi.fn(),
  explainFinding: vi.fn(),
  buildAnthropicMessages: vi.fn(),
}));
// Partial mock: the parser's codegraph module needs the real execFile.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>();
  return { ...actual, spawn: vi.fn() };
});

import { suggestFix } from "../src/llm";
import { fixCommand } from "../src/commands/fix";

const REPORT = {
  tool: "sft-dev",
  version: 2,
  finishedAt: "2026-01-01T00:00:04.200Z",
  runnerError: null,
  warnings: [],
  summary: { total: 1, passed: 0, failed: 1, skipped: 0, totalDurationMs: 1_000 },
  tasks: [
    {
      name: "Type Check",
      command: "tsc --noEmit",
      success: false,
      exitCode: 2,
      timedOut: false,
      skipped: false,
      truncated: false,
      durationMs: 1_000,
      stdout: "",
      stderr: "src/auth.ts(42,5): error TS2339: Property 'x' does not exist.",
    },
  ],
};

const CRLF_PATCH =
  "--- a/src/auth.ts\r\n+++ b/src/auth.ts\r\n@@ -42 +42 @@\r\n-old\r\n+new";

let dir: string;
let stdout: string[];
let stderr: string[];
let savedKey: string | undefined;
let originalStdin: PropertyDescriptor | undefined;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sft-fix-"));
  stdout = [];
  stderr = [];
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  });
  savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  vi.mocked(spawn).mockReset();
  vi.mocked(suggestFix).mockReset();
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
  restoreStdin();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function writeReport(): void {
  writeFileSync(path.join(dir, "sft-report.json"), JSON.stringify(REPORT), "utf8");
}

function stubSuggestion(patchDiff: string): void {
  vi.mocked(suggestFix).mockResolvedValue({
    patchDiff,
    explanation: "Do the thing.",
    confidence: 0.9,
    filesTouched: ["src/auth.ts"],
  });
}

function answerWith(text: string): void {
  originalStdin = Object.getOwnPropertyDescriptor(process, "stdin");
  Object.defineProperty(process, "stdin", {
    value: Readable.from([text]),
    configurable: true,
    writable: true,
  });
}

function restoreStdin(): void {
  if (originalStdin !== undefined) {
    Object.defineProperty(process, "stdin", originalStdin);
    originalStdin = undefined;
  }
}

/**
 * Configures the spawn mock: each call emits `close` with the next exit code
 * and pipes `stderrText` into the child's stderr handler.
 */
function mockSpawn(exits: number[], stderrText = ""): void {
  let call = 0;
  vi.mocked(spawn).mockImplementation((() => {
    const code = exits[call] ?? 0;
    call += 1;
    const child = new EventEmitter() as EventEmitter & {
      stderr: { on: (event: string, cb: (data: Buffer) => void) => void };
    };
    child.stderr = {
      on: (_event: string, cb: (data: Buffer) => void) => {
        if (stderrText !== "") cb(Buffer.from(stderrText));
      },
    };
    setTimeout(() => child.emit("close", code), 0);
    return child;
  }) as unknown as typeof spawn);
}

const LF_PATCH = "--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -42 +42 @@\n-old\n+new";

describe("fixCommand", () => {
  it("returns 0 when the user declines", async () => {
    writeReport();
    process.env.ANTHROPIC_API_KEY = "test-key";
    stubSuggestion(LF_PATCH);
    answerWith("n\n");

    expect(await fixCommand(["1"])).toBe(0);
    expect(stdout.join("")).toContain("Patch discarded.");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("returns 1 when git apply --check fails", async () => {
    writeReport();
    process.env.ANTHROPIC_API_KEY = "test-key";
    stubSuggestion(LF_PATCH);
    answerWith("y\n");
    mockSpawn([1], "error: patch failed: src/auth.ts:42");

    expect(await fixCommand(["1"])).toBe(1);
    expect(stderr.join("")).toContain("Patch did not apply cleanly");
    expect(stderr.join("")).toContain("error: patch failed");

    // The patch file is left in place for inspection.
    const checkArgs = vi.mocked(spawn).mock.calls[0]?.[1];
    expect(checkArgs?.[0]).toBe("apply");
    expect(checkArgs?.[1]).toBe("--check");
    const patchFile = checkArgs?.[2] ?? "";
    expect(existsSync(patchFile)).toBe(true);
    rmSync(patchFile, { force: true });
  });

  it("returns 0 and calls git apply when --check succeeds and user answers y", async () => {
    writeReport();
    process.env.ANTHROPIC_API_KEY = "test-key";
    stubSuggestion(LF_PATCH);
    answerWith("y\n");
    mockSpawn([0, 0]);

    expect(await fixCommand(["1"])).toBe(0);
    expect(stdout.join("")).toContain("Patch applied.");

    const calls = vi.mocked(spawn).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[0]).toBe("git");
    expect(calls[0]?.[1]?.[0]).toBe("apply");
    expect(calls[0]?.[1]?.[1]).toBe("--check");
    expect(calls[1]?.[1]?.[0]).toBe("apply");
    const patchFile = calls[1]?.[1]?.[1] ?? "";
    expect(existsSync(patchFile)).toBe(false); // deleted on success
  });

  it("normalizes CRLF in the patch before writing the temp file", async () => {
    writeReport();
    process.env.ANTHROPIC_API_KEY = "test-key";
    stubSuggestion(CRLF_PATCH);
    answerWith("y\n");
    // Check fails so the temp file is left in place for inspection.
    mockSpawn([1], "error: patch failed");

    expect(await fixCommand(["1"])).toBe(1);
    const patchFile = vi.mocked(spawn).mock.calls[0]?.[1]?.[2] ?? "";
    const content = readFileSync(patchFile, "utf8");
    expect(content).not.toContain("\r\n");
    expect(content).toContain("--- a/src/auth.ts\n+++ b/src/auth.ts\n");
    rmSync(patchFile, { force: true });
  });
});
