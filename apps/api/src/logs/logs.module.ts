import { S3Client } from "@aws-sdk/client-s3";
import { Module } from "@nestjs/common";
import { AppConfig } from "../config/app-config.service";
import { AuthModule } from "../auth/auth.module";
import { RunsModule } from "../runs/runs.module";
import { LogsController } from "./logs.controller";
import { LogsService } from "./logs.service";
import { createS3Client } from "./s3-client";

@Module({
  imports: [AuthModule, RunsModule],
  controllers: [LogsController],
  providers: [
    LogsService,
    {
      provide: "S3_CLIENT",
      useFactory: (config: AppConfig): S3Client => createS3Client(config.env),
      inject: [AppConfig],
    },
  ],
  exports: [LogsService, "S3_CLIENT"],
})
export class LogsModule {}