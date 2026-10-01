/**
 * What changed since the last run: the pages that sound different from the run before, line by
 * line and flag by flag, the pages that sound the same (counted, not shown), the pages read in
 * only one of the two runs, and the lines that say so. Pure: it works from two run records and
 * the lines of the passes it's asked about, and reads no files.
 */
import { diffArrays, diffWordsWithSpace, type ArrayChange } from "diff";

import {
  PASS_NAMES,
  type FlagResult,
  type PageRecord,
  type PassName,
  type RunJson,
} from "../model.js";
import { environmentDifferences } from "../report/compare.js";
import { dayMonth, names } from "./format.js";

/** Some of a line's text, and whether it differs from the line it's compared with. */
export interface DiffWord {
  text: string;
  changed: boolean;
}

export type DiffLine =
  /** `words` add up to `text`. */
  | { kind: "removed" | "added"; text: string; words: DiffWord[] }
  | { kind: "same"; text: string }
  /** A run of unchanged lines, left out. */
  | { kind: "collapsed"; count: number };

export interface PassChange {
  pass: PassName;
  /** How many lines the pass lost, and how many it gained. */
  removed: number;
  added: number;
  lines: DiffLine[];
}

export interface PageChange {
  key: string;
  slug: string;
  url: string;
  label?: string;
  /** The passes whose transcripts differ, in pass order. */
  passes: PassChange[];
  /**
   * The page's flags in the two runs, compared by rule and pass. A resolved flag is as the earlier
   * run recorded it, and the others are as the later run did.
   */
  flags: { resolved: FlagResult[]; added: FlagResult[]; unchanged: FlagResult[] };
}

export interface OnlyInOnePage {
  key: string;
  url: string;
  label?: string;
  /**
   * "failed in one run" is a page read in full in one run that the other run listed but didn't read
   * in full: it failed there, or was skipped, or was never reached.
   */
  reason: "new" | "no longer listed" | "failed in one run";
}

export interface Changes {
  before: RunJson;
  after: RunJson;
  /** Pages read in full in both runs whose transcripts differ, in the later run's page order. */
  changed: PageChange[];
  /** Pages read in full in both whose transcripts are identical: counted, not shown. */
  same: number;
  /**
   * Pages read in full in one run and not the other, in the later run's page order, then those
   * only the earlier run listed. A page read in neither run isn't here.
   */
  onlyInOne: OnlyInOnePage[];
  /** environmentDifferences(before, after), shown first when not empty. */
  tools: string[];
  /** The section's line. */
  line: string;
  /** The summary's line. */
  summaryLine: string;
}

/** Unchanged lines kept on each side of a change. */
const CONTEXT = 2;

/** What each of voicecap's flag rules finds, in words for a reader who hasn't met its id. */
const RULE_FINDS = new Map([
  ["generic-link-text", "the links that say only what they do, not where they go"],
  ["unlabeled", "the unnamed controls"],
  ["headings", "the heading structure"],
  ["read-not-finished", "the unfinished read"],
  ["tab-no-stops", "the missing Tab stops"],
  ["tab-before-main", "the Tab stops before the main content"],
  ["repeated-phrase", "the repeated speech"],
]);

/**
 * Compare two runs of the same site, page by page. A page read in full in both is compared pass by
 * pass on the fingerprint of each pass's TXT body, so a pass whose fingerprints agree is never read.
 * `body` gives a pass's body lines (as `extractBody` does), or null when the run has no transcript
 * of that pass: it counts as having no lines, as `--compare` takes it. `name` is how a page is
 * called in the section's line.
 */
export function changesOf(
  before: RunJson,
  after: RunJson,
  body: (run: string, slug: string, pass: PassName) => string[] | null,
  name: (page: { label?: string; url: string }) => string,
): Changes {
  const earlier = new Map(before.pages.map((page): [string, PageRecord] => [page.key, page]));
  const listed = new Set(after.pages.map((page) => page.key));
  const changed: PageChange[] = [];
  const onlyInOne: OnlyInOnePage[] = [];
  let same = 0;

  for (const page of after.pages) {
    const was = earlier.get(page.key);
    if (was === undefined) {
      if (page.status === "done") onlyInOne.push({ ...pageRef(page), reason: "new" });
    } else if ((was.status === "done") !== (page.status === "done")) {
      onlyInOne.push({ ...pageRef(page), reason: "failed in one run" });
    } else if (page.status === "done") {
      const passes = PASS_NAMES.flatMap((pass): PassChange[] => {
        // The fingerprint is of the TXT body, so equal fingerprints are equal lines.
        if (was.passes[pass]?.contentSha256 === page.passes[pass]?.contentSha256) return [];
        const lines = diffLines(
          body(before.id, was.slug, pass) ?? [],
          body(after.id, page.slug, pass) ?? [],
        );
        return [{ pass, ...lines }];
      });
      if (passes.length === 0) {
        same += 1;
      } else {
        changed.push({
          ...pageRef(page),
          slug: page.slug,
          passes,
          flags: flagChanges(was.flags, page.flags),
        });
      }
    }
  }
  for (const page of before.pages) {
    if (!listed.has(page.key) && page.status === "done") {
      onlyInOne.push({ ...pageRef(page), reason: "no longer listed" });
    }
  }

  return {
    before,
    after,
    changed,
    same,
    onlyInOne,
    tools: environmentDifferences(before, after),
    ...sentences(dayMonth(before.createdAt), changed, same, name),
  };
}

