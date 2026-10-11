# cicured — Extended Analysis Plan

**Status:** Draft, pending execution. Started 2026-10-11.
**Owner:** Reda Halloub
**Related:** `SFT-Dev_Spec.md`, `OPEN_CORE_PLAN.md`, `deploy/README.md`
**Supersedes:** nothing. This is a new phase, Phase 3 of the open-core
roadmap, extending the analysis surface of both the SaaS platform and the
free `sft` CLI.

---

## 1. Thesis

cicured's core differentiator is that it **executes code**, not just reads
it. Today the runner executes four tasks (Typecheck, Lint, Build, Tests)
and the parser extracts structured findings from their output. That's
enough to be useful. It is not enough to be a complete diagnostic layer.

Two categories of bugs are still invisible:

1. **Security bugs that static analysis catches** — hardcoded secrets,
   SQLi, XSS, insecure crypto, known CVEs in dependencies. CodeRabbit,
   Greptile, and Snyk all flag these. We don't.
2. **Cross-file structural bugs** — a change in one file silently breaks
   a caller in another. Greptile's code graph catches this. We don't.

Two categories are unique to us:

3. **Runtime bugs the code actually produces when executed** — unhandled
   promise rejections, missing env vars at boot, smoke-test crashes,
   memory leaks during the test run. Sentry catches these in production,
   behind an SDK. We catch them in the sandbox, before deploy.
4. **LLM patches grounded in a real failure** — CodeRabbit and Greptile
   feed the LLM a diff and hope it spots problems. We feed it a finding
   that *did* happen, plus the code graph around it. The LLM never has to
   guess whether a bug exists.

This plan closes the gap on (1) and (2) and strengthens (3) and (4).

---

## 2. Competitive positioning

Post-Phase-3 capability matrix:

| Capability | CodeRabbit | Greptile | Sentry | cicured (target) |
|---|---|---|---|---|
| Typecheck / Lint / Build / Tests | ✅ | ✅ | ❌ | ✅ |
| Hardcoded secret detection | ✅ | ✅ | ❌ | ✅ (Semgrep) |
| SAST (SQLi/XSS/crypto misuse) | ✅ | ✅ | ❌ | ✅ (Semgrep) |
| Dependency CVE scan | ✅ | ✅ | ❌ | ✅ (Semgrep Supply Chain) |
| Repository code graph | ❌ | ✅ | ❌ | ✅ (Phase 3b) |
| Runtime crash catch | ❌ | ❌ | ✅ prod | ✅ **sandbox** |
| Blast radius in patch | ❌ | static only | ❌ | ✅ **static + runtime** |
| LLM grounded in real failure | ❌ | ❌ | ⚠️ prod-only | ✅ always |
| Zero-install (no SDK) | ✅ | ✅ | ❌ | ✅ |

The matrix is the pitch. Any single row can be matched. The combination is
unique.

---

## 3. Scope

### In scope

- Code graph extraction from a repository, cached locally and by git SHA.
- Semgrep-based security scanning as a runner task.
- A graph-aware LLM prompt contract that includes caller context,
  test mapping, and blast radius.
- CLI additions: `sft run --extended`, `sft run --deep`, `sft explain <n>`,
  `sft fix <n>`, `sft graph`.
- New parser: `packages/parser/src/parsers/semgrep.ts`.
- New parser: `packages/parser/src/codegraph.ts`.
- New zod schemas for graph nodes, neighborhoods, and Semgrep findings.
- Worker integration: findings gain a `blastRadius` field; suggestions
  include the graph neighborhood in the prompt.

### Out of scope (deferred)

- Semgrep rule authoring. We ship curated community rule packs only.
- A code graph database. Graph is per-repo, per-SHA, cached to disk.
- A cross-repo code graph. Single-repo scope only.
- Bundle size budgets, license compliance, flaky test detection. Those
  are Phase 5.
- Metrics/analytics layer (Friction Index, etc.). Phase 5.
- Multi-language support. Node/TypeScript only for Phase 3.

---

## 4. Architecture

