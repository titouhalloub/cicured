#!/usr/bin/env node
// sft-dev.mjs — sandboxed build runner for SFT-Dev SaaS (v2, hardened)
// Contract: writes sft-report.json in cwd; exit 0 = all tasks passed, 1 = >=1 task failed, 2 = runner crash.
// Report schema stays version 2; new fields are additive: task.skipped, task.truncated, report.warnings.
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const RUN_STARTED = Date.now();

// ── 1. Environment hygiene ─────────────────────────────────────────────
for (const key of Object.keys(process.env)) {
  if (/^(GIT_|GITHUB_|GITLAB_|GH_|GL_)/.test(key)) delete process.env[key];
}
const binDir = path.join(process.cwd(), "node_modules", ".bin");
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
process.env.FORCE_COLOR = "0";
process.env.CI = "true";

// ── 2. Limits ──────────────────────────────────────────────────────────
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const TASK_TIMEOUT_MS = num(process.env.SFT_TASK_TIMEOUT_MS, 10 * 60 * 1000); // per task
const DEADLINE_MS = num(process.env.SFT_DEADLINE_MS, 12 * 60 * 1000);          // whole run (pod budget is 15 min)
const KILL_GRACE_MS = 5000;
const TAIL_CHARS = 200000;                                                     // per stream, per task

const warnings = [];

// ── 3. Toolchain detection ─────────────────────────────────────────────
function readPkg() {
  try { return JSON.parse(readFileSync("package.json", "utf8")); } catch { return {}; }
}
function hasEslintConfig(pkg) {
  if (pkg.eslintConfig) return true;
  try {
    return readdirSync(".").some(f => /^(eslint\.config\.(js|mjs|cjs|ts|mts|cts)|\.eslintrc(\.(js|cjs|mjs|json|yaml|yml))?)$/.test(f));
  } catch { return false; }
}
const isPlaceholderScript = (s) => typeof s !== "string" || /no test specified/i.test(s);

function detectTasks() {
  const pkg = readPkg();
  const s = pkg.scripts || {};
  const dev = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const tasks = [];
  if (existsSync("tsconfig.json")) tasks.push({ name: "Type Check", command: "tsc --noEmit --pretty false" });
  if (hasEslintConfig(pkg)) tasks.push({ name: "Lint", command: "eslint . --no-color" });
  if (s.build) tasks.push({ name: "Build", command: "npm run build" });
  if (s.test && !isPlaceholderScript(s.test)) {
    // jest/vitest exit 1 when zero test files exist; treat "no tests yet" as a pass, like the original runner
    const passNone = /\b(jest|vitest)\b/.test(s.test) ? " -- --passWithNoTests" : "";
    tasks.push({ name: "Tests", command: `npm test${passNone}` });
  }
  else if (existsSync("vitest.config.ts") || existsSync("vitest.config.js") || dev.vitest) tasks.push({ name: "Tests", command: "vitest run" });
  else if (existsSync("jest.config.js") || existsSync("jest.config.ts") || dev.jest) tasks.push({ name: "Tests", command: "jest --passWithNoTests --ci" });
  // Phase 3d-1: Python tasks are additive — mixed repos get both sets and the
  // names never collide with the Node/TS ones.
  for (const task of detectPythonTasks()) tasks.push(task);
  for (const task of detectGoTasks()) tasks.push(task);
  for (const task of detectSemgrepTasks()) tasks.push(task);
  for (const task of detectRustTasks()) tasks.push(task);
  return tasks;
}

// Python toolchain probe (Phase 3d-1): tasks are only added when python3 is
// actually runnable, so a missing interpreter skips gracefully with a warning
// instead of failing every Python task at spawn time.
function hasPython3() {
  try { return !spawnSync("python3", ["--version"], { stdio: "ignore" }).error; } catch { return false; }
}

