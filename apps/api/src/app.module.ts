import { Module } from "@nestjs/common";
// Nest 12 moved the enhancer tokens (APP_GUARD/APP_PIPE/...) out of
// @nestjs/common and into @nestjs/core.
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "./auth/auth.module";
import { ConfigModule } from "./config/config.module";
import { DbModule } from "./db/db.module";
import { HealthModule } from "./health/health.module";
import { LogsModule } from "./logs/logs.module";
import { ProjectsModule } from "./projects/projects.module";
import { QueueModule } from "./queue/queue.module";
import { ReposModule } from "./repos/repos.module";
import { RunsModule } from "./runs/runs.module";
import { UsageModule } from "./usage/usage.module";
import { UsersModule } from "./users/users.module";
import { WebhooksModule } from "./webhooks/webhooks.module";

@Module({
  imports: [
    ConfigModule,
    DbModule,
    QueueModule,
    UsersModule,
    AuthModule,
    ProjectsModule,
    ReposModule,
    RunsModule,
    LogsModule,
    UsageModule,
    HealthModule,
    WebhooksModule,
    // M5 §9: 60 requests per minute per IP, applied to every route. Mutating
    // endpoints that are expensive (run creation) tighten this with @Throttle.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