### 4.1 The three layers, stacked

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: Graph-aware LLM                                    │
│   Input:  finding + graph neighborhood + minimal code slices│
│   Output: schema-validated unified diff                     │
├─────────────────────────────────────────────────────────────┤
│ Layer 2: Code graph                                         │
│   Build once per (repo, SHA). Cache at .sft/graph.json.     │
│   Provides: callers, callees, tests touching each file.     │
├─────────────────────────────────────────────────────────────┤
│ Layer 1: Deterministic analysis                             │
│   Runner tasks: Typecheck, Lint, Build, Tests, Security.    │
│   Parser turns each task's output into ParsedFinding[].     │
└─────────────────────────────────────────────────────────────┘
```

Layer 3 cannot exist without Layer 2 (needs callers). Layer 2 does not
depend on Layer 1 (graph is static). Layer 1 is already shipped for the
original four tasks; Phase 3a adds Security as a fifth.

### 4.2 Where each piece lives

| Piece | Repo location | Published? |
|---|---|---|
| Code graph builder | `packages/parser/src/codegraph.ts` | Yes (MIT, part of `@sft/parser`) |
| Semgrep parser | `packages/parser/src/parsers/semgrep.ts` | Yes |
| Graph schemas | `packages/schemas/src/codegraph.ts` | Yes (MIT) |
| Graph-aware LLM | `apps/worker/src/ai/` | **No** (SaaS-only) |
| CLI commands | `packages/cli/src/commands/` | Yes (MIT) |
| Runner Security task | `sft-dev.config.json` | N/A (config) |
| Semgrep in sandbox | `docker/sandbox/Dockerfile` | N/A |

### 4.3 Data flow

**SaaS path (worker runs a job):**

```
clone  →  install deps  →  build graph  →  run tasks (incl. Security)
                                              ↓
                                        sft-report.json
                                              ↓
                                        parse → findings[]
                                              ↓
                              enrich findings with graph neighborhoods
                                              ↓
                                        persist to DB
                                              ↓
                              LLM per finding (graph-aware prompt)
                                              ↓
                                        suggestions[]
```

**CLI path (developer runs `sft run --extended`):**

```
cwd  →  build graph (cached by git SHA)
     →  run tasks (Typecheck, Lint, Build, Tests, Security)
     →  parse findings
     →  enrich with graph
     →  print structured summary
     →  append to .sft/cache.json
     →  optional: sft explain <n> / sft fix <n>
