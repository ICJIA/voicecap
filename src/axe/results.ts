/**
 * axe-core's check of a page, as voicecap asks for it and keeps it. axe-core is an automated
 * checker: it tests a page's code against rules, and finds what code can find. Its results are
 * evidence beside what NVDA said and a person's review, never a verdict.
 *
 * This holds what voicecap asks axe for, and turns axe's results into the file each page keeps
 * (pages/<slug>/axe.json): only what each rule found, so the file stays small, written so that the
 * same results always give the same bytes. It imports nothing from Playwright and runs without a
 * browser: the Guidepup driver runs axe in the page it holds.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { z } from "zod";

import { errorMessage } from "../util/errors.js";
import { sortKeys } from "../util/hash.js";

/**
 * The rules axe runs, by their tags: WCAG 2.0, 2.1, and 2.2 at levels A and AA, and axe's best
 * practices. They're the ones voicecap's own tests run on its pages.
 */
export const AXE_TAGS: readonly string[] = Object.freeze([
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
  "best-practice",
]);

/** How long axe gets to check a page. Past it, the page has no result from axe, and is read as usual. */
export const AXE_LIMIT_MS = 20_000;
/** The most elements kept for one rule; the rest are counted. */
export const MAX_NODES = 50;
/**
 * The most of an element's HTML kept: 300 UTF-16 code units, what a string's length counts. A cut
 * never splits a character written with two of them, so a kept HTML's length is never more.
 */
export const MAX_HTML = 300;
/** The most of the reason a page has no result from axe kept, counted as MAX_HTML is. */
export const MAX_REASON = 300;

const IMPACTS = ["critical", "serious", "moderate", "minor"] as const;

/** How much a rule's failure matters, as axe rates it. */
export type AxeImpact = (typeof IMPACTS)[number];

/** What the page's record keeps of axe's results, beside the file's fingerprint. */
export interface AxeSummary {
  /** axe-core's version, as its results give it. */
  axeVersion: string;
  /** How many rules found violations, needed review, passed, and didn't apply to the page. */
  counts: { violations: number; incomplete: number; passes: number; inapplicable: number };
  /** How many of the violations are of each impact; one axe gives no impact isn't counted. */
  impacts: { critical: number; serious: number; moderate: number; minor: number };
}

/** An element a rule found, as kept. */
export interface KeptNode {
  /**
   * Its selectors, one for each frame from the page in. An element in a shadow root is the host's
   * selector, then " >>> " and the next, ending with its own.
   */
  target: string[];
  /**
   * Its HTML: at most MAX_HTML UTF-16 code units, so its length is never more than 300. A character
   * written with two units that would cross the limit is left out whole.
   */
  html: string;
  /** axe's words on how to fix it ("" when axe gives none). */
  failureSummary: string;
}

/** A rule with violations, or one that needs review, as kept. */
export interface KeptRule {
  id: string;
  /** null where axe gives none. */
  impact: AxeImpact | null;
  /** axe's words for what the rule asks. */
  help: string;
  /** axe's page on the rule. */
  helpUrl: string;
  tags: string[];
  /** The first MAX_NODES elements it found, in axe's order. */
  nodes: KeptNode[];
  /** How many more it found. */
  moreNodes: number;
}

/** The file a page keeps of axe's results: pages/<slug>/axe.json. */
export interface KeptAxeResults {
  schemaVersion: 1;
  axeVersion: string;
  /** The tags of the rules run: AXE_TAGS. */
  tags: string[];
  /** The page's address, after redirects. */
  url: string;
  counts: AxeSummary["counts"];
  violations: KeptRule[];
  /** What axe couldn't decide, for a person to check: axe's "incomplete". */
  incomplete: KeptRule[];
}

/**
 * The parts of axe's results voicecap reads, as axe-core 4.13 gives them; the rest is left out.
 * axe names every rule, and the shareable page reads back no rule without a name (axeViewOf), so
 * none is kept.
 */
