import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseNvdaLog, type LogEvent } from "../src/manual/nvda-log.js";
import {
  REDACTED_TEXT,
  displayGesture,
  isTypingKey,
  parseGesture,
  processTyping,
} from "../src/manual/redact.js";

const FIXTURE = fileURLToPath(new URL("../fixture/manual/nvda-io-log.txt", import.meta.url));
const events = parseNvdaLog(readFileSync(FIXTURE, "utf8")).events;

const EDITABLE_ROLES = [
  "edit",
  "password edit",
  "editable",
  "combo box",
  "spin button",
  "protected",
];
const FOCUS_KEYS = ["tab", "shift+tab", "escape", "f6", "nvda+space", "alt+d", "control+l"];

describe("parseGesture", () => {
  it("splits NVDA gesture identifiers, ignoring modifier order and case", () => {
    expect(parseGesture("kb(desktop):NVDA+shift+downArrow")).toEqual({
      source: "kb(desktop)",
      modifiers: ["nvda", "shift"],
      main: "downarrow",
      isKeyboard: true,
    });
    expect(parseGesture("shift+tab")).toMatchObject({
      source: "",
      modifiers: ["shift"],
      main: "tab",
    });
    expect(parseGesture("br(freedomScientific):routing").isKeyboard).toBe(false);
    // On layouts where ":" is unshifted, the main key itself is ":".
    expect(parseGesture("kb(laptop)::").main).toBe(":");
  });

  it("displays keyboard gestures without their source", () => {
    expect(displayGesture("kb(desktop):control+home")).toBe("control+home");
    expect(displayGesture("kb:tab")).toBe("tab");
    expect(displayGesture("br(freedomScientific):routing")).toBe("br(freedomScientific):routing");
  });
});

describe("isTypingKey", () => {
  const typing = (id: string) => isTypingKey(parseGesture(id));

  it("counts characters, space, and erasing keys, alone or with Shift", () => {
    for (const id of [
      "kb(desktop):g",
      "kb(desktop):shift+g",
      "kb(desktop):7",
      "kb(desktop):.",
      "kb(desktop):shift+/",
      "kb(desktop):plus",
      "kb(desktop):space",
      "kb(desktop):backspace",
      "kb(desktop):control+backspace",
      "kb(desktop):delete",
      "kb(desktop):numLockNumpad4",
      "kb(desktop):alt+control+q",
    ]) {
      expect(typing(id), id).toBe(true);
    }
  });

  it("doesn't count commands and navigation", () => {
    for (const id of [
      "kb(desktop):downArrow",
      "kb(desktop):control+c",
      "kb(desktop):NVDA+t",
      "kb(desktop):alt+d",
      "kb(desktop):enter",
      "kb(desktop):tab",
      "kb(desktop):f6",
      "br(freedomScientific):a",
    ]) {
      expect(typing(id), id).toBe(false);
    }
  });
});

describe("processTyping on the fixture session", () => {
  const redacted = processTyping(events, {
    editableRoles: EDITABLE_ROLES,
    focusKeys: FOCUS_KEYS,
    redact: true,
  });

  it("keeps the focus announcement of the field and redacts the typing after it", () => {
    const texts = redacted.entries.map((entry) => entry.text);
    const announcement = texts.indexOf("search landmark, Search this site, edit, blank");
    expect(announcement).toBeGreaterThan(0);
    expect(texts[announcement + 1]).toBe(REDACTED_TEXT);
    // Every keystroke and echo of "grant deadlines" collapses into one marker.
    expect(texts[announcement + 2]).not.toBe(REDACTED_TEXT);
    for (const letter of ["g", "r", "a", "n", "t", "d", "e", "l", "i", "s", "space"]) {
      expect(texts).not.toContain(letter);
      expect(texts).not.toContain(`kb(desktop):${letter}`);
    }
    expect(texts.join("\n")).not.toMatch(/grant|deadlines/);
  });

  it("keeps redacting after a non-focus key until focus moves again", () => {
    const texts = redacted.entries.map((entry) => entry.text);
    // Enter isn't a focus key here, so the page-load speech after it is redacted too...
    const enter = texts.indexOf("kb(desktop):enter");
    expect(texts[enter + 1]).toBe(REDACTED_TEXT);
    expect(texts).not.toContain("Search results - Voicecap Test Agency, document");
    // ...until Tab moves focus to a non-editable element.
    expect(texts).toContain("Skip to main content, link");
    expect(texts).toContain("main landmark, heading, level 1, Welcome to the Voicecap Test Agency");
    expect(texts).toContain("content info landmark, © 2026 Voicecap Test Agency");
  });

  it("counts the typing and the markers, not the characters", () => {
    expect(redacted.typingDetected).toBe("grant deadlines".length);
    expect(redacted.redactedKeystrokes).toBe(1);
    expect(redacted.redactedSpeech).toBe(1);
    expect(redacted.entries.filter((entry) => entry.redacted)).toHaveLength(2);
  });

  it("drops typed-word entries from the transcript", () => {
    expect(redacted.entries.some((entry) => entry.event.type === "typed-word")).toBe(false);
  });

  it("with Enter as a focus key, the speech after submitting the form is kept", () => {
    const outcome = processTyping(events, {
      editableRoles: EDITABLE_ROLES,
      focusKeys: [...FOCUS_KEYS, "enter", "numpadEnter"],
      redact: true,
    });
    const texts = outcome.entries.map((entry) => entry.text);
    expect(texts).toContain("Search results - Voicecap Test Agency, document");
    expect(texts.join("\n")).not.toMatch(/grant|deadlines/);
    expect(outcome.redactedSpeech).toBe(0);
  });

  it("only detects when not redacting, leaving the entries unchanged", () => {
    const detected = processTyping(events, {
      editableRoles: EDITABLE_ROLES,
      focusKeys: FOCUS_KEYS,
      redact: false,
    });
    expect(detected.typingDetected).toBe("grant deadlines".length);
    expect(detected.entries.some((entry) => entry.redacted)).toBe(false);
    expect(detected.redactedKeystrokes).toBe(0);
    expect(detected.entries.map((entry) => entry.text)).toContain("kb(desktop):g");
  });
});

