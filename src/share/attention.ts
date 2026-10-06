/**
 * What needs attention. Pure.
 *
 * - **The cards** (`attentionCards`): a card for each problem, across every page it's on: a kind of
 *   flag and what NVDA named ("i 2i Logo", "read more"), a page the latest run couldn't read, a read
 *   that stopped before the page's end, an issue a reviewer found, or a page whose transcripts
 *   changed since its review. Each card says where on the page NVDA said it, in NVDA's own words:
 *   the lines of the shown transcripts that raised its flags (flagItemLines and flagQuotes).
 * - **The line for a page** (`attentionClauses` and `attentionLine`): what a listener hears on a page
 *   that needs attention, in one plain line: its flags, a failure to read it, and an issue a
 *   reviewer found.
 */
import { DEFAULT_CONFIG } from "../config/defaults.js";
import {
  flagItemLines,
  flagQuotes,
  type FlagRules,
  type ItemLine,
  type PagePasses,
} from "../flags/evaluate.js";
import { PASS_NAMES, type FlagResult, type PassName } from "../model.js";
import { normalizeSpeech } from "../passes/steps.js";
import type { PageCard } from "./cards.js";
import { names } from "./format.js";
import type { PageReview } from "./review.js";

/**
 * The kinds of card, in the order cards on as many pages come in: the flags' kinds, the items first,
 * then a page not read, an issue, and a change since a review.
 */
const KINDS = [
  "graphic-generic",
  "graphic-unnamed",
  "button-unnamed",
  "field-unlabeled",
  "unnamed",
  "link-unnamed",
  "link-generic",
  "first-heading",
  "skip-link",
  "tab-nothing",
  "repeated",
  "read-stopped",
  "custom",
  "recorded",
  "unread",
  "issue",
  "changed",
] as const;

export type AttentionKind = (typeof KINDS)[number];

/** The kinds that come from flags: every kind but "unread", "issue", and "changed". */
export const FLAG_KINDS: ReadonlySet<AttentionKind> = new Set(
  KINDS.filter((kind) => kind !== "unread" && kind !== "issue" && kind !== "changed"),
);

/** Where on its pages NVDA said a card's problem: one page part, on every page it's there. */
export interface AttentionPlace {
  /**
   * The page part NVDA named at the line: "header", "main content", "navigation", "footer",
   * "sidebar", "search"; null when it named none.
   */
  part: string | null;
  /**
   * The link or button the item sits in, from its Tab stop: its other words as NVDA said them, and
   * its role; null when none.
   */
  inside: { words: string; role: "link" | "button" } | null;
  /**
   * One line for each pass that heard it here, the first page's, in pass order (read, headings,
   * tab); empty when NVDA's words aren't available.
   */
  said: { pass: PassName; line: string }[];
  /** The pages' slugs, in page order. */
  pages: string[];
  /** The lines matched here, across pages and passes. */
  times: number;
}

export interface AttentionCard {
  /** "need-1", "need-2", ... in card order. */
  id: string;
  kind: AttentionKind;
  /**
   * What NVDA named: a graphic's name as NVDA said it ("i 2i Logo"), the item ("read more", "edit",
   * "graphic"), a repeated phrase, a custom or recorded flag's subject; null for kinds that name
   * nothing.
   */
  subject: string | null;
  /** first-heading: the level NVDA said, else null. */
  level: number | null;
  /** None for a page not read, an issue, and a change since a review. */
  places: AttentionPlace[];
  /**
   * Every page on the card, in page order. detail: an unread page's failure, or an issue's note (""
   * when none); else null.
   */
  pages: { slug: string; name: string; path: string; detail: string | null }[];
  times: number;
}

/**
 * A page as the cards see it: its card, its review, and the passes of its shown transcripts that its
 * flags were computed from. Null passes: NVDA's words aren't here, as for a page with no transcripts
 * and one whose flags are as its record has them (`flagsAsRecorded`).
 */
export interface AttentionPage {
  card: PageCard;
  review: PageReview | null;
  passes: PagePasses | null;
}

