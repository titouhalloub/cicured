import childProcess from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runRunner } from "../src/runner";

const RUNNER_PATH = "E:\\cicured\\packages\\runner\\sft-dev.mjs";

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
    const result = await runRunner([], { cwd: "C:\\tmp\\repo" });

    expect(spawnArgs[0]).toBe(RUNNER_PATH);
    expect(spawnArgs).toHaveLength(1);
    expect(spawnOpts.cwd).toBe("C:\\tmp\\repo");
    expect(result.exitCode).toBe(0);
  });

  it("forwards extra args to the runner", async () => {
    stubSpawn(1);
    await runRunner(["--json"], { cwd: "C:\\tmp\\repo" });
    expect(spawnArgs).toEqual([RUNNER_PATH, "--json"]);
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
