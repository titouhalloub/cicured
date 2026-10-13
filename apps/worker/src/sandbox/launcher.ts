import { promises as fs } from "node:fs";
import path from "node:path";
import type { Container, ContainerCreateOptions } from "dockerode";
import { UUID_PATTERN } from "@sft/schemas";
import type { WorkerEnv } from "../env";

/** Spec §8 sandbox limits: 2 CPU / 4 GB / non-root / read-only / tmpfs. */
const SANDBOX_MEMORY_BYTES = 4 * 1024 * 1024 * 1024;
const SANDBOX_NANO_CPUS = 2_000_000_000;
const WORKSPACE_TMPFS = "size=3g,uid=1001,gid=1001,mode=0755,exec";
/** A read-only rootfs leaves /tmp unusable; give tools a small writable area. */
const TMP_TMPFS = "size=64m,mode=1777";
const WORKSPACE_DIR = "/workspace";
/** The pinned runner is injected by mount, never copied from the user's repo. */
export const RUNNER_CONTAINER_PATH = "/opt/sft/sft-dev.mjs";
/**
 * GitHub only in v1 - no arbitrary clone URLs (Spec §8, SSRF). Owner segments
 * follow GitHub's own rules (alphanumerics and hyphens, no dots); repository
 * names additionally allow dots and underscores.
 */
const REPO_FULL_NAME_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9_.-]+$/;

/**
 * The slice of dockerode the worker uses. Narrowing it keeps every unit test
 * away from a real Docker daemon ("never call real Docker in unit tests").
 */
export interface DockerLike {
  createContainer(options: ContainerCreateOptions): Promise<Container>;
  getContainer(id: string): Container;
}

export interface SandboxLaunchInput {
  runId: string;
  installationId: number;
  repoFullName: string;
  branch: string;
  /** Minted per run; passed to the container as GIT_TOKEN and nowhere else. */
  token: string;
}

export interface SandboxWaitResult {
  exitCode: number | null;
  timedOut: boolean;
}

export interface SandboxHandle {
  readonly containerId: string;
  waitFor(timeoutMs: number): Promise<SandboxWaitResult>;
  remove(): Promise<void>;
}

export interface SandboxLauncher {
  launch(input: SandboxLaunchInput): Promise<SandboxHandle>;
  /** Force-removes every in-flight container (graceful shutdown). */
  killAll(): Promise<void>;
}

/**
 * Creates and starts one sandbox container for a run.
 *
 * Hardening (Spec §0/§8): read-only root filesystem, tmpfs-only workspace,
 * `no-new-privileges`, Docker's default seccomp profile, all capabilities
 * dropped, 2 CPU / 4 GB. `AutoRemove` stays false so the container's lifetime is
 * explicit: the worker removes it in a `finally` block, and a run can always be
 * inspected if something goes wrong.
 */
