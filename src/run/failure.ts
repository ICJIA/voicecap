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
 *
 * The folder is replaced as a file: URL spells it, too, which is how the stack frames of voicecap's
 * own ES modules show it: "file:///C:/Users/Jane%20Doe/a.js" for "C:\Users\Jane Doe".
 */
export function redactHome(text: string, home: string, platform: NodeJS.Platform): string {
  const windows = platform === "win32";
  // A separator left at the end of the home folder (HOME=/Users/pat/) isn't part of it.
  const folder = home.replace(windows ? /[\\/]+$/ : /\/+$/, "");
  if (folder === "") return text;
  const parts = folder.split(windows ? /[\\/]+/ : "/");
  const separator = windows ? String.raw`[\\/]+` : "/";
  // A folder that needs no encoding is spelled the same way twice: one alternative.
  const sources = new Set(
    [parts, parts.map(urlPart)].map((spelling) => spelling.map(escapeRegExp).join(separator)),
  );
  const pattern = new RegExp(`(?:${[...sources].join("|")})${NAME_ENDS}`, windows ? "giu" : "gu");
  const replacement = windows ? "%USERPROFILE%" : "~";
  return text.replace(pattern, () => replacement);
}

/** A part of a path as a file: URL spells it (a space is %20); one that can't be encoded stays. */
function urlPart(part: string): string {
  try {
    return encodeURI(part);
  } catch {
    return part; // it has a lone surrogate, which encodeURI throws on
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