/**
 * The cards of what needs attention, from each page in scope, in page order, with the flag rules its
 * flags were computed with.
 *
 * **Which pages give which cards.** A page is settled when its latest review entry is a decision
 * (reviewed, issue, or fixed) about the transcripts shown: the summary's `decided`.
 * - A page with an open issue (a latest entry of "issue") is on a card of its own, with its note.
 * - A page whose transcripts changed since its latest review is on the changed card. That review
 *   settles nothing, so its flags still count, unless it found an issue.
 * - A page the latest run failed on, or never read, with the failure in words, is on the unread
 *   card, with that failure. A page voicecap skipped isn't.
 * - The flags of a page that is neither settled nor an open issue's: a read that stopped before the
 *   page's end (its card's `readStopped`, or a read-not-finished flag) is on the read-stopped card,
 *   once. Its other flags give the kinds below.
 *
 * **The flags' kinds,** where NVDA's words are here: generic-link-text and unlabeled give a card for
 * each thing NVDA named, from each line that raised the flag (flagItemLines, in that flag's pass);
 * headings, tab-before-main, tab-no-stops, and repeated-phrase give their own kinds; any other rule
 * is custom, named by its message. Where they aren't (null passes), each flag is "recorded", named by
 * each item its record found, else by its message; so is a flag of the rules that find items whose
 * lines aren't here, so that no flag is lost.
 *
 * **Grouping:** one card per kind and subject (compared lowercased, with its spaces collapsed), and
 * for first-heading per level too, since each level is a different thing NVDA said; an issue is a
 * card of its own. A card's subject is its first, as NVDA said it. Its places are keyed by the page
 * part each line names, in the order first met.
 *
 * **Order:** most pages first, then in the kinds' order (KINDS), then by the first page.
 */
export function attentionCards(pages: AttentionPage[], rules: FlagRules): AttentionCard[] {
  const groups = new Map<string, [Hit, ...Hit[]]>();
  pages.forEach((page, index) => {
    for (const hit of hitsOf(page, index, rules)) {
      const key = keyOf(hit);
      const group = groups.get(key);
      if (group === undefined) groups.set(key, [hit]);
      else group.push(hit);
    }
  });
  return [...groups.values()]
    .map((hits) => cardOf(hits, pages))
    .sort(
      (a, b) =>
        b.pages.length - a.pages.length ||
        KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) ||
        a.first - b.first,
    )
    .map(({ first: _first, ...card }, index) => ({ id: `need-${index + 1}`, ...card }));
}

/** What one page adds to a card: one line NVDA said, one flag, or the page itself. */
interface Hit {
  kind: AttentionKind;
  subject: string | null;
  level: number | null;
  /** The page's index among the pages given. */
  page: number;
  /** An unread page's failure, or an issue's note; null for the rest. */
  detail: string | null;
  times: number;
  /** Where on the page: null for the kinds with no places (unread, issue, and changed). */
  at: {
    part: string | null;
    /** The line NVDA said there, and its pass; null when there's no line to quote. */
    said: { pass: PassName; line: string } | null;
    inside: AttentionPlace["inside"];
  } | null;
}

/** The kinds of the rules that don't find items, by rule; any rule not here is custom. */
const RULE_KINDS = new Map<string, AttentionKind>([
  ["headings", "first-heading"],
  ["tab-before-main", "skip-link"],
  ["tab-no-stops", "tab-nothing"],
  ["repeated-phrase", "repeated"],
]);

/** The rules that find items, whose lines give each card its subject. */
const ITEM_RULES = new Set(["generic-link-text", "unlabeled"]);

