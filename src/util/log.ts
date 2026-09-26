import { styleText } from "node:util";

/** Where voicecap sends console messages. Commands take one so tests can capture output. */
export interface Logger {
  info(message: string): void;
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

export function createConsoleLogger(
  out: OutputStream = process.stdout,
  err: OutputStream = process.stderr,
): Logger {
  const color = (stream: OutputStream) =>
    Boolean(stream.isTTY) && process.env.NO_COLOR === undefined;
  const paint = (stream: OutputStream, format: Parameters<typeof styleText>[0], text: string) =>
    color(stream) ? styleText(format, text) : text;
  return {
    info: (message) => out.write(`${message}\n`),
    warn: (message) => err.write(`${paint(err, "yellow", `Warning: ${message}`)}\n`),
    alert: (message) => {
      const rule = "=".repeat(72);
      err.write(`${paint(err, ["bold", "yellow"], `${rule}\nWARNING: ${message}\n${rule}`)}\n`);
    },
    error: (message) => err.write(`${paint(err, "red", `Error: ${message}`)}\n`),
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
