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
  /** The compared passes whose transcripts differ and can be read, in pass order. */
  passes: PassChange[];
  /**
   * The compared passes whose transcripts differ but can't be read here (`body` gave nothing for
   * one of the runs), in pass order. Not in `passes`: with no lines to compare, none are shown.
   */
  unreadable: PassName[];
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
   * "failed in one run" and "skipped in one run" are a page read in full in one run whose record in
   * the other says it failed, or that voicecap skipped (it loaded, and was left out).
   */
  reason: "new" | "no longer listed" | "failed in one run" | "skipped in one run";
}

export interface Changes {
  before: RunJson;
  after: RunJson;
  /**
   * Pages read in full in both runs with a compared pass that differs, in the later run's page
   * order.
   */
  changed: PageChange[];
  /** Pages read in full in both whose compared passes are identical: counted, not shown. */
  same: number;
  /**
   * Pages read in full in one run and not the other, in the later run's page order, then those
   * only the earlier run listed. A page read in neither run isn't here, and neither is one the
   * other run never reached (a completed run has none).
   */
  onlyInOne: OnlyInOnePage[];
  /** environmentDifferences(before, after), shown first when not empty. */
  tools: string[];
  /**
   * Says so when the two runs didn't read the same passes: what each read, and which are compared
   * (the passes both read). Null when they read the same. Shown first, beside `tools`.
   */
  passesNote: string | null;
  /** The section's line. */
  line: string;
  /**
   * The summary's line. When the runs read different passes, it says it speaks for "the passes both
   * runs read", since the note that says which isn't beside it.
   */
  summaryLine: string;
}

/**
 * The body lines of a pass's TXT transcript, as `extractBody` gives them, or null if it can't be
 * read.
 */
type BodyOf = (run: string, slug: string, pass: PassName) => string[] | null;

/** What a page is called in a sentence. */
type PageName = (page: { label?: string; url: string }) => string;

/** Unchanged lines kept on each side of a change. */
const CONTEXT = 2;

/**
 * What each of voicecap's flag rules finds, in words for a reader who hasn't met its id. People
 * hear these read aloud, so none has a comma of its own.
 */
const RULE_FINDS = new Map([
  ["generic-link-text", "the links that don't say where they go"],
  ["unlabeled", "the unnamed controls"],
  ["headings", "the heading structure"],
  ["read-not-finished", "the unfinished read"],
  ["tab-no-stops", "the missing Tab stops"],
  ["tab-before-main", "the Tab stops before the main content"],
  ["repeated-phrase", "the repeated speech"],
]);

/**
 * Compare two runs of the same site, page by page. A page read in full in both is compared pass by
 * pass, over the passes both runs read, on the fingerprint of each pass's TXT body: a pass whose
 * fingerprints agree is never read. `body` gives a pass's body lines, or null when the transcript
 * can't be read here. `name` is how a page is called in the section's line.
 */
export function changesOf(before: RunJson, after: RunJson, body: BodyOf, name: PageName): Changes {
  const earlier = new Map(before.pages.map((page): [string, PageRecord] => [page.key, page]));
  const listed = new Set(after.pages.map((page) => page.key));
  // A pass only one run read has nothing to be compared with.
  const readBefore = passesRead(before);
  const readAfter = passesRead(after);
  const compared = readBefore.filter((pass) => readAfter.includes(pass));
  const changed: PageChange[] = [];
  const onlyInOne: OnlyInOnePage[] = [];
  let same = 0;

  for (const page of after.pages) {
    const was = earlier.get(page.key);
    if (was === undefined) {
      if (page.status === "done") onlyInOne.push({ ...pageRef(page), reason: "new" });
    } else if ((was.status === "done") !== (page.status === "done")) {
      // The run that didn't read the page in full says why. A page still pending there was never
      // reached, which a completed run doesn't have, so there is no reason to give.
      const other = was.status === "done" ? page : was;
      if (other.status === "failed") {
        onlyInOne.push({ ...pageRef(page), reason: "failed in one run" });
      } else if (other.status === "skipped") {
        onlyInOne.push({ ...pageRef(page), reason: "skipped in one run" });
      }
    } else if (page.status === "done" && compared.length > 0) {
      const { passes, unreadable } = comparePasses(compared, [before, was], [after, page], body);
      if (passes.length === 0 && unreadable.length === 0) {
        same += 1;
      } else {
        changed.push({
          ...pageRef(page),
          slug: page.slug,
          passes,
          unreadable,
          flags: flagChanges(was.flags, page.flags, compared),
        });
      }
    }
  }
  for (const page of before.pages) {
    if (!listed.has(page.key) && page.status === "done") {
      onlyInOne.push({ ...pageRef(page), reason: "no longer listed" });
    }
  }

  const note = passesNote(readBefore, readAfter, compared);
  return {
    before,
    after,
    changed,
    same,
    onlyInOne,
    tools: environmentDifferences(before, after),
    passesNote: note,
    ...sentences({
      date: dayMonth(before.createdAt),
      changed,
      same,
      passesCompared: compared.length,
      differentPasses: note !== null,
      name,
    }),
  };
}

