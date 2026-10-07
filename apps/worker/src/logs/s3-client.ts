import { S3Client } from "@aws-sdk/client-s3";
import type { WorkerEnv } from "../env";

/**
 * Shared S3 client config for the worker.
 * - S3_ENDPOINT set → MinIO mode: endpoint + forcePathStyle
 * - S3_ENDPOINT unset → real AWS S3: no endpoint override, no forcePathStyle
 */
export function createS3Client(env: WorkerEnv): S3Client {
  const endpoint = env.S3_ENDPOINT || undefined;
  return new S3Client({
    region: env.S3_REGION,
    endpoint,
    forcePathStyle: !!endpoint,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
}