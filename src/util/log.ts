import { styleText } from "node:util";

import { inertText } from "./inert.js";

/**
 * What a result line says: that something passed or failed. At a terminal, the console logger
 * shows a passing line in green and a failing one in red. The words must say it too: color never
 * carries the meaning alone.
 */
export type Outcome = "pass" | "fail";

const OUTCOME_COLOR = { pass: "green", fail: "red" } as const;

/** Where voicecap sends console messages. Commands take one so tests can capture output. */
export interface Logger {
  info(message: string, outcome?: Outcome): void;
  warn(message: string): void;
  /** A warning the user must not miss, printed prominently. */
  alert(message: string): void;
  error(message: string): void;
}

type Level = "info" | "warn" | "alert" | "error";

/** Anything with write(): process.stdout, or a capture stream in tests. */
export interface OutputStream {
  write(chunk: string): unknown;
  isTTY?: boolean;
}

/**
 * The logger commands print through. A message can hold words from outside: a website's, a
 * sitemap's, a server's reply, a record's. So each level writes its message through inertText,
 * which writes a control character, an invisible formatting character, or a line separator as an
 * escape such as `\u{1b}`, and a CR LF as a line break. The color codes come after, so they're the
 * only escape sequences a terminal is sent.
 */
export function createConsoleLogger(
  out: OutputStream = process.stdout,
  err: OutputStream = process.stderr,
): Logger {
  const color = (stream: OutputStream) =>
    Boolean(stream.isTTY) && process.env.NO_COLOR === undefined;
  const paint = (stream: OutputStream, format: Parameters<typeof styleText>[0], text: string) =>
    color(stream) ? styleText(format, text) : text;
  return {
    info: (message, outcome) => {
      const text = inertText(message);
      out.write(`${outcome ? paint(out, OUTCOME_COLOR[outcome], text) : text}\n`);
    },
    warn: (message) => err.write(`${paint(err, "yellow", `Warning: ${inertText(message)}`)}\n`),
    alert: (message) => {
      const rule = "=".repeat(72);
      const text = `${rule}\nWARNING: ${inertText(message)}\n${rule}`;
      err.write(`${paint(err, ["bold", "yellow"], text)}\n`);
    },
    error: (message) => err.write(`${paint(err, "red", `Error: ${inertText(message)}`)}\n`),
  };
}

export interface MemoryLogger extends Logger {
  readonly entries: { level: Level; message: string }[];
  /** All messages joined with newlines, for assertions. */
  text(level?: Level): string;
}

export function createMemoryLogger(): MemoryLogger {
  const entries: { level: Level; message: string }[] = [];
  const push = (level: Level) => (message: string) => {
    entries.push({ level, message });
  };
  return {
    entries,
    info: push("info"),
    warn: push("warn"),
    alert: push("alert"),
    error: push("error"),
    text: (level) =>
      entries
        .filter((entry) => level === undefined || entry.level === level)
        .map((entry) => entry.message)
        .join("\n"),
  };
}

export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  alert: () => {},
  error: () => {},
};
