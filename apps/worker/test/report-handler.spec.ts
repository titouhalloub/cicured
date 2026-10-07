import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SftReportV2 } from "@sft/schemas";
import { createLogger } from "../src/common/secrets";
import { extractAndValidateReport, REPORT_CONTAINER_PATH } from "../src/report/handler";
import type { DockerLike } from "../src/sandbox/launcher";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const logger = createLogger("report-test");

/** A valid schema-v2 report: exactly what the pinned runner emits on exit 0. */
const VALID_REPORT = {
  tool: "sft-dev",
  version: 2,
  finishedAt: "2026-09-30T12:00:00.000Z",
  runnerError: null,
  warnings: [],
  summary: { total: 1, passed: 1, failed: 0, skipped: 0, totalDurationMs: 1234 },
  tasks: [
    {
      name: "Type Check",
      command: "pnpm -r typecheck",
      success: true,
      exitCode: 0,
      timedOut: false,
      skipped: false,
      truncated: false,
      durationMs: 1234,
      stdout: "",
      stderr: "",
    },
  ],
};

/**
 * The entrypoint copies sft-report.json into the bind-mounted host directory
 * before the container exits; this writes it exactly where the handler looks.
 */
async function writeOutDir(reportsDir: string, contents: string): Promise<string> {
  const outDir = path.join(reportsDir, RUN_ID);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "sft-report.json"), contents);
  return outDir;
}

/** The handler no longer talks to Docker, but keeps the parameters. */
function dockerDouble(): DockerLike {
  return {
    createContainer: async () => {
      throw new Error("createContainer must not be called by the report handler");
    },
    getContainer: () => {
      throw new Error("getContainer must not be called by the report handler");
    },
  };
}

async function withReportsDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "sft-reports-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
describe("extractAndValidateReport", () => {
  it("validates and stores a report copied out of the sandbox", async () => {
    await withReportsDir(async (reportsDir) => {
      await writeOutDir(reportsDir, JSON.stringify(VALID_REPORT));

      const result = await extractAndValidateReport(
        dockerDouble(),
        "container-1",
        RUN_ID,
        reportsDir,
        logger,
      );

      expect(result).not.toBeNull();
      expect(result!.report).toMatchObject({ tool: "sft-dev", version: 2 });
      expect(result!.path).toBe(path.join(reportsDir, `${RUN_ID}.json`));

      // Stored verbatim, so M3's parser sees exactly the runner's bytes.
      const stored = JSON.parse(await readFile(result!.path, "utf8")) as unknown;
      expect(stored).toEqual(VALID_REPORT);
      expect(SftReportV2.safeParse(stored).success).toBe(true);
      // Owner-only: the report embeds untrusted build output.
      if (process.platform === "win32") {
        // Windows can't represent Unix owner-only permissions: fs.chmod only
        // toggles the read-only bit and Node reports 0o666 for writable files.
        // The 0o600 invariant is enforced on Linux, where the worker runs.
        return;
      }
      expect((await stat(result!.path)).mode & 0o777).toBe(0o600);
    });
  });

  it("removes the per-run staging directory after a successful extraction", async () => {
    await withReportsDir(async (reportsDir) => {
      const outDir = await writeOutDir(reportsDir, JSON.stringify(VALID_REPORT));
      expect((await stat(outDir)).isDirectory()).toBe(true);

      await extractAndValidateReport(
        dockerDouble(),
        "container-1",
        RUN_ID,
        reportsDir,
        logger,
      );

      // The bind-mounted per-run dir is transient: only <runId>.json survives.
      await expect(stat(outDir)).rejects.toThrow();
      expect((await stat(path.join(reportsDir, `${RUN_ID}.json`))).isFile()).toBe(true);
    });
  });

  it("reads the report from the runner's cwd inside the sandbox", () => {
    // The runner writes sft-report.json relative to its cwd, which the
    // entrypoint sets to the cloned repo.
    expect(REPORT_CONTAINER_PATH).toBe("/workspace/repo/sft-report.json");
  });

  it("returns null and writes nothing when the payload fails zod", async () => {
    await withReportsDir(async (reportsDir) => {
      await writeOutDir(reportsDir, JSON.stringify({ tool: "not-sft-dev", version: 99 }));

      const result = await extractAndValidateReport(
        dockerDouble(),
        "container-1",
        RUN_ID,
        reportsDir,
        logger,
      );

      expect(result).toBeNull();
      await expect(stat(path.join(reportsDir, `${RUN_ID}.json`))).rejects.toThrow();
    });
  });

  it("returns null when the file is not valid JSON", async () => {
    await withReportsDir(async (reportsDir) => {
      await writeOutDir(reportsDir, "{not json");

      const result = await extractAndValidateReport(
        dockerDouble(),
        "container-1",
        RUN_ID,
        reportsDir,
        logger,
      );
      expect(result).toBeNull();
    });
  });

  it("returns null when the run produced no report at all", async () => {
    await withReportsDir(async (reportsDir) => {
      // Runner crash before writing, or a container killed mid-install: the
      // per-run directory never gets the file.
      await mkdir(path.join(reportsDir, RUN_ID), { recursive: true });

      const result = await extractAndValidateReport(
        dockerDouble(),
        "container-1",
        RUN_ID,
        reportsDir,
        logger,
      );
      expect(result).toBeNull();
    });
  });

  it("returns null when the report exceeds the parser byte cap", async () => {
    await withReportsDir(async (reportsDir) => {
      const huge = {
        ...VALID_REPORT,
        tasks: [{ ...VALID_REPORT.tasks[0]!, stdout: "x".repeat(2 * 1024 * 1024 + 10) }],
      };
      await writeOutDir(reportsDir, JSON.stringify(huge));

      const result = await extractAndValidateReport(
        dockerDouble(),
        "container-1",
        RUN_ID,
        reportsDir,
        logger,
      );
      expect(result).toBeNull();
    });
  });

  it("refuses a run id that is not a uuid (no path traversal)", async () => {
    await withReportsDir(async (reportsDir) => {
      await writeOutDir(reportsDir, JSON.stringify(VALID_REPORT));

      await expect(
        extractAndValidateReport(
          dockerDouble(),
          "container-1",
          "../../etc/passwd",
          reportsDir,
          logger,
        ),
      ).rejects.toThrow(/runId must be a uuid/);
    });
  });
});