```

---

## 5. Phase breakdown

### Phase 3a — Semgrep integration

**Goal:** close the static security parity gap. After 3a, cicured detects
the same classes of issues CodeRabbit flags — but our findings are
extracted deterministically and formatted for the LLM, not lost in prose.

**Duration:** 1 session.

**Deliverables:**

- `docker/sandbox/Dockerfile` — add Semgrep.
  - Base image change: `apk add python3 py3-pip` OR switch to
    `python:3.12-alpine` and layer Node on top. Simpler: keep
    `node:20-alpine`, add `python3 py3-pip`, then `pip install
    --no-cache-dir semgrep`.
  - Rule packs cached at `/opt/semgrep/rules/` (bundled, not downloaded
    at run time).
  - `SEMGREP_SEND_METRICS=off` set in the image env.
- `sft-dev.config.json` — add a fifth task:

  ```json
  {
    "name": "Security",
    "command": "semgrep scan --config /opt/semgrep/rules --json --json-output=semgrep.json --severity WARNING --severity ERROR --metrics=off --quiet"
  }
  ```

- `packages/schemas/src/finding.ts` — extend `FINDING_CATEGORIES` to
  include `"security"`. Update the `Finding` zod schema. Update
  `RULE_ID_PATTERNS.security` with the Semgrep format:
  `/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+$/` (Semgrep rules are
  dotted names like `javascript.lang.security.audit.sqli`).
- `packages/parser/src/parsers/semgrep.ts` — new. Signature:
  `parseSemgrep(jsonPath: string): ParsedFinding[]`.
  - Reads `semgrep.json` (schema `semgrep_output_v1`).
  - Maps `results[].check_id` → `ruleId`.
  - Maps `results[].path` → `file` (strip workspace prefix).
  - Maps `results[].start.line` → `line`, `start.col` → `col`.
  - Maps `results[].extra.message` → `message`.
  - Maps `results[].extra.severity` → `severity`:
    - `CRITICAL` → `error`
    - `HIGH` → `error`
    - `MEDIUM` → `warning`
    - `LOW` → `info`
    - `INFO` → `info`
  - Ignores `results[].extra.metadata` beyond what's needed.
  - Caps output at 500 findings (same as the other parsers).
  - Never throws.
- `packages/parser/src/parsers/index.ts` — dispatch `"Security"` to
  `parseSemgrep`. Note: `parseSemgrep` reads a file path, not a string.
  Change the dispatcher signature to support both shapes:
  `parseTask(task, cwd)`. Or, simpler: the runner's report embeds the
  semgrep JSON as `stdout` (via `--json` to stdout, not `--json-output`).
  Decision: **use `--json` alone, no `--json-output`**, so semgrep
  prints to stdout and the existing dispatcher signature works.
- `packages/parser/test/fixtures/semgrep-clean.json` — a Semgrep run with
  zero results.
- `packages/parser/test/fixtures/semgrep-many.json` — 3+ findings, mix
  of severities, at least one CWE-tagged.
- `packages/parser/test/semgrep.spec.ts` — 5 tests.

**Exit criteria:**

- `pnpm -r typecheck && pnpm -r lint && pnpm -r test` green.
- `node packages/runner/sft-dev.mjs` inside a repo with a known-bad file
  produces a `Security` task that exits 1 and a `sft-report.json` with
  semgrep findings.
- `packages/parser` test count rises by 5.

**Risks:**

- Semgrep pulls ~180 MB of dependencies into the sandbox image. If the
  3 GB tmpfs workspace becomes a problem, see Phase 3d (deferred).
- Semgrep's rule pack (`p/javascript`, `p/typescript`) expects registry
  access on first run. Bundling the packs at image build time avoids
  this but adds a build step. **Decision:** bundle.
- Semgrep JSON output has one top-level key (`results`) plus `errors`
  and `paths`. If `errors` is non-empty (parse failures), the parser
  emits a single synthetic finding with `ruleId: "SEMGREP_PARSE_ERROR"`.

---

### Phase 3b — Code graph

**Goal:** produce a per-repo structural graph that answers "what calls
this, what does this call, what tests touch it." This is the piece that
makes LLM patches safe and makes `sft explain` genuinely useful.

**Duration:** 1 session.

**Deliverables:**

- `packages/schemas/src/codegraph.ts` — new. Zod schemas:

  ```ts
  export const CodeGraphFunction = z.object({
    name: z.string(),
    file: z.string(),
    line: z.number().int().nonnegative(),
    callsTo: z.array(z.string()),
    calledBy: z.array(z.string()),
    referencedIn: z.array(z.string()),
  });

  export const CodeGraphFile = z.object({
    path: z.string(),
    imports: z.array(z.string()),
    importedBy: z.array(z.string()),
    functions: z.array(CodeGraphFunction),
    tests: z.array(z.string()), // test files that import this file
  });

  export const CodeGraph = z.object({
    version: z.literal(1),
    repoRoot: z.string(),
    gitSha: z.string().nullable(),
    builtAt: z.string().datetime(),
    files: z.array(CodeGraphFile),
  });

  export type CodeGraph = z.infer<typeof CodeGraph>;
  export type CodeGraphFile = z.infer<typeof CodeGraphFile>;
  export type CodeGraphFunction = z.infer<typeof CodeGraphFunction>;
  ```

- `packages/parser/src/codegraph.ts` — new. Builds the graph.

  ```ts
  export interface BuildOptions {
    rootDir: string;
    testFilePatterns?: string[]; // default: ["**/*.test.ts", "**/*.spec.ts", "**/*.test.tsx"]
    excludePatterns?: string[];  // default: ["**/node_modules/**", "**/dist/**", "**/.next/**"]
  }

  export async function buildCodeGraph(opts: BuildOptions): Promise<CodeGraph>;
  export function findFile(graph: CodeGraph, path: string): CodeGraphFile | null;
  export function findFunction(graph: CodeGraph, name: string): CodeGraphFunction[];
  export interface Neighborhood {
    file: CodeGraphFile;
    function?: CodeGraphFunction;
    callers: CodeGraphFunction[];
    callees: CodeGraphFunction[];
    tests: string[];
  }
  export function blastRadiusFor(graph: CodeGraph, finding: { file: string; line: number }): Neighborhood | null;
  ```

  Implementation notes:
  - Use the TypeScript compiler API (`typescript` is already a devDep)
    to parse each `.ts` / `.tsx` file. Do NOT regex-parse.
  - For each source file: extract `import` statements, `export`
    declarations, and function/method declarations.
  - Build a reverse index for `calledBy` and `importedBy` in a second
    pass.
  - `tests` for a file = every test-pattern-matching file that imports
    it (directly or transitively).
  - Cap at 5,000 files. Beyond that, emit a graph with a `warnings`
    entry and no functions — the CLI prints "repo too large for full
    graph; run on a package." Do not OOM.
  - Cache format: exactly the `CodeGraph` shape, written to
    `<rootDir>/.sft/graph.json`. Cache key is `gitSha`; if the file's
    `gitSha` matches `git rev-parse HEAD` and the graph was built less
    than 24 hours ago, reuse it. Otherwise rebuild.
  - Never throws. On total failure returns an empty graph with a
    warning.

- `packages/cli/src/commands/graph.ts` — new. Command `sft graph`.
  - Runs `buildCodeGraph({ rootDir: process.cwd() })`.
  - Writes to `.sft/graph.json`.
  - Prints a summary: `N files, M functions, X cross-references`.
  - `--json` prints the raw graph.

- `packages/cli/src/commands/run.ts` — modify. Before running tasks,
  build (or load) the graph, so `sft explain` and `sft fix` can use it.
  Store it in memory for the session, and rely on `.sft/graph.json` for
  persistence.

- `packages/parser/test/codegraph.spec.ts` — 8 tests:
  - builds a graph from a small fixture directory
  - detects import edges
  - detects caller edges for a known function
  - detects test files that import a source file
  - respects exclude patterns
  - caches to `.sft/graph.json` and reuses when SHA matches
  - invalidates cache when SHA changes
  - returns empty graph on unreadable input without throwing

- `packages/parser/test/fixtures/graph-fixture/` — a 5-file fixture repo
  with a known call graph:
  ```
  src/a.ts        — exports functionA, calls functionB from b.ts
  src/b.ts        — exports functionB
  src/c.ts        — imports a.ts, calls functionA
  test/a.spec.ts  — imports a.ts, tests functionA
  package.json    — minimal
  ```

**Exit criteria:**

- `pnpm -r typecheck && pnpm -r lint && pnpm -r test` green.
- `sft graph` on the cicured repo itself produces a `.sft/graph.json`
  with > 0 files and > 0 functions.
- `sft graph --json` output parses with `CodeGraph.parse()`.
- Parser test count rises by 8.

**Risks:**

- TypeScript compiler API is slow on large repos (~5–15s for 500 files).
  Acceptable for a one-time cost per SHA.
- Circular imports break naive graph walkers. Use a visited set.
- Dynamic imports (`await import(...)`) and `require()` aren't detected
  by static analysis. Note as a known limitation; the graph is
  best-effort.

---

### Phase 3c — Graph-aware LLM

**Goal:** feed the LLM a finding, a graph neighborhood, and minimal code
slices. Produce patches that compile.

**Duration:** 1 session.

**Deliverables:**

- `packages/schemas/src/suggestion.ts` — extend `SuggestionDraft`. The
  existing shape is `{ patchDiff, explanation, confidence }`. Add:

  ```ts
  filesTouched: z.array(z.string()).min(1).max(10),
  ```

  to the draft shape. The LLM must declare which files it's changing.
  This makes patches auditable: if the LLM touches a file outside the
  neighborhood, we reject it.

- `apps/worker/src/ai/context.ts` — extend `buildSuggestionPrompt` to
  accept a `Neighborhood`:

  ```ts
  export function buildSuggestionPrompt(
    finding: FindingsWithFingerprint,
    snippet: string,
    neighborhood: Neighborhood | null,
  ): SuggestionPrompt;
  ```

  New user prompt section between `<untrusted_finding>` and
  `<untrusted_code>`:

  ```
  Code graph neighborhood:
  <codegraph_neighborhood>
  File: {file}
  Function: {function.name} (line {function.line})
  Called by:
    - {caller.file}:{caller.line} {caller.name}
  Calls:
    - {callee.file}:{callee.line} {callee.name}
  Tests that import this file:
    - {test path}
  </codegraph_neighborhood>
  ```

  Update the system prompt: add a line "If the patch changes a
  function's signature, it MUST update every caller listed in
  `<codegraph_neighborhood>`."

- `apps/worker/src/job/run-job.ts` — after finding persistence, load the
  graph from `.sft/graph.json` (worker writes it during the run, see
  below) and enrich each finding before sending it to the LLM.

- `apps/worker/src/sandbox/entrypoint.sh` — after install, run the
  graph builder. But the sandbox doesn't have `packages/parser`. Two
  options:
  1. **Bundle the graph builder into the sandbox** as a separate script
     injected via bind mount. Adds surface area.
  2. **Build the graph after report extraction, in the worker.** The
     worker has `packages/parser`, and the cloned repo is still
     available in the sandbox's `/out` output. **Decision: option 2**
     — but that means the worker needs a copy of the repo, which it
     doesn't have (only the report).

  **Revised decision:** the sandbox writes `sft-report.json` and the
  worker extracts it. For the graph, we need the repo. Two paths:
  - **(a)** Add a second output: the sandbox runs `tsc --noEmit` after
    tasks and tars up the `.ts` files' file list plus imports. Too
    fragile.
  - **(b)** Build the graph in the sandbox as a task. Add a sixth task
    `Graph` that runs a small injected script `sft-graph.mjs` (bundled
    with the runner, MIT, small) and writes `sft-graph.json` to the
    workspace. Worker extracts it alongside `sft-report.json`.

  **Decision: (b).** The graph builder ships as `sft-graph.mjs` in
  `packages/runner/bin/`, and the runner invokes it after Tests. The
  graph schema stays in `packages/schemas`; the sandbox writes it as
  JSON without needing the zod validation (worker validates on extract).

- `packages/runner/bin/sft-graph.mjs` — new. A ~200-line Node script
  that:
  - Reads `./package.json` and `./tsconfig.json`.
  - Walks source files with a naive but correct TS parser (regex-based
    is unacceptable; use a bundled lightweight parser like
    `@typescript-eslint/typescript-estree` via a vendored copy, or
    reimplement the import/export scan with a 150-line lexer).
  - Emits `sft-graph.json` in the same shape as `CodeGraph`.
  - **Alternative:** ship `sft-graph.mjs` as a thin wrapper that spawns
    `npx --yes tsx packages/parser/src/codegraph-cli.ts`. Requires the
    parser package to be installed, which the sandbox doesn't have.
  - **Final decision:** the graph builder is a **dependency-free
    hand-written scanner** living in `packages/runner/bin/sft-graph.mjs`.
    It is not a full TypeScript compiler — it uses a regex-based
    import/export scanner with a conservative fallback: if it can't
    parse a file, it skips it and notes it in the graph's `warnings`.
    Full AST-based graph is only used in the CLI path via
    `packages/parser`.

  This is a deviation from the "one builder" plan. It's justified: the
  sandbox image shouldn't carry the TypeScript compiler for a graph
  scan.

- `packages/cli/src/commands/explain.ts` — new. Command `sft explain <n>`.
  - Reads the last `sft-report.json` and `.sft/graph.json`.
  - Prints the finding, the neighborhood, and calls the LLM (BYOK) to
    produce a plain-English explanation (no patch).
  - Uses a shorter prompt: the system prompt says "explain the finding
    in one paragraph; do not propose a patch."

- `packages/cli/src/commands/fix.ts` — new. Command `sft fix <n>`.
  - Same as `suggest` but with the graph neighborhood in the prompt.
  - After the LLM returns a patch, prints it and asks `Apply? [y/N]`.
  - On `y`, writes the patch via `git apply` (not a custom applier).
  - On `n`, discards.
  - Never applies without confirmation.

- `packages/cli/src/commands/run.ts` — modify to call `sft graph` first
  (only if `--deep` or `--extended`), and to run the security task when
  `--extended`.

- `packages/cli/src/index.ts` — wire the new commands into the dispatcher
  and the help text.

**Exit criteria:**

- `pnpm -r typecheck && pnpm -r lint && pnpm -r test` green.
- `sft run --extended` runs 5 tasks.
- `sft run --deep` runs 5 tasks + graph build.
- `sft explain 1` against a repo with a known failure prints a
  graph-grounded explanation.
- `sft fix 1` produces a patch that `git apply` accepts (dry-run mode).
- Worker tests: the graph-enriched prompt includes the neighborhood
  section, verified by a snapshot test.

**Risks:**

- The LLM's patch now has access to more context, which can make it
  *more* likely to touch files outside the finding. The `filesTouched`
  validation catches this.
- The sandbox graph builder is a weaker implementation than the CLI's.
  Acceptable — the CLI graph is for the developer, the sandbox graph is
  only for the LLM prompt.
- `git apply` on Windows may fail on CRLF/LF mismatches. The CLI normalizes
  patches to LF before applying.

---

### Phase 3d — optional hardening (deferred)

Bundled Semgrep adds ~180 MB to the sandbox. If the tmpfs cap is
exceeded on larger repos, split the sandbox into two stages:
- Stage 1: install + build + Typecheck + Lint + Tests + Graph
- Stage 2: Security (with Semgrep installed in a separate image layer,
  only pulled when `--extended`)

Not needed for Phase 3a.

---

## 6. New data shapes

### 6.1 `Finding` extended

```ts
export const Finding = z.object({
  severity: FindingSeverity,           // error|warning|info
  category: FindingCategory,           // build|typecheck|lint|test|security
  ruleId: z.string().min(1).max(300),
  file: z.string().min(1).max(4096),
  line: z.number().int().nonnegative(),
  col: z.number().int().nonnegative(),
  message: z.string().min(1).max(10_000),
  fingerprint: z.string().regex(SHA256_HEX_PATTERN),
  blastRadius: z.object({
    callers: z.number().int().nonnegative(),
    callees: z.number().int().nonnegative(),
    tests: z.number().int().nonnegative(),
  }).optional(),
});
```

`blastRadius` is additive. Findings without graph enrichment omit it.

### 6.2 `RULE_ID_PATTERNS.security`

```ts
security: {
  source: "semgrep",
  pattern: /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+$/,
  example: "javascript.lang.security.audit.sqli",
},
```

### 6.3 Semgrep result → ParsedFinding mapping

| Semgrep field | ParsedFinding field |
|---|---|
| `check_id` | `ruleId` |
| `path` | `file` (strip `/workspace/repo/` prefix if present) |
| `start.line` | `line` |
| `start.col` | `col` |
| `extra.message` | `message` |
| `extra.severity` | `severity` (mapped, see Phase 3a) |
| (constant) | `category: "security"` |

---

## 7. Config surface

### 7.1 `sft-dev.config.json` after Phase 3a

```json
{
  "tasks": [
    { "name": "Type Check", "command": "pnpm -r typecheck" },
    { "name": "Lint",       "command": "pnpm -r lint" },
    { "name": "Build",      "command": "pnpm -r build" },
    { "name": "Tests",      "command": "pnpm -r test" },
    { "name": "Security",   "command": "semgrep scan --config /opt/semgrep/rules --json --severity WARNING --severity ERROR --metrics=off --quiet" }
  ]
}
```

### 7.2 CLI flags after Phase 3c

| Flag | Effect |
|---|---|
| `sft run` | 4 tasks (default) |
| `sft run --extended` | + Security |
| `sft run --deep` | + Security + Graph |
| `sft run --json` | Machine-readable output |
| `sft run --no-cache` | Skip `.sft/cache.json` write |
| `sft graph` | Build graph explicitly |
| `sft graph --json` | Emit graph to stdout |
| `sft explain <n>` | Explain finding #n (BYOK) |
| `sft fix <n>` | Patch finding #n (BYOK, requires confirm) |
| `sft suggest` | Deprecated; use `sft fix` with no arg to fix #1 |

### 7.3 Env vars

| Var | Default | Used by |
|---|---|---|
| `SFT_SEMGREP_CONFIG` | `/opt/semgrep/rules` | Sandbox Security task |
| `SFT_GRAPH_MAX_FILES` | `5000` | Graph builder |
| `SFT_GRAPH_CACHE_HOURS` | `24` | Graph cache freshness |

---

## 8. Testing strategy

### 8.1 Parser tests

- Existing: tsc, eslint, jest, fingerprint, parse-report.
- New: semgrep (5 tests), codegraph (8 tests).
- Total parser tests: 19 → 32.

### 8.2 CLI tests

- Existing: cache, credentials, runner, init, run.
- New: graph command (3 tests), explain command (2 tests, mocked LLM),
  fix command (3 tests, dry-run patch apply).
- Total CLI tests: 21 → 29.

### 8.3 Worker tests

- Extend `run-job.spec.ts`:
  - "enriches findings with blast radius when the graph is present"
  - "skips enrichment when the graph is absent"
- Extend `context.spec.ts`:
  - "system prompt mentions callers when neighborhood is provided"
  - "neighborhood is omitted when null"
- Total worker tests: 116 → 120.

### 8.4 Fixtures

- `packages/parser/test/fixtures/semgrep-clean.json`
- `packages/parser/test/fixtures/semgrep-many.json`
- `packages/parser/test/fixtures/graph-fixture/` (5 files, ~40 lines)
- `apps/worker/test/ai/fixtures/neighborhood.json` (a pre-baked
  `Neighborhood` object)

**All fixtures are hand-written from real tool output.** No invented
formats.

---

## 9. Exit criteria (whole of Phase 3)

- `pnpm -r typecheck && pnpm -r lint && pnpm -r test` green across all
  seven packages.
- `node packages/runner/sft-dev.mjs` runs 5 tasks on cicured's own repo
  and produces a valid `sft-report.json`.
- `sft run --extended` on a fresh clone of a repo with a known secret
  produces a `security` finding with the correct rule_id.
- `sft graph` on a 100-file repo builds in under 15 seconds.
- `sft explain 1` produces a graph-grounded explanation.
- `sft fix 1` produces a patch that `git apply --check` accepts.
- A sandbox run of the SaaS worker produces a suggestion whose patch
  touches only files listed in `filesTouched`.

---

## 10. Non-goals

- A code graph database. Graph is file-based and per-SHA.
- Cross-repo graphs. One graph per repo.
- LLM fine-tuning. We use base models.
- Semgrep rule authoring. We ship community packs.
- TypeScript-in-JS support (`// @ts-check`). Not in Phase 3.
- Monorepo-aware graph (multiple `tsconfig.json`). Best-effort only.

