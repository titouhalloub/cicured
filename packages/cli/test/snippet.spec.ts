import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { snippetFor } from "../src/snippet";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sft-snippet-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("snippetFor", () => {
  it("returns a ±5 line window around the given line", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    writeFileSync(path.join(dir, "fixture.ts"), lines.join("\n"), "utf8");

    const snippet = snippetFor({ file: "fixture.ts", line: 10 }, dir);
    const out = snippet.split("\n");
    expect(out).toHaveLength(11);
    expect(out[0]).toBe("line 5");
    expect(out[out.length - 1]).toBe("line 15");
    expect(snippet).toContain("line 10");
  });

  it('returns "" when the file does not exist', () => {
    expect(snippetFor({ file: "missing.ts", line: 3 }, dir)).toBe("");
  });

  it("strips the /workspace/repo/ prefix", () => {
    writeFileSync(path.join(dir, "src.ts"), "alpha\nbravo\ncharlie", "utf8");

    const snippet = snippetFor({ file: "/workspace/repo/src.ts", line: 2 }, dir);
    expect(snippet).toContain("bravo");
  });

  it("caps at 50 lines if the file is huge", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`);
    writeFileSync(path.join(dir, "huge.ts"), lines.join("\n"), "utf8");

    const snippet = snippetFor({ file: "huge.ts", line: 250 }, dir);
    expect(snippet.split("\n").length).toBeLessThanOrEqual(50);
    expect(snippet).toContain("line 250");
  });

  it("never throws on a binary-looking file", () => {
    const blob = Buffer.from([0x00, 0xff, 0xfe, 0x01, 0x02, 0x80, 0x7f]);
    writeFileSync(path.join(dir, "blob.ts"), blob);

    expect(() => snippetFor({ file: "blob.ts", line: 1 }, dir)).not.toThrow();
    expect(typeof snippetFor({ file: "blob.ts", line: 1 }, dir)).toBe("string");
  });
});
