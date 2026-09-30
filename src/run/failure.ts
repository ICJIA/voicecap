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
 * Replace the home folder in some text, such as a stack trace, so the account name isn't kept:
 * with %USERPROFILE% on Windows, and with ~ elsewhere. The folder is replaced wherever its name
 * ends: "/Users/pat" is replaced in "/Users/pat/a.js" and "(/Users/pat)", but not in
 * "/Users/patrick". On Windows the match ignores case and takes either slash between the parts.
 */
export function redactHome(text: string, home: string, platform: NodeJS.Platform): string {
  const windows = platform === "win32";
  // A separator left at the end of the home folder (HOME=/Users/pat/) isn't part of it.
  const folder = home.replace(windows ? /[\\/]+$/ : /\/+$/, "");
  if (folder === "") return text;
  const source = windows
    ? folder
        .split(/[\\/]+/)
        .map(escapeRegExp)
        .join(String.raw`[\\/]+`)
    : escapeRegExp(folder);
  const replacement = windows ? "%USERPROFILE%" : "~";
  return text.replace(new RegExp(source + NAME_ENDS, windows ? "giu" : "gu"), () => replacement);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
