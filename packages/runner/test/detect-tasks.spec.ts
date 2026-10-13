import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { RUNNER_PATH } from "./helpers";

/**
 * Detection tests for the runner's auto-detected task matrix — Phase 3d-1
 * Python, Phase 3d-3 Go.
 *
 * The runner is spawned with --detect-only, which prints `{ tasks, warnings }`
 * as JSON and exits 0 without running anything — the whole detection matrix is
 * observable without a toolchain on the host.
 *
 * hasPython3()/hasGo() spawn a bare `python3`/`go`, so PATH is controlled per
 * test: node-backed stand-ins are prepended when a tool must appear present
 * (the Windows Store `python3` alias stub hangs on spawn, and CI images may
 * not ship either tool), and pointed at a nonexistent directory for the
 * "tool missing" case.
 */

/** Directories holding the python3 / go stand-ins; prepended to PATH as needed. */
const PY3_SHIM_DIR = mkdtempSync(path.join(tmpdir(), "sft-py3-"));
const GO_SHIM_DIR = mkdtempSync(path.join(tmpdir(), "sft-go-"));
/** A path that never exists, so a bare spawn fails with ENOENT. */
const MISSING_PATH_DIR = path.join(tmpdir(), "sft-tools-absent-does-not-exist");

/** Fixture dirs created by detect(), removed in afterEach. */
const fixtures: string[] = [];

beforeAll(() => {
  // `node --version` exits 0 — enough for hasPython3()/hasGo(), which only
  // check that the spawn did not error.
  for (const [dir, exe] of [
    [PY3_SHIM_DIR, "python3"],
    [GO_SHIM_DIR, "go"],
  ] as const) {
    const shim = path.join(dir, process.platform === "win32" ? `${exe}.exe` : exe);
    copyFileSync(process.execPath, shim);
    if (process.platform !== "win32") chmodSync(shim, 0o755);
  }
});

afterAll(() => {
  rmSync(PY3_SHIM_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  rmSync(GO_SHIM_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
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
  go: boolean = true,
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
  const prefixes: string[] = [];
  if (python3) prefixes.push(PY3_SHIM_DIR);
  if (go) prefixes.push(GO_SHIM_DIR);
  // A tool marked absent must not be reachable at all, so the host PATH is
  // dropped whenever any tool is missing — otherwise the host's real
  // `python3`/`go` (or, on Windows, the hanging Store alias stub) leaks in.
  const pathValue =
    prefixes.length === 0
      ? MISSING_PATH_DIR
      : python3 && go
        ? [...prefixes, hostPath].join(path.delimiter)
        : prefixes.join(path.delimiter);
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

describe("detectGoTasks via --detect-only", () => {
  it("go.mod adds Go Vet", () => {
    const result = detect({ "go.mod": "module example.com/foo\n\ngo 1.23\n" });
    expect(names(result)).toContain("Go Vet");
  });

  it("go.mod plus a *_test.go file adds Go Tests and Go Vet", () => {
    const result = detect(
      { "go.mod": "module example.com/foo\n\ngo 1.23\n", "foo_test.go": "package foo\n" },
    );
    expect(names(result)).toContain("Go Tests");
    expect(names(result)).toContain("Go Vet");
  });

  it("go.mod without any *_test.go adds Go Vet only", () => {
    const result = detect(
      { "go.mod": "module example.com/foo\n\ngo 1.23\n", "foo.go": "package foo\n" },
    );
    expect(names(result)).toContain("Go Vet");
    expect(names(result)).not.toContain("Go Tests");
  });

  it("no go.mod adds neither Go task", () => {
    const result = detect({ "package.json": '{"scripts": {"test": "vitest run"}}\n' });
    expect(names(result)).not.toContain("Go Tests");
    expect(names(result)).not.toContain("Go Vet");
  });

  it("go missing on PATH yields a warning and no Go tasks", () => {
    // python3 stays shimmed — the Go fixtures carry no Python signal, so the
    // python3 path is never reached and only `go` is absent from PATH.
    const result = detect(
      { "go.mod": "module example.com/foo\n\ngo 1.23\n", "foo_test.go": "package foo\n" },
      [],
      true,
      false,
    );
    expect(names(result)).not.toContain("Go Tests");
    expect(names(result)).not.toContain("Go Vet");
    expect(result.warnings.some((w) => /go not found on PATH/.test(w))).toBe(true);
  });
});
