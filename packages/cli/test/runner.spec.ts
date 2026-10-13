import childProcess from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runRunner } from "../src/runner";

// The runner path is resolved at runtime by `resolveRunnerPath()` inside
// `src/runner.ts`. The test asserts its *shape*, not a machine-specific
// absolute path — a hardcoded E:\... made this pass only on the original
// Windows dev machine and fail everywhere else (including cicured's own
// sandbox on Linux).
const RUNNER_PATH_SUFFIX = /sft-dev\.mjs$/;

// cwd is passed through to spawn unchanged; the value does not need to
// exist on disk because spawn is stubbed below.
const TEST_CWD = "test-cwd-value-is-not-read";

let spawnArgs: string[];
let spawnOpts: childProcess.SpawnOptions;

function stubSpawn(exitCode: number): void {
  vi.spyOn(childProcess, "spawn").mockImplementation((
    _cmd: string,
    args: readonly string[],
    opts: childProcess.SpawnOptions,
  ) => {
    spawnArgs = [...args];
    spawnOpts = opts;
    return {
      on: (event: string, handler: (code: number) => void) => {
        if (event === "close") setImmediate(() => handler(exitCode));
        return undefined as never;
      },
    } as unknown as childProcess.ChildProcess;
  }) as unknown as typeof childProcess.spawn;
}

beforeEach(() => {
  spawnArgs = [];
  spawnOpts = {};
});

describe("runRunner", () => {
  it("spawns node with the resolved runner path and no extra args", async () => {
    stubSpawn(0);
    const result = await runRunner([], { cwd: TEST_CWD });

    expect(spawnArgs).toHaveLength(1);
    expect(spawnArgs[0]).toMatch(RUNNER_PATH_SUFFIX);
    expect(spawnOpts.cwd).toBe(TEST_CWD);
    expect(result.exitCode).toBe(0);
  });

  it("forwards extra args to the runner", async () => {
    stubSpawn(1);
    await runRunner(["--json"], { cwd: TEST_CWD });
    expect(spawnArgs).toHaveLength(2);
    expect(spawnArgs[0]).toMatch(RUNNER_PATH_SUFFIX);
    expect(spawnArgs[1]).toBe("--json");
  });

  it("surfaces the runner exit code", async () => {
    stubSpawn(2);
    const result = await runRunner([]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("returns 127 when the spawn itself throws", async () => {
    vi.spyOn(childProcess, "spawn").mockImplementation(() => {
      throw new Error("EACCES");
    });
    const result = await runRunner([]);
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain("failed to spawn");
  });

  it("never rejects", async () => {
    stubSpawn(0);
    await expect(runRunner([])).resolves.toBeDefined();
  });
});
