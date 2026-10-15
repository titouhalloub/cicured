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

/** Directories holding the python3 / go / semgrep / cargo stand-ins; prepended to PATH as needed. */
const PY3_SHIM_DIR = mkdtempSync(path.join(tmpdir(), "sft-py3-"));
const GO_SHIM_DIR = mkdtempSync(path.join(tmpdir(), "sft-go-"));
const SEMGREP_SHIM_DIR = mkdtempSync(path.join(tmpdir(), "sft-semgrep-"));
const CARGO_SHIM_DIR = mkdtempSync(path.join(tmpdir(), "sft-cargo-"));
/** A path that never exists, so a bare spawn fails with ENOENT. */
const MISSING_PATH_DIR = path.join(tmpdir(), "sft-tools-absent-does-not-exist");

/** Fixture dirs created by detect(), removed in afterEach. */
const fixtures: string[] = [];

beforeAll(() => {
  // `node --version` exits 0 — enough for hasPython3()/hasGo()/hasSemgrep()/
  // hasCargo(), which only check that the spawn did not error.
  for (const [dir, exe] of [
    [PY3_SHIM_DIR, "python3"],
    [GO_SHIM_DIR, "go"],
    [SEMGREP_SHIM_DIR, "semgrep"],
    [CARGO_SHIM_DIR, "cargo"],
  ] as const) {
    const shim = path.join(dir, process.platform === "win32" ? `${exe}.exe` : exe);
    copyFileSync(process.execPath, shim);
    if (process.platform !== "win32") chmodSync(shim, 0o755);
  }
});

