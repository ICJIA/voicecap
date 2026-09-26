import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { decodeManualInput, detectManualFormat, splitLines } from "../src/manual/detect.js";
import { parseSpeechViewer } from "../src/manual/speech-viewer.js";

const LOG_FIXTURE = fileURLToPath(new URL("../fixture/manual/nvda-io-log.txt", import.meta.url));

/** What Speech Viewer shows for part of the fixture home page: items joined with two spaces. */
const CAPTURE = [
  "link  Skip to main content",
  "banner landmark  link  Voicecap Test Agency",
  "Main  navigation landmark  list  with 4 items  link  Home",
  "",
  "out of list  main landmark  heading  level 1  Welcome to the Voicecap Test Agency",
  "content info landmark  © 2026 Voicecap Test Agency",
  "© 2026 Voicecap Test Agency",
].join("\r\n");

describe("parseSpeechViewer", () => {
  it("reads one utterance per line and converts two-space separators to ', '", () => {
    const utterances = parseSpeechViewer(CAPTURE);
    expect(utterances.map((utterance) => utterance.text)).toEqual([
      "link, Skip to main content",
      "banner landmark, link, Voicecap Test Agency",
      "Main, navigation landmark, list, with 4 items, link, Home",
      "out of list, main landmark, heading, level 1, Welcome to the Voicecap Test Agency",
      "content info landmark, © 2026 Voicecap Test Agency",
      "© 2026 Voicecap Test Agency",
    ]);
    expect(utterances[2]!.items).toHaveLength(6);
    expect(utterances[3]!.line).toBe(5);
  });

  it("drops empty items (runs of more than two spaces) and blank lines", () => {
    expect(parseSpeechViewer("a    b  \n\n  c  ").map((utterance) => utterance.items)).toEqual([
      ["a", "b"],
      ["c"],
    ]);
  });

  it("accepts LF, CRLF, and CR line endings", () => {
    const text = "one  item\rtwo\r\nthree\n";
    expect(parseSpeechViewer(text).map((utterance) => utterance.text)).toEqual([
      "one, item",
      "two",
      "three",
    ]);
  });
});

describe("detectManualFormat", () => {
  it("recognizes NVDA logs by their entry headers", () => {
    expect(detectManualFormat(readFileSync(LOG_FIXTURE, "utf8"))).toBe("nvda-log");
  });

  it("recognizes an excerpt that starts in the middle of an entry", () => {
    const excerpt = [
      "Traceback (most recent call last):",
      '  File "eventHandler.pyc", line 321, in executeEvent',
      "IO - speech.speech.speak (10:00:00.000) - MainThread (1):",
      "Speaking ['text']",
    ].join("\n");
    expect(detectManualFormat(excerpt)).toBe("nvda-log");
  });

  it("treats anything else as Speech Viewer text", () => {
    expect(detectManualFormat(CAPTURE)).toBe("speech-viewer");
    expect(detectManualFormat("IO - but not a header")).toBe("speech-viewer");
  });
});

describe("decodeManualInput", () => {
  it("decodes UTF-8, with or without a BOM", () => {
    const text = "Speech  © 2026";
    const bytes = new TextEncoder().encode(text);
    expect(decodeManualInput(bytes)).toEqual({ text, encoding: "utf-8" });
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]);
    expect(decodeManualInput(withBom)).toEqual({ text, encoding: "utf-8" });
  });

  it("decodes UTF-16 with a BOM (Notepad's 'Unicode')", () => {
    const le = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0xa9, 0x00]);
    expect(decodeManualInput(le)).toEqual({ text: "A©", encoding: "utf-16le" });
    const be = new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0x00, 0xa9]);
    expect(decodeManualInput(be)).toEqual({ text: "A©", encoding: "utf-16be" });
  });

  it("falls back to Windows-1252 (Notepad's 'ANSI') when the bytes aren't UTF-8", () => {
    const ansi = new Uint8Array([0x93, 0x51, 0x94, 0x20, 0x96, 0x20, 0xa9]);
    expect(decodeManualInput(ansi)).toEqual({ text: "“Q” – ©", encoding: "windows-1252" });
  });
});

describe("splitLines", () => {
  it("drops only the final empty line", () => {
    expect(splitLines("a\r\n\r\nb\r\n")).toEqual(["a", "", "b"]);
  });
});
