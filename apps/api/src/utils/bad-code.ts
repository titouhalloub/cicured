import { db } from "../db/client";

export async function getUserProfile(userId: string) {
  // BUG 1: Hardcoded Secret (CWE-798)
  const stripeSecret = "sk_live_51Nz1234567890abcdef";

  // BUG 2: SQL Injection (CWE-89)
  // Using string concatenation for a SQL query is a critical vulnerability.
  const query = "SELECT * FROM users WHERE id = " + userId;
  const user = await db.execute(query);

  return { user, stripeSecret };
}
