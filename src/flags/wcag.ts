/**
 * The WCAG success criteria each of voicecap's built-in flag rules may relate to, for the report
 * for AI tools (src/share/ai/json.ts): a flag in the JSON file carries the criteria of its rule as
 * `wcag`, as numbers in strings ("2.4.4"), the way axe's issues carry theirs (`axeCriteriaList`, in
 * src/share/axe-view.ts).
 *
 * Each rule is mapped to the criteria it most often points to, or to none. It is a hint for a
 * person, never a verdict: a flag is a heuristic over what NVDA said, and the person reviewing
 * decides whether it relates to a criterion at all, and which. The JSON file's note says so
 * (`AI_TEXT.wcagNote`, after the sentences of `AI_TEXT.about`).
 *
 * - `generic-link-text`: 2.4.4 (Link Purpose, In Context).
 * - `unlabeled`: 1.1.1 (Non-text Content) and 4.1.2 (Name, Role, Value).
 * - `headings`: 1.3.1 (Info and Relationships) and 2.4.6 (Headings and Labels).
 * - `tab-no-stops`: 2.1.1 (Keyboard).
 * - `tab-before-main`: 2.4.1 (Bypass Blocks).
 * - `read-not-finished` and `repeated-phrase`: none. The first says voicecap's read pass stopped
 *   before the page's end, which is about the run, and the second that the same words were said
 *   many times in a row, which any of a dozen things can cause.
 *
 * A custom rule (`flags.custom`) is no built-in one, and has no criterion: `wcagOf` gives none for
 * it. A test pins the table, and holds its keys to the built-in rules' own list.
 *
 * The table is frozen, and so is each list in it, so no caller can change what another reads.
 * Pure.
 */
import type { BuiltInRule } from "./evaluate.js";

/** A list of criteria that can't be changed. */
const criteria = (...numbers: string[]): readonly string[] => Object.freeze(numbers);

/**
 * The criteria each built-in rule may relate to, in the order of the rules' own list
 * (`BUILT_IN_RULES`). A rule missing here is a type error.
 */
export const RULE_WCAG: Readonly<Record<BuiltInRule, readonly string[]>> = Object.freeze({
  "generic-link-text": criteria("2.4.4"),
  unlabeled: criteria("1.1.1", "4.1.2"),
  "read-not-finished": criteria(),
  headings: criteria("1.3.1", "2.4.6"),
  "tab-no-stops": criteria("2.1.1"),
  "tab-before-main": criteria("2.4.1"),
  "repeated-phrase": criteria(),
});

/**
 * The criteria a flag's rule may relate to, by the rule's id as a flag records it: the table's for
 * a built-in rule, and none for any other, a custom rule's id or one an older record names that
 * no longer exists. Only an id the table has itself counts, so a custom rule named "constructor"
 * or "toString" finds none, not a function every object has.
 */
export function wcagOf(rule: string): readonly string[] {
  return Object.hasOwn(RULE_WCAG, rule) ? RULE_WCAG[rule as BuiltInRule] : [];
}