---

## 11. Open questions

1. **Do we ship the sandbox graph builder as a hand-written scanner,
   or install the parser package?**
   - Hand-written: no extra deps, but weaker accuracy.
   - Install parser: adds `typescript` (~80 MB) to the sandbox.
   - **Lean:** hand-written for the sandbox, full AST for the CLI.
   - **Risk:** two implementations to keep in sync. Mitigation: the
     graph schema is the contract, and both are tested against the same
     fixture.

2. **Does `sft run --extended` become the default in a future release?**
   - Pro: security scanning should be default.
   - Con: adds 30–60s to every run, and Semgrep output has false
     positives that erode trust.
   - **Lean:** keep `--extended` opt-in for Phase 3. Revisit in Phase 5.

3. **Should the LLM prompt include the entire caller snippet, or just
   the signature?**
   - Entire caller: more context, more tokens.
   - Signature only: cheaper, less likely to hallucinate.
   - **Lean:** signature only for Phase 3. Add a "see caller code" flag
     in Phase 3.1.

4. **What's the fate of `sft suggest` vs `sft fix`?**
   - `suggest` prints, `fix` applies. Overlapping.
   - **Lean:** deprecate `suggest`, alias it to `fix --dry-run`.

---

## 12. Rollout

| Phase | Commit | What ships |
|---|---|---|
| 3a | `feat(parser, runner): add Semgrep security task` | Static parity with CodeRabbit |
| 3b | `feat(parser, cli): code graph builder and CLI command` | Blast radius in findings |
| 3c | `feat(worker, cli): graph-aware LLM prompts and sft fix` | Grounded patches |

