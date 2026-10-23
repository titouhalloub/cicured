import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { WorkerLogger } from "../common/secrets";

export function createReportUploader({
  s3Client,
  bucket,
  logger,
}: {
  s3Client: S3Client;
  bucket: string;
  logger: WorkerLogger;
}) {
  return async (runId: string, report: unknown): Promise<string | null> => {
    const key = `reports/${runId}/sft-report.json`;
    try {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: JSON.stringify(report),
          ContentType: "application/json",
        }),
      );
      return key;
    } catch (error) {
      logger.error("failed to upload report to S3", error);
      return null;
    }
  };
}