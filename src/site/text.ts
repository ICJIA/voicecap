/**
 * The website's fixed text: the words of its page that aren't a report's own. A report's date, who
 * prepared it, and its files' names, sizes, and fingerprints come from the records (./render.ts),
 * and the words that say the same as the shareable page's (what voicecap is, the link to it, who
 * prepared a report) are that page's (../share/text.ts).
 *
 * The wording is the design's. voicecap is a person's review of a website with a real screen
 * reader, sped up, so every report here is a person's, and nothing says otherwise. The functions
 * are for lines with a name or a date in them.
 */
import type { ShareResult } from "../model.js";
import { plural } from "../report/html.js";
import { dateAndTime } from "../share/format.js";
import { ABOUT, MAC_HASH, POWERSHELL_HASH, TOP_TEXT } from "../share/text.js";

/**
 * How many pages NVDA read, as the page's own summary says it: "all 9 pages", "1 page", or "7 of
 * the 9 pages".
 */
function pagesRead({ pages, read }: ShareResult): string {
  if (read === pages) return pages === 1 ? "1 page" : `all ${plural(pages, "page")}`;
  return `${read} of the ${plural(pages, "page")}`;
}

/**
 * A sentence of the page: plain words, commands, which the page sets in the fixed-width font, and
 * links, each with the words it's made of and where it goes. It holds no markup, and nothing in it
 * is escaped: the page escapes each piece as it draws it.
 */
export type Sentence = (string | { code: string } | { link: string; href: string })[];