afterAll(() => {
  rmSync(PY3_SHIM_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  rmSync(GO_SHIM_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  rmSync(SEMGREP_SHIM_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  rmSync(CARGO_SHIM_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

afterEach(() => {
  while (fixtures.length > 0) {
    rmSync(fixtures.pop() as string, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
interface DetectedTask {
  name: string;
  command: string;
  parser?: string;
  parserConfig?: unknown;
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
  semgrep: boolean = true,
  cargo: boolean = true,
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
  if (semgrep) prefixes.push(SEMGREP_SHIM_DIR);
  if (cargo) prefixes.push(CARGO_SHIM_DIR);
  // A tool marked absent must not be reachable at all, so the host PATH is
  // dropped whenever any tool is missing — otherwise the host's real
  // `python3`/`go`/`semgrep`/`cargo` (or, on Windows, the hanging Store alias
  // stub) leaks in.
  const pathValue =
    prefixes.length === 0
      ? MISSING_PATH_DIR
      : python3 && go && semgrep && cargo
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

describe("detectSemgrepTasks via --detect-only", () => {
  const securityTask = (result: DetectResult): DetectedTask | undefined =>
    result.tasks.find((t) => t.name === "Security");

  it("semgrep on PATH adds Security", () => {
    const result = detect({ "package.json": '{"scripts": {"test": "vitest run"}}\n' });

    const task = securityTask(result);
    expect(task).toBeDefined();
    expect(task?.command).toContain("--config auto");
    expect(task?.command).toContain("--metrics=off");
  });

  it("semgrep missing adds no Security task and no warning", () => {
    const result = detect({ "package.json": '{"scripts": {"test": "vitest run"}}\n' }, [], true, true, false);

    expect(names(result)).not.toContain("Security");
    // Unlike Python/Go there is no signal a repo *needs* Semgrep, so a missing
    // binary is deliberately silent — no warning at all.
    expect(result.warnings).toEqual([]);
  });

  it("mixed repo gets Tests, Python Tests, Go Tests, and Security", () => {
    const result = detect(
      {
        "package.json": '{"scripts": {"test": "vitest run"}}\n',
        "pyproject.toml": '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
        "go.mod": "module example.com/foo\n\ngo 1.23\n",
        "foo_test.go": "package foo\n",
      },
    );
    const list = names(result);
    expect(list).toContain("Tests");
    expect(list).toContain("Python Tests");
    expect(list).toContain("Go Tests");
    expect(list).toContain("Security");
    expect(new Set(list).size).toBe(list.length);
  });
});

describe("detectRustTasks via --detect-only", () => {
  const rustTask = (result: DetectResult, name: string): DetectedTask | undefined =>
    result.tasks.find((t) => t.name === name);

  it("Cargo.toml with cargo on PATH adds Rust Lint and Rust Tests", () => {
    const result = detect({
      "Cargo.toml": '[package]\nname = "foo"\nversion = "0.1.0"\nedition = "2021"\n',
    });
    const list = names(result);

    expect(list).toContain("Rust Lint");
    expect(list).toContain("Rust Tests");
    // Clippy's JSON diagnostics are the only reason NDJSON parsing works.
    expect(rustTask(result, "Rust Lint")?.command).toContain("--message-format=json");
    // --no-fail-fast keeps every target running so one failure doesn't mask the rest.
    expect(rustTask(result, "Rust Tests")?.command).toContain("--no-fail-fast");
  });

  it("no Cargo.toml adds neither Rust task and does not probe cargo", () => {
    const result = detect({ "package.json": '{"scripts": {"test": "vitest run"}}\n' }, [], true, true, true, false);

    expect(names(result)).not.toContain("Rust Lint");
    expect(names(result)).not.toContain("Rust Tests");
    expect(result.warnings.some((w) => /cargo not found/.test(w))).toBe(false);
  });

  it("cargo missing yields a warning and no Rust tasks", () => {
    const result = detect({ "Cargo.toml": '[package]\nname = "foo"\nversion = "0.1.0"\n' }, [], true, true, true, false);

    expect(names(result)).not.toContain("Rust Lint");
    expect(names(result)).not.toContain("Rust Tests");
    expect(result.warnings.some((w) => /cargo not found on PATH/.test(w))).toBe(true);
  });

  it("mixed repo gets Tests, Python Tests, Go Tests, Security, Rust Lint, Rust Tests", () => {
    const result = detect({
      "package.json": '{"scripts": {"test": "vitest run"}}\n',
      "pyproject.toml": '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
      "go.mod": "module example.com/foo\n\ngo 1.23\n",
      "foo_test.go": "package foo\n",
      "Cargo.toml": '[package]\nname = "foo"\nversion = "0.1.0"\n',
    });
    const list = names(result);

    expect(list).toContain("Tests");
    expect(list).toContain("Python Tests");
    expect(list).toContain("Go Tests");
    expect(list).toContain("Security");
    expect(list).toContain("Rust Lint");
    expect(list).toContain("Rust Tests");
    expect(new Set(list).size).toBe(list.length);
  });
});

describe("user-supplied config tasks via --detect-only", () => {
  it("a task with a parser field is preserved with its parserConfig", () => {
    const result = detect({
      "sft-dev.config.json":
        `${JSON.stringify(
          {
            tasks: [
              {
                name: "Custom Scan",
                command: "my-tool --json",
                parser: "json",
                parserConfig: { path: "results", fields: { file: "file", line: "line" } },
              },
            ],
          },
          null,
          2,
        )}\n`,
    });

    const task = result.tasks.find((t) => t.name === "Custom Scan");
    expect(task).toBeDefined();
    expect(task?.command).toBe("my-tool --json");
    expect(task?.parser).toBe("json");
    expect(task?.parserConfig).toEqual({ path: "results", fields: { file: "file", line: "line" } });
  });

  it("a config task without a parser field carries no parser keys", () => {
    const result = detect({
      "sft-dev.config.json":
        `${JSON.stringify({ tasks: [{ name: "Plain", command: "echo hi" }] }, null, 2)}\n`,
    });

    const task = result.tasks.find((t) => t.name === "Plain");
    expect(task).toBeDefined();
    expect(task?.parser).toBeUndefined();
    expect(task?.parserConfig).toBeUndefined();
  });

  it("an empty-string parser id is dropped instead of failing the report", () => {
    const result = detect({
      "sft-dev.config.json":
        `${JSON.stringify({ tasks: [{ name: "Bad", command: "echo hi", parser: "" }] }, null, 2)}\n`,
    });

    const task = result.tasks.find((t) => t.name === "Bad");
    expect(task).toBeDefined();
    expect(task?.parser).toBeUndefined();
  });
});
