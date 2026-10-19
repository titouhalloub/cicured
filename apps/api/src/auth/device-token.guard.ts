import { timingSafeEqual } from "node:crypto";
import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { UserRow } from "../db";
import { UsersService } from "../users/users.service";
import type { AuthenticatedRequest } from "./authenticated-request";
import { SessionGuard } from "./session.guard";

const BEARER_PREFIX = "Bearer ";

/**
 * DEV-MODE auth for the CLI ledger upload (POST /usage/llm-calls).
 *
 * Pre-launch stand-in for a real device-token flow: the CLI sends
 * `Authorization: Bearer <SFT_DEVICE_TOKEN>` and the caller is resolved to the
 * user identified by `SFT_DEVICE_TOKEN_EMAIL`. The token is compared in
 * constant time and must never be logged or echoed. A valid session cookie is
 * accepted as a fallback so the endpoint also works from the dashboard, and a
 * future proper device-token flow can replace this guard without touching the
 * endpoint.
 */
@Injectable()
export class DeviceTokenGuard implements CanActivate {
  constructor(
    private readonly users: UsersService,
    private readonly sessionGuard: SessionGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;

    if (typeof header === "string" && header.startsWith(BEARER_PREFIX)) {
      request.user = await this.resolveDeviceUser(header.slice(BEARER_PREFIX.length).trim());
      return true;
    }

    // Fallback: same rules as every other authenticated endpoint.
    try {
      return await this.sessionGuard.canActivate(context);
    } catch {
      throw new UnauthorizedException("authentication required");
    }
  }

  private async resolveDeviceUser(token: string): Promise<UserRow> {
    const expected = process.env.SFT_DEVICE_TOKEN;
    const email = process.env.SFT_DEVICE_TOKEN_EMAIL;
    if (!expected || !email) {
      throw new UnauthorizedException("device token auth is not configured");
    }
    if (!tokensMatch(token, expected)) throw new UnauthorizedException("invalid device token");

    const user = await this.users.findByEmail(email);
    if (!user) throw new UnauthorizedException("unknown user");
    return user;
  }
}

/** Constant-time compare; equal-length buffers only (length itself is not secret). */
function tokensMatch(actual: string, expected: string): boolean {
  const left = Buffer.from(actual, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}