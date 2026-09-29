import { defineConfig } from "drizzle-kit";

/** Offline config for `drizzle-kit generate`; runtime migrations use src/db/migrate.ts. */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://sft:sft@localhost:5432/sft_dev",
  },
  strict: true,
  verbose: true,
});
