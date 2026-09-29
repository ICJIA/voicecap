/**
 * Opening a file in the app this computer uses for it, as double-clicking it would: voicecap
 * demo's report, in the browser. `open` on a Mac, Explorer on Windows, and `xdg-open` elsewhere.
 * Each starts with no shell and the path as its one argument, so no character in a folder's name
 * (a space, &, or a quote) is ever read as part of a command. Commands that belong to an operating
 * system live in src/drivers/, so this does.
 */
import { spawn } from "node:child_process";

export interface Command {
  file: string;
  args: string[];
}

/** The command that opens `file` in its app on `platform`. */
export function openFileCommand(file: string, platform: NodeJS.Platform): Command {
  switch (platform) {
    case "darwin":
      return { file: "open", args: [file] };
    case "win32":
      return { file: "explorer.exe", args: [file] };
    default:
      return { file: "xdg-open", args: [file] };
  }
}

/** Starts a command and leaves it running: true once it has started, false if it couldn't. */
export type StartCommand = (command: Command) => Promise<boolean>;

/**
 * The real StartCommand: spawns the command detached, with no shell and its output ignored, and
 * doesn't wait for it (Explorer, for one, exits with 1 even when it opened the file).
 */
export const startCommand: StartCommand = ({ file, args }) =>
  new Promise((resolve) => {
    try {
      const child = spawn(file, args, { detached: true, stdio: "ignore", shell: false });
      // Node reports a command that can't start as an event after spawn() has returned; with
      // nothing listening, that event would end voicecap.
      child.on("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });

/**
 * Opens `file`, an absolute path, in its app. False when the command couldn't start, so the
 * caller can say where the file is instead. It doesn't wait for the app, so it can't tell whether
 * the app showed the file. `platform` and `start` are for tests.
 */
export function openFile(
  file: string,
  options: { platform?: NodeJS.Platform; start?: StartCommand } = {},
): Promise<boolean> {
  const start = options.start ?? startCommand;
  return start(openFileCommand(file, options.platform ?? process.platform));
}
