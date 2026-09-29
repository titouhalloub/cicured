import { Controller, Get, Inject, Res } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Response } from "express";
import type IORedis from "ioredis";
import { DRIZZLE, type Database } from "../db";
import { REDIS } from "../queue/queue.module";

const HEALTH_TIMEOUT_MS = 2_000;

@Controller("health")
export class HealthController {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: IORedis,
  ) {}

  /** Liveness - no dependencies, always cheap (probe-safe). */
  @Get()
  liveness(): {
    status: "ok";
    service: string;
    uptimeSeconds: number;
    timestamp: string;
  } {
    return {
      status: "ok",
      service: "sft-api",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness - Postgres + Redis with a hard timeout; 503 when degraded (§9). */
  @Get("ready")
  async readiness(@Res({ passthrough: true }) res: Response): Promise<{
    status: "ok" | "degraded";
    database: boolean;
    redis: boolean;
  }> {
    const [database, redis] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);
    const ready = database && redis;
    if (!ready) res.status(503);
    return { status: ready ? "ok" : "degraded", database, redis };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await withTimeout(this.db.execute(sql`select 1`), HEALTH_TIMEOUT_MS);
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      await withTimeout(this.redis.ping(), HEALTH_TIMEOUT_MS);
      return true;
    } catch {
      return false;
    }
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`health check timed out after ${ms}ms`)),
      ms,
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
