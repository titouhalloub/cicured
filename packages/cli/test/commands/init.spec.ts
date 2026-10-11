import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initCommand } from "../../src/commands/init";

let dir: string;
let written: string[];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sft-init-"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  written = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    written.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("initCommand", () => {
  it("writes the four starter tasks and returns 0", () => {
    expect(initCommand()).toBe(0);

    const target = path.join(dir, "sft-dev.config.json");
    expect(existsSync(target)).toBe(true);

    const parsed: unknown = JSON.parse(readFileSync(target, "utf8"));
    expect(parsed).toMatchObject({
      tasks: [
        { name: "Type Check", command: "tsc --noEmit" },
        { name: "Lint", command: "eslint ." },
        { name: "Build", command: "npm run build" },
        { name: "Tests", command: "npm test -- --passWithNoTests" },
      ],
    });
    expect(written.join("")).toContain("Wrote sft-dev.config.json");
  });

  it("returns 1 and leaves the existing file untouched", () => {
    const target = path.join(dir, "sft-dev.config.json");
    writeFileSync(target, '{"tasks":[]}', "utf8");

    expect(initCommand()).toBe(1);
    expect(readFileSync(target, "utf8")).toBe('{"tasks":[]}');
    expect(written.join("")).toContain("Already exists.");
  });
});
