import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AppConfig } from "./config/app-config.service";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfig);
  app.enableShutdownHooks();
  // Cookie-based sessions: the web app calls the API with credentials.
  app.enableCors({ origin: config.webAppUrl, credentials: true });
  await app.listen(config.port);
  Logger.log(
    `SFT-Dev API listening on http://localhost:${config.port} (env=${config.nodeEnv})`,
    "bootstrap",
  );
}

bootstrap().catch((error: unknown) => {
  // Config validation failures land here with a readable message.
  Logger.error(
    error instanceof Error ? error.message : String(error),
    undefined,
    "bootstrap",
  );
  process.exitCode = 1;
});
