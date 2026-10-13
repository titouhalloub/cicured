import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { RUNNER_PATH } from "./helpers";

/**
 * Detection tests for the Phase 3d-1 Python task matrix.
 *
 * The runner is spawned with --detect-only (Phase 3d-1 fixup), which prints
 * `{ tasks, warnings }` as JSON and exits 0 without running anything — the
 * whole detection matrix is observable without a toolchain on the host.
 *
 * hasPython3() spawns a bare `python3`, so PATH is controlled per test: a
 * node-backed stand-in is prepended when the interpreter must appear present
 * (the Windows Store `python3` alias stub hangs on spawn, and CI images may
 * not ship python3), and pointed at a nonexistent directory for the
 * "interpreter missing" case.
 */

/** Directory holding the python3 stand-in; prepended to PATH when needed. */
const SHIM_DIR = mkdtempSync(path.join(tmpdir(), "sft-py3-"));
const SHIM_EXE = process.platform === "win32" ? "python3.exe" : "python3";
/** A path that never exists, so `spawnSync("python3", ...)` fails with ENOENT. */
const MISSING_PATH_DIR = path.join(tmpdir(), "sft-py3-absent-does-not-exist");

/** Fixture dirs created by detect(), removed in afterEach. */
const fixtures: string[] = [];

beforeAll(() => {
  // `node --version` exits 0 — enough for hasPython3(), which only checks
  // that the spawn did not error.
  const shim = path.join(SHIM_DIR, SHIM_EXE);
  copyFileSync(process.execPath, shim);
  if (process.platform !== "win32") chmodSync(shim, 0o755);
});

afterAll(() => {
  rmSync(SHIM_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

afterEach(() => {
  while (fixtures.length > 0) {
    rmSync(fixtures.pop() as string, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
interface DetectedTask {
  name: string;
  command: string;
}

interface DetectResult {
  exitCode: number;
  tasks: DetectedTask[];
  warnings: string[];
}

/** Runs `node sft-dev.mjs --detect-only` in a fresh fixture dir and parses its JSON. */
function detect(
  files: Record<string, string>,
  dirs: string[] = [],
  python3: boolean = true,
): DetectResult {
  const cwd = mkdtempSync(path.join(tmpdir(), "sft-detect-"));
  fixtures.push(cwd);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(cwd, name), content);
  }
  for (const dir of dirs) {
    mkdirSync(path.join(cwd, dir), { recursive: true });
  }

  // Windows exposes the variable as "Path", POSIX as "PATH" — drop both
  // before setting ours so the host PATH cannot win.
  const hostPath = process.env.Path ?? process.env.PATH ?? "";
  const pathValue = python3 ? [SHIM_DIR, hostPath].join(path.delimiter) : MISSING_PATH_DIR;
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.toUpperCase() === "PATH") continue;
    env[key] = value;
  }
  env.PATH = pathValue;

  const { status, stdout, stderr, error } = spawnSync(
    process.execPath,
    [RUNNER_PATH, "--detect-only"],
    { cwd, env, encoding: "utf8", timeout: 20_000, windowsHide: true },
  );

  if (error !== undefined && error !== null) {
    throw new Error(`runner spawn failed: ${error.message}`);
  }
  if (status !== 0) {
    throw new Error(`runner exited ${status}\nstdout: ${stdout}\nstderr: ${stderr}`);
  }
  return { exitCode: status, ...(JSON.parse(stdout) as { tasks: DetectedTask[]; warnings: string[] }) };
}

const names = (result: DetectResult): string[] => result.tasks.map((t) => t.name);

describe("detectPythonTasks via --detect-only", () => {
  it("pyproject.toml with [tool.pytest.ini_options] adds Python Tests", () => {
    const result = detect({ "pyproject.toml": '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n' });
    expect(names(result)).toContain("Python Tests");
  });

  it("pyproject.toml with [tool.ruff] adds Python Lint", () => {
    const result = detect({ "pyproject.toml": "[tool.ruff]\nline-length = 100\n" });
    expect(names(result)).toContain("Python Lint");
  });

  it("pyproject.toml with both sections adds both", () => {
    const result = detect({
      "pyproject.toml": '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n\n[tool.ruff]\nline-length = 100\n',
    });
    expect(names(result)).toContain("Python Tests");
    expect(names(result)).toContain("Python Lint");
  });

  it("pyproject.toml with only [tool.black] adds neither", () => {
    const result = detect({ "pyproject.toml": "[tool.black]\nline-length = 100\n" });
    expect(names(result)).not.toContain("Python Tests");
    expect(names(result)).not.toContain("Python Lint");
  });

  it("pytest.ini adds Python Tests", () => {
    const result = detect({ "pytest.ini": "[pytest]\n" });
    expect(names(result)).toContain("Python Tests");
  });

  it("tox.ini adds Python Tests", () => {
    const result = detect({ "tox.ini": "[tox]\n" });
    expect(names(result)).toContain("Python Tests");
  });

  it("ruff.toml adds Python Lint", () => {
    const result = detect({ "ruff.toml": "line-length = 100\n" });
    expect(names(result)).toContain("Python Lint");
  });

  it(".ruff.toml adds Python Lint", () => {
    const result = detect({ ".ruff.toml": "line-length = 100\n" });
    expect(names(result)).toContain("Python Lint");
  });

  it("requirements.txt with tests/ directory adds Python Tests", () => {
    const result = detect({ "requirements.txt": "pytest\n" }, ["tests"]);
    expect(names(result)).toContain("Python Tests");
  });

  it("requirements.txt without tests/ and without pytest.ini adds neither", () => {
    const result = detect({ "requirements.txt": "pytest\n" });
    expect(names(result)).not.toContain("Python Tests");
    expect(names(result)).not.toContain("Python Lint");
  });

  it("mixed repo adds both Node and Python tasks", () => {
    const result = detect(
      {
        "package.json": '{"scripts": {"test": "vitest run"}}\n',
        "pyproject.toml": '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
      },
    );
    const list = names(result);
    expect(list).toContain("Tests");
    expect(list).toContain("Python Tests");
    expect(new Set(list).size).toBe(list.length);
  });

  it("Node-only repo adds no Python tasks", () => {
    const result = detect({ "package.json": '{"scripts": {"test": "vitest run"}}\n' });
    expect(names(result)).not.toContain("Python Tests");
    expect(names(result)).not.toContain("Python Lint");
  });

  it("python3 missing yields a warning and no Python tasks", () => {
    const result = detect({ "pyproject.toml": '[tool.pytest.ini_options]\n' }, [], false);
    expect(names(result)).not.toContain("Python Tests");
    expect(result.warnings.some((w) => /python3 not found/.test(w))).toBe(true);
  });
});


