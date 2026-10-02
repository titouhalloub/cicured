import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSecrets,
  createLogger,
  redact,
  registerSecret,
  unregisterSecret,
} from "../src/common/secrets";

/** Captures the line a logger method writes to the console. */
function capture(fn: (logger: ReturnType<typeof createLogger>) => void): string[] {
  const lines: string[] = [];
  const push = (message: string) => lines.push(message);
  const log = vi.spyOn(console, "log").mockImplementation(push);
  const warn = vi.spyOn(console, "warn").mockImplementation(push);
  const error = vi.spyOn(console, "error").mockImplementation(push);
  try {
    fn(createLogger());
  } finally {
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  }
  return lines;
}

describe("createLogger formatting", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders [sft-worker] <scope> <bindings> <message>", () => {
    const root = createLogger("boot", { queue: "sft-runs" });
    const [line] = capture(() => root.info("worker ready (concurrency 1, budget 900000ms)"));
    expect(line).toBe("[sft-worker] boot queue=sft-runs worker ready (concurrency 1, budget 900000ms)");
  });

  it("child() starts fresh: no parent scope, no parent bindings", () => {
    const root = createLogger("boot", { queue: "sft-runs" });
    const [line] = capture(() =>
      root.child({ runId: "ef93b9cb-1234" }).info("launching sandbox image=cicured/sandbox:node20"),
    );
    expect(line).toBe("[sft-worker] runId=ef93b9cb-1234 launching sandbox image=cicured/sandbox:node20");
    expect(line).not.toContain("boot");
    expect(line).not.toContain("queue=");
  });

  it("child() accepts an optional new scope", () => {
    const root = createLogger("boot", { queue: "sft-runs" });
    const [line] = capture(() => root.child({}, "task").info("running lint"));
    expect(line).toBe("[sft-worker] task running lint");
  });

  it("child() renders a new scope together with its own bindings", () => {
    const root = createLogger("boot", { queue: "sft-runs" });
    const [line] = capture(() => root.child({ task: "Lint" }, "task").info("running"));
    expect(line).toBe("[sft-worker] task task=Lint running");
  });

  it("does not emit a double space when there is no scope", () => {
    const [line] = capture(() => createLogger().info("bare"));
    expect(line).toBe("[sft-worker] bare");
    expect(line).not.toContain("[sft-worker]  ");
  });

  it("does not emit a double space when there is no scope but there are bindings", () => {
    const [line] = capture(() => createLogger(undefined, { runId: "abc" }).info("msg"));
    expect(line).toBe("[sft-worker] runId=abc msg");
  });

  it("leaves the parent logger untouched when a child is derived", () => {
    const root = createLogger("boot", { queue: "sft-runs" });
    const lines = capture(() => {
      root.child({ runId: "abc" }).info("child line");
      root.info("parent line");
    });
    expect(lines).toEqual([
      "[sft-worker] runId=abc child line",
      "[sft-worker] boot queue=sft-runs parent line",
    ]);
  });
});

describe("secret redaction (.clinerules: never log secrets)", () => {
  afterEach(() => clearSecrets());

  it("masks a registered secret and restores the original after unregister", () => {
    registerSecret("ghs_super_secret_token_value");
    expect(redact("cloning with ghs_super_secret_token_value@github.com")).toBe(
      "cloning with [redacted]@github.com",
    );

    unregisterSecret("ghs_super_secret_token_value");
    expect(redact("ghs_super_secret_token_value")).toBe("ghs_super_secret_token_value");
  });

  it("masks token-shaped strings even when never registered", () => {
    expect(redact("ghs_abcdefghijklmnopqrstuvwxyz012345")).toBe("[redacted-token]");
    expect(redact("github_pat_11ABCDEFG0abcdefghijklmnop")).toBe("[redacted-token]");
  });

  it("ignores values too short to be a real token", () => {
    registerSecret("abc");
    expect(redact("abc")).toBe("abc");
  });

  it("redacts tokens emitted through the logger", () => {
    registerSecret("ghs_live_run_token_value");
    const [line] = capture(() => createLogger("boot").info("token=ghs_live_run_token_value"));
    expect(line).toBe("[sft-worker] boot token=[redacted]");
  });
});