function pageRef(page: PageRecord): { key: string; url: string; label?: string } {
  return {
    key: page.key,
    url: page.url,
    ...(page.label === undefined ? {} : { label: page.label }),
  };
}

function flagChanges(was: FlagResult[], now: FlagResult[]): PageChange["flags"] {
  const idOf = (flag: FlagResult) => JSON.stringify([flag.rule, flag.pass ?? null]);
  const had = new Set(was.map(idOf));
  const has = new Set(now.map(idOf));
  return {
    resolved: was.filter((flag) => !has.has(idOf(flag))),
    added: now.filter((flag) => !had.has(idOf(flag))),
    unchanged: now.filter((flag) => had.has(idOf(flag))),
  };
}

// The changed lines of a pass.

type Block =
  { kind: "same"; lines: string[] } | { kind: "change"; removed: string[]; added: string[] };

/**
 * The lines of a pass that went and came, with every long run of lines that didn't change left out
 * but the `CONTEXT` beside a change.
 */
function diffLines(
  before: string[],
  after: string[],
): Pick<PassChange, "removed" | "added" | "lines"> {
  const blocks = blocksOf(diffArrays(before, after));
  const lines: DiffLine[] = [];
  let removed = 0;
  let added = 0;
  blocks.forEach((block, index) => {
    if (block.kind === "same") {
      // A run keeps context only beside a change: the first run has none before it, and the last none after.
      const head = index === 0 ? 0 : CONTEXT;
      const tail = index === blocks.length - 1 ? 0 : CONTEXT;
      lines.push(...withContext(block.lines, head, tail));
    } else {
      removed += block.removed.length;
      added += block.added.length;
      lines.push(...pairLines(block.removed, block.added));
    }
  });
  return { removed, added, lines };
}

/** Runs of unchanged lines, and the changes between them: removed and added lines side by side are one. */
function blocksOf(parts: ArrayChange<string>[]): Block[] {
  const blocks: Block[] = [];
  for (const part of parts) {
    if (!part.added && !part.removed) {
      blocks.push({ kind: "same", lines: part.value });
      continue;
    }
    let block = blocks.at(-1);
    if (block?.kind !== "change") {
      block = { kind: "change", removed: [], added: [] };
      blocks.push(block);
    }
    (part.removed ? block.removed : block.added).push(...part.value);
  }
  return blocks;
}

/** A run of unchanged lines: its first `head` and last `tail`, with the lines between as a count. */
function withContext(run: string[], head: number, tail: number): DiffLine[] {
  const same = (text: string): DiffLine => ({ kind: "same", text });
  if (run.length <= head + tail) return run.map(same);
  return [
    ...run.slice(0, head).map(same),
    { kind: "collapsed", count: run.length - head - tail },
    ...run.slice(run.length - tail).map(same),
  ];
}

/**
 * A change's lines. A removed line and the added line at the same place are a pair, shown one after
 * the other, each with the words that differ marked. A line with no partner is marked whole.
 */
function pairLines(removed: string[], added: string[]): DiffLine[] {
  const lines: DiffLine[] = [];
  for (let at = 0; at < Math.max(removed.length, added.length); at += 1) {
    const old = removed[at];
    const now = added[at];
    if (old !== undefined && now !== undefined) {
      const words = markWords(old, now);
      lines.push(
        { kind: "removed", text: old, words: words.removed },
        { kind: "added", text: now, words: words.added },
      );
    } else if (old !== undefined) {
      lines.push({ kind: "removed", text: old, words: [{ text: old, changed: true }] });
    } else if (now !== undefined) {
      lines.push({ kind: "added", text: now, words: [{ text: now, changed: true }] });
    }
  }
  return lines;
}

