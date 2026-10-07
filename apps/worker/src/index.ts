import Docker from "dockerode";
import IORedis from "ioredis";
import { createLogger } from "./common/secrets";
import { createDb } from "./db";
import { assertRunnerArtifact, loadDotEnvFile, loadEnv } from "./env";
import { mintInstallationToken } from "./github/token";
import { createRunJob } from "./job/run-job";
import { attachAndStream } from "./logs/attach";
import { createLogArchiver } from "./logs/archiver";
import { createLogPublisher } from "./logs/publisher";
import { extractAndValidateReport } from "./report/handler";
import { createRunsWorker } from "./queue/runs.worker";
import { createRunRepository } from "./run-repository";
import { createS3Client } from "./logs/s3-client";
import { createSandboxLauncher, type DockerLike } from "./sandbox/launcher";

/**
 * Worker bootstrap (Spec §11 M2). Consumes the same BullMQ queue the API
 * produces into and runs one hardened Docker sandbox per run.
 */
async function main(): Promise<void> {
  loadDotEnvFile();
  const env = loadEnv();
  // The pinned runner is bind-mounted into every sandbox: fail at boot, not
  // once per run, if the host path is wrong.
  assertRunnerArtifact(env);

  const logger = createLogger("boot", { queue: env.SFT_QUEUE_NAME });
  const database = createDb(env.DATABASE_URL);
  await database.pool.query("SELECT 1");

  const redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const docker: DockerLike = new Docker();
  const sandbox = createSandboxLauncher(docker, env);
  const repository = createRunRepository(database.db);
  // PUBLISH is an ordinary command, so the BullMQ client can carry the log
  // traffic; only the API needs a dedicated subscriber connection.
  const logPublisher = createLogPublisher(redis, env.SFT_LOG_CHANNEL_PREFIX);
  // Shared S3 client - the archiver reuses this single instance. Same config
  // as the API's presigner so presigned signatures never diverge (M2b-2).
  const s3Client = createS3Client(env);

  const processRun = createRunJob({
    env,
    repository,
    sandbox,
    logger,
    publisher: logPublisher,
    createArchiver: (runId) => createLogArchiver({ s3Client, bucket: env.S3_BUCKET, runId, logger }),
    attach: ({ containerId, runId, archiver }) =>
      attachAndStream(docker, containerId, runId, logPublisher, logger, archiver),
    mintToken: (installationId) => mintInstallationToken(installationId, env),
    extractReport: ({ containerId, runId }) =>
      extractAndValidateReport(
        docker,
        containerId,
        runId,
        env.REPORTS_DIR,
        logger.child({ runId }),
      ),
  });

  const worker = createRunsWorker({
    env,
    connection: redis,
    logger,
    handle: (data) => processRun(data.runId),
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`received ${signal}, shutting down`);
    // Stop consuming, kill the sandbox that is mid-run, then release the
    // connections in the order they were opened.
    await worker.close();
    await logPublisher.close();
    await sandbox.killAll();
    try {
      await redis.quit();
    } catch {
      redis.disconnect();
    }
    await database.close();
    logger.info("shutdown complete");
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  logger.info(`worker ready (concurrency 1, budget ${env.SFT_DEADLINE_BUDGET_MS}ms)`);
}

main().catch((error: unknown) => {
  // Boot failures (config, Postgres, Redis) land here with a readable message.
  console.error(`[sft-worker] boot ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
