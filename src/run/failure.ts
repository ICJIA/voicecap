import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ForegroundError } from "../drivers/types.js";
import type { FailureCause } from "../model.js";
import { StepTimeoutError } from "../passes/steps.js";
import { EnvironmentError } from "../util/errors.js";

/**
 * Why an attempt at a page failed: the code the error carries, when it's one of voicecap's own
 * (an EnvironmentError, ForegroundError, or StepTimeoutError) and has one. Every other error,
 * whatever properties it has, is "unexpected": it may be a fault in voicecap itself.
 */
export function causeOf(error: unknown): FailureCause {
  if (
    error instanceof EnvironmentError ||
    error instanceof ForegroundError ||
    error instanceof StepTimeoutError
  ) {
    return error.failure ?? "unexpected";
  }
  return "unexpected";
}

/**
 * The next character isn't one a folder's name goes on with: a letter, a digit, _ or -, or a run of
 * full stops that one of those follows (the "." of "pat.old", and the ".." of "pat..old", are part
 * of a name). Full stops that end a sentence ("Couldn't open C:\Users\pat.") or trail off in an
 * ellipsis ("Opening C:\Users\pat...") end the name, too, and so does the ellipsis of one character
 * (U+2026), which is no full stop.
 */
const NAME_ENDS = String.raw`(?![\p{L}\p{N}_-]|\.+[\p{L}\p{N}_-])`;

/**
 * The home folder, or null where there's none: Node throws when neither HOME (USERPROFILE on
 * Windows) nor the account's entry gives one. A failed attempt isn't lost to that, and neither is
 * the page that shows records: with no home folder, redactHome has nothing to replace.
 */
export function homeFolder(): string | null {
  try {
    return os.homedir();
  } catch {
    return null;
  }
}

/**
 * Replace the home folder in some text, such as a stack trace, so the account name isn't kept:
 * with %USERPROFILE% on Windows, and with ~ elsewhere. The folder is replaced wherever its name
 * ends: "/Users/pat" is replaced in "/Users/pat/a.js", in "(/Users/pat)", at the end of a
 * sentence ("Couldn't open /Users/pat."), and before an ellipsis ("Opening /Users/pat..."), but not
 * in "/Users/patrick" or "/Users/pat.old". On Windows the match ignores case and takes either slash
 * between the parts.
 *
 * The folder is replaced as a file: URL spells it, too, which is how the stack frames of voicecap's
 * own ES modules show it: "file:///C:/Users/Jane%20Doe/a.js" for "C:\Users\Jane Doe". The spelling
 * is Node's own (see fileUrlSpelling), so a "#" or "~" in the folder's name is matched as Node
 * writes it in those frames. On Windows, a folder on a drive is replaced as Git Bash spells it, too
 * ("/c/Users/pat" for "C:\Users\pat"), which is how a path someone typed there is kept.
 *
 * The home folder's short (8.3) spelling, "C:\Users\JANEDO~1", is not known from the home folder
 * alone: redactAccount finds it, and is what the words of an error that a run keeps go through.
 */
export function redactHome(text: string, home: string, platform: NodeJS.Platform): string {
  const windows = platform === "win32";
  // A separator left at the end of the home folder (HOME=/Users/pat/) isn't part of it.
  const folder = home.replace(windows ? /[\\/]+$/ : /\/+$/, "");
  // Nothing to replace: no folder, or only the root of the file system or (on Windows) of a drive.
  if (folder === "" || (windows && /^[A-Za-z]:$/.test(folder))) return text;
  const spellings = [
    folder,
    fileUrlSpelling(folder, windows),
    windows ? gitBashSpelling(folder) : null,
  ].filter((spelling): spelling is string => spelling !== null);
  const replacement = windows ? "%USERPROFILE%" : "~";
  return text.replace(folderPattern(spellings, windows), () => replacement);
}

/**
 * Replace the temp folder in some text with %TEMP%, wherever and however the text spells it: in any
 * case, and with either slash between its parts. It's for Windows alone, where a message names the
 * files in the temp folder, and the temp folder may be spelled with the account's short name
 * (C:\Users\JANEDO~1\AppData\Local\Temp), which isn't the spelling of the home folder that
 * redactHome replaces. On any other system, and for a `temp` that isn't an absolute path, the text
 * comes back as it was: the working folder, ".", would match every full stop, and a drive's root,
 * "C:\", every path on the drive. Like a home folder, the temp folder is replaced only as a whole
 * folder.
 */
export function redactTemp(text: string, temp: string, platform: NodeJS.Platform): string {
  if (platform !== "win32") return text;
  // A separator left at the end of the folder isn't part of it, and leaves a root with no path.
  const folder = temp.replace(/[\\/]+$/, "");
  if (!path.win32.isAbsolute(folder)) return text;
  return text.replace(folderPattern([folder], true), () => "%TEMP%");
}

/**
 * The folders that name an account, as this computer has them: where redactAccount finds the
 * account's name in the words of an error. `realTemp` is the temp folder with every link and short
 * name resolved (null where it can't be had).
 */
export interface AccountFolders {
  home: string | null;
  temp: string;
  realTemp: string | null;
  platform: NodeJS.Platform;
}

