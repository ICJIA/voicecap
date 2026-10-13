/**
 * Windows' own programs, by their full path, and the one setting that keeps Windows from looking
 * for any other program in the folder voicecap runs in.
 *
 * A program started by its name alone (`powershell.exe`, `tasklist`) is looked for by Windows in the
 * current folder first, and only then in PATH. voicecap is run from a repository it shares (the
 * transcripts home), so a file named `powershell.exe` committed there would be started in place of
 * Windows' own, as the person running voicecap. So voicecap names each of these programs by its full
 * path in the Windows folder, which no folder it runs in can stand in for, and every program it
 * starts by name (`git`, and what Guidepup starts, such as `cscript`) is covered by
 * guardProgramSearch().
 */
import path from "node:path";

/** The Windows programs voicecap starts. */
export type SystemTool = "powershell" | "tasklist" | "taskkill" | "reg" | "explorer";

/** Where each program is, under the Windows folder. */
const TOOL_PATH: Record<SystemTool, string[]> = {
  powershell: ["System32", "WindowsPowerShell", "v1.0", "powershell.exe"],
  tasklist: ["System32", "tasklist.exe"],
  taskkill: ["System32", "taskkill.exe"],
  reg: ["System32", "reg.exe"],
  explorer: ["explorer.exe"],
};

/** The Windows folder when the environment names none that is a full path. */
const DEFAULT_WINDOWS_FOLDER = "C:\\Windows";

/**
 * The Windows folder: `SystemRoot`, else `windir`, whichever comes first as an absolute Windows
 * path, else C:\Windows. A value that isn't one ("Windows", "..\\Windows") would be a folder
 * relative to where voicecap runs, which is what a full path is here to avoid.
 */
function windowsFolder(env: NodeJS.ProcessEnv): string {
  for (const value of [env.SystemRoot, env.windir]) {
    if (value !== undefined && path.win32.isAbsolute(value)) return value;
  }
  return DEFAULT_WINDOWS_FOLDER;
}

/**
 * `tool`'s full path in the Windows folder `env` names: `C:\Windows\System32\tasklist.exe`, say. It
 * is written for Windows whatever platform asks, and no file is looked for.
 */
export function systemTool(tool: SystemTool, env: NodeJS.ProcessEnv = process.env): string {
  return path.win32.join(windowsFolder(env), ...TOOL_PATH[tool]);
}

/**
 * Tells Windows not to look in the current folder for a program started by name, by setting
 * NoDefaultCurrentDirectoryInExePath. libuv, which starts every program Node starts, asks Windows
 * (NeedCurrentDirectoryForExePathW) whether to, and Windows answers from the environment of the
 * process doing the starting, this one. So an `env` given to the program being started doesn't do
 * it, and a program started before this call isn't covered. `cli.ts` calls it, with no argument,
 * before anything starts a program. It covers `git`, which runs in a folder of the repository, and
 * what Guidepup starts by name, such as `cscript`.
 */
export function guardProgramSearch(env: NodeJS.ProcessEnv = process.env): void {
  env.NoDefaultCurrentDirectoryInExePath = "1";
}