function detectPythonTasks() {
  let pyproject = "";
  try { pyproject = readFileSync("pyproject.toml", "utf8"); } catch {}
  const hasPyproject = pyproject.length > 0;
  const hasTestsDir = existsSync("tests");
  // One pytest signal from any of the config surfaces: a [tool.*pytest*] key
  // in pyproject.toml, a tests/ dir next to it, pytest.ini / tox.ini, or a
  // plain requirements.txt / setup.py repo that ships a tests/ directory.
  const pytestSignal =
    (hasPyproject && (/\[tool\.[^\]]*pytest/.test(pyproject) || hasTestsDir)) ||
    existsSync("pytest.ini") ||
    existsSync("tox.ini") ||
    (!hasPyproject && (existsSync("requirements.txt") || existsSync("setup.py")) && hasTestsDir);
  const ruffSignal =
    (hasPyproject && /\[tool\.ruff/.test(pyproject)) ||
    existsSync("ruff.toml") ||
    existsSync(".ruff.toml");
  if (!pytestSignal && !ruffSignal) return [];
  if (!hasPython3()) {
    warnings.push("python3 not found on PATH; skipping Python tasks");
    return [];
  }
  const tasks = [];
  if (pytestSignal) tasks.push({ name: "Python Tests", command: "python3 -m pytest -v --no-header --tb=short" });
  if (ruffSignal) tasks.push({ name: "Python Lint", command: "ruff check --output-format=json ." });
  return tasks;
}

// Go toolchain probe (Phase 3d-3): mirrors hasPython3() — a module without a
// runnable `go` skips gracefully with a warning instead of failing every Go
// task at spawn time.
function hasGo() {
  try { return !spawnSync("go", ["version"], { stdio: "ignore" }).error; } catch { return false; }
}

/** Shallow walk (max depth 3) for a *_test.go file, skipping vendor/ and .git/. */
function hasGoTestFile(dir, depth) {
  if (depth > 3) return false;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const entry of entries) {
    if (entry.isFile() && /_test\.go$/.test(entry.name)) return true;
    if (entry.isDirectory() && entry.name !== "vendor" && entry.name !== ".git" && hasGoTestFile(path.join(dir, entry.name), depth + 1)) return true;
  }
  return false;
}

function detectGoTasks() {
  if (!existsSync("go.mod")) return [];
  if (!hasGo()) {
    warnings.push("go not found on PATH; skipping Go tasks");
    return [];
  }
  const tasks = [{ name: "Go Vet", command: "go vet ./..." }];
  if (hasGoTestFile(".", 1)) tasks.push({ name: "Go Tests", command: "go test -json ./..." });
  return tasks;
}

// Semgrep probe (Phase 3a): multi-language SAST. Unlike Python/Go there is no
// repo signal that *needs* Semgrep — it auto-detects languages from the files
// present — so a missing binary is silent (no warning). --metrics=off keeps the
// tool local-first; --quiet keeps stdout to JSON only.
function hasSemgrep() {
  try { return !spawnSync("semgrep", ["--version"], { stdio: "ignore" }).error; } catch { return false; }
}

function detectSemgrepTasks() {
  if (!hasSemgrep()) return [];
  return [{ name: "Security", command: "semgrep --config=auto --json --no-git-ignore --quiet --metrics=off", timeout: 300000 }];
}

// Cargo probe (Phase 3d-4): mirrors hasGo() — a module without a runnable
// `cargo` skips gracefully with a warning instead of failing every Rust task
// at spawn time.
function hasCargo() {
  try { return !spawnSync("cargo", ["--version"], { stdio: "ignore" }).error; } catch { return false; }
}

function detectRustTasks() {
  if (!existsSync("Cargo.toml")) return [];
  if (!hasCargo()) {
    warnings.push("cargo not found on PATH; skipping Rust tasks");
    return [];
  }
  // --quiet keeps clippy's stdout to NDJSON only (no "Compiling..." progress
  // lines to pollute the stream); --no-fail-fast runs every test target even
  // when one fails, which is what a diagnostics tool wants.
  return [
    { name: "Rust Lint", command: "cargo clippy --message-format=json --quiet" },
    { name: "Rust Tests", command: "cargo test --no-fail-fast" },
  ];
}

/** Parser dispatch fields carried by user-supplied config tasks (Phase 3e). */
const parserFieldsOf = (task) =>
  task.parser ? { parser: task.parser, parserConfig: task.parserConfig } : {};

function loadConfig() {
  const cfgPath = "sft-dev.config.json";
  if (existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
      if (Array.isArray(cfg.tasks) && cfg.tasks.length) {
        const valid = cfg.tasks.filter(t => t && typeof t.name === "string" && typeof t.command === "string" && t.command.trim());
        if (valid.length !== cfg.tasks.length) warnings.push(`sft-dev.config.json: ${cfg.tasks.length - valid.length} invalid task(s) ignored`);
        // Phase 3e: a config task may pin a registry parser id + free-form
        // config. Drop them unless the id is a non-empty string, otherwise the
        // report would fail SftTaskV2 (parser: z.string().min(1)).
        for (const task of valid) {
          if (task.parser !== undefined && (typeof task.parser !== "string" || !task.parser)) delete task.parser;
          if (task.parser === undefined) delete task.parserConfig;
        }
        if (valid.length) return valid;
        warnings.push("sft-dev.config.json: no valid tasks, falling back to auto-detection");
      }
    } catch (e) {
      warnings.push(`sft-dev.config.json invalid: ${e.message}`);
    }
  }
  const detected = detectTasks();
  if (!detected.length) warnings.push("no tasks detected (no tsconfig, eslint config, build/test script)");
  return detected;
}

// ── 4. Task execution (streams live, captures tails, kills process group) ──
function killTree(child) {
  try {
    if (process.platform === "win32") child.kill();
    else process.kill(-child.pid, "SIGTERM");
  } catch {}
  setTimeout(() => {
    try {
      if (process.platform === "win32") child.kill("SIGKILL");
      else process.kill(-child.pid, "SIGKILL");
    } catch {}
  }, KILL_GRACE_MS).unref();
}

