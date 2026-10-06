import { describe, expect, it } from "vitest";

import { ForegroundError } from "../src/drivers/types.js";
import { runPass, type PassSettings } from "../src/passes/index.js";
import { lineMatches } from "../src/passes/read.js";
import { InterruptedError, StepRecorder } from "../src/passes/steps.js";
import { EnvironmentError } from "../src/util/errors.js";
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

  it("doesn't mistake distinct controls that sound the same for a focus trap", async () => {
    const downloads = Array.from({ length: 12 }, (_, i) => ({
      spoken: "Download, link",
      focused: element("Download", { href: `/files/report-${i}.pdf`, inMain: true }),
    }));
    const result = await run({ stops: downloads }, "tab");
    expect(result.stopReason).toBe("left-document");
    expect(result.steps).toHaveLength(13);
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

describe("the failure a pass reports, for a page's failed attempts", () => {
  it("explains a timeout: its cause, the step that didn't finish, and that step's command", async () => {
    // Ctrl+End and Ctrl+Home are steps 1 and 2; the first Down Arrow, step 3, never finishes.
    const driver = new ScriptedDriver([{ url: URL_, lines: ["A", "B", "C", "D"] }], {
      hang: (command) => command === "nextLine",
    });
    await driver.openPage(URL_);
    const result = await runPass("read", driver, { ...settings, stepTimeoutMs: 50 });
    expect(result.stopReason).toBe("timeout");
    expect(result.steps).toHaveLength(2);
    expect(result.failure).toEqual({
      cause: "step-timeout",
      message: "nextLine did not finish within 50ms",
      step: 3,
      command: "nextLine",
    });
  });

  it("explains an unexpected error, and keeps its stack", async () => {
    const driver = new ScriptedDriver([{ url: URL_, lines: ["A"] }]);
    const broken = new Error("NVDA went away");
    driver.nextHeading = () => Promise.reject(broken);
    await driver.openPage(URL_);
    const result = await runPass("headings", driver, settings);
    expect(result.stopReason).toBe("error");
    expect(result.failure).toEqual({
      cause: "unexpected",
      message: "NVDA went away",
      step: 1,
      command: "nextHeading",
      stack: broken.stack,
    });
  });

  it("keeps no stack for an error that isn't unexpected", async () => {
    const driver = new ScriptedDriver([{ url: URL_, lines: ["A"] }], {
      fail: (command) =>
        command === "nextHeading"
          ? new ForegroundError("Another window took the foreground.")
          : null,
    });
    await driver.openPage(URL_);
    const result = await runPass("headings", driver, settings);
    expect(result.stopReason).toBe("error");
    expect(result.failure).toEqual({
      cause: "foreground",
      message: "Another window took the foreground.",
      step: 1,
      command: "nextHeading",
    });
  });

  it("keeps the program that took the foreground, when the driver says which, or that Windows didn't", async () => {
    for (const program of ["Microsoft Teams", null]) {
      const driver = new ScriptedDriver([{ url: URL_, lines: ["A"] }], {
        fail: (command) =>
          command === "nextHeading"
            ? new ForegroundError("Another window took the foreground.", { program })
            : null,
      });
      await driver.openPage(URL_);
      const result = await runPass("headings", driver, settings);
      expect(result.failure, String(program)).toEqual({
        cause: "foreground",
        message: "Another window took the foreground.",
        step: 1,
        command: "nextHeading",
        program,
      });
    }
  });

  it("keeps no program for any other failure, as for a foreground one that names none", async () => {
    const failures = [
      new ForegroundError("Another window took the foreground."),
      new EnvironmentError("Windows is locked.", { failure: "locked" }),
      new Error("NVDA went away"),
    ];
    for (const failure of failures) {
      const driver = new ScriptedDriver([{ url: URL_, lines: ["A"] }], {
        fail: (command) => (command === "nextHeading" ? failure : null),
      });
      await driver.openPage(URL_);
      const result = await runPass("headings", driver, settings);
      expect(result.failure, failure.message).not.toHaveProperty("program");
    }
  });

  it("keeps no stack when what was thrown isn't an Error", async () => {
    const driver = new ScriptedDriver([{ url: URL_, lines: ["A"] }]);
    // Not every library rejects with an Error: this one rejects with a string.
    const thrown = "NVDA went away" as unknown as Error;
    driver.nextHeading = () => Promise.reject(thrown);
    await driver.openPage(URL_);
    const result = await runPass("headings", driver, settings);
    expect(result.failure).toEqual({
      cause: "unexpected",
      message: "NVDA went away",
      step: 1,
      command: "nextHeading",
    });
  });

  it("names the step whose check failed, as the step that failed", async () => {
    const driver = new ScriptedDriver(
      [{ url: URL_, stops: [{ spoken: "Home, link", focused: element("Home") }] }],
      {
        fail: (command) =>
          command === "focusInDocument" ? new Error("The browser went away") : null,
      },
    );
    await driver.openPage(URL_);
    const result = await runPass("tab", driver, settings);
    // The Tab was sent, but its step never finished, so it isn't among the steps.
    expect(result.steps).toHaveLength(0);
    expect(result.failure).toMatchObject({
      cause: "unexpected",
      step: 1,
      command: "nextFocusable",
    });
  });

  it("names no step for a failure outside one", async () => {
    // The tab pass asks what's focused before its first Tab, which isn't a step.
    const driver = new ScriptedDriver([{ url: URL_, stops: [] }], {
      fail: (command) => (command === "focusedElement" ? new Error("The browser went away") : null),
    });
    await driver.openPage(URL_);
    const result = await runPass("tab", driver, settings);
    expect(result.stopReason).toBe("error");
    expect(result.failure).toMatchObject({ cause: "unexpected", step: null, command: null });
  });

  it("has no failure when the pass ends normally", async () => {
    for (const pass of ["read", "headings", "tab"] as const) {
      const result = await run(
        { lines: ["A"], headings: ["heading, level 1, A"], stops: [] },
        pass,
      );
      expect(["end-reached", "no-next-heading", "left-document"]).toContain(result.stopReason);
      expect(result, pass).not.toHaveProperty("failure");
    }
    // A safety net stopping a pass isn't a failure either.
    const capped = await run({ lines: ["A", "B", "C"] }, "read", { cap: 3 });
    expect(capped.stopReason).toBe("step-cap");
    expect(capped).not.toHaveProperty("failure");
  });
});

describe("StepRecorder.current", () => {
  it("names the step under way, and is null between steps", async () => {
    const recorder = new StepRecorder(1000, undefined);
    expect(recorder.current).toBeNull();
    let during: StepRecorder["current"] = null;
    await recorder.step("nextLine", () => {
      during = recorder.current;
      return Promise.resolve("A");
    });
    expect(during).toEqual({ n: 1, command: "nextLine" });
    expect(recorder.current).toBeNull();
    await recorder.step("nextLine", () => Promise.resolve("B"));
    expect(recorder.count).toBe(2);
    expect(recorder.current).toBeNull();
  });

  it("stays on the step that failed, so the failure can name it", async () => {
    const recorder = new StepRecorder(1000, undefined);
    await recorder.step("toBottom", () => Promise.resolve("A"));
    await expect(
      recorder.step("nextHeading", () => Promise.reject(new Error("NVDA went away"))),
    ).rejects.toThrow("NVDA went away");
    expect(recorder.current).toEqual({ n: 2, command: "nextHeading" });
    expect(recorder.count).toBe(1);
  });

  it("isn't set by a query, which isn't a step", async () => {
    const recorder = new StepRecorder(1000, undefined);
    let during: StepRecorder["current"] = null;
    await recorder.query("focus check", () => {
      during = recorder.current;
      return Promise.resolve(null);
    });
    expect(during).toBeNull();
    expect(recorder.current).toBeNull();
  });
});
