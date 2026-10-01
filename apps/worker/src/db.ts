import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./tables";

/**
 * Postgres access for the worker. Mirrors apps/api/src/db/db.module.ts (drizzle
 * + node-postgres) but as plain factories: the worker is not a Nest app, it is
 * a BullMQ consumer bootstrapped in src/index.ts.
 */
export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  pool: Pool;
  db: Database;
  close(): Promise<void>;
}

export function createDb(databaseUrl: string, options: { max?: number } = {}): DbHandle {
  // One long-running run per worker (concurrency 1), so a small pool is enough.
  const pool = new Pool({ connectionString: databaseUrl, max: options.max ?? 4 });
  const db = drizzle(pool, { schema });
  return {
    pool,
    db,
    async close() {
      await pool.end();
    },
  };
}