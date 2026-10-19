import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DeviceTokenGuard } from "../auth/device-token.guard";
import { UsageController } from "./usage.controller";
import { UsageService } from "./usage.service";

/**
 * LLM usage ledger upload (`sft sync`). AuthModule supplies SessionGuard
 * (cookie fallback) and UsersService (device-token email lookup); DRIZZLE
 * comes from the global DbModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [UsageController],
  providers: [UsageService, DeviceTokenGuard],
  exports: [UsageService],
})
export class UsageModule {}