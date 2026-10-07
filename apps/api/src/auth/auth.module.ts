import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { GitHubClient } from "./github.client";
import { SessionGuard } from "./session.guard";
import { SessionService } from "./session.service";

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService, GitHubClient, SessionService, SessionGuard],
  exports: [GitHubClient, SessionService, SessionGuard, UsersModule],
})
export class AuthModule {}
