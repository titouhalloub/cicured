import { Module } from "@nestjs/common";
import { GitHubClient } from "../auth/github.client";
import { CryptoService } from "../common/crypto.service";
import { QueueModule } from "../queue/queue.module";
import { DiffReviewLlm } from "./diff-review.llm";
import { WebhooksController } from "./webhooks.controller";
import { WebhooksService } from "./webhooks.service";

@Module({
  imports: [QueueModule],
  controllers: [WebhooksController],
  // CryptoService is provided module-locally by ProjectsModule (which does not
  // export it), and GitHubClient module-locally by AuthModule, so both are
  // listed here too. DbModule and ConfigModule are global.
  providers: [WebhooksService, CryptoService, GitHubClient, DiffReviewLlm],
})
export class WebhooksModule {}