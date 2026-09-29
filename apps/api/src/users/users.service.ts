import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DRIZZLE, users, type Database, type UserRow } from "../db";

export interface GithubIdentity {
  providerUserId: string;
  email: string | null;
}

@Injectable()
export class UsersService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Idempotent login upsert keyed by (provider, provider_user_id). */
  async upsertGithubUser(identity: GithubIdentity): Promise<UserRow> {
    const [row] = await this.db
      .insert(users)
      .values({
        provider: "github",
        providerUserId: identity.providerUserId,
        email: identity.email,
      })
      .onConflictDoUpdate({
        target: [users.provider, users.providerUserId],
        set: { email: identity.email },
      })
      .returning();
    if (!row) throw new Error("user upsert returned no row");
    return row;
  }

  async findById(id: string): Promise<UserRow | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ?? null;
  }
}