/** The passes a run was set to read, in pass order. */
function passesRead(run: RunJson): PassName[] {
  return PASS_NAMES.filter((pass) => run.settings.passes.includes(pass));
}

/**
 * The compared passes of a page, in each run, that differ: those whose lines can be shown, and
 * those whose lines can't be read, which are named and not shown, since a pass with no lines would
 * read as every line of the other run gone or new.
 */
function comparePasses(
  compared: PassName[],
  [earlierRun, was]: [RunJson, PageRecord],
  [laterRun, page]: [RunJson, PageRecord],
  body: BodyOf,
): Pick<PageChange, "passes" | "unreadable"> {
  const passes: PassChange[] = [];
  const unreadable: PassName[] = [];
  for (const pass of compared) {
    // The fingerprint is of the TXT body, so equal fingerprints are equal lines.
    if (was.passes[pass]?.contentSha256 === page.passes[pass]?.contentSha256) continue;
    const old = body(earlierRun.id, was.slug, pass);
    const now = body(laterRun.id, page.slug, pass);
    if (old === null || now === null) unreadable.push(pass);
    else passes.push({ pass, ...diffLines(old, now) });
  }
  return { passes, unreadable };
}

function pageRef(page: PageRecord): { key: string; url: string; label?: string } {
  return {
    key: page.key,
    url: page.url,
    ...(page.label === undefined ? {} : { label: page.label }),
  };
}

/**
 * A page's flags in the two runs, by rule and pass. A flag of a pass only one run read isn't
 * compared, any more than the pass is: the other run never looked for it, so it isn't gone or new.
 * A flag with no pass belongs to the page as a whole.
 */
