import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { loadDotEnvFile, loadEnv } from "../config/env";
import { resolveMigrationsFolder, runMigrations } from "./migrate";
import * as schema from "./schema";

/** `pnpm --filter @sft/api db:migrate` - applies apps/api/drizzle migrations. */
async function main(): Promise<void> {
  loadDotEnvFile();
  const env = loadEnv();
  const folder = resolveMigrationsFolder();
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    console.log(`[db:migrate] applying migrations from ${folder}`);
    await runMigrations(drizzle(pool, { schema }), folder);
    console.log("[db:migrate] done");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("[db:migrate] failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
