import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { VoicecapConfig } from "../src/config/schema.js";
import type { EnvironmentInfo, ScreenReaderDriver } from "../src/drivers/types.js";
import { InterruptedError, StepTimeoutError } from "../src/passes/steps.js";
import { runLiveCheck, serveCheckPage } from "../src/readiness/live-check.js";

const environment: EnvironmentInfo = {
  driver: { name: "guidepup", version: "0.34.0" },
  screenReader: { name: "NVDA", version: "2026.2", build: "0.2.1-2026.2", language: "en-US" },
  capture: "complete",
  browser: { name: "Chrome", version: "153.0.8010.53" },
  os: "Windows 11 Pro 25H2 (10.0.26200)",
  screenReaderSettings: {},
};

/** A driver whose named calls never finish. */
class StubDriver implements ScreenReaderDriver {
  readonly name = "guidepup";
  readonly calls: string[] = [];

  constructor(private readonly hangs: string[] = []) {}

  private call<T>(name: string, value: T): Promise<T> {
    this.calls.push(name);
    return this.hangs.includes(name) ? new Promise(() => {}) : Promise.resolve(value);
  }

  start = () => this.call("start", undefined);
  stop = () => this.call("stop", undefined);
  getEnvironmentInfo = () => this.call("getEnvironmentInfo", environment);
  cleanupStale = () => this.call("cleanupStale", [] as string[]);
  openPage = (url: string) =>
    this.call("openPage", {
      finalUrl: url,
      status: 200,
      contentType: "text/html",
      title: "t",
      canonical: null,
    });
  nextLine = () => this.call("nextLine", "");
  nextHeading = () => this.call("nextHeading", "");
  nextFocusable = () => this.call("nextFocusable", "Doctor button, button");
  toTop = () => this.call("toTop", "heading, level 1, voicecap doctor check");
  toBottom = () => this.call("toBottom", "");
  focusInDocument = () => this.call("focusInDocument", true);
  focusedElement = () => this.call("focusedElement", null);
}

describe("the doctor's live check", () => {
  const quick: VoicecapConfig = {
    ...DEFAULT_CONFIG,
    timeouts: { ...DEFAULT_CONFIG.timeouts, stepMs: 20, driverStartMs: 20 },
    readiness: { ...DEFAULT_CONFIG.readiness, networkIdleTimeoutMs: 20 },
  };
  const url = "http://127.0.0.1:9/";

  it("captures what NVDA says at the top of the page and for the first Tab", async () => {
    const driver = new StubDriver();
    const live = await runLiveCheck(driver, url, quick);
    expect(live.speech).toEqual([
      "heading, level 1, voicecap doctor check",
      "Doctor button, button",
    ]);
    expect(driver.calls.at(-1)).toBe("stop");
  });

  it("gives up on a start that never finishes, and stops NVDA and the browser", async () => {
    const driver = new StubDriver(["start"]);
    await expect(runLiveCheck(driver, url, quick)).rejects.toThrow(StepTimeoutError);
    expect(driver.calls).toContain("stop");
  });

  it("gives up on a step that never finishes, and stops NVDA and the browser", async () => {
    const driver = new StubDriver(["nextFocusable"]);
    await expect(runLiveCheck(driver, url, quick)).rejects.toThrow(StepTimeoutError);
    expect(driver.calls).toContain("stop");
  });

  it("stops at Ctrl+C, and stops NVDA and the browser", async () => {
    const driver = new StubDriver(["openPage"]);
    const controller = new AbortController();
    const check = runLiveCheck(driver, url, DEFAULT_CONFIG, controller.signal);
    setTimeout(() => controller.abort(), 20);
    await expect(check).rejects.toThrow(InterruptedError);
    expect(driver.calls).toContain("stop");
  });
});

describe("the live check, with any screen reader", () => {
  const quick: VoicecapConfig = {
    ...DEFAULT_CONFIG,
    timeouts: { ...DEFAULT_CONFIG.timeouts, stepMs: 20, driverStartMs: 20 },
  };

  it("names the start that never finished without naming NVDA", async () => {
    const driver = new StubDriver(["start"]);
    await expect(runLiveCheck(driver, "http://127.0.0.1:9/", quick)).rejects.toThrow(
      "Starting the screen reader and the browser did not finish",
    );
  });
});

describe("the check page", () => {
  it("is served on 127.0.0.1 until it's closed", async () => {
    const page = await serveCheckPage();
    try {
      expect(page.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      const response = await fetch(page.url);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      const html = await response.text();
      // What the live check's two steps read, and a line for any screen reader.
      expect(html).toContain("<h1>voicecap doctor check</h1>");
      expect(html).toContain('<button type="button">Doctor button</button>');
      expect(html).toContain("<p>If the screen reader reads this, voicecap can hear it.</p>");
    } finally {
      await page.close();
    }
    await expect(fetch(page.url)).rejects.toThrow();
  });
});