/** Each of two lines as words, with the words that differ from the other line marked. */
function markWords(old: string, now: string): { removed: DiffWord[]; added: DiffWord[] } {
  const parts = diffWordsWithSpace(old, now);
  return {
    removed: tidy(
      parts
        .filter((part) => !part.added)
        .map((part) => ({ text: part.value, changed: part.removed })),
    ),
    added: tidy(
      parts
        .filter((part) => !part.removed)
        .map((part) => ({ text: part.value, changed: part.added })),
    ),
  };
}

/**
 * Words marked as a reader wants to see them: a space between two changed words is part of the
 * change ("click here", not "click" and "here"), and a change doesn't take the spaces beside it
 * (so a changed word is marked without the space that follows it).
 */
function tidy(pieces: DiffWord[]): DiffWord[] {
  const text = pieces.map((piece) => piece.text).join("");
  const changed = pieces.flatMap((piece) =>
    Array.from({ length: piece.text.length }, () => piece.changed),
  );

  for (const [from, to] of stretches(changed, false)) {
    if (from > 0 && to < text.length && /^\s+$/.test(text.slice(from, to))) {
      changed.fill(true, from, to);
    }
  }
  for (const [from, to] of stretches(changed, true)) {
    let start = from;
    let end = to;
    while (start < end && /\s/.test(text.charAt(start))) start += 1;
    while (end > start && /\s/.test(text.charAt(end - 1))) end -= 1;
    // A change that is only spaces is left as it is: it's all there is to mark.
    if (start < end) changed.fill(false, from, start).fill(false, end, to);
  }

  const words: DiffWord[] = [];
  let from = 0;
  for (let at = 1; at <= text.length; at += 1) {
    if (at === text.length || changed[at] !== changed[from]) {
      words.push({ text: text.slice(from, at), changed: changed[from] === true });
      from = at;
    }
  }
  return words;
}

/** The [from, to) stretches of `mask` that are all `value`. */
function stretches(mask: boolean[], value: boolean): [number, number][] {
  const found: [number, number][] = [];
  let from = -1;
  mask.forEach((bit, at) => {
    if (bit === value && from === -1) {
      from = at;
    } else if (bit !== value && from !== -1) {
      found.push([from, at]);
      from = -1;
    }
  });
  if (from !== -1) found.push([from, mask.length]);
  return found;
}

// The section's line and the summary's.

function sentences(
  date: string,
  changed: PageChange[],
  same: number,
  name: (page: { label?: string; url: string }) => string,
): Pick<Changes, "line" | "summaryLine"> {
  const since = `Since the last run on ${date}:`;
  const compared = changed.length + same;
  if (compared === 0) {
    return {
      line: "No page was read in full in both runs, so none could be compared.",
      summaryLine: `${since} no page was read in full in both runs, so none could be compared.`,
    };
  }
  if (changed.length === 0) {
    return {
      line: "Every page read in full in both runs sounds exactly the same.",
      summaryLine: `${since} every page sounds the same.`,
    };
  }

  const resolved = resolvedFlags(changed, name);
  const sound = (count: number) => (count === 1 ? "sounds" : "sound");
  const count = changed.length;
  const lead =
    `Compared with the run on ${date}: ${count} of ${compared} ` +
    `${compared === 1 ? "page" : "pages"} ${sound(count)} different, ` +
    `and ${same} ${sound(same)} exactly the same.`;
  const summary = `${since} ${count} ${count === 1 ? "page sounds" : "pages sound"} different`;
  if (resolved.length === 0) return { line: lead, summaryLine: `${summary}.` };

  const are = resolved.length === 1 ? "this flag is" : "these flags are";
  return {
    line: `${lead} Resolved: ${names(resolved)}.`,
    summaryLine: `${summary}, and ${are} resolved: ${names(resolved)}.`,
  };
}

/**
 * The flags gone from each changed page, as "<what the rule finds> on <page> (<rule>)": one for
 * each rule on each page, and none for a rule the page still has in another pass. A rule with no
 * plain name is named by its id alone.
 */
function resolvedFlags(
  changed: PageChange[],
  name: (page: { label?: string; url: string }) => string,
): string[] {
  return changed.flatMap((page) => {
    const kept = new Set([...page.flags.unchanged, ...page.flags.added].map((flag) => flag.rule));
    const gone = new Set(
      page.flags.resolved.map((flag) => flag.rule).filter((rule) => !kept.has(rule)),
    );
    return [...gone].map((rule) => {
      const finds = RULE_FINDS.get(rule);
      return finds === undefined
        ? `${rule} on ${name(page)}`
        : `${finds} on ${name(page)} (${rule})`;
    });
  });
}
