import { Module } from "@nestjs/common";
import { CryptoService } from "../common/crypto.service";
import { QueueModule } from "../queue/queue.module";
import { WebhooksController } from "./webhooks.controller";
import { WebhooksService } from "./webhooks.service";

@Module({
  imports: [QueueModule],
  controllers: [WebhooksController],
  // CryptoService is provided module-locally by ProjectsModule (which does not
  // export it), so it is listed here too. DbModule and ConfigModule are global.
  providers: [WebhooksService, CryptoService],
})
export class WebhooksModule {}