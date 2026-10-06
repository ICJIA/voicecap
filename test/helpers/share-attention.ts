/**
 * What the tests of "What needs attention" build their pages from: the lines NVDA said of i2i's
 * logo (v3--i2i.netlify.app), on pages built as the model is given them (`pageOf`, `pageFrom`), the
 * passes behind them (`passesOf`), a review of one (`reviewed`), and i2i's 32 pages (`i2iPages`).
 * The model's tests and the words' tests share them, so the words are checked against the cards the
 * model really makes. Pure: the flags are computed by the default rules.
 */
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { evaluateFlags, type FlagRules, type PagePasses } from "../../src/flags/evaluate.js";
import {
  PASS_NAMES,
  type DriverCommand,
  type FlagResult,
  type PassName,
  type ReviewStatus,
  type StopReason,
} from "../../src/model.js";
import type { AttentionPage } from "../../src/share/attention.js";
import type { PageCard } from "../../src/share/cards.js";
import type { PageReview } from "../../src/share/review.js";
import { MAIN_COMMAND } from "../../src/transcripts/format.js";

const rules = DEFAULT_CONFIG.flags;

// What NVDA said of i2i's logo (v3--i2i.netlify.app), from the transcripts of 6 October 2026: on
// the home page, in the header, at its link's Tab stop, and again in the main content; and on each
// biography page, in the header and at its link's Tab stop.
export const HOME_READ_HEADER =
  "banner landmark, same page, link, current page, Unlabeled graphic, i 2i Logo. To get missing image descriptions, open the context menu.";
export const HOME_READ_MAIN = "main landmark, Unlabeled graphic, i 2i logo";
export const HOME_TAB =
  "banner landmark, i 2i Logo. To get missing image descriptions, open the context menu., Unlabeled graphic, INSTITUTE 2 INNOVATE, same page, link, current page";
export const BIO_READ =
  "banner landmark, link, Unlabeled graphic, i 2i Logo. To get missing image descriptions, open the context menu.";
export const BIO_TAB =
  "banner landmark, i 2i Logo. To get missing image descriptions, open the context menu., Unlabeled graphic, INSTITUTE 2 INNOVATE, link";

/** The site the pages here are on. */
const SITE = "https://v3--i2i.netlify.app";

/** What NVDA said in each pass of a page, line by line. A pass not given wasn't read. */
export type Lines = Partial<Record<PassName, string[]>>;

/**
 * A page's passes as a run records them, each ended as the real run ended them ("end-reached"),
 * unless `readStop` says how the read pass stopped. The read pass goes to the last line (Ctrl+End)
 * and back to the first (Ctrl+Home), then down, line by line, to the end, where its last line is
 * said again. Each Tab stop is in the page.
 */
export function passesOf(lines: Lines, readStop: StopReason = "end-reached"): PagePasses {
  const passes: PagePasses = {};
  for (const pass of PASS_NAMES) {
    const said = lines[pass];
    if (said === undefined) continue;
    const last = said.at(-1) ?? "";
    const steps: [DriverCommand, string][] =
      pass === "read"
        ? [
            ["toBottom", last],
            ["toTop", said[0] ?? ""],
            ...said.slice(1).map((line): [DriverCommand, string] => ["nextLine", line]),
            ...(readStop === "end-reached" ? [["nextLine", last] as [DriverCommand, string]] : []),
          ]
        : said.map((line): [DriverCommand, string] => [MAIN_COMMAND[pass], line]);
    passes[pass] = {
      stopReason: pass === "read" ? readStop : "end-reached",
      steps: steps.map(([command, spoken], index) => ({
        n: index + 1,
        command,
        spoken,
        durationMs: 1000,
        offsetMs: (index + 1) * 1000,
        ...(pass === "tab" ? { inDocument: true } : {}),
      })),
    };
  }
  return passes;
}

/** A page's address on the site, without the site's: i2i's home page is "/". */
function pathOf(slug: string): string {
  if (slug === "home") return "/";
  return slug.startsWith("bio-") ? `/biographies/${slug}/` : `/${slug}/`;
}

/** What a page is called on its card. */
function nameOf(slug: string): string {
  if (slug === "home") return "Home";
  const bio = /^bio-(\d+)$/.exec(slug)?.[1];
  return bio === undefined ? `Page ${slug}` : `Biography ${bio}`;
}

/**
 * A page as the model is given it: its card, with `flags` (by default the rules' over its passes,
 * and none for a page with no passes), its review, and its passes. Null passes: NVDA's words aren't
 * here, and the card's flags are as its record has them.
 */
export function pageFrom(
  slug: string,
  passes: PagePasses | null,
  options: {
    flags?: FlagResult[];
    review?: PageReview;
    card?: Partial<PageCard>;
    rules?: FlagRules;
  } = {},
): AttentionPage {
  const flags =
    options.flags ?? (passes === null ? [] : evaluateFlags(passes, options.rules ?? rules));
  const path = pathOf(slug);
  const card: PageCard = {
    key: `${SITE}${path}`,
    slug,
    name: nameOf(slug),
    labeled: true,
    path,
    title: null,
    status: flags.length > 0 ? "flags" : "no-flags",
    statusText: "Transcribed",
    readStopped: null,
    reviewChips: [],
    manual: [],
    counts: null,
    timeMs: null,
    strip: [],
    screenshot: { notRecorded: "Not recorded." },
    from: null,
    failure: null,
    flags,
    flagsAsRecorded: passes === null && flags.length > 0,
    needsAttention: true,
    ...options.card,
  };
  return { card, review: options.review ?? null, passes };
}

/** A page NVDA read line by line, and Tab by Tab. An empty list is a pass it didn't read. */
export function pageOf(
  slug: string,
  read: string[],
  tab: string[],
  review?: PageReview,
): AttentionPage {
  const lines: Lines = {};
  if (read.length > 0) lines.read = read;
  if (tab.length > 0) lines.tab = tab;
  return pageFrom(slug, passesOf(lines), { review });
}

/** A page's review, whose latest entry is `status`, of the transcripts shown unless `changed`. */
export function reviewed(
  status: ReviewStatus,
  options: { note?: string; changed?: boolean } = {},
): PageReview {
  return {
    listened: null,
    latest: {
      status,
      reviewer: "Pat Lee",
      at: "2026-10-06T14:00:00-05:00",
      note: options.note ?? null,
      run: "2026-10-06_0900",
      url: `${SITE}/`,
      files: {},
      content: {},
    },
    changedSinceReview: options.changed ?? false,
    issueFound: status === "issue",
    fixed: status === "fixed",
    manual: [],
  };
}

/** i2i's home page and its 31 biography pages, as NVDA read them. */
export function i2iPages(): AttentionPage[] {
  const bios = Array.from({ length: 31 }, (_, i) => pageOf(`bio-${i + 1}`, [BIO_READ], [BIO_TAB]));
  return [pageOf("home", [HOME_READ_HEADER, HOME_READ_MAIN], [HOME_TAB]), ...bios];
}
