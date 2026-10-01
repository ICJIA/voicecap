/**
 * What a listener hears on a page that needs attention, in one plain line: its flags, a failure to
 * read it, and an issue a reviewer found. Pure.
 */
import type { FlagResult } from "../model.js";
import { names } from "./format.js";

/** The rules that find items, and what the line says of the items each found. */
type FindingRule = "generic-link-text" | "unlabeled";

/** What a link with no name is called in `FlagResult.found`. NVDA says only "link" for it. */
const NO_NAME = "(no name)";

/**
 * "<what>; <what>": a clause for each rule the page's flags raised, in the order the flags first
 * raise them, then a clause for a failure, then one for an issue. Empty when there is nothing to
 * say.
 *
 * `failure` is what kind of failure stopped the page being read, in words ("another window took the
 * screen"), "" when the record doesn't say, and null when the page has none. `issueNote` is the
 * note of the issue a reviewer found and no one has fixed, "" when the review has no note, and null
 * when the page has no open issue.
 *
 * A rule raised in more than one pass is one clause, since the passes hear the same page: the links
 * the read pass and the Tab pass both hear are counted once. A flag from a record that has no list
 * of what it found gives its own message.
 */
export function attentionClauses(
  flags: FlagResult[],
  failure: string | null,
  issueNote: string | null,
): string {
  const clauses = new Set<string>(flags.map((flag) => flagClause(flag, flags)));
  if (failure !== null) {
    clauses.add(
      failure === ""
        ? "it couldn't be read after every attempt"
        : `it couldn't be read after every attempt (${failure})`,
    );
  }
  if (issueNote !== null) {
    const note = tidy(issueNote);
    clauses.add(note === "" ? "a reviewer found an issue" : `a reviewer found an issue: ${note}`);
  }
  return [...clauses].join("; ");
}

/**
 * The clauses with the page's name in front, as one plain line of text: "<name>: <what>; <what>",
 * or just the name when there is nothing to say. See `attentionClauses`.
 */
export function attentionLine(
  name: string,
  flags: FlagResult[],
  failure: string | null,
  issueNote: string | null,
): string {
  const clauses = attentionClauses(flags, failure, issueNote);
  return clauses === "" ? name : `${name}: ${clauses}`;
}

function flagClause(flag: FlagResult, all: FlagResult[]): string {
  switch (flag.rule) {
    case "generic-link-text":
    case "unlabeled":
      return flag.found === undefined ? tidy(flag.message) : foundClause(flag.rule, all);
    case "headings":
      return headingsClause(flag.message);
    case "read-not-finished":
      return "NVDA's reading stopped before the end of the page";
    case "tab-no-stops":
      return "Tab reaches nothing on the page";
    case "tab-before-main":
      return "Tab stops before the main content, and the first stop isn't a skip link";
    default:
      // repeated-phrase, and a rule of the person's own: each says what it found in its message.
      return tidy(flag.message);
  }
}

/**
 * What a rule found on the page, across the passes: each item once, with the most any one pass
 * found of it, since the passes hear the same links and controls again, and most often first.
 */
function foundClause(rule: FindingRule, all: FlagResult[]): string {
  const most = new Map<string, number>();
  for (const flag of all) {
    if (flag.rule !== rule) continue;
    for (const { text, count } of flag.found ?? []) {
      most.set(text, Math.max(most.get(text) ?? 0, count));
    }
  }
  // The sort is stable, so items found as often stay in the order the flags list them.
  const found = [...most].sort((a, b) => b[1] - a[1]);
  const count = found.reduce((sum, [, each]) => sum + each, 0);
  const said = (text: string) =>
    `“${rule === "generic-link-text" && text === NO_NAME ? "link" : text}”`;
  const only = `only ${names(found.map(([text]) => said(text)))}`;
  if (rule === "generic-link-text") {
    return `${count === 1 ? "1 link says" : `${count} links say`} ${only}`;
  }
  return `${count === 1 ? "1 control has no name" : `${count} controls have no names`}, so NVDA says ${only}`;
}

/**
 * The headings rule's two messages, as a person would say them: "its first heading is level 2, not
 * 1" and "it has no headings". The rule words them (headings in src/flags/evaluate.ts).
 */
function headingsClause(message: string): string {
  const text = tidy(message);
  if (text === "The page has no headings") return "it has no headings";
  const level = /^The first heading is level (\d+), not level 1$/.exec(text)?.[1];
  if (level !== undefined) return `its first heading is level ${level}, not 1`;
  // A message this version doesn't know: the message, as a clause.
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** Text as part of a line: on one line, and without the period that ended it as a sentence. */
function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/\.$/, "");
}
