import { Global, Inject, Module, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { AppConfig } from "../config/app-config.service";
import { RunsQueue } from "./runs-queue.service";
import { REDIS, RUNS_QUEUE } from "./queue.constants";

/**
 * Redis + BullMQ producers (Spec §0: "Queue: BullMQ on Redis 7"). The worker
 * consumer lands in M2; M1 only enqueues. `lazyConnect` keeps the API bootable
 * when Redis is down (readiness reports it instead of crashing).
 */
@Global()
@Module({
  providers: [
    // RunsQueue wraps RUNS_QUEUE for the services that enqueue runs. It is
    // provided and exported here so any module can inject it by class token;
    // it was previously @Injectable but registered in no module at all.
    RunsQueue,
    {
      provide: REDIS,
      useFactory: (config: AppConfig) =>
        new IORedis(config.redisUrl, {
          // BullMQ requires blocking commands to retry indefinitely.
          maxRetriesPerRequest: null,
          lazyConnect: true,
        }),
      inject: [AppConfig],
    },
    {
      provide: RUNS_QUEUE,
      useFactory: (config: AppConfig, connection: IORedis) =>
        new Queue(config.queueName, {
          connection,
          defaultJobOptions: {
            removeOnComplete: { age: 7 * 24 * 3600, count: 5000 },
            removeOnFail: false,
          },
        }),
      inject: [AppConfig, REDIS],
    },
  ],
  exports: [RUNS_QUEUE, REDIS, RunsQueue],
})
export class QueueModule implements OnModuleDestroy {
  constructor(
    @Inject(RUNS_QUEUE) private readonly queue: Queue,
    @Inject(REDIS) private readonly redis: IORedis,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
