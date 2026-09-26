import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  normalizeSpeechItem,
  parseNvdaLog,
  parseTimeOfDay,
  selectWindow,
  splitLogEntries,
} from "../src/manual/nvda-log.js";
import { UsageError } from "../src/util/errors.js";

const FIXTURE = fileURLToPath(new URL("../fixture/manual/nvda-io-log.txt", import.meta.url));
const fixtureText = readFileSync(FIXTURE, "utf8");

describe("the fixture log", () => {
  it("keeps its Windows line endings", () => {
    expect(fixtureText).toContain("\r\n");
    expect(fixtureText.replace(/\r\n/g, "")).not.toContain("\n");
  });
});

describe("splitLogEntries", () => {
  it("splits on NVDA's entry headers and keeps multi-line messages together", () => {
    const entries = splitLogEntries(fixtureText);
    const first = entries[0]!;
    expect(first).toMatchObject({
      level: "INFO",
      codepath: "__main__",
      time: "23:57:41.102",
      thread: "MainThread",
      message: "Starting NVDA version 2026.2 AMD64",
      line: 1,
    });
    expect(first.timeMs).toBe(((23 * 60 + 57) * 60 + 41) * 1000 + 102);
    const error = entries.find((entry) => entry.level === "ERROR")!;
    expect(error.message.split("\n")).toHaveLength(9);
    expect(error.message).toContain("_ctypes.COMError");
    expect(entries.every((entry) => !entry.message.includes("\r"))).toBe(true);
  });

  it("ignores lines before the first header (an excerpt that starts mid-entry)", () => {
    const text = [
      "Speaking ['orphaned']",
      "IO - speech.speech.speak (10:00:00.000) - MainThread (1):",
      "Speaking ['kept']",
    ].join("\n");
    const entries = splitLogEntries(text);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.message).toBe("Speaking ['kept']");
  });
});

