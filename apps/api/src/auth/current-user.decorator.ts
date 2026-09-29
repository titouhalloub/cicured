import {
  createParamDecorator,
  UnauthorizedException,
  type ExecutionContext,
} from "@nestjs/common";
import type { UserRow } from "../db";
import type { AuthenticatedRequest } from "./authenticated-request";

/** Injects the SessionGuard-authenticated user into a handler parameter. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): UserRow => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) throw new UnauthorizedException("authentication required");
    return request.user;
  },
);
