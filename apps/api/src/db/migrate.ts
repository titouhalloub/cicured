import { existsSync } from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "./db.module";

/**
 * Locates the `drizzle/` migration folder without relying on `__dirname` or
 * `import.meta` (the same code runs under tsx, Vitest and plain Node).
 */
export function resolveMigrationsFolder(cwd: string = process.cwd()): string {
  const override = process.env.SFT_MIGRATIONS_DIR;
  if (override) return path.resolve(override);

  const candidates: string[] = [];
  let dir = path.resolve(cwd);
  for (let depth = 0; depth < 5; depth += 1) {
    candidates.push(path.join(dir, "drizzle"), path.join(dir, "apps", "api", "drizzle"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "meta", "_journal.json"))) return candidate;
  }
  throw new Error(`cannot locate drizzle migrations folder (searched from ${cwd})`);
}

/** Applies all pending migrations. Idempotent - safe to run on every boot/test. */
export async function runMigrations(
  db: Database,
  folder: string = resolveMigrationsFolder(),
): Promise<void> {
  await migrate(db, { migrationsFolder: folder });
}
