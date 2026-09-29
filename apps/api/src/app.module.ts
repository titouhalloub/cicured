import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { ConfigModule } from "./config/config.module";
import { DbModule } from "./db/db.module";
import { HealthModule } from "./health/health.module";
import { ProjectsModule } from "./projects/projects.module";
import { QueueModule } from "./queue/queue.module";
import { ReposModule } from "./repos/repos.module";
import { RunsModule } from "./runs/runs.module";
import { UsersModule } from "./users/users.module";

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
    HealthModule,
  ],
})
export class AppModule {}