function flagChanges(
  was: FlagResult[],
  now: FlagResult[],
  compared: PassName[],
): PageChange["flags"] {
  const isCompared = (flag: FlagResult) => flag.pass === undefined || compared.includes(flag.pass);
  const before = was.filter(isCompared);
  const after = now.filter(isCompared);
  const idOf = (flag: FlagResult) => JSON.stringify([flag.rule, flag.pass ?? null]);
  const had = new Set(before.map(idOf));
  const has = new Set(after.map(idOf));
  return {
    resolved: before.filter((flag) => !has.has(idOf(flag))),
    added: after.filter((flag) => !had.has(idOf(flag))),
    unchanged: after.filter((flag) => had.has(idOf(flag))),
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
      // A run keeps context only beside a change: the first run has no change before it, and the
      // last has none after it.
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

/**
 * Runs of unchanged lines, and the changes between them: removed and added lines side by side are
 * one change.
 */
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

/** A run of unchanged lines: its first `head` and last `tail`, and a count for those between. */
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

// What the section and the summary say.

/** The word for each pass in a sentence. */
const PASS_WORDS: Record<PassName, string> = { read: "read", headings: "headings", tab: "Tab" };

/** "the read pass", "the read and Tab passes", "the read, headings, and Tab passes". */
function passList(passes: PassName[]): string {
  if (passes.length === 0) return "no passes";
  const words = names(passes.map((pass) => PASS_WORDS[pass]));
  return `the ${words} ${passes.length === 1 ? "pass" : "passes"}`;
}

/**
 * What the section says first when the two runs didn't read the same passes: what each read, and
 * which are compared. Null when they read the same.
 */
function passesNote(before: PassName[], after: PassName[], compared: PassName[]): string | null {
  if (before.join() === after.join()) return null;
  const read = (passes: PassName[]) =>
    passes.length === 1 ? `only ${passList(passes)}` : passList(passes);
  const comparing =
    compared.length === 0
      ? "no pass is compared"
      : `only ${passList(compared)} ${compared.length === 1 ? "is" : "are"} compared`;
  return `The run before read ${read(before)}, and this one ${read(after)}; ${comparing}.`;
}

/** A flag that is gone from a page: where it was, and what it found. */
interface Resolved {
  page: string;
  /** What the rule finds, or the rule's id when voicecap has no plain name for it. */
  finds: string;
  /** The rule's id, as well, when `finds` is a plain name. */
  rule: string | null;
}

function sentences(input: {
  /** The earlier run's day and month. */
  date: string;
  changed: PageChange[];
  same: number;
  /** How many passes were compared. */
  passesCompared: number;
  /** Whether the runs read different passes, which `passesNote` says. */
  differentPasses: boolean;
  name: PageName;
}): Pick<Changes, "line" | "summaryLine"> {
  const { date, changed, same, passesCompared, differentPasses, name } = input;
  const since = `Since the last run on ${date}:`;
  // The section's line stands under the note that says which passes were compared. The summary's
  // doesn't, so when the passes differ it says whose it speaks for.
  const speaksFor = differentPasses ? " in the passes both runs read," : "";
  if (passesCompared === 0) {
    return {
      line: "No pass was read in both runs, so no page could be compared.",
      summaryLine: `${since} no pass was read in both runs, so no page could be compared.`,
    };
  }
  const pages = changed.length + same;
  if (pages === 0) {
    return {
      line: "No page was read in full in both runs, so none could be compared.",
      summaryLine: `${since} no page was read in full in both runs, so none could be compared.`,
    };
  }
  // Only the pages read in full in both runs were compared, so the line says it of those.
  if (changed.length === 0) {
    return {
      line: "Every page read in full in both runs sounds exactly the same.",
      summaryLine: `${since}${speaksFor} every page read in full in both runs sounds the same.`,
    };
  }

  const sound = (count: number) => (count === 1 ? "sounds" : "sound");
  const count = changed.length;
  const lead =
    `Compared with the run on ${date}: ${count} of ${pages} ` +
    `${pages === 1 ? "page" : "pages"} ${sound(count)} different, ` +
    `and ${same} ${sound(same)} exactly the same.`;
  const pagesSound = count === 1 ? "page sounds" : "pages sound";
  const summary = `${since}${speaksFor} ${count} ${pagesSound} different`;
  const resolved = resolvedFlags(changed, name);
  if (resolved.length === 0) return { line: lead, summaryLine: `${summary}.` };

  // People hear these read aloud, so each says where first, and a semicolon sets one from the next.
  const where = (item: Resolved) => `on ${item.page}, ${item.finds}`;
  const withRule = (item: Resolved) =>
    item.rule === null ? where(item) : `${where(item)} (${item.rule})`;
  const items = resolved.map(where).join("; ");
  const are = resolved.length === 1 ? "this flag is" : "these flags are";
  return {
    line: `${lead} Resolved: ${resolved.map(withRule).join("; ")}.`,
    summaryLine: differentPasses
      ? `${summary}; resolved: ${items}.`
      : `${summary}, and ${are} resolved: ${items}.`,
  };
}

/**
 * The flags gone from each changed page: one for each rule on each page, and none for a rule the
 * page still has in another pass.
 */
function resolvedFlags(changed: PageChange[], name: PageName): Resolved[] {
  return changed.flatMap((page) => {
    const kept = new Set([...page.flags.unchanged, ...page.flags.added].map((flag) => flag.rule));
    const gone = new Set(
      page.flags.resolved.map((flag) => flag.rule).filter((rule) => !kept.has(rule)),
    );
    return [...gone].map((rule): Resolved => {
      const finds = RULE_FINDS.get(rule);
      return finds === undefined
        ? { page: name(page), finds: rule, rule: null }
        : { page: name(page), finds, rule };
    });
  });
}
