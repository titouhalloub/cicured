import { mkdtempSync, promises as fsPromises } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Container, ContainerCreateOptions } from "dockerode";
import {
  createSandboxContainer,
  type DockerLike,
  type SandboxLaunchInput,
} from "../src/sandbox/launcher";
import { makeEnv } from "./test-utils";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "ghs_supersecrettokenvalue0123456789";

const INPUT: SandboxLaunchInput = {
  runId: RUN_ID,
  installationId: 4242,
  repoFullName: "acme/web",
  branch: "main",
  token: TOKEN,
};

/** A dockerode double. Unit tests never touch a real Docker daemon. */
function makeDockerDouble() {
  const created: ContainerCreateOptions[] = [];
  const container = {
    id: "container-1",
    start: vi.fn(async () => undefined),
    wait: vi.fn(async () => ({ StatusCode: 0 })),
    kill: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  } as unknown as Container;

  const docker: DockerLike = {
    createContainer: async (options) => {
      created.push(options);
      return container;
    },
    getContainer: () => container,
  };

  return { docker, created, container };
}

function envOf(
  options: { taskTimeoutMs?: number; budgetMs?: number; reportsDir?: string } = {},
) {
  return makeEnv({
    SFT_TASK_TIMEOUT_MS: options.taskTimeoutMs ?? 600_000,
    SFT_DEADLINE_BUDGET_MS: options.budgetMs ?? 900_000,
    // Default to a throwaway directory so tests never touch the real
    // ./tmp/reports tree when exercising the /out bind.
    REPORTS_DIR:
      options.reportsDir ??
      join(mkdtempSync(path.join(tmpdir(), "sft-cfg-")), "reports"),
  });
}

