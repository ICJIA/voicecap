/**
 * The website's fixed text: the words of its page that aren't a report's own. A report's date, who
 * prepared it, and its files' names, sizes, and fingerprints come from the records (./render.ts),
 * and the words that say the same as the shareable page's (what voicecap is, the link to it, who
 * prepared a report) are that page's (../share/text.ts).
 *
 * The wording is the design's. voicecap is a person's review of a website with a real screen
 * reader, sped up, so every report here is a person's, and nothing says otherwise. The functions
 * are for lines with a name, a date, or a count in them.
 */
import { plural } from "../report/html.js";
import { dateAndTime } from "../share/format.js";
import { ABOUT, MAC_HASH, POWERSHELL_HASH, TOP_TEXT } from "../share/text.js";

/**
 * A sentence of the page: plain words, and commands, which the page sets in the fixed-width font.
 * It holds no markup, and nothing in it is escaped: the page escapes each piece as it draws it.
 */
export type Sentence = (string | { code: string })[];

export const SITE_TEXT = {
  /** The page's title, and its one heading of the first level. */
  title: "Screen reader test results",
  lead: "Each report is a person's review of a website with a real screen reader, sped up by voicecap. Every transcript in a report is what the screen reader said, word for word, and every decision in it is a person's.",
  skip: "Skip to main content",
  /** The label of the bar's navigation, whose links are the views' headings. */
  nav: "Views",
  /** The three views: each one's heading, which is also its link in the bar, and its lead. */
  views: {
    demo: {
      title: "The demo",
      lead: "voicecap's report on its own small demo site, as an example of what it makes.",
    },
    sites: { title: "The sites", lead: "Each site's reports, the newest first." },
    byDate: {
      title: "Every report, by date",
      lead: "Every site's reports, the newest first, each with its page.",
    },
  },
  /** Said in place of a view's lead, when no report has been shared. */
  noReports: "No reports have been shared yet.",
  /** A site's count of reports: "1 report", "3 reports". */
  reports: (count: number): string => plural(count, "report"),
  /** A report's line, which heads it: "3 October 2026, 14:05". */
  reportLine: (at: string): string => dateAndTime(at),
  /** Under a report's line: who prepared it. */
  preparedBy: (by: string): string => `${TOP_TEXT.preparedBy} ${by}`,
  /** In a line of the list by date, after the site: "prepared by Pat Lee". */
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
