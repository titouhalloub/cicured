import { promises as fs } from "node:fs";
import path from "node:path";
import { PARSER_LIMITS, parseSftReport, UUID_PATTERN, type SftReportV2 } from "@sft/schemas";
import type { WorkerLogger } from "../common/secrets";
import type { DockerLike } from "../sandbox/launcher";

/** The runner writes its report into its own cwd, which is the cloned repo. */
export const REPORT_CONTAINER_PATH = "/workspace/repo/sft-report.json";

export interface ExtractedReport {
  report: SftReportV2;
  path: string;
}

/**
 * Reads sft-report.json that the sandbox entrypoint copied to /out before
 * the container exited.
 *
 * The report is untrusted, attacker-controlled input (Spec §8): it is read
 * from a dedicated per-run host directory (bind-mounted into the container),
 * capped at the shared parser byte limit, and zod-validated. Anything that
 * goes wrong - missing file, oversize, invalid JSON, schema violation -
 * returns `null` so the caller can classify the run as `runner_crash`.
 *
 * The `_docker` and `_containerId` parameters are kept for interface
 * stability with createRunJob's ReportExtractor type, but are no longer used
 * (the report is read from disk, not the container filesystem - tmpfs files
 * vanish when the container exits).
 *
 * M2a stores the validated report on the worker host under REPORTS_DIR; S3
 * archival (with the 30-day retention boundary) is M2b.
 */
export async function extractAndValidateReport(
  _docker: DockerLike,
  _containerId: string,
  runId: string,
  reportsDir: string,
  logger: WorkerLogger,
): Promise<ExtractedReport | null> {
  if (!UUID_PATTERN.test(runId)) throw new Error("runId must be a uuid");

  const absReports = path.resolve(reportsDir);
  const source = path.join(absReports, runId, "sft-report.json");

  let raw: string;
  try {
    const stat = await fs.stat(source);
    if (stat.size > PARSER_LIMITS.maxReportBytes) {
      logger.warn(`sft-report.json exceeds ${PARSER_LIMITS.maxReportBytes} bytes`);
      return null;
    }
    raw = await fs.readFile(source, "utf8");
  } catch (error) {
    logger.warn("no sft-report.json in the sandbox output directory", error);
    return null;
  }

  const parsed = parseSftReport(raw);
  if (!parsed.ok) {
    logger.warn(`sft-report.json failed schema validation: ${parsed.error}`);
    return null;
  }

  const target = path.join(absReports, `${runId}.json`);
  const staging = path.join(absReports, `.${runId}.json.tmp`);
  // Written verbatim (already validated) and owner-only: the report contains
  // build output from an untrusted repository.
  await fs.writeFile(staging, raw, { mode: 0o600 });
  await fs.rename(staging, target);

  // Clean up the per-run staging directory from the bind mount.
  await fs.rm(path.join(absReports, runId), { recursive: true, force: true });

  logger.info(`stored sft-report.json at ${target}`);
  return { report: parsed.report, path: target };
}