/** What one page adds to the cards. */
function hitsOf(page: AttentionPage, index: number, rules: FlagRules): Hit[] {
  const { card, review } = page;
  // Flags as their record has them have no lines of NVDA's here, whatever passes come with them.
  const passes = card.flagsAsRecorded ? null : page.passes;
  const latest = review?.latest ?? null;
  const changed = review?.changedSinceReview === true;
  const openIssue = latest?.status === "issue";
  const settled = latest !== null && latest.status !== "unreviewed" && !changed;
  const hits: Hit[] = [];
  const pageHit = (kind: AttentionKind, detail: string | null): Hit => ({
    kind,
    subject: null,
    level: null,
    page: index,
    detail,
    times: 1,
    at: null,
  });
  if ((card.status === "failed" || card.status === "never") && card.failure !== null) {
    hits.push(pageHit("unread", card.failure));
  }
  if (openIssue) hits.push(pageHit("issue", latest.note ?? ""));
  if (changed) hits.push(pageHit("changed", null));
  if (settled || openIssue) return hits;

  const stop = card.flags.find((flag) => flag.rule === "read-not-finished");
  if (card.readStopped !== null || stop !== undefined) {
    const line =
      stop === undefined || passes === null ? undefined : flagQuotes(passes, rules, stop)[0];
    hits.push(placedHit("read-stopped", null, null, index, stop?.count ?? 1, line, stop?.pass));
  }
  const flags = card.flags.filter((flag) => flag.rule !== "read-not-finished");
  if (passes === null) return [...hits, ...flags.flatMap((flag) => recordedHits(flag, index))];

  const items = flags.filter((flag) => ITEM_RULES.has(flag.rule));
  const flagged = new Set(items.map((flag) => `${flag.rule}/${flag.pass}`));
  const lines =
    items.length === 0
      ? []
      : flagItemLines(passes, rules).filter((line) => flagged.has(`${line.rule}/${line.pass}`));
  hits.push(...lines.map((line) => itemHit(line, index, rules)));
  for (const flag of flags) {
    if (!ITEM_RULES.has(flag.rule)) {
      hits.push(flagHit(flag, passes, rules, index));
    } else if (!lines.some((line) => line.rule === flag.rule && line.pass === flag.pass)) {
      // Its pass's lines aren't here: the flag is as its record has it.
      hits.push(...recordedHits(flag, index));
    }
  }
  return hits;
}

/** A line an item rule matched, as the card of what it found: its kind and subject, and where. */
function itemHit(line: ItemLine, page: number, rules: FlagRules): Hit {
  const { kind, subject } = itemKind(line, rules);
  return {
    kind,
    subject,
    level: null,
    page,
    detail: null,
    times: 1,
    at: {
      part: partOf(line.spoken),
      said: { pass: line.pass, line: line.spoken },
      // A Tab stop says the link or button the item sits in. The item's own name isn't its words.
      inside: line.pass === "tab" ? insideOf(line.spoken, subject, rules) : null,
    },
  };
}

/**
 * The kind of what an item rule found, with the item lowercased, and its subject: a graphic NVDA
 * names (graphicName) is "graphic-generic", named by that name, and one it doesn't is
 * "graphic-unnamed"; a form field's role is "field-unlabeled" ("radio button" too, though it says
 * "button"); any other button is "button-unnamed"; and anything else is "unnamed". A link with no
 * name is "link-unnamed", and any other link "link-generic", named by its words.
 */
function itemKind(
  line: ItemLine,
  rules: FlagRules,
): { kind: AttentionKind; subject: string | null } {
  const item = lower(line.item);
  if (line.rule === "generic-link-text") {
    return item === NO_NAME
      ? { kind: "link-unnamed", subject: null }
      : { kind: "link-generic", subject: item };
  }
  if (item.includes("graphic")) {
    const name = graphicName(line.spoken, rules);
    return name === null
      ? { kind: "graphic-unnamed", subject: item }
      : { kind: "graphic-generic", subject: name };
  }
  if (FIELDS.has(item)) return { kind: "field-unlabeled", subject: item };
  if (item.includes("button")) return { kind: "button-unnamed", subject: null };
  return { kind: "unnamed", subject: item };
}

/** The form fields the unlabeled rule finds by their role alone. */
const FIELDS = new Set(["edit", "combo box", "check box", "radio button"]);

/**
 * A flag of a rule that finds no items, as its card: its kind, and the first line it quotes
 * (flagQuotes) with its pass. A repeated phrase is named by the phrase, a custom rule by its
 * message, and the first heading has its level.
 */
