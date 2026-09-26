import { describe, expect, it } from "vitest";

import { runPass, type PassSettings } from "../src/passes/index.js";
import { lineMatches } from "../src/passes/read.js";
import { InterruptedError } from "../src/passes/steps.js";
import { element, ScriptedDriver, type ScriptedPage } from "./helpers/scripted-driver.js";

const URL_ = "https://example.illinois.gov/page";

const settings: PassSettings = {
  cap: 400,
  repeatLimit: 10,
  endConfirmations: 1,
  noNextHeading: /^no next heading$/i,
  stepTimeoutMs: 1000,
};

async function run(
  page: Omit<ScriptedPage, "url">,
  pass: "read" | "headings" | "tab",
  overrides: Partial<PassSettings> = {},
) {
  const driver = new ScriptedDriver([{ url: URL_, ...page }]);
  await driver.openPage(URL_);
  return runPass(pass, driver, { ...settings, ...overrides });
}

const spoken = (result: Awaited<ReturnType<typeof run>>) => result.steps.map((s) => s.spoken);

describe("read pass: end-of-page detection", () => {
  it("reads to the end: Ctrl+End, Ctrl+Home, every line, the repeat, and one confirmation", async () => {
    const result = await run(
      { lines: ["banner landmark, link, Home", "heading, level 1, Welcome", "© 2026 Agency"] },
      "read",
    );
    expect(result.stopReason).toBe("end-reached");
    expect(result.steps.map((s) => s.command)).toEqual([
      "toBottom",
      "toTop",
      "nextLine",
      "nextLine",
      "nextLine",
      "nextLine",
    ]);
    expect(spoken(result).slice(-3)).toEqual(["© 2026 Agency", "© 2026 Agency", "© 2026 Agency"]);
  });

  it("does not stop at two identical consecutive lines mid-page", async () => {
    const lines = ["Intro", "link, Read more", "link, Read more", "Middle", "The end"];
    const result = await run({ lines }, "read");
    expect(result.stopReason).toBe("end-reached");
    expect(spoken(result)).toContain("Middle");
    expect(spoken(result).at(-1)).toBe("The end");
  });

  it("does not stop where the last line also appears earlier", async () => {
    const lines = [
      "link, Back to top",
      "Section one",
      "link, Back to top",
      "Section two",
      "link, Back to top",
    ];
    const result = await run({ lines }, "read");
    expect(result.stopReason).toBe("end-reached");
    expect(spoken(result).filter((s) => s === "Section two")).toHaveLength(1);
  });

  it("uses the confirmation step when a mid-page pair equals the last line", async () => {
    const lines = ["Start", "blank", "blank", "Real content", "blank"];
    const confirmed = await run({ lines }, "read");
    expect(confirmed.stopReason).toBe("end-reached");
    expect(spoken(confirmed)).toContain("Real content");

    // The prompt's plain rule (no confirmation) stops early on this page.
    const plain = await run({ lines }, "read", { endConfirmations: 0 });
    expect(plain.stopReason).toBe("end-reached");
    expect(spoken(plain)).not.toContain("Real content");
  });

  it("matches the last line when Ctrl+End and arriving at it add container context", async () => {
    const result = await run(
      {
        lines: ["link, Home", "list with 2 items, link, Contact", "© 2026 Agency"],
        bottom: "content info landmark, © 2026 Agency",
        arrival: "out of list, content info landmark, © 2026 Agency",
      },
      "read",
    );
    expect(result.stopReason).toBe("end-reached");
    // The arrival differs from the re-spoken line, so one extra repeat is needed before the
    // "spoken, then repeated" rule (plus one confirmation) is met.
    expect(spoken(result).slice(-4)).toEqual([
      "out of list, content info landmark, © 2026 Agency",
      "© 2026 Agency",
      "© 2026 Agency",
      "© 2026 Agency",
    ]);
  });

  it("stops at the repeat safety net when the end never matches the last line", async () => {
    const result = await run(
      { lines: ["One", "Two", "Three"], bottom: "something else entirely" },
      "read",
    );
    expect(result.stopReason).toBe("repeat-limit");
    expect(spoken(result).filter((s) => s === "Three")).toHaveLength(10);
  });

  it("stops at the step cap and counts every step", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`);
    const result = await run({ lines }, "read", { cap: 20 });
    expect(result.stopReason).toBe("step-cap");
    expect(result.steps).toHaveLength(20);
  });

  it("handles a one-line page", async () => {
    const result = await run({ lines: ["Only line"] }, "read");
    expect(result.stopReason).toBe("end-reached");
    expect(spoken(result)).toEqual(["Only line", "Only line", "Only line", "Only line"]);
  });

  it("records timing for each step", async () => {
    const result = await run({ lines: ["A", "B"] }, "read");
    for (const [i, step] of result.steps.entries()) {
      expect(step.n).toBe(i + 1);
      expect(step.durationMs).toBeGreaterThanOrEqual(0);
      expect(step.offsetMs).toBeGreaterThanOrEqual(step.durationMs);
    }
  });
});

describe("lineMatches", () => {
  it("matches equal speech and trailing items, but not partial words", () => {
    expect(lineMatches("© 2026 Agency", "© 2026 Agency")).toBe(true);
    expect(lineMatches("content info landmark, © 2026 Agency", "© 2026 Agency")).toBe(true);
    expect(lineMatches("heading, level 2. Next section", "Next section")).toBe(true);
    expect(lineMatches("content info landmark, © 2026 Agency", "2026 Agency")).toBe(false);
    expect(lineMatches("Agency", "")).toBe(false);
    expect(lineMatches("  spaced   out ", "spaced out")).toBe(true);
  });
});

describe("headings pass", () => {
  it("records each heading until NVDA says there is no next heading", async () => {
    const headings = ["heading, level 1, Welcome", "heading, level 2, News"];
    const result = await run({ headings }, "headings");
    expect(result.stopReason).toBe("no-next-heading");
    expect(spoken(result)).toEqual([...headings, "no next heading"]);
  });

  it("stops at once on a page with no headings", async () => {
    const result = await run({ headings: [] }, "headings");
    expect(result.stopReason).toBe("no-next-heading");
    expect(result.steps).toHaveLength(1);
  });

  it("stops at the step cap", async () => {
    const headings = Array.from({ length: 30 }, (_, i) => `heading, level 2, Section ${i}`);
    const result = await run({ headings }, "headings", { cap: 5 });
    expect(result.stopReason).toBe("step-cap");
  });
});

describe("tab pass", () => {
  it("records each focus stop with the focused element and stops when focus leaves the page", async () => {
    const stops = [
      {
        spoken: "Skip to main content, link",
        focused: element("Skip to main content", { href: "#main" }),
      },
      { spoken: "Home, link", focused: element("Home") },
      {
        spoken: "Search this site, edit, blank",
        focused: element("Search this site", {
          tag: "input",
          role: "textbox",
          inMain: true,
          href: null,
        }),
      },
    ];
    const result = await run({ stops, leaving: "Address and search bar, edit" }, "tab");
    expect(result.stopReason).toBe("left-document");
    expect(result.steps).toHaveLength(4);
    expect(result.steps[0]?.focused?.href).toBe("#main");
    expect(result.steps[2]?.focused?.inMain).toBe(true);
    expect(result.steps.at(-1)).toMatchObject({ inDocument: false, focused: null });
    expect(result.initialFocus).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  it("warns when something is focused before the first Tab", async () => {
    const result = await run(
      { stops: [], initialFocus: element("Search", { tag: "input", role: "textbox" }) },
      "tab",
    );
    expect(result.warnings[0]).toMatch(/focused before the first Tab/);
    expect(result.stopReason).toBe("left-document");
  });

  it("stops a one-element focus trap at the repeat safety net", async () => {
    const trap = Array.from({ length: 50 }, () => ({
      spoken: "Close, button",
      focused: element("Close", { tag: "button", role: "button" }),
    }));
    const result = await run({ stops: trap }, "tab");
    expect(result.stopReason).toBe("repeat-limit");
    expect(result.steps).toHaveLength(10);
  });

  it("stops at the step cap", async () => {
    const stops = Array.from({ length: 30 }, (_, i) => ({
      spoken: `Link ${i}, link`,
      focused: element(`Link ${i}`),
    }));
    const result = await run({ stops }, "tab", { cap: 7 });
    expect(result.stopReason).toBe("step-cap");
    expect(result.steps).toHaveLength(7);
  });
});

describe("failures inside a pass", () => {
  it("ends with stop reason timeout, keeping the steps so far", async () => {
    const driver = new ScriptedDriver([{ url: URL_, lines: ["A", "B", "C", "D"] }], {
      hang: (command, _url, call) => command === "nextLine" && call > 4,
    });
    await driver.openPage(URL_);
    const result = await runPass("read", driver, { ...settings, stepTimeoutMs: 50 });
    expect(result.stopReason).toBe("timeout");
    expect(result.errors[0]).toMatch(/nextLine did not finish/);
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it("ends with stop reason error when the driver throws", async () => {
    const driver = new ScriptedDriver([{ url: URL_, lines: ["A"] }]);
    driver.nextHeading = () => Promise.reject(new Error("NVDA went away"));
    await driver.openPage(URL_);
    const result = await runPass("headings", driver, settings);
    expect(result.stopReason).toBe("error");
    expect(result.errors).toEqual(["NVDA went away"]);
  });

  it("propagates an interruption instead of recording it", async () => {
    const driver = new ScriptedDriver([{ url: URL_, lines: ["A", "B", "C"] }]);
    await driver.openPage(URL_);
    const controller = new AbortController();
    controller.abort();
    await expect(runPass("read", driver, settings, controller.signal)).rejects.toBeInstanceOf(
      InterruptedError,
    );
  });
});
