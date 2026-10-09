/**
 * What the shareable page shows of a page's axe results: its axe.json as the page reads it back
 * (`axeViewOf`), and the words worked out from it, which both copies say alike. axe-core is an
 * automated checker; what it found is evidence beside the person's review, never its verdict.
 *
 * The page reads the file it carries, never the page's record of it: the record's fingerprint names
 * the file, the fingerprint check checks the file's text, and the fold is drawn from that same
 * text, so a check that passes vouches for what the fold shows. A file is data, as a record is: one
 * that isn't axe's results as voicecap keeps them (src/axe/results.ts) is read as none, and the
 * card says so rather than stop. Pure.
 */
import { z } from "zod";

import type { AxeImpact, AxeSummary, KeptRule } from "../axe/results.js";
import { names } from "./format.js";
import { AXE_TEXT } from "./text.js";

/** axe's impacts, most severe first: the order a card lists the rules in. */
const IMPACTS = [
  "critical",
  "serious",
  "moderate",
  "minor",
] as const satisfies readonly AxeImpact[];

/** A rule axe found violated, or that needs review, as the page shows it: as its file keeps it. */
export type AxeViewRule = KeptRule;

/** A page's axe results, as its file keeps them, with the rules most severe first. */
export interface AxeView {
  /** axe-core's version, as its results gave it. */
  axeVersion: string;
  /** The tags of the rules axe ran. */
  tags: string[];
  /** How many rules found violations, needed review, passed, and didn't apply to the page. */
  counts: AxeSummary["counts"];
  /** The rules axe found violated (its "violations"): the page's issues. */
  violations: AxeViewRule[];
  /** What axe couldn't decide, for a person to check (its "incomplete"). */
  incomplete: AxeViewRule[];
}

const whole = z.number().int().nonnegative();

// A rule's id is never empty in axe's results, and the card heads a rule with no words of its own
// (`help`) by it, so a heading always has words.
const ruleSchema = z.object({
  id: z.string().min(1),
  impact: z.enum(IMPACTS).nullable(),
  help: z.string(),
  helpUrl: z.string(),
  tags: z.array(z.string()),
  nodes: z.array(
    z.object({ target: z.array(z.string()), html: z.string(), failureSummary: z.string() }),
  ),
  moreNodes: whole,
});

const fileSchema = z.object({
  schemaVersion: z.literal(1),
  axeVersion: z.string(),
  tags: z.array(z.string()),
  url: z.string(),
  counts: z.object({ violations: whole, incomplete: whole, passes: whole, inapplicable: whole }),
  violations: z.array(ruleSchema),
  incomplete: z.array(ruleSchema),
});

/**
 * A page's axe results from the text of its axe.json, with the rules of each list most severe
 * first, axe's order kept among those of one impact, and a rule axe gave no impact last. Null for a
 * text that isn't axe's results as voicecap keeps them: not JSON, not of that shape, or with counts
 * that aren't the rules it lists. Fields a later voicecap may add are left out.
 */
export function axeViewOf(text: string): AxeView | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const read = fileSchema.safeParse(parsed);
  if (!read.success) return null;
  const { axeVersion, tags, counts, violations, incomplete } = read.data;
  if (counts.violations !== violations.length || counts.incomplete !== incomplete.length) {
    return null;
  }
  return {
    axeVersion,
    tags,
    counts,
    violations: bySeverity(violations),
    incomplete: bySeverity(incomplete),
  };
}

/** Rules most severe first, axe's order kept among those of one impact; none given, last. */
function bySeverity(rules: AxeViewRule[]): AxeViewRule[] {
  const rank = (rule: AxeViewRule) =>
    rule.impact === null ? IMPACTS.length : IMPACTS.indexOf(rule.impact);
  return rules.toSorted((a, b) => rank(a) - rank(b));
}

/** How many of a page's issues are of each impact. One axe gave no impact isn't counted. */
export function axeImpacts(view: AxeView): Record<AxeImpact, number> {
  const impacts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const rule of view.violations) if (rule.impact !== null) impacts[rule.impact] += 1;
  return impacts;
}

/** A tag of a WCAG version's level: "wcag2a" is 2.0 A, "wcag21aa" 2.1 AA, "wcag22aa" 2.2 AA. */
const LEVEL_TAG = /^wcag(\d)(\d?)(a{1,3})$/;

