import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { parseCookies } from "../common/cookies";
import type { UsersService } from "../users/users.service";
import type { AuthenticatedRequest } from "./authenticated-request";
import type { SessionService } from "./session.service";
import { SESSION_COOKIE_NAME } from "./session.service";

/** Requires a valid session cookie and loads the user on every request. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE_NAME];
    if (!token) throw new UnauthorizedException("authentication required");

    const payload = this.sessions.verifySessionToken(token);
    if (!payload) throw new UnauthorizedException("invalid or expired session");

    const user = await this.users.findById(payload.sub);
    if (!user) throw new UnauthorizedException("unknown user");

    request.user = user;
    return true;
  }
}
