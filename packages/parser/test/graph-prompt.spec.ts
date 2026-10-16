import { describe, expect, it } from "vitest";
import type { Neighborhood } from "../src/codegraph";
import { formatNeighborhoodBlock } from "../src/graph/prompt";

/** A minimal full neighborhood: file + function + 1 caller + 1 callee + 2 tests. */
const FULL: Neighborhood = {
  file: {
    path: "src/auth.ts",
    imports: [],
    importedBy: [],
    functions: [],
    tests: ["test/a.spec.ts", "test/b.spec.ts"],
  },
  function: {
    name: "login",
    file: "src/auth.ts",
    line: 40,
    callsTo: ["hash"],
    calledBy: ["handleLogin"],
    referencedIn: [],
  },
  callers: [
    {
      name: "handleLogin",
      file: "src/routes.ts",
      line: 10,
      callsTo: ["login"],
      calledBy: [],
      referencedIn: [],
    },
  ],
  callees: [
    {
      name: "hash",
      file: "src/crypto.ts",
      line: 4,
      callsTo: [],
      calledBy: ["login"],
      referencedIn: [],
    },
  ],
  tests: ["test/a.spec.ts", "test/b.spec.ts"],
};

describe("formatNeighborhoodBlock", () => {
  it("returns the empty string for null", () => {
    expect(formatNeighborhoodBlock(null)).toBe("");
  });

  it("returns the empty string for undefined", () => {
    expect(formatNeighborhoodBlock(undefined)).toBe("");
  });

  it("renders a full neighborhood with tags, file, function, callers, callees and tests", () => {
    const block = formatNeighborhoodBlock(FULL);
    expect(block).toContain("<codegraph_neighborhood>");
    expect(block).toContain("</codegraph_neighborhood>");
    expect(block).toContain("File: src/auth.ts");
    expect(block).toContain("login (line 40)");
    expect(block).toContain("src/routes.ts:10 handleLogin");
    expect(block).toContain("src/crypto.ts:4 hash");
    expect(block).toContain("test/a.spec.ts");
    expect(block).toContain("test/b.spec.ts");
  });

  it("omits the 'Called by:' heading when callers is empty", () => {
    const block = formatNeighborhoodBlock({ ...FULL, callers: [] });
    expect(block).not.toContain("Called by:");
  });

  it("omits the 'Calls:' heading when callees is empty", () => {
    const block = formatNeighborhoodBlock({ ...FULL, callees: [] });
    expect(block).not.toContain("Calls:");
  });

  it("omits the 'Tests that import this file:' heading when tests is empty", () => {
    const block = formatNeighborhoodBlock({ ...FULL, tests: [] });
    expect(block).not.toContain("Tests that import this file:");
  });

  it("renders '(none)' on the Function line when function is undefined", () => {
    const block = formatNeighborhoodBlock({ ...FULL, function: undefined });
    expect(block).toContain("Function: (none) (line 0)");
    expect(block).toContain("</codegraph_neighborhood>");
  });

  it("uses \\n line endings only, never \\r\\n", () => {
    const block = formatNeighborhoodBlock(FULL);
    expect(block).not.toContain("\r");
    expect(block).toContain("\n");
  });
});
