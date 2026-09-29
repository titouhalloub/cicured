import { describe, expect, it } from "vitest";
import { WEB_M1_STUB } from "../src/index";

describe("web M1 stub", () => {
  it("keeps the package wired into pnpm -r test until the M4 UI lands", () => {
    expect(WEB_M1_STUB).toBe(true);
  });
});
