import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { OAuthCallbackInput, type SessionUser } from "@sft/schemas";
import type { Request, Response } from "express";
import { appendSetCookie, parseCookies, serializeCookie } from "../common/cookies";
import { toSessionUser } from "../common/dto";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AppConfig } from "../config/app-config.service";
import type { UserRow } from "../db";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { GitHubClient } from "./github.client";
import { SessionService } from "./session.service";
import {
  OAUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME
} from "./session.service";
import { SessionGuard } from "./session.guard";

/** GitHub OAuth login + session lifecycle (Spec §0/§6). */
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly github: GitHubClient,
    private readonly config: AppConfig,
  ) {}

  /** GET /auth/github - browser redirect to GitHub's authorize page. */
  @Get("github")
  startGithubLogin(@Res() res: Response): void {
    const state = this.auth.newOAuthState();
    appendSetCookie(res, this.stateCookie(state));
    res.redirect(302, this.github.buildAuthorizeUrl(state));
  }

  /** GET /auth/github/callback - browser redirect back from GitHub. */
  @Get("github/callback")
  async githubCallback(
    @Query(new ZodValidationPipe(OAuthCallbackInput)) query: OAuthCallbackInput,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    this.assertOAuthState(req, query.state);
    const user = await this.auth.loginWithCode(query.code);
    appendSetCookie(res, this.sessionCookie(this.sessions.createSessionToken(user.id)));
    appendSetCookie(res, this.stateCookie("", 0));
    res.redirect(302, this.config.webAppUrl);
  }

  /** POST /auth/:provider/callback (Spec §6) - SPA/API flow. */
  @Post(":provider/callback")
  async providerCallback(
    @Param("provider") provider: string,
    @Body(new ZodValidationPipe(OAuthCallbackInput)) body: OAuthCallbackInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: SessionUser }> {
    if (provider !== "github") {
      throw new NotFoundException(`unsupported provider: ${provider}`);
    }
    this.assertOAuthState(req, body.state);
    const user = await this.auth.loginWithCode(body.code);
    appendSetCookie(res, this.sessionCookie(this.sessions.createSessionToken(user.id)));
    return { user: toSessionUser(user) };
  }

  /** POST /auth/logout - clears the session cookie. */
  @Post("logout")
  logout(@Res({ passthrough: true }) res: Response): { ok: true } {
    appendSetCookie(res, this.sessionCookie("", 0));
    return { ok: true };
  }

  /** GET /auth/me - current session user. */
  @UseGuards(SessionGuard)
  @Get("me")
  me(@CurrentUser() user: UserRow): SessionUser {
    return toSessionUser(user);
  }

  private assertOAuthState(req: Request, state: string): void {
    const cookieState = parseCookies(req.headers.cookie)[OAUTH_STATE_COOKIE_NAME];
    if (!cookieState || cookieState !== state) {
      throw new BadRequestException("invalid or missing OAuth state");
    }
  }

  private sessionCookie(
    value: string,
    maxAgeSeconds: number = Math.floor(this.config.sessionTtlMs / 1000),
  ): string {
    return serializeCookie(SESSION_COOKIE_NAME, value, {
      maxAgeSeconds,
      secure: this.config.isProduction,
      sameSite: "Lax",
    });
  }

  private stateCookie(value: string, maxAgeSeconds = 600): string {
    return serializeCookie(OAUTH_STATE_COOKIE_NAME, value, {
      maxAgeSeconds,
      secure: this.config.isProduction,
      sameSite: "Lax",
    });
  }
}