Each phase ships independently. Each is one session.

After Phase 3, the open-core phases resume:

| Phase | What ships |
|---|---|
| 4 | Publish `@cicured/sft` and `@cicured/cli` to npm |
| 5 | Metrics layer (Friction Index, flaky tests, etc.) |

---

## 13. Risks summary

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Semgrep image size exceeds tmpfs | Medium | High | Fallback to two-stage sandbox (Phase 3d) |
| Graph builder is inaccurate on complex TS | Medium | Medium | Full AST in CLI, best-effort in sandbox; both documented |
| LLM patches touch unrelated files | Medium | High | `filesTouched` validation rejects out-of-neighborhood edits |
| Semgrep false positives erode trust | High | Medium | Bundle curated rules only; severity `WARNING`+ |
| `git apply` fails on Windows line endings | High | Low | Normalize patches to LF before applying |
| Sandbox graph and CLI graph diverge | Medium | Medium | Shared zod schema; fixture-driven tests on both |

---

## 14. Kickoff prompts

Each phase is a single Cline task. Prompts are not included here — they
are generated per-phase from the deliverables above, matching the pattern
used in `OPEN_CORE_PLAN.md` (prescriptive, exact, exit criteria at the
end). Ask for `Phase 3a`, `Phase 3b`, or `Phase 3c` to receive the next
one.

---

*End of plan.*