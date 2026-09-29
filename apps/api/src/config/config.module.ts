import { Global, Module } from "@nestjs/common";
import { APP_ENV, AppConfig } from "./app-config.service";
import { loadDotEnvFile, loadEnv } from "./env";

/** Global config module: validates the environment once at boot (Spec §0). */
@Global()
@Module({
  providers: [
    {
      provide: APP_ENV,
      useFactory: () => {
        loadDotEnvFile();
        return loadEnv();
      },
    },
    AppConfig,
  ],
  exports: [AppConfig],
})
export class ConfigModule {}
