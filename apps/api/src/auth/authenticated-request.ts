import type { Request } from "express";
import type { UserRow } from "../db";

/** Request after SessionGuard has attached the authenticated user. */
export interface AuthenticatedRequest extends Request {
  user?: UserRow;
}
