import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/llm", () => ({
  explainFinding: vi.fn(),
  suggestFix: vi.fn(),
  buildMessages: vi.fn(),
  createProvider: vi.fn(() => {
    throw new Error("No LLM provider configured. Set ANTHROPIC_API_KEY.");
  }),
}));

import { explainFinding, createProvider } from "../src/llm";
import { explainCommand } from "../src/commands/explain";

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

let dir: string;
let stdout: string[];
let stderr: string[];
let savedKey: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sft-explain-"));
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
  vi.mocked(explainFinding).mockReset();
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function writeReport(): void {
  writeFileSync(path.join(dir, "sft-report.json"), JSON.stringify(REPORT), "utf8");
}

describe("explainCommand", () => {
  it("returns 1 when no report file exists", async () => {
    expect(await explainCommand(["1"])).toBe(1);
    expect(stderr.join("")).toContain("No sft-report.json");
  });

  it("returns 1 when N is out of range", async () => {
    writeReport();
    expect(await explainCommand(["99"])).toBe(1);
    expect(stderr.join("")).toContain("Finding #99 out of range (have 1).");
  });

  it("returns 1 when no LLM provider is configured", async () => {
    writeReport();
    expect(await explainCommand(["1"])).toBe(1);
    expect(stderr.join("")).toContain("No LLM provider configured");
  });

  it("returns 0 and prints something when the LLM stub returns text", async () => {
    writeReport();
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.mocked(createProvider).mockReturnValue({
      providerId: "anthropic",
      model: "claude-sonnet-4-5",
      pricing: { inputPerM: 3, outputPerM: 15 },
      complete: vi.fn(),
    } as never);
    vi.mocked(explainFinding).mockResolvedValue(
      "This finding means the property is missing.",
    );

    expect(await explainCommand(["1"])).toBe(0);
    expect(stdout.join("")).toContain("This finding means the property is missing.");
    expect(stdout.join("")).toContain("Rule: TS2339");
    expect(vi.mocked(explainFinding)).toHaveBeenCalledTimes(1);
  });
});
