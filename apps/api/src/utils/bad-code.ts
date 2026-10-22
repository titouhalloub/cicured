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
// testing webhook
// testing webhook
// trigger pr review
// trigger 4
// trigger 5
// trigger webhook 1792497371
// trigger after IPv4 export 1792497469
// ledger check 1792531922
// speed check 1792537019
// pull test 1792541579
// final cost and speed test 1792545324
// log trace test 1792546877
// log trace test v2 1792547510
// log trace test v3 1792547578
// auth fix 1792684027
// TTL fix test 1792688364
// final S3 test 1792693110
// manual S3 fix 1792693408
// manual S3 fix 1792706413
// clock fix test 1792710453