describe("parseNvdaLog", () => {
  const parsed = parseNvdaLog(fixtureText);

  it("extracts input gestures, speech, and typed words, in order, and discards the rest", () => {
    const types = new Set(parsed.events.map((event) => event.type));
    expect(types).toEqual(new Set(["key", "speech", "typed-word"]));
    expect(parsed.discarded).toBe(parsed.entries - parsed.events.length);
    const texts = parsed.events.map((event) => event.text).join("\n");
    for (const noise of [
      "Traceback",
      "COMError",
      "Config dir",
      "IAccessible role failed",
      "Exiting",
    ]) {
      expect(texts).not.toContain(noise);
    }
    expect(parsed.events.slice(2, 4).map((event) => [event.type, event.text])).toEqual([
      ["key", "kb(desktop):NVDA+t"],
      ["speech", "Voicecap Test Agency - Google Chrome"],
    ]);
    const atValues = parsed.events.map((event) => event.at);
    expect([...atValues].sort((a, b) => a - b)).toEqual(atValues);
  });

  it("drops speech command objects and joins text items with ', '", () => {
    const focus = parsed.events.find((event) => event.text.startsWith("search landmark"))!;
    expect(focus.items).toEqual(["search landmark", "Search this site", "edit", "blank"]);
    expect(focus.text).toBe("search landmark, Search this site, edit, blank");
    const texts = parsed.events.map((event) => event.text);
    expect(texts.some((text) => /Command|CancellableSpeech|en_US/.test(text))).toBe(false);
    expect(texts).toContain("This site is a test fixture for voicecap., Nothing here changes.");
  });

  it("decodes repr escapes and quoting", () => {
    const texts = parsed.events.map((event) => event.text);
    expect(texts).toContain("list, with 2 items, link, Grant applications open October 1");
    expect(texts).toContain("The agency's fixture pages are for testing only.");
    expect(texts).toContain("content info landmark, © 2026 Voicecap Test Agency");
  });

  it("finds the NVDA version, typed words, and the midnight crossing", () => {
    expect(parsed.nvdaVersion).toBe("2026.2");
    expect(parsed.events.filter((event) => event.type === "typed-word").map((e) => e.text)).toEqual(
      ["grant", "deadlines"],
    );
    expect(parsed.crossings).toBe(1);
    const enter = parsed.events.find((event) => event.text === "kb(desktop):enter")!;
    expect(enter.day).toBe(1);
    expect(enter.time).toBe("00:00:03.118");
  });

  it("reports no events for a log below Input/output level", () => {
    const infoOnly = [
      "INFO - __main__ (09:00:00.000) - MainThread (1):",
      "Starting NVDA version 2025.3.1 AMD64",
      "INFO - core.main (09:00:01.000) - MainThread (1):",
      "NVDA initialized",
    ].join("\r\n");
    const result = parseNvdaLog(infoOnly);
    expect(result.events).toEqual([]);
    expect(result.nvdaVersion).toBe("2025.3.1");
  });

  it("keeps the quoted text of a speech entry it can't fully parse, with a warning", () => {
    const text = [
      "IO - speech.speech.speak (09:00:00.000) - MainThread (1):",
      "Speaking [LangChangeCommand ('en_US'), 'heading', 'Truncated",
    ].join("\n");
    const result = parseNvdaLog(text);
    expect(result.events[0]!.text).toBe("en_US, heading");
    expect(result.warnings[0]).toMatch(/Line 1: couldn't fully parse/);
  });

  it("skips speech sequences with no text", () => {
    const text = [
      "IO - speech.speech.speak (09:00:00.000) - MainThread (1):",
      "Speaking [BeepCommand(440, 50, left=50, right=50), EndUtteranceCommand()]",
    ].join("\n");
    expect(parseNvdaLog(text).events).toEqual([]);
  });

  it("treats small backwards jumps (thread jitter) as the same day", () => {
    const text = [
      "IO - speech.speech.speak (09:00:00.500) - MainThread (1):",
      "Speaking ['a']",
      "IO - inputCore.InputManager.executeGesture (09:00:00.490) - winInputHook (2):",
      "Input: kb(desktop):downArrow",
    ].join("\n");
    const result = parseNvdaLog(text);
    expect(result.crossings).toBe(0);
    expect(result.events.map((event) => event.day)).toEqual([0, 0]);
  });
});

describe("normalizeSpeechItem", () => {
  it("trims and collapses whitespace runs exactly like Guidepup (a single tab or NBSP stays)", () => {
    expect(normalizeSpeechItem("  two  spaces\tand\n\nlines ")).toBe("two spaces\tand lines");
    expect(normalizeSpeechItem("single nbsp")).toBe("single nbsp");
  });
});

describe("parseTimeOfDay", () => {
  it("accepts HH:MM and HH:MM:SS", () => {
    expect(parseTimeOfDay("23:50", "--from")).toEqual({
      ms: (23 * 60 + 50) * 60_000,
      precisionMs: 60_000,
      text: "23:50",
    });
    expect(parseTimeOfDay("0:00:10", "--to")).toEqual({
      ms: 10_000,
      precisionMs: 1000,
      text: "00:00:10",
    });
  });

  it("rejects anything else", () => {
    for (const bad of ["24:00", "12:60", "noon", "12", "12:00:61", "12:00pm"]) {
      expect(() => parseTimeOfDay(bad, "--from")).toThrow(UsageError);
    }
  });
});

describe("selectWindow", () => {
  const parsed = parseNvdaLog(fixtureText);
  const start = parsed.startMs!;
  const window = (from: string | null, to: string | null) =>
    selectWindow(
      parsed.events,
      start,
      from ? parseTimeOfDay(from, "--from") : null,
      to ? parseTimeOfDay(to, "--to") : null,
    );

  it("returns everything without --from or --to", () => {
    expect(window(null, null)).toEqual(parsed.events);
  });

  it("spans midnight, resolving both times forward from the session start", () => {
    const selected = window("23:59", "00:00:20");
    expect(selected[0]!.text).toBe("kb(desktop):enter");
    expect(selected.at(-1)!.text).toBe("link, New research on pretrial services");
    expect(selected.every((event) => event.day === 1)).toBe(true);
  });

  it("treats a time without seconds as the whole minute", () => {
    const selected = window("23:58", "23:58");
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every((event) => event.time.startsWith("23:58"))).toBe(true);
  });

  it("reads --to alone as after the session start (the next day when it's earlier)", () => {
    const selected = window(null, "00:00:03");
    expect(selected[0]).toBe(parsed.events[0]);
    expect(selected.at(-1)!.text).toBe("deadlines");
  });
});