export const SITE_TEXT = {
  /** The page's title, and its one heading of the first level. */
  title: "Screen reader test results",
  lead: "Each report is a person's review of a website with a real screen reader, sped up by voicecap. Every transcript in a report is what the screen reader said, word for word, and every decision in it is a person's.",
  skip: "Skip to main content",
  /**
   * The label of the bar's navigation, which every page of the website has. Its links are the views'
   * headings, on the website's own page, and the link to the trust page ({@link trust}): the website
   * itself, so the label names that.
   */
  nav: "This website",
  /**
   * The words of the bar's last link, to the trust page. The bar of every page says them, so they're
   * here with the rest of the bar's words, and not with the trust page's own.
   */
  trust: "Can I trust this?",
  /** The three views: each one's heading, which is also its link in the bar, and its lead. */
  views: {
    demo: {
      title: "The demo",
      // The build publishes the demo's own pages in demo-site/, beside the page: the link is
      // relative, and its words are the demo's canonical address, which names the same place.
      lead: [
        "voicecap's report on its own small demo site, as an example of what it makes. The site's pages are at ",
        { link: "voicecap.netlify.app/demo-site/", href: "demo-site/" },
        ".",
      ] satisfies Sentence,
    },
    // The site keeps each site's newest three reports (KEPT_PER_SITE in ./build.ts): the current
    // one, and two before it.
    sites: {
      title: "The sites",
      lead: "Each site's current report, with up to two earlier ones below it.",
    },
    byDate: {
      title: "Every report, by date",
      lead: "Every site's reports, the newest first, each with its page.",
    },
  },
  /** Said in place of the sites' lead, when no report has been shared. */
  noReports: "No reports have been shared yet.",
  /** A report's line: "3 October 2026, 14:05". */
  reportLine: (at: string): string => dateAndTime(at),
  /** What heads a site's newest report, ahead of its line. */
  current: "The current report",
  /**
   * How many pages NVDA read, on a site's current report's card, beside its bar: the line after the
   * verdict's headline (verdictOf in ../share/verdict.ts), which says the problems that need
   * attention and the pages they're on, or that nothing does.
   */
  reading: (result: ShareResult): string => `NVDA read ${pagesRead(result)}.`,
  /**
   * The word after how many sites have reports, beside the sites' heading, where the number is the
   * big part: "2 sites", "1 site".
   */
  siteUnit: (count: number): string => (count === 1 ? "site" : "sites"),
  /** The word after how many reports are listed by date, beside that view's heading: "6 reports". */
  reportUnit: (count: number): string => (count === 1 ? "report" : "reports"),
  /** The link to a site itself, beside its name. */
  visit: "Visit the site",
  /**
   * What a screen reader hears after the link's words, and a reader doesn't see: " at
   * dvfr.illinois.gov, in a new tab". So no two sites' links read alike, and a screen reader knows
   * the site opens in a tab of its own, as the link's arrow shows the eye.
   */
  visitAt: (site: string): string => ` at ${site}, in a new tab`,
  /** Under the current report's line: who prepared it. */
  preparedBy: (by: string): string => `${TOP_TEXT.preparedBy} ${by}`,
  /** The current report's two links: its page, which opens in the browser, and its Word copy. */
  open: "Open the report",
  download: "Download the Word copy",
  /** The heading of a site's reports before its current one, which are a line each. */
  earlier: "Earlier reports",
  /** An earlier report's link to its Word copy, after the one to its page ({@link open}). */
  word: "Word copy",
  /**
   * What a screen reader hears after a report's link, and a reader doesn't see: the site's name and
   * the report's line, " of dvfr.illinois.gov, 3 October 2026, 14:05". So no two links on the page
   * read alike, though each site has an "Open the report".
   */
  of: (site: string, at: string): string => ` of ${site}, ${dateAndTime(at)}`,
  /** The demo's name, in what a screen reader hears after its links: the demo isn't a site. */
  demoName: "the demo",
  /** The fold that holds every report's files, with their sizes and fingerprints. */
  fold: "Files and fingerprints, to check a copy",
  /**
   * In a line of a list, after the report's line (in the fold, and among the earlier reports) or
   * after its site (in the list by date): "prepared by Pat Lee".
   */
  listedBy: (by: string): string => `prepared by ${by}`,
  /** What each kind of file is called. A walkthrough file is of a run, when the record says which. */
  files: {
    page: "The report, to open",
    word: "The Word copy",
    walkthrough: (run: string | null): string =>
      run === null ? "A walkthrough file" : `The walkthrough file of run ${run}`,
    other: "A file",
  },
  /** Before a file's fingerprint, which follows in the fixed-width font. */
  sha256: "SHA-256",
  /** Said of a report that has no walkthrough file, and none that isn't here either. */
  noWalkthrough: "No walkthrough file was shared with this report.",
  /**
   * Said of a file the record names that isn't published, in two cases: it changed since it was
   * shared, or it is missing.
   */
  gone: {
    changed: (name: string): string =>
      `${name} isn't here: it no longer matches the fingerprint recorded when it was shared.`,
    missing: (name: string): string => `${name} isn't here: the file is missing.`,
  },
  /** In a line of the list by date, in place of the link to a report's page that isn't here. */
  pageGone: "its page isn't here",
  /** Under the views: what a file's fingerprint is, and how to check a copy against it. */
  fingerprint: [
    "A file's SHA-256 fingerprint is the one recorded when it was shared, so a copy can be checked against it: ",
    { code: POWERSHELL_HASH },
    " in PowerShell, or ",
    { code: MAC_HASH },
    " on a Mac. PowerShell shows the same letters in capitals.",
  ] satisfies Sentence,
  /** Under the views: what a walkthrough file is for, and the command that uses it. */
  walkthrough: [
    "A walkthrough file repeats its run, with the same pages, passes, and limits: ",
    { code: "npx @icjia/voicecap --walkthrough <file>" },
    ".",
  ] satisfies Sentence,
  /** The footer: what voicecap is, and the words and the address of the link to it. */
  about: ABOUT,
  madeWith: TOP_TEXT.madeWith,
  madeWithLink: TOP_TEXT.madeWithLink,
  github: TOP_TEXT.github,
  /** The theme button says what it switches to. */
  theme: { light: "Light version", dark: "Dark version" },
};
