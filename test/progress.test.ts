import { describe, expect, it } from "vitest";

import { estimateRemaining, progressLine } from "../src/run/progress.js";

describe("progress line", () => {
  it("matches the documented format", () => {
    const line = progressLine({
      index: 27,
      total: 100,
      path: "/grants/fy27-jag",
      outcome: {
        kind: "done",
        passes: {
          read: { steps: 212, stopReason: "end-reached", items: 212 },
          headings: { steps: 10, stopReason: "no-next-heading", items: 9 },
          tab: { steps: 35, stopReason: "left-document", items: 34 },
        },
      },
      durationMs: 5 * 60_000 + 48_000,
      remainingMs: 7 * 3_600_000 + 10 * 60_000,
    });
    expect(line).toBe(
      "[27/100] /grants/fy27-jag — read: 212 steps (end reached), headings: 9, tab: 34 — 5m 48s — about 7h 10m left",
    );
  });

  it("mentions unnatural stops, failures, and skips", () => {
    const failed = progressLine({
      index: 3,
      total: 3,
      path: "/x",
      outcome: {
        kind: "failed",
        error: "HTTP 404",
        passes: { tab: { steps: 300, stopReason: "step-cap", items: 300 } },
      },
      durationMs: 2000,
      remainingMs: null,
    });
    expect(failed).toBe("[3/3] /x — FAILED: HTTP 404 (tab: 300 (step cap)) — 2s");
    expect(
      progressLine({
        index: 1,
        total: 2,
        path: "/feed",
        outcome: { kind: "skipped", reason: "not HTML" },
        durationMs: 0,
        remainingMs: 1000,
      }),
    ).toBe("[1/2] /feed — skipped: not HTML — about 1s left");
  });

  it("estimates time left from the average page", () => {
    expect(estimateRemaining([], 5)).toBeNull();
    expect(estimateRemaining([1000, 3000], 10)).toBe(20_000);
    expect(estimateRemaining([1000], 0)).toBeNull();
  });
});
