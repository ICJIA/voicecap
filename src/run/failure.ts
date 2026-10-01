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

/** The next character isn't one a folder's name goes on with (a letter, digit, _, ., or -). */
const NAME_ENDS = String.raw`(?![\p{L}\p{N}_.-])`;

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
 * ends: "/Users/pat" is replaced in "/Users/pat/a.js" and "(/Users/pat)", but not in
 * "/Users/patrick". On Windows the match ignores case and takes either slash between the parts.
 *
 * The folder is replaced as a file: URL spells it, too, which is how the stack frames of voicecap's
 * own ES modules show it: "file:///C:/Users/Jane%20Doe/a.js" for "C:\Users\Jane Doe". The spelling
 * is Node's own (see fileUrlSpelling), so a "#" or "~" in the folder's name is matched as Node
 * writes it in those frames.
 */
export function redactHome(text: string, home: string, platform: NodeJS.Platform): string {
  const windows = platform === "win32";
  // A separator left at the end of the home folder (HOME=/Users/pat/) isn't part of it.
  const folder = home.replace(windows ? /[\\/]+$/ : /\/+$/, "");
  // Nothing to replace: no folder, or only the root of the file system or (on Windows) of a drive.
  if (folder === "" || (windows && /^[A-Za-z]:$/.test(folder))) return text;
  const spellings = [folder, fileUrlSpelling(folder, windows)].filter(
    (spelling): spelling is string => spelling !== null,
  );
  const split = (spelling: string) => spelling.split(windows ? /[\\/]+/ : "/");
  const separator = windows ? String.raw`[\\/]+` : "/";
  // A folder that needs no encoding is spelled the same way twice: one alternative.
  const sources = new Set(
    spellings.map((spelling) => split(spelling).map(escapeRegExp).join(separator)),
  );
  const pattern = new RegExp(`(?:${[...sources].join("|")})${NAME_ENDS}`, windows ? "giu" : "gu");
  const replacement = windows ? "%USERPROFILE%" : "~";
  return text.replace(pattern, () => replacement);
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