const ruleSchema = z.object({
  id: z.string().min(1),
  impact: z.enum(IMPACTS).nullish(),
  help: z.string(),
  helpUrl: z.string(),
  tags: z.array(z.string()),
  nodes: z.array(
    z.object({
      // One selector a frame; one into shadow roots is a list, from the host in.
      target: z.array(z.union([z.string(), z.array(z.string())])),
      html: z.string(),
      failureSummary: z.string().optional(),
    }),
  ),
});

const resultsSchema = z.object({
  testEngine: z.object({ version: z.string() }),
  violations: z.array(ruleSchema),
  incomplete: z.array(ruleSchema),
  passes: z.array(z.unknown()),
  inapplicable: z.array(z.unknown()),
});

type AxeRule = z.infer<typeof ruleSchema>;

/**
 * What a page keeps of axe's results for the page at `url`: the file's text, and what the page's
 * record says of it. Throws when `raw` isn't axe's results.
 */
export function keptAxeResults(raw: unknown, url: string): { json: string; summary: AxeSummary } {
  const parsed = resultsSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`axe's results couldn't be read (${why(parsed.error)})`);
  const results = parsed.data;
  const counts = {
    violations: results.violations.length,
    incomplete: results.incomplete.length,
    passes: results.passes.length,
    inapplicable: results.inapplicable.length,
  };
  const impacts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const rule of results.violations) if (rule.impact) impacts[rule.impact]++;
  const kept: KeptAxeResults = {
    schemaVersion: 1,
    axeVersion: results.testEngine.version,
    tags: [...AXE_TAGS],
    url,
    counts,
    violations: results.violations.map(keptRule),
    incomplete: results.incomplete.map(keptRule),
  };
  return {
    json: `${JSON.stringify(sortKeys(kept), null, 2)}\n`,
    summary: { axeVersion: kept.axeVersion, counts, impacts },
  };
}

function keptRule(rule: AxeRule): KeptRule {
  return {
    id: rule.id,
    impact: rule.impact ?? null,
    help: rule.help,
    helpUrl: rule.helpUrl,
    tags: rule.tags,
    nodes: rule.nodes.slice(0, MAX_NODES).map((node) => ({
      target: node.target.map((selector) =>
        typeof selector === "string" ? selector : selector.join(" >>> "),
      ),
      html: cut(node.html, MAX_HTML),
      failureSummary: node.failureSummary ?? "",
    })),
    moreNodes: Math.max(0, rule.nodes.length - MAX_NODES),
  };
}

/**
 * The reason a page has no result from axe, as its record keeps it and the shareable page shows it:
 * the first line of what went wrong (the first with words in it, when the first has none), without
 * the stack that may follow, cut to MAX_REASON.
 */
export function axeErrorReason(error: unknown): string {
  const line = errorMessage(error)
    .split(/\r?\n|\r/)
    .map((text) => text.trim())
    .find((text) => text !== "");
  return line === undefined ? "no reason was given" : cut(line, MAX_REASON);
}

/**
 * `text` cut to at most `most` UTF-16 code units, never splitting a character written with two (a
 * surrogate pair): one that would end past the limit is left out whole.
 */
function cut(text: string, most: number): string {
  if (text.length <= most) return text;
  const last = text.charCodeAt(most - 1);
  const startsPair = last >= 0xd800 && last <= 0xdbff;
  return text.slice(0, startsPair ? most - 1 : most);
}

/** What the first thing wrong is, and where: "violations: Invalid input: expected array, …". */
function why(error: z.ZodError): string {
  const [issue] = error.issues;
  if (issue === undefined) return "they aren't laid out as axe lays them out";
  const where = issue.path.map(String).join(".");
  return where === "" ? issue.message : `${where}: ${issue.message}`;
}

/**
 * axe-core's own script, axe.min.js from the installed package, unchanged: its license notice
 * comes first, as its license asks of every copy.
 */
export async function axeScript(): Promise<string> {
  return readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
}