/** This computer's account folders. Never throws: a folder Node can't give is null. */
export function accountFolders(): AccountFolders {
  const temp = os.tmpdir();
  let realTemp: string | null;
  try {
    realTemp = realpathSync.native(temp);
  } catch {
    realTemp = null;
  }
  return { home: homeFolder(), temp, realTemp, platform: process.platform };
}

/**
 * Replace what names the account in the words of an error that a run keeps: the temp folder as
 * redactTemp writes it, then the home folder as redactHome writes it, in every spelling Windows
 * gives them. The temp folder goes first, because it lies in the home folder (in its short spelling,
 * the one `temp` has, or in its long one, the one `realTemp` has), and a path in it is the more
 * useful for being named by its variable.
 *
 * Windows gives the profile folder of an account whose name is longer than eight characters, or has
 * a space, a short name too (C:\Users\JANEDO~1), and the temp folder is spelled with it in the
 * environment (so is `temp`) but not by the system's real path for it (`realTemp`). When `realTemp`
 * is in the home folder, the rest of it is the same in both, so what comes before that rest in
 * `temp` is the home folder's short spelling, and it's replaced as the home folder is. A short
 * spelling is known only that way: a text that has one with a temp folder elsewhere keeps it.
 */
export function redactAccount(text: string, folders: AccountFolders = accountFolders()): string {
  const { home, temp, realTemp, platform } = folders;
  let redacted = redactTemp(text, temp, platform);
  if (realTemp !== null && realTemp !== temp) redacted = redactTemp(redacted, realTemp, platform);
  if (home === null) return redacted;
  redacted = redactHome(redacted, home, platform);
  const short = platform === "win32" ? shortHomeFolder(home, temp, realTemp) : null;
  return short === null ? redacted : redactHome(redacted, short, platform);
}

/**
 * The home folder's short (8.3) spelling, as `temp` shows it, when `realTemp` is in the home folder
 * (see redactAccount); null when it can't be told, or is the home folder as `home` spells it.
 */
function shortHomeFolder(home: string, temp: string, realTemp: string | null): string | null {
  if (realTemp === null) return null;
  const folder = home.replace(/[\\/]+$/, "");
  // The same text, in any case and with either slash.
  const alike = (a: string, b: string) =>
    a.replaceAll("/", "\\").toLowerCase() === b.replaceAll("/", "\\").toLowerCase();
  if (
    folder === "" ||
    realTemp[folder.length] !== "\\" ||
    !alike(realTemp.slice(0, folder.length), folder)
  ) {
    return null;
  }
  // What comes after the home folder in the real path, the separator first: "\AppData\Local\Temp".
  const tail = realTemp.slice(folder.length);
  if (temp.length <= tail.length || !alike(temp.slice(temp.length - tail.length), tail))
    return null;
  const short = temp.slice(0, temp.length - tail.length);
  return short === folder ? null : short;
}

/**
 * A pattern for a folder in any of its `spellings`, wherever its name ends (NAME_ENDS). On Windows
 * it ignores case and takes one or more slashes of either kind between the parts, which is how a
 * doubled backslash in a JSON string or a Python repr is matched.
 */
function folderPattern(spellings: readonly string[], windows: boolean): RegExp {
  const split = (spelling: string) => spelling.split(windows ? /[\\/]+/ : "/");
  const separator = windows ? String.raw`[\\/]+` : "/";
  // A folder that needs no encoding is spelled the same way twice: one alternative.
  const sources = new Set(
    spellings.map((spelling) => split(spelling).map(escapeRegExp).join(separator)),
  );
  return new RegExp(`(?:${[...sources].join("|")})${NAME_ENDS}`, windows ? "giu" : "gu");
}

/**
 * An absolute folder's path as Node's file: URLs spell it, as in the stack frames of ES modules:
 * "C:/Users/Jane%20Doe" for "C:\Users\Jane Doe", "//srv/share/pat" for "\\srv\share\pat", and
 * "/Users/pat%23x" for "/Users/pat#x" (Node 24 writes a "~" as %7E, too). Null for a path that
 * isn't absolute, which a URL can spell only once it's resolved into another folder, or one Node
 * can't spell.
 */
function fileUrlSpelling(folder: string, windows: boolean): string | null {
  if (!(windows ? path.win32 : path.posix).isAbsolute(folder)) return null;
  try {
    const url = pathToFileURL(folder, { windows });
    // A network share's server is the URL's host: file://srv/share/pat.
    const spelled = url.host === "" ? url.pathname : `//${url.host}${url.pathname}`;
    // A drive's path gets a slash before its letter: file:///C:/Users/pat.
    return windows ? spelled.replace(/^\/(?=[A-Za-z]:)/, "") : spelled;
  } catch {
    return null;
  }
}

/**
 * A Windows folder on a drive as Git Bash spells it: "/c/Users/pat" for "C:\Users\pat", with the
 * drive in lower case and a slash between the parts. Null for a folder with no drive letter, such
 * as one on a network share.
 */
function gitBashSpelling(folder: string): string | null {
  const drive = /^([A-Za-z]):[\\/]/.exec(folder);
  if (drive === null) return null;
  return `/${drive[1]!.toLowerCase()}/${folder.slice(3).replace(/[\\/]+/g, "/")}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
