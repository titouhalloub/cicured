import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ReposController } from "./repos.controller";

@Module({
  imports: [AuthModule],
  controllers: [ReposController],
})
export class ReposModule {}