export async function createSandboxContainer(
  docker: DockerLike,
  env: WorkerEnv,
  input: SandboxLaunchInput,
): Promise<Container> {
  const { runId, installationId, repoFullName, branch, token } = input;
  if (!UUID_PATTERN.test(runId)) throw new Error("runId must be a uuid");
  if (!REPO_FULL_NAME_PATTERN.test(repoFullName)) {
    throw new Error(`invalid repoFullName: ${repoFullName}`);
  }
  if (branch.trim() === "") throw new Error("branch is required");

  // Per-run host output directory, bind-mounted at /out: the workspace is a
  // tmpfs, so once the container exits the report is gone. The entrypoint
  // copies sft-report.json here before exiting.
  //
  // The container's sandbox user (uid 1001) is NOT the worker's uid (1000),
  // and the worker has no CAP_CHOWN to chown the directory. The entrypoint's
  // `cp` therefore runs as a foreign uid and can only write if the directory
  // grants "other" write. mkdir's `mode` is masked by the process umask
  // (0777 & ~022 = 0755), so the chmod is required - the mode argument alone
  // is not enough.
  const outDir = path.resolve(env.REPORTS_DIR, runId);
  await fs.mkdir(outDir, { recursive: true, mode: 0o777 });

  // The pnpm store is bind-mounted read-write at /pnpm-store (the entrypoint
  // sets PNPM_STORE_DIR/npm_config_store_dir accordingly) so installs reuse
  // the host cache instead of re-downloading native binaries into the tmpfs
  // on every run. Same 0o777/umask caveat as the /out directory above: the
  // sandbox user (uid 1001) must be able to write to it, and mkdir's `mode`
  // is masked by the process umask, so the chmod below is required too.
  await fs.mkdir(env.PNPM_STORE_HOST_PATH, { recursive: true, mode: 0o777 });
  await fs.chmod(env.PNPM_STORE_HOST_PATH, 0o777);
  await fs.chmod(outDir, 0o777);

  const options: ContainerCreateOptions = {
    Image: env.SANDBOX_IMAGE,
    name: `sft-run-${runId}`,
    WorkingDir: WORKSPACE_DIR,
    Env: [
      `GIT_REPO_URL=github.com/${repoFullName}`,
      `GIT_BRANCH=${branch}`,
      `GIT_TOKEN=${token}`,
      // The entrypoint turns this budget into the runner deadline:
      // SFT_DEADLINE_MS = budget - installMs - 60s (Spec §2 pre-flight).
      `SFT_DEADLINE_MS=${env.SFT_DEADLINE_BUDGET_MS}`,
      `SFT_TASK_TIMEOUT_MS=${env.SFT_TASK_TIMEOUT_MS}`,
    ],
    Labels: {
      "sft.run-id": runId,
      "sft.repo": repoFullName,
      "sft.installation-id": String(installationId),
    },
    HostConfig: {
      Memory: SANDBOX_MEMORY_BYTES,
      NanoCpus: SANDBOX_NANO_CPUS,
      ReadonlyRootfs: true,
      Tmpfs: { [WORKSPACE_DIR]: WORKSPACE_TMPFS, "/tmp": TMP_TMPFS },
      SecurityOpt: ["no-new-privileges"],
      CapDrop: ["ALL"],
      // Seccomp: nothing set - Docker applies its default profile.
      AutoRemove: false,
      Binds: [
        `${env.SFT_RUNNER_HOST_PATH}:${RUNNER_CONTAINER_PATH}:ro`,
        `${outDir}:/out:rw`,
        `${env.PNPM_STORE_HOST_PATH}:/pnpm-store:rw`,
      ],
    },
  };

  const container = await docker.createContainer(options);
  try {
    await container.start();
  } catch (error) {
    // Never leave a created-but-unstarted container behind.
    await container.remove({ force: true }).catch(() => undefined);
    throw error;
  }
  return container;
}
/**
 * Waits for the container to exit, killing it when it outlives `timeoutMs`.
 * On timeout the exit code is discarded: `timedOut` is what the run is
 * classified by (Spec §5: `timeout` is detected around the runner).
 */
export async function startContainerAndWait(
  container: Container,
  timeoutMs: number,
): Promise<SandboxWaitResult> {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
    timer.unref();
  });

  try {
    const winner = await Promise.race([
      container.wait().then((result) => ({ kind: "exited" as const, result })),
      expiry,
    ]);
    if (winner === "timeout") {
      try {
        await container.kill();
      } catch {
        // The container may have exited between the timer and the kill.
      }
      return { exitCode: null, timedOut: true };
    }
    return { exitCode: winner.result.StatusCode ?? null, timedOut: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Binds the launcher to one environment and tracks in-flight containers. */
export function createSandboxLauncher(docker: DockerLike, env: WorkerEnv): SandboxLauncher {
  const active = new Set<SandboxHandle>();

  return {
    async launch(input: SandboxLaunchInput): Promise<SandboxHandle> {
      const container = await createSandboxContainer(docker, env, input);
      const handle: SandboxHandle = {
        containerId: container.id,
        waitFor: (timeoutMs: number) => startContainerAndWait(container, timeoutMs),
        remove: async () => {
          active.delete(handle);
          await container.remove({ force: true });
        },
      };
      active.add(handle);
      return handle;
    },

    async killAll(): Promise<void> {
      // `remove({ force: true })` stops and deletes the container, which is
      // exactly what a shutdown must do to an in-flight sandbox.
      for (const handle of [...active]) {
        try {
          await handle.remove();
        } catch {
          // Already gone - nothing to clean up.
        }
      }
    },
  };
}