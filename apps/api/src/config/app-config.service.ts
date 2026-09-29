import { Inject, Injectable } from "@nestjs/common";
import type { AppEnv } from "./env";

/** DI token for the validated environment object. */
export const APP_ENV = "APP_ENV";

/** Typed access to configuration; injected everywhere instead of process.env. */
@Injectable()
export class AppConfig {
  constructor(@Inject(APP_ENV) readonly env: AppEnv) {}

  get nodeEnv(): AppEnv["NODE_ENV"] {
    return this.env.NODE_ENV;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === "production";
  }

  get isTest(): boolean {
    return this.env.NODE_ENV === "test";
  }

  get port(): number {
    return this.env.API_PORT;
  }

  get apiPublicUrl(): string {
    return this.env.API_PUBLIC_URL;
  }

  get webAppUrl(): string {
    return this.env.WEB_APP_URL;
  }

  get databaseUrl(): string {
    return this.env.DATABASE_URL;
  }

  get redisUrl(): string {
    return this.env.REDIS_URL;
  }

  get queueName(): string {
    return this.env.SFT_QUEUE_NAME;
  }

  get sessionSecret(): string {
    return this.env.SESSION_SECRET;
  }

  get sessionTtlMs(): number {
    return this.env.SESSION_TTL_HOURS * 60 * 60 * 1000;
  }

  get encryptionKey(): string {
    return this.env.SFT_ENCRYPTION_KEY;
  }

  get githubOAuthConfigured(): boolean {
    return Boolean(this.env.GITHUB_CLIENT_ID && this.env.GITHUB_CLIENT_SECRET);
  }

  get githubAppConfigured(): boolean {
    return Boolean(
      this.env.GITHUB_APP_ID && this.env.GITHUB_APP_PRIVATE_KEY,
    );
  }

  get github() {
    return {
      clientId: this.env.GITHUB_CLIENT_ID,
      clientSecret: this.env.GITHUB_CLIENT_SECRET,
      appId: this.env.GITHUB_APP_ID,
      appSlug: this.env.GITHUB_APP_SLUG,
      privateKey: this.env.GITHUB_APP_PRIVATE_KEY,
      apiBase: this.env.GITHUB_API_BASE,
      oauthBase: this.env.GITHUB_OAUTH_BASE,
      callbackUrl: `${this.env.API_PUBLIC_URL}/auth/github/callback`,
    } as const;
  }
}
