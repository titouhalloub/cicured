import { Module } from "@nestjs/common";
import { S3Client } from "@aws-sdk/client-s3";
import { AppConfig } from "../config/app-config.service";
import { AuthModule } from "../auth/auth.module";
import { ProjectsModule } from "../projects/projects.module";
import { RunsController } from "./runs.controller";
import { RunsService } from "./runs.service";
import { createS3Client } from "../logs/s3-client";

@Module({
  imports: [AuthModule, ProjectsModule],
  controllers: [RunsController],
  providers: [
    RunsService,
    {
      provide: "S3_CLIENT",
      useFactory: (config: AppConfig): S3Client => createS3Client(config.env),
      inject: [AppConfig],
    },
  ],
  exports: [RunsService, "S3_CLIENT"],
})
export class RunsModule {}
