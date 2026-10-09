import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "../components/runs/status-badge";
import { RUN_STATUSES, type RunStatus } from "../lib/schemas";

/** Expected label + distinctive color class per status (Horizon palette). */
const EXPECTED: Array<[RunStatus, string, string]> = [
  ["queued", "Queued", "bg-brand-warning/15"],
  ["running", "Running", "bg-brand-info/15"],
  ["success", "Success", "bg-brand-success/15"],
  ["failed", "Failed", "bg-brand-error/15"],
  ["runner_crash", "Crashed", "border-brand-error"],
  ["timeout", "Timeout", "bg-brand-warning/15"],
  ["cancelled", "Cancelled", "text-text-muted-light"],
];

describe("StatusBadge", () => {
  it("renders the correct label and color class for each RunStatus value", () => {
    for (const [status, label, colorClass] of EXPECTED) {
      const html = renderToStaticMarkup(<StatusBadge status={status} />);
      expect(html, `status: ${status}`).toContain(label);
      expect(html, `status: ${status}`).toContain(colorClass);
    }
  });

  it("covers every value of RUN_STATUSES (guards against schema drift)", () => {
    expect(EXPECTED.map(([status]) => status).sort()).toEqual([...RUN_STATUSES].sort());
  });
});
