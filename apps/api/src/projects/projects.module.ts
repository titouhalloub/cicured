import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CryptoService } from "../common/crypto.service";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";

@Module({
  imports: [AuthModule],
  controllers: [ProjectsController],
  // CryptoService lives in common/ but is only injected by ProjectsService, so
  // it is provided here. It was previously provided by no module at all, which
  // only surfaced once the runtime emitted decorator metadata.
  providers: [CryptoService, ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
