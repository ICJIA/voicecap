import type { ManualInputFormat } from "../model.js";

/**
 * The first line of every NVDA log entry (logHandler.initialize):
 *   "{levelname} - {codepath} ({asctime}) - {threadName} ({thread}):"
 * where asctime is local time of day with milliseconds (Formatter.formatTime), e.g.
 *   IO - inputCore.InputManager.executeGesture (09:17:40.724) - Thread-5 (13576):
 */
export const LOG_HEADER =
  /^([A-Z][A-Z_]*) - (.+?) \((\d{2}):(\d{2}):(\d{2})\.(\d{3})\) - (.+?) \((\d+)\):$/;

export interface DecodedText {
  text: string;
  encoding: "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";
}

/**
 * Decode an imported file. NVDA writes its log as UTF-8 (logHandler.FileHandler). Speech Viewer
 * text is whatever the user saved it as: Notepad writes UTF-8, "Unicode" (UTF-16 with a BOM),
 * or "ANSI" (Windows-1252 on English systems).
 */
export function decodeManualInput(bytes: Uint8Array): DecodedText {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16le" };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "utf-16be" };
  }
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = hasBom ? bytes.subarray(3) : bytes;
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(body), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(body), encoding: "windows-1252" };
  }
}

/** Split text into lines, accepting CRLF (Windows), LF, and CR line endings. */
export function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/**
 * An NVDA log if a log-entry header appears among the first 2,000 non-empty lines (an excerpt may
 * start mid-entry, even inside a long traceback); otherwise Speech Viewer text, which has no such
 * headers. Mistaking a log for Speech Viewer text would skip the privacy warning, so look far.
 */
export function detectManualFormat(text: string): ManualInputFormat {
  let seen = 0;
  for (const line of splitLines(text)) {
    if (line.trim() === "") continue;
    if (LOG_HEADER.test(line)) return "nvda-log";
    seen += 1;
    if (seen >= 2000) break;
  }
  return "speech-viewer";
}