describe("createSandboxContainer (Spec §8 hardening)", () => {
  it("mounts the pinned runner read-only and tmpfs-es the workspace", async () => {
    const { docker, created, container } = makeDockerDouble();
    await createSandboxContainer(docker, envOf(), INPUT);

    expect(created).toHaveLength(1);
    const options = created[0]!;
    expect(options.Image).toBe("cicured/sandbox:node20");
    // Bind 1: the pinned runner, read-only.
    expect(options.HostConfig?.Binds?.[0]).toBe(
      "/host/path/packages/runner/sft-dev.mjs:/opt/sft/sft-dev.mjs:ro",
    );
    expect(options.HostConfig?.Tmpfs).toMatchObject({
      "/workspace": expect.stringContaining("size=3g"),
      "/tmp": expect.any(String),
    });
    expect(container.start).toHaveBeenCalledTimes(1);
  });

  it("bind-mounts a run-scoped host output directory at /out", async () => {
    const { docker, created } = makeDockerDouble();
    const reportsDir = await mkdtemp(path.join(tmpdir(), "sft-out-"));
    try {
      await createSandboxContainer(
        docker,
        envOf({ reportsDir }),
        INPUT,
      );

      const options = created[0]!;
      const binds = options.HostConfig?.Binds ?? [];
      expect(binds).toHaveLength(3);
      // Bind 2: the per-run host dir. The workspace is a tmpfs, so the report
      // is copied here before the container exits.
      const expected = `${path.resolve(reportsDir, RUN_ID)}:/out:rw`;
      expect(binds[1]).toBe(expected);
      // Bind 3: the persistent pnpm store, so installs reuse the host cache.
      expect(binds.some((bind) => /sft-dev\.mjs:.*:ro$/.test(bind))).toBe(true);
      expect(binds.some((bind) => /out:rw$/.test(bind))).toBe(true);
      expect(binds.some((bind) => /pnpm-store:rw$/.test(bind))).toBe(true);

      // The host side of that bind must exist before the container starts.
      const outDir = path.resolve(reportsDir, RUN_ID);
      expect((await stat(outDir)).isDirectory()).toBe(true);
    } finally {
      await rm(reportsDir, { recursive: true, force: true });
    }
  });

  it("makes the output directory writable by the container's foreign uid", async () => {
    const { docker } = makeDockerDouble();
    const reportsDir = await mkdtemp(path.join(tmpdir(), "sft-out-"));
    try {
      await createSandboxContainer(docker, envOf({ reportsDir }), INPUT);

      const outDir = path.resolve(reportsDir, RUN_ID);
      const mode = (await stat(outDir)).mode & 0o777;
      // The sandbox user is uid 1001, the worker is uid 1000, and the worker
      // cannot chown. "other" write is the ONLY thing that lets the entrypoint
      // copy the report out.
      expect(mode & 0o002).toBe(0o002);
            if (process.platform === "win32") {
        // Windows doesn't implement Unix file modes: fs.chmod only toggles the
        // read-only bit and Node reports 0o666 for writable files regardless of
        // the requested mode. This assertion guards a umask regression on Linux,
        // where the worker actually runs.
        return;
      }
      // Guard the regression that motivated this: mkdir's `mode` argument is
      // masked by the process umask, so relying on it alone yields 0756 here.
      expect(mode).toBe(0o777);
    } finally {
      await rm(reportsDir, { recursive: true, force: true });
    }
  });

  it("creates the pnpm store host directory before launching", async () => {
    const { docker } = makeDockerDouble();
    const env = envOf();
    const mkdirSpy = vi.spyOn(fsPromises, "mkdir");
    const chmodSpy = vi.spyOn(fsPromises, "chmod");
    try {
      await createSandboxContainer(docker, env, INPUT);
      expect(mkdirSpy).toHaveBeenCalledWith(env.PNPM_STORE_HOST_PATH, {
        recursive: true,
        mode: 0o777,
      });
      expect(chmodSpy).toHaveBeenCalledWith(env.PNPM_STORE_HOST_PATH, 0o777);
    } finally {
      mkdirSpy.mockRestore();
      chmodSpy.mockRestore();
    }
  });

  it("applies every locked hardening flag", async () => {
    const { docker, created } = makeDockerDouble();
    await createSandboxContainer(docker, envOf(), INPUT);

    const host = created[0]!.HostConfig!;
    expect(host.ReadonlyRootfs).toBe(true);
    expect(host.CapDrop).toEqual(["ALL"]);
    expect(host.SecurityOpt).toEqual(["no-new-privileges"]);
    expect(host.Memory).toBe(4 * 1024 * 1024 * 1024);
    expect(host.NanoCpus).toBe(2_000_000_000);
    // Container lifetime is explicit: the worker removes it in a finally block.
    expect(host.AutoRemove).toBe(false);
  });

  it("passes clone and deadline settings through env only", async () => {
    const { docker, created } = makeDockerDouble();
    await createSandboxContainer(
      docker,
      envOf({ taskTimeoutMs: 300_000, budgetMs: 840_000 }),
      { ...INPUT, branch: "release" },
    );

    expect(created[0]!.Env).toEqual([
      "GIT_REPO_URL=github.com/acme/web",
      "GIT_BRANCH=release",
      `GIT_TOKEN=${TOKEN}`,
      "SFT_DEADLINE_MS=840000",
      "SFT_TASK_TIMEOUT_MS=300000",
    ]);
  });

  it("never leaks the token into binds, labels or the container name", async () => {
    const { docker, created } = makeDockerDouble();
    await createSandboxContainer(docker, envOf(), INPUT);

    const options = created[0]!;
    expect(options.name).toBe(`sft-run-${RUN_ID}`);
    expect(JSON.stringify(options.Labels)).not.toContain(TOKEN);
    expect(JSON.stringify(options.HostConfig?.Binds)).not.toContain(TOKEN);

    // The token may appear in exactly one place: the Env array.
    const occurrences = JSON.stringify(options).split(TOKEN).length - 1;
    expect(occurrences).toBe(1);
  });

  it("labels the container for orphan cleanup", async () => {
    const { docker, created } = makeDockerDouble();
    await createSandboxContainer(docker, envOf(), INPUT);

    expect(created[0]!.Labels).toMatchObject({
      "sft.run-id": RUN_ID,
      "sft.repo": "acme/web",
      "sft.installation-id": "4242",
    });
  });

  it("rejects an invalid run id or repo before calling Docker", async () => {
    const { docker, created } = makeDockerDouble();

    await expect(
      createSandboxContainer(docker, envOf(), { ...INPUT, runId: "../../etc" }),
    ).rejects.toThrow(/runId must be a uuid/);
    await expect(
      createSandboxContainer(docker, envOf(), {
        ...INPUT,
        repoFullName: "evil.example.com/x",
      }),
    ).rejects.toThrow(/invalid repoFullName/);

    expect(created).toHaveLength(0);
  });

  it("removes a created container when start fails", async () => {
    const { docker, container } = makeDockerDouble();
    (container.start as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("no such image"),
    );

    await expect(createSandboxContainer(docker, envOf(), INPUT)).rejects.toThrow(
      "no such image",
    );
    expect(container.remove).toHaveBeenCalledWith({ force: true });
  });
});