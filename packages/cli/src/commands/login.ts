import { createInterface } from "node:readline/promises";
import { writeCredentials } from "../storage/credentials";

/**
 * `sft login` — dev-mode device token (a real OAuth device flow replaces this
 * later without changing the endpoint). The token is read from
 * SFT_DEVICE_TOKEN when set, otherwise pasted on stdin, and stored via
 * writeCredentials(). It is never printed back or logged.
 */
export async function loginCommand(): Promise<number> {
  const email = process.env.SFT_DEVICE_TOKEN_EMAIL?.trim() ?? "";
  let token = process.env.SFT_DEVICE_TOKEN?.trim() ?? "";

  if (!token) {
    token = (await promptLine("Paste device token: ")).trim();
  }
  if (!token) {
    process.stderr.write("No token provided — nothing saved.\n");
    return 1;
  }

  writeCredentials({
    deviceToken: token,
    createdAt: new Date().toISOString(),
    email,
  });

  process.stdout.write(`Signed in as ${email || "unknown user"}.\n`);
  return 0;
}

async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}