function flagHit(flag: FlagResult, passes: PagePasses, rules: FlagRules, page: number): Hit {
  const kind = RULE_KINDS.get(flag.rule) ?? "custom";
  const line = flagQuotes(passes, rules, flag)[0];
  const subject =
    kind === "repeated" ? (line ?? null) : kind === "custom" ? tidy(flag.message) : null;
  const level = kind === "first-heading" ? levelOf(flag.message) : null;
  return placedHit(kind, subject, level, page, flag.count ?? 1, line, flag.pass);
}

/** The level a headings flag's message says ("The first heading is level 2, not level 1."). */
function levelOf(message: string): number | null {
  const level = /level (\d+)/.exec(message)?.[1];
  return level === undefined ? null : Number(level);
}

/** A flag's part in a card, at the line it quotes: none when it has none to quote. */
function placedHit(
  kind: AttentionKind,
  subject: string | null,
  level: number | null,
  page: number,
  times: number,
  line: string | undefined,
  pass: PassName | undefined,
): Hit {
  return {
    kind,
    subject,
    level,
    page,
    detail: null,
    times,
    at: {
      part: line === undefined ? null : partOf(line),
      said: line === undefined || pass === undefined ? null : { pass, line },
      inside: null,
    },
  };
}

/**
 * A flag as its record has it, without NVDA's words: a "recorded" card for each item it found, as
 * many times as it found it, or one named by its message when its record lists none.
 */
function recordedHits(flag: FlagResult, page: number): Hit[] {
  const found = flag.found ?? [];
  const subjects =
    found.length > 0
      ? found.map(({ text, count }) => ({ subject: text, times: count }))
      : [{ subject: tidy(flag.message), times: flag.count ?? 1 }];
  return subjects.map(({ subject, times }) => ({
    kind: "recorded",
    subject,
    level: null,
    page,
    detail: null,
    times,
    at: { part: null, said: null, inside: null },
  }));
}

/**
 * The card a page's part belongs on: its kind, its subject compared lowercased with its spaces
 * collapsed, and its level. An issue is a card of its own, so its page is part of its key.
 */
function keyOf(hit: Hit): string {
  const subject = hit.subject === null ? null : lower(normalizeSpeech(hit.subject));
  return JSON.stringify([hit.kind, subject, hit.level, hit.kind === "issue" ? hit.page : null]);
}

/** A card from what its pages add, in page order, with its first page's index to order it by. */
function cardOf(
  hits: [Hit, ...Hit[]],
  pages: AttentionPage[],
): Omit<AttentionCard, "id"> & { first: number } {
  const [first] = hits;
  const indices = inOrder(hits.map((hit) => hit.page));
  return {
    kind: first.kind,
    subject: first.subject,
    level: first.level,
    places: placesOf(hits, (index) => pages[index]?.card.slug ?? ""),
    pages: indices.map((index) => ({
      slug: pages[index]?.card.slug ?? "",
      name: pages[index]?.card.name ?? "",
      path: pages[index]?.card.path ?? "",
      detail: hits.find((hit) => hit.page === index)?.detail ?? null,
    })),
    times: timesOf(hits),
    first: indices[0] ?? first.page,
  };
}

/**
 * A card's places, by the page part each line names, in the order first met: the first non-null
 * `inside` of its Tab stops, and for each pass, the first page's line.
 */
function placesOf(hits: Hit[], slugOf: (index: number) => string): AttentionPlace[] {
  const parts = new Map<
    string | null,
    { page: number; times: number; at: NonNullable<Hit["at"]> }[]
  >();
  for (const { page, times, at } of hits) {
    if (at === null) continue;
    const here = parts.get(at.part);
    if (here === undefined) parts.set(at.part, [{ page, times, at }]);
    else here.push({ page, times, at });
  }
  return [...parts].map(([part, here]) => ({
    part,
    inside: here.find(({ at }) => at.inside !== null)?.at.inside ?? null,
    said: PASS_NAMES.flatMap((pass) => {
      const said = here.find(({ at }) => at.said?.pass === pass)?.at.said;
      return said ? [said] : [];
    }),
    pages: inOrder(here.map(({ page }) => page)).map(slugOf),
    times: timesOf(here),
  }));
}