/** A tag of a WCAG success criterion: "wcag143" is 1.4.3, "wcag1410" 1.4.10. */
const CRITERION_TAG = /^wcag(\d)(\d)(\d+)$/;

/** The tag of axe's best practices, which name no WCAG criterion. */
const BEST_PRACTICE = "best-practice";

/** A WCAG version and level from its tag ("wcag21aa" → 2.1 and AA), or null for another tag. */
function levelOf(tag: string): { version: string; level: string } | null {
  const found = LEVEL_TAG.exec(tag);
  if (found === null) return null;
  const [, major = "", minor = "", level = ""] = found;
  return { version: `${major}.${minor === "" ? "0" : minor}`, level: level.toUpperCase() };
}

/**
 * The rules axe ran, by the tags its file names, as a reader says them: "WCAG 2.0 and 2.1 at
 * levels A and AA, WCAG 2.2 at level AA, and best practices". WCAG's versions that share their
 * levels are named together; a tag this version doesn't know is named as it is; and no tag is "".
 */
export function axeRulesRun(tags: readonly string[]): string {
  const levels = new Map<string, string[]>();
  const others: string[] = [];
  let bestPractices = false;
  for (const tag of tags) {
    const wcag = levelOf(tag);
    if (wcag !== null) {
      const known = levels.get(wcag.version) ?? [];
      if (!known.includes(wcag.level)) known.push(wcag.level);
      levels.set(wcag.version, known);
    } else if (tag === BEST_PRACTICE) {
      bestPractices = true;
    } else if (!others.includes(tag)) {
      others.push(tag);
    }
  }
  // Versions with the same levels, in the order the tags first name them.
  const groups: { versions: string[]; levels: string[] }[] = [];
  for (const [version, levelsOf] of levels) {
    const same = groups.find((group) => group.levels.join() === levelsOf.join());
    if (same) same.versions.push(version);
    else groups.push({ versions: [version], levels: levelsOf });
  }
  return names([
    ...groups.map(
      ({ versions, levels: of }) =>
        `WCAG ${names(versions)} at ${of.length === 1 ? "level" : "levels"} ${names(of)}`,
    ),
    ...(bestPractices ? ["best practices"] : []),
    ...others,
  ]);
}

/**
 * The WCAG success criteria a rule's tags name, with their version and level, as a reader says
 * them: "WCAG 2.0 AA 1.4.3", "WCAG 2.0 A 2.4.4 and 4.1.2"; "best practice" for one of axe's best
 * practices; both, for a rule that is both; and "" for a rule whose tags name neither. axe's other
 * tags (its categories, other standards) aren't said.
 */
export function axeCriteria(tags: readonly string[]): string {
  const levels = tags.flatMap((tag) => {
    const wcag = levelOf(tag);
    return wcag === null ? [] : [`${wcag.version} ${wcag.level}`];
  });
  const criteria = tags.flatMap((tag) => {
    const found = CRITERION_TAG.exec(tag);
    return found === null ? [] : [found.slice(1).join(".")];
  });
  const wcag =
    levels.length + criteria.length === 0
      ? []
      : [["WCAG", levels.join(", "), names(criteria)].filter((part) => part !== "").join(" ")];
  return names([...wcag, ...(tags.includes(BEST_PRACTICE) ? [AXE_TEXT.bestPractice] : [])]);
}

/**
 * axe's words on how to fix an element (its `failureSummary`), set out as axe lays them out: a lead
 * ("Fix any of the following:"), then the things under it, one a line, for each part (axe puts a
 * blank line between them). Words laid out some other way are each a lead's line. Nothing is
 * changed but the spaces around a line, and a summary of no words is no part.
 */
export function axeFix(summary: string): { lead: string; items: string[] }[] {
  return summary
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((part) =>
      part
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== ""),
    )
    .flatMap(([lead, ...items]) => (lead === undefined ? [] : [{ lead, items }]));
}

/**
 * An element's selectors, as axe gives them, one for each frame from the page in, as a reader sees
 * them: one after another.
 */
export function axeSelector(target: readonly string[]): string {
  return target.join(" ");
}

/**
 * The address of axe's page on a rule (its `helpUrl`), when it is one: on axe's own site, where its
 * rules' pages are. A card links only to such an address, so a file can make no other link.
 */
export function axeRulePage(helpUrl: string): string | null {
  return helpUrl.startsWith(AXE_TEXT.rulePages) ? helpUrl : null;
}
