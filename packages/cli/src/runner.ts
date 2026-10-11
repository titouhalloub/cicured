// Default import so tests can `vi.spyOn(childProcess, "spawn")`.
import childProcess from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const SPAWN_FAILED: RunResult = {
  exitCode: 127,
  stdout: "",
  stderr: "failed to spawn the runner",
};

/**
 * Locates `sft-dev.mjs` from the installed `@cicured/sft` package.
 *
 * `import.meta.resolve` is the documented path, but bundler/SSR transforms
 * (including Vitest's) can replace `import.meta` with a plain `{ url }` object,
 * which would drop `resolve`. `createRequire` is the same resolver through a
 * different door, so it is used as a fallback rather than as the primary.
 */
function resolveRunnerPath(): string {
  const dynamicResolve = import.meta.resolve as
    | ((specifier: string) => string)
    | undefined;
  const resolved =
    typeof dynamicResolve === "function"
      ? dynamicResolve("@cicured/sft")
      : createRequire(import.meta.url).resolve("@cicured/sft");
  return resolved.startsWith("file:") ? fileURLToPath(resolved) : resolved;
}

export async function runRunner(
  args: string[],
  opts: { cwd?: string } = {},
): Promise<RunResult> {
  let runnerPath: string;
  try {
    runnerPath = resolveRunnerPath();
  } catch {
    return {
      ...SPAWN_FAILED,
      stderr:
        "could not resolve @cicured/sft — install it with `npm install @cicured/sft`",
    };
  }

  return new Promise<RunResult>((resolve) => {
    let child: childProcess.ChildProcess;
    try {
      child = childProcess.spawn(
        process.execPath,
        [runnerPath, ...args],
        {
          cwd: opts.cwd ?? process.cwd(),
          stdio: ["ignore", "inherit", "inherit"],
        },
      );
    } catch {
      resolve(SPAWN_FAILED);
      return;
    }

    child.on("error", () => resolve(SPAWN_FAILED));
    child.on("close", (code) => resolve({ exitCode: code ?? 1, stdout: "", stderr: "" }));
  });
}