/** Pages' indices, each once, in page order. */
function inOrder(indices: number[]): number[] {
  return [...new Set(indices)].sort((a, b) => a - b);
}

function timesOf(parts: { times: number }[]): number {
  return parts.reduce((sum, { times }) => sum + times, 0);
}

/**
 * Chrome's hint after an image it counts as having no name, in English: "To get missing image
 * descriptions, open the context menu." It follows the image's name, when it has one.
 */
const HINT = "to get missing image descriptions";

/** The hint's second item. */
const CONTEXT_MENU = "open the context menu";

/** Where a link goes, as NVDA says it beside the link: never the link's own words. */
const LINK_PLACES = new Set(["same page", "current page", "visited"]);

/** The page parts NVDA names, by the landmark it says. */
const PARTS = new Map([
  ["banner landmark", "header"],
  ["main landmark", "main content"],
  ["navigation landmark", "navigation"],
  ["content info landmark", "footer"],
  ["complementary landmark", "sidebar"],
  ["search landmark", "search"],
]);

/**
 * NVDA's speech as items: on one line (normalizeSpeech), split at ", " (within an utterance) and
 * ". " (between utterances), each without a final "." or ",", in its own capitals, and with no empty
 * item. The flag rules split speech the same way, then lowercase it.
 */
export function speechItems(spoken: string): string[] {
  return normalizeSpeech(spoken)
    .split(/, |\. /)
    .map((item) => item.replace(/[.,]$/, ""))
    .filter((item) => item !== "");
}

/**
 * The name NVDA said for a graphic, as it said it, or null when it said none. Its items
 * (speechItems) are compared lowercased; the graphic item is the first that contains "graphic".
 * - Chrome's hint follows the name of an image whose name it counts as missing: the item before an
 *   item that starts with the hint is the name, unless it's the graphic item ("…, Unlabeled graphic,
 *   i 2i Logo. To get missing image descriptions, …", and at a Tab stop, "i 2i Logo. To get missing
 *   image descriptions, …, Unlabeled graphic, …").
 * - Otherwise, the item right after the graphic item is the name ("Unlabeled graphic, i 2i logo"),
 *   unless it starts with the hint, or is a landmark, a state (rules.unlabeled.stateItems), a link's
 *   role (rules.genericLinkText.linkRoles), or "button".
 * `rules` gives the states and links' roles: the default config's, unless a caller gives its own.
 */
export function graphicName(
  spoken: string,
  rules: FlagRules = DEFAULT_CONFIG.flags,
): string | null {
  const list = speechItems(spoken);
  const said = list.map(lower);
  const graphic = said.findIndex((item) => item.includes("graphic"));
  const hinted = said.findIndex((item, i) => i > 0 && item.startsWith(HINT) && i - 1 !== graphic);
  if (hinted !== -1) return list[hinted - 1] ?? null;
  if (graphic === -1) return null;
  const after = said[graphic + 1];
  if (after === undefined || after.startsWith(HINT) || neverAName(after, rules)) return null;
  return list[graphic + 1] ?? null;
}

/** An item NVDA says around a name that is never one: a landmark, a state, or a role. */
function neverAName(item: string, rules: FlagRules): boolean {
  const { states, linkRoles } = wordsOf(rules);
  return isLandmark(item) || states.has(item) || linkRoles.has(item) || item === "button";
}

/**
 * The link or button an item sits in, from its Tab stop (`spoken`): its other words, as NVDA said
 * them, joined by ", ", and its role. Its other words are the stop's items without its landmarks,
 * its states (rules.unlabeled.stateItems), where a link goes ("same page", "current page",
 * "visited"), the graphic item, the item's name (`name`), Chrome's hint, and the role itself. The
 * role is "link" when a link's role (rules.genericLinkText.linkRoles) was among the items, else
 * "button" when "button" was. Null with no such role, or no words left.
 */
