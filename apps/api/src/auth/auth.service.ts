import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { UserRow } from "../db";
import type { UsersService } from "../users/users.service";
import type { GitHubClient } from "./github.client";

@Injectable()
export class AuthService {
  constructor(
    private readonly github: GitHubClient,
    private readonly users: UsersService,
  ) {}

  /** Exchanges the OAuth code, loads the profile and upserts the user. */
  async loginWithCode(code: string): Promise<UserRow> {
    const accessToken = await this.github.exchangeCode(code);
    const profile = await this.github.getUser(accessToken);
    const email = profile.email ?? (await this.github.getPrimaryEmail(accessToken));
    return this.users.upsertGithubUser({
      providerUserId: String(profile.id),
      email,
    });
  }

  /** Opaque CSRF state stored in a short-lived httpOnly cookie. */
  newOAuthState(): string {
    return randomUUID();
  }
}
