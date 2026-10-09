/**
 * The website's fixed text: the words of its page that aren't a report's own, and the words of the
 * frame every page of the website has (./frame.ts), its two bars and its way back. A report's date,
 * who prepared it, and its files' names, sizes, and fingerprints come from the records
 * (./render.ts), and the words that say the same as the shareable page's (voicecap's address, who
 * prepared a report) are that page's (../share/text.ts).
 *
 * The wording is the design's. voicecap is a person's review of a website with a real screen
 * reader, sped up, so every report here is a person's, and nothing says otherwise. The functions
 * are for lines with a name, a date, or a version in them.
 */
import type { ShareResult } from "../model.js";
import { plural } from "../report/html.js";
import { dateAndTime, longDate } from "../share/format.js";
import { MAC_HASH, POWERSHELL_HASH, TOP_TEXT } from "../share/text.js";

/** The website's title, which its own page is headed by, and which every page's title ends with. */
const SITE_TITLE = "Screen reader test results";

/**
 * A day the facts give as YYYY-MM-DD, as the website says it: "9 October 2026". The trust page says
 * each release's day so, and so does What's New.
 */
export const day = (date: string): string => longDate(`${date}T00:00`);

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
  title: SITE_TITLE,
  lead: "Each report is a person's review of a website with a real screen reader, sped up by voicecap. Every transcript in a report is what the screen reader said, word for word, and every decision in it is a person's.",
  skip: "Skip to main content",
  /** The website's name, which starts the top bar of every page, as a link to the front page. */
  siteName: "ICJIA Screen Reader Tests",
  /**
   * The label of the top bar's navigation, which every page of the website has. Its links are the
   * website's three other pages: the website itself, so the label names that.
   */
  nav: "This website",
  /**
   * The words of the links to the trust page and to Technical details, in both bars of every page,
   * so they're here with the rest of the bars' words, and not with those pages' own. The link to
   * What's New says that page's heading ({@link whatsNew}).
   */
  trust: "Can I trust this?",
  technical: "Technical details",
  /** The label of the front page's row of links to its views, and of Technical details' list. */
  onThisPage: "On this page",
  /** The three views: each one's heading, which is also its link in "On this page", and its lead. */
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
  /** voicecap on GitHub: the bottom bar links to it, and the pages to its code there. */
  github: TOP_TEXT.github,
  /**
   * The theme button's words, which are its label, since the button is an icon: what it switches to,
   * the light theme while the page is dark, and the dark one while it's light.
   */
  theme: { light: "Switch to the light theme", dark: "Switch to the dark theme" },
  /**
   * The bottom bar's words, after the website's pages': its links to voicecap on GitHub and to its
   * CHANGELOG, and the version of voicecap that built the website, which a reader sees as "v0.15.0"
   * and a screen reader hears as "voicecap version 0.15.0".
   */
  footer: {
    github: "GitHub",
    changelog: "Changelog",
    version: (version: string): string => `v${version}`,
    versionHeard: (version: string): string => `voicecap version ${version}`,
  },
  /** The way back from each of the other pages to the front page, which holds the test results. */
  back: "Back to the test results",
  /**
   * The What's New page (./whats-new.ts): a card for each release of voicecap, from its CHANGELOG.
   * Everything the CHANGELOG says of a release (its version, its day, its headline, its points) is
   * the page's to draw from the facts, so these are only the words around it.
   */
  whatsNew: {
    /** The page's title, as the trust page's is: its heading's words, then the website's title. */
    title: `What's New · ${SITE_TITLE}`,
    /** Above the heading, a few words that say what follows: the page is every release. */
    kicker: "Every release",
    /** The page's one heading of the first level. */
    heading: "What's New",
    lead: "Every release of voicecap, newest first, from its CHANGELOG. The front page shows the newest one.",
    /** A release's day, after its version: "9 October 2026". */
    day,
    /** After the day of the version that built the website, so a reader knows which one it is. */
    current: "the current version",
    /** The link at the end of each card, to the release's entry in the CHANGELOG on GitHub. */
    link: "The full entry in the CHANGELOG",
    /**
     * What a screen reader hears after the link's words, and a reader doesn't see: " for 0.13.1". So
     * no two cards' links sound alike, and the visible words stay the start of what's heard.
     */
    linkFor: (version: string): string => ` for ${version}`,
    /** Said in place of the cards, when the CHANGELOG records no release. */
    none: "No release is recorded in this build of voicecap.",
  },
};