export function insideOf(
  spoken: string,
  name: string | null,
  rules: FlagRules = DEFAULT_CONFIG.flags,
): AttentionPlace["inside"] {
  const { states, linkRoles } = wordsOf(rules);
  const list = speechItems(spoken);
  const said = list.map(lower);
  const graphic = said.findIndex((item) => item.includes("graphic"));
  const named =
    name === null ? -1 : said.findIndex((item, i) => i !== graphic && item === lower(name));
  const role = said.some((item) => linkRoles.has(item))
    ? "link"
    : said.includes("button")
      ? "button"
      : null;
  const words = list.filter((_, i) => {
    const item = said[i] ?? "";
    return !(
      i === graphic ||
      i === named ||
      isLandmark(item) ||
      states.has(item) ||
      LINK_PLACES.has(item) ||
      item.startsWith(HINT) ||
      item === CONTEXT_MENU ||
      linkRoles.has(item) ||
      item === "button"
    );
  });
  return role === null || words.length === 0 ? null : { words: words.join(", "), role };
}

/**
 * The page part a line names: its first item that ends in " landmark", as a part ("banner
 * landmark" is the header); null when it names no landmark, or one that's no part here.
 */
function partOf(spoken: string): string | null {
  const landmark = speechItems(spoken)
    .map(lower)
    .find((item) => item.endsWith(" landmark"));
  return (landmark === undefined ? undefined : PARTS.get(landmark)) ?? null;
}

/** An item NVDA says for a landmark: "banner landmark". */
function isLandmark(item: string): boolean {
  return /(^| )landmark$/.test(item);
}

/** The states, and the roles a link is said with, that `rules` know, lowercased. */
function wordsOf(rules: FlagRules): { states: Set<string>; linkRoles: Set<string> } {
  return {
    states: new Set(rules.unlabeled.stateItems.map(lower)),
    linkRoles: new Set(rules.genericLinkText.linkRoles.map(lower)),
  };
}

function lower(text: string): string {
  return text.toLowerCase();
}

/** The rules that find items, and what the line says of the items each found. */
type FindingRule = "generic-link-text" | "unlabeled";

/** What a link with no name is called in `FlagResult.found`. NVDA says only "link" for it. */
const NO_NAME = "(no name)";

/**
 * Why the latest run couldn't read a page: what kind of failure stopped it, in words ("another
 * window took the screen"), "" when the record doesn't say; and the earlier run whose transcripts
 * the page shows, or null when no run read it.
 */
export interface ReadFailure {
  kind: string;
  shownFrom: string | null;
}

/**
 * "<what>; <what>": a clause for each rule the page's flags raised, in the order the flags first
 * raise them, then a clause for a failure, then one for an issue. Empty when there is nothing to
 * say.
 *
 * `failure` is why the latest run couldn't read the page (see ReadFailure), and null when it read
 * it. `issueNote` is the note of the issue a reviewer found and no one has fixed, "" when the review
 * has no note, and null when the page has no open issue.
 *
 * A rule raised in more than one pass is one clause, since the passes hear the same page: the links
 * the read pass and the Tab pass both hear are counted once. A flag from a record that has no list
 * of what it found gives its own message.
 */
export function attentionClauses(
  flags: FlagResult[],
  failure: ReadFailure | null,
  issueNote: string | null,
): string {
  const clauses = new Set<string>(flags.map((flag) => flagClause(flag, flags)));
  if (failure !== null) clauses.add(failureClause(failure));
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
  failure: ReadFailure | null,
  issueNote: string | null,
): string {
  const clauses = attentionClauses(flags, failure, issueNote);
  return clauses === "" ? name : `${name}: ${clauses}`;
}

/**
 * A failure as a clause: a page no run read "couldn't be read after every attempt"; one an earlier
 * run read is said to be the latest run's failure, with the run its transcripts are from.
 */
function failureClause({ kind, shownFrom }: ReadFailure): string {
  const why = kind === "" ? "" : ` (${kind})`;
  return shownFrom === null
    ? `it couldn't be read after every attempt${why}`
    : `the latest run couldn't read it${why}; its transcripts are from run ${shownFrom}`;
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
  // Items, not controls: the rule finds graphics and other unnamed things too.
  return `${count === 1 ? "1 item has no name" : `${count} items have no names`}, so NVDA says ${only}`;
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