function runTask(task, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    console.log(`\n[sft-dev] ▶ ${task.name}: ${task.command}`);
    let out = "", err = "", truncated = false, timedOut = false, settled = false;
    const cap = (s, chunk) => {
      s += chunk;
      if (s.length > TAIL_CHARS * 2) { s = s.slice(-TAIL_CHARS); truncated = true; }
      return s;
    };
    const child = spawn(task.command, {
      shell: true, env: process.env, stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32"
    });
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    child.stdout.on("data", d => { const t = d.toString(); process.stdout.write(t); out = cap(out, t); });
    child.stderr.on("data", d => { const t = d.toString(); process.stderr.write(t); err = cap(err, t); });
    const finish = (code, signal, spawnError) => {
      if (settled) return; settled = true; clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      const exitCode = timedOut ? 124 : (typeof code === "number" ? code : (spawnError ? 127 : 1));
      const result = {
        name: task.name, command: task.command, ...parserFieldsOf(task),
        success: !timedOut && !spawnError && code === 0,
        exitCode, timedOut, skipped: false, truncated, durationMs,
        stdout: out.slice(-TAIL_CHARS), stderr: (spawnError ? `${spawnError.message}\n` : "") + err.slice(-TAIL_CHARS)
      };
      console.log(`[sft-dev] ${result.success ? "✔" : "✖"} ${task.name} (${durationMs}ms)` +
        (timedOut ? " — TIMEOUT" : "") + (exitCode ? ` — exit ${exitCode}` : ""));
      resolve(result);
    };
    child.on("error", e => finish(null, null, e));
    child.on("close", (code, signal) => finish(code, signal, null));
  });
}

const skippedResult = (task, reason) => ({
  name: task.name, command: task.command, ...parserFieldsOf(task),
  success: false, exitCode: null, timedOut: false,
  skipped: true, truncated: false, durationMs: 0, stdout: "", stderr: reason
});

// ── 5. Orchestration ───────────────────────────────────────────────────
const results = [];
let runnerError = null;

function writeReport() {
  const executed = results.filter(r => !r.skipped);
  const report = {
    tool: "sft-dev", version: 2,
    finishedAt: new Date().toISOString(),
    runnerError, warnings,
    summary: {
      total: results.length,
      passed: executed.filter(r => r.success).length,
      failed: executed.filter(r => !r.success).length,
      skipped: results.filter(r => r.skipped).length,
      totalDurationMs: Date.now() - RUN_STARTED
    },
    tasks: results
  };
  try { writeFileSync("sft-report.json", JSON.stringify(report, null, 2)); }
  catch (e) { console.error(`[sft-dev] could not write report: ${e.message}`); runnerError = runnerError || `report write failed: ${e.message}`; }
  return report;
}

function crash(e) {
  runnerError = runnerError || (e && e.message) || String(e);
  console.error(`[sft-dev] RUNNER ERROR: ${runnerError}`);
  writeReport();
  process.exit(2);   // never let an uncaught exception fall through to Node's default exit 1
}
process.on("uncaughtException", crash);
process.on("unhandledRejection", crash);

async function main() {
  if (process.argv.includes("--detect-only")) {
    // loadConfig(), not detectTasks(): the flag's contract is "what would this
    // run", so user-supplied sft-dev.config.json tasks (and their parser
    // fields, Phase 3e) must appear alongside the auto-detected ones.
    const tasks = loadConfig();
    process.stdout.write(JSON.stringify({ tasks, warnings }, null, 2) + "\n");
    process.exit(0);
  }
  const tasks = loadConfig();
  console.log(`[sft-dev] platform=${os.platform()} tasks=${tasks.length} cwd=${process.cwd()} deadline=${DEADLINE_MS}ms`);
  for (const w of warnings) console.log(`[sft-dev] ⚠ ${w}`);

  for (const task of tasks) {
    const remaining = DEADLINE_MS - (Date.now() - RUN_STARTED);
    if (remaining <= 0) { results.push(skippedResult(task, "global deadline exceeded")); continue; }
    results.push(await runTask(task, Math.min(task.timeout ?? TASK_TIMEOUT_MS, remaining)));
  }

  const report = writeReport();
  console.log(`\n[sft-dev] ── SUMMARY: ${report.summary.passed}/${report.summary.total} passed` +
    (report.summary.skipped ? `, ${report.summary.skipped} skipped` : "") + " ──");
  for (const r of results) console.log(`  ${r.skipped ? "○" : r.success ? "✔" : "✖"} ${r.name}`);

  if (runnerError) process.exit(2);
  process.exit(report.summary.failed > 0 || report.summary.skipped > 0 ? 1 : 0);
}

main().catch(crash);
