import { Global, Inject, Module, type OnModuleDestroy } from "@nestjs/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { AppConfig } from "../config/app-config.service";
import * as schema from "./schema";

export const PG_POOL = "PG_POOL";
export const DRIZZLE = "DRIZZLE_DB";
export type Database = NodePgDatabase<typeof schema>;

/** Postgres access for the whole API (drizzle + node-postgres). */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: (config: AppConfig) =>
        new Pool({ connectionString: config.databaseUrl, max: 10 }),
      inject: [AppConfig],
    },
    {
      provide: DRIZZLE,
      useFactory: (pool: Pool) => drizzle(pool, { schema }),
      inject: [PG_POOL],
    },
  ],
  exports: [DRIZZLE],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