describe("processTyping heuristics", () => {
  let n = 0;
  const key = (text: string): LogEvent => event("key", text);
  const speech = (...items: string[]): LogEvent => ({
    ...event("speech", items.join(", ")),
    items,
  });
  const typedWord = (text: string): LogEvent => event("typed-word", text);
  function event(type: LogEvent["type"], text: string): LogEvent {
    n += 1;
    return { type, text, time: "10:00:00.000", day: 0, at: n, line: n };
  }
  const run = (list: LogEvent[], redact = true) =>
    processTyping(list, { editableRoles: EDITABLE_ROLES, focusKeys: FOCUS_KEYS, redact });

  it("uses typed words to find typing into a field reached without a focus key (e.g. a click)", () => {
    const outcome = run([
      key("kb(desktop):h"),
      speech("heading", "level 2", "Sign in"),
      key("kb(desktop):s"),
      speech("s"),
      key("kb(desktop):e"),
      speech("e"),
      key("kb(desktop):space"),
      typedWord("se"),
      speech("space"),
    ]);
    expect(outcome.entries.map((entry) => entry.text)).toEqual([
      "kb(desktop):h",
      "heading, level 2, Sign in",
      REDACTED_TEXT,
    ]);
    expect(outcome.typingDetected).toBe(3);
  });

  it("doesn't treat browse-mode quick navigation letters as typing", () => {
    const outcome = run([
      key("kb(desktop):h"),
      speech("heading", "level 1", "Welcome"),
      key("kb(desktop):k"),
      speech("link", "Home"),
    ]);
    expect(outcome.typingDetected).toBe(0);
    expect(outcome.entries.some((entry) => entry.redacted)).toBe(false);
  });

  it("redacts password fields and leaves them when focus moves on", () => {
    const outcome = run([
      key("kb(desktop):tab"),
      speech("Password", "password edit", "protected", "blank"),
      key("kb(desktop):shift+h"),
      speech("star"),
      key("kb(desktop):1"),
      speech("star"),
      key("kb(desktop):tab"),
      speech("Sign in", "button"),
      key("kb(desktop):space"),
      speech("Signing in"),
    ]);
    expect(outcome.entries.map((entry) => entry.text)).toEqual([
      "kb(desktop):tab",
      "Password, password edit, protected, blank",
      REDACTED_TEXT,
      "kb(desktop):tab",
      "Sign in, button",
      "kb(desktop):space",
      "Signing in",
    ]);
    expect(outcome.typingDetected).toBe(2);
  });

  it("redacts speech after arrow keys in a field (reading back typed text)", () => {
    const outcome = run([
      key("kb(desktop):tab"),
      speech("Notes", "edit", "multi line", "blank"),
      key("kb(desktop):leftArrow"),
      speech("private text"),
    ]);
    expect(outcome.entries.map((entry) => entry.text)).toEqual([
      "kb(desktop):tab",
      "Notes, edit, multi line, blank",
      "kb(desktop):leftArrow",
      REDACTED_TEXT,
    ]);
    expect(outcome.redactedKeystrokes).toBe(0);
    expect(outcome.redactedSpeech).toBe(1);
  });

  it("combines a focus announcement split across several speech entries", () => {
    const outcome = run([
      key("kb(desktop):tab"),
      speech("form"),
      speech("Email", "edit", "blank"),
      key("kb(desktop):a"),
      speech("a"),
    ]);
    expect(outcome.entries.map((entry) => entry.text)).toEqual([
      "kb(desktop):tab",
      "form",
      "Email, edit, blank",
      REDACTED_TEXT,
    ]);
  });
});
