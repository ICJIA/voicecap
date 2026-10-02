/**
 * The shareable page's fixed text: how voicecap works, how it came to be, and the headings, labels,
 * and short lines of each section.
 *
 * These are the words on the page that aren't computed from a run's records. The sentences that are
 * (a section's opening line, a card's title) are built from the model in words.ts, which says them
 * around their numbers and names. Both renderers draw from these two modules, the page now and its
 * Word copy later, so this one holds words and nothing more: the steps' icons are named here and
 * drawn by the renderer, and the only markup is the bold and code in the timeline's cells.
 *
 * The wording is the design's ("Fixed text: how voicecap works, and how it came to be"), and the
 * owner reads it before each release. voicecap is a person's review with a real screen reader,
 * sped up, so nothing here calls it "automated"; the word appears only for other tools.
 */
import type { PassName } from "../model.js";

/**
 * The top of the page: the line above the site's name, the labels in the line below its lead (each
 * is followed by what it labels), and the two addresses the top links to.
 */
export const TOP_TEXT = {
  eyebrow: "Screen reader test results",
  asOf: "As of",
  preparedBy: "Prepared by",
  madeWith: "Made with",
  siteAddress: "Site address",
  /** Where "voicecap", in "Made with voicecap", links to. */
  github: "https://github.com/ICJIA/voicecap",
  /** Where the screen reader's name links to, when it is NVDA. */
  nvAccess: "https://www.nvaccess.org/",
};

/**
 * The Summary: its heading, the titles of its panels and bars, the line for no page that needs
 * attention, and the words for what a page's latest result can be.
 */
export const SUMMARY_TEXT = {
  title: "Summary",
  attention: "What needs attention",
  noAttention: "No page has flags or an open issue.",
  complete: "How complete the test was",
  todo: "What's still to do",
  whenHow: "When and how",
  results: "Every page's latest result",
  /** What a page's latest result can be, as the words that follow a count of pages. */
  resultWords: { done: "without flags", flagged: "with flags", never: "never transcribed" },
  rules: "Flags by rule",
  /** Said in place of the rules and their counts, when no flag was raised. */
  noFlagsRaised: "No flags were raised.",
  review: "The human review",
  /** The three counts of the human review, each out of its total. */
  reviewRows: { heard: "Heard live", reviewed: "Transcripts reviewed", fixed: "Issues fixed" },
};

/**
 * "How voicecap works", apart from its lead, its steps, and its band on when to run voicecap: the
 * heading, the sample of what NVDA said on the home page, and the keys it was said at.
 */
export const HOW_TEXT = {
  title: "How voicecap works",
  /** The words of the lead (HOW_LEAD) that are set in bold: that the person reads the transcripts. */
  leadBold: "The person running it reads the transcripts",
  /** The sample's heading; with a sample, the page and how many ways through it follow. */
  heard: "Heard on this site",
  /** How many ways through the page the sample has, by the number of its passes. */
  howMany: ["no ways", "one way", "two ways", "three ways"],
  /**
   * The key each pass presses, and what it goes by: the keys NVDA's users press. Each key is named
   * in words. The mockup drew the first as an arrow, which a screen reader says twice ("downwards
   * arrow, Down Arrow"), and axe can't check the contrast of a character that isn't text.
   */
  ways: {
    read: { key: "Down Arrow", words: "line by line" },
    headings: { key: "H", words: "heading by heading" },
    tab: { key: "Tab", words: "control by control" },
  } satisfies Record<PassName, { key: string; words: string }>,
  /** Under the sample: what its words are, and what each time is. */
  heardNote:
    "NVDA's own words: the first lines of each pass, from the transcripts below. Each time is how long that line took, which includes the wait for NVDA to finish speaking.",
  /** Said in place of the sample, when the home page has no transcripts to take one from. */
  noSample: "Not recorded: no sample of the home page's lines is available.",
};

/** The paragraph that opens "How voicecap works". */
export const HOW_LEAD =
  "Automated checkers read a page's code and test it against rules. voicecap takes a real screen reader through each page the way a person would, and saves every word it says. It can spot-check a large site, zero in on the pages that need attention, or go through a whole small site. The person running it reads the transcripts and fixes what they find. voicecap presses the keys and turns the pages, and NVDA speaks very fast as it goes, so the transcripts are where its words are read.";

/** The six steps, in order. `icon` names the picture the renderer draws beside a step. */
export const HOW_STEPS: {
  icon: "list" | "reader" | "three" | "words" | "person" | "seal";
  title: string;
  text: string;
}[] = [
  {
    icon: "list",
    title: "Every page on the list",
    text: "From the sitemap, or a list of chosen pages (a CSV file). Each page is read once, in full, or listed with the reason it couldn't be. None is missed or done twice, an easy slip when clicking through a site by hand.",
  },
  {
    icon: "reader",
    title: "The real screen reader",
    text: "NVDA itself, never a simulation, with a fresh browser for every page.",
  },
  {
    icon: "three",
    title: "Three ways through each page",
    text: "The keys a person presses to go line by line, heading by heading, and control by control.",
  },
  {
    icon: "words",
    title: "Every word, and a check on every key",
    text: "Each key press and everything the screen reader said, in order. Before and after every key press, voicecap checks that the page still has the screen. If it doesn't, the step is thrown out and the page tried again.",
  },
  {
    icon: "person",
    title: "A person reads and fixes",
    text: "The person running voicecap hears NVDA at work, and says so when the run ends. NVDA speaks very fast during a run, so the transcripts are where its words are read. The person reads them, records what they found, and fixes it. Flags point to moments worth a closer look.",
  },
  {
    icon: "seal",
    title: "A sealed record",
    text: "Every file gets a fingerprint and each run is sealed, so anyone can check that nothing has changed since.",
  },
];

/**
 * The band after the steps. `headline` and `text` read as one passage. The stage with `marked` is
 * the one the band stresses, and the renderer sets it apart.
 */
export const WHEN_TO_RUN: {
  headline: string;
  text: string;
  stages: { title: string; text: string; marked: boolean }[];
} = {
  headline: "When to run voicecap: before the site goes live.",
  text: "And again after a major update. Screen reader users hear the deployed site, so that's the one to listen to.",
  stages: [
    {
      title: "In development",
      text: "Not here, since builds change daily and aren't what users get.",
      marked: false,
    },
    {
      title: "Before launch",
      text: "Run voicecap on the deployed site, as users will get it.",
      marked: true,
    },
    {
      title: "Live",
      text: "Share the results, the report and the sealed record behind it.",
      marked: false,
    },
    {
      title: "After a major update",
      text: "Run it again, on the same pages, compared with the run before.",
      marked: false,
    },
  ],
};

/** What a pass is called as a heading. */
export const PASS_TITLE: Record<PassName, string> = {
  read: "Read",
  headings: "Headings",
  tab: "Tab",
};

/** What a pass is called in a sentence. */
export const PASS_WORDS: Record<PassName, string> = {
  read: "read",
  headings: "headings",
  tab: "Tab",
};

/**
 * "Every page": its heading, what a card says of each pass and of the page's flags, and the table
 * of the pages no longer listed.
 */
export const PAGES_TEXT = {
  title: "Every page",
  /** The label of each number on a card: what each pass captured, and how long the page took. */
  captured: { read: "Read", headings: "Headings", tab: "Tab stops", time: "Time" },
  /** What a card says of a pass the shown run didn't read, which is never "0". */
  notRead: "Not read",
  /** What a card says of a time when its record has no words of its own for it. */
  notRecorded: "Not recorded",
  /** Said of a page that has transcripts and no flags. */
  noFlags: "No flags",
  /** Said of a page whose flags are as its run recorded them, not the current rules'. */
  flagsAsRecorded: "Flags as recorded",
  noLongerListed: "No longer listed",
  noLongerListedLead:
    "Pages that earlier runs tested and the latest page list no longer has, with what the last run that had each one recorded.",
  /** The heads of that table's columns. */
  noLongerListedHead: ["Page", "Last run that had it", "What it recorded"],
};

/** "What the flags found": its heading, and the words of each flagged page's table. */
export const FLAGS_TEXT = {
  title: "What the flags found",
  /** The heads of the table's columns: the rule, what it found, and the lines NVDA spoke. */
  head: ["Rule", "What NVDA showed", "NVDA said"],
  /** Said in place of NVDA's words, for a rule with no line to quote. */
  noLine: "No line to quote",
};

/** "Appendix: every transcript": its heading, and what it says in place of a transcript's words. */
export const APPENDIX_TEXT = {
  title: "Appendix: every transcript",
  /** For a transcript with no lines. */
  noLines: "This transcript has no lines.",
  /** For a transcript the run recorded but whose file couldn't be read here, as the page says it. */
  unreadable:
    "This transcript was recorded, but its file couldn't be read here, so it isn't shown, and the fingerprint check leaves it out.",
  /** For a page whose record lists no transcript files. */
  noFiles: "This run's record lists no transcript files for the page.",
};

/**
 * Why voicecap exists, in the order the page tells it: `why` first, then `usual` and `answer` in
 * the fold beneath. `why` quotes the study it rests on by its article's headline, once, and `deque`
 * is that article: the renderer links the title where `why` has it, to `url`. The title is the
 * headline word for word, as Deque printed it on 10 March 2021, since a quoted title shown to
 * auditors must be exact.
 */
export const STORY: {
  why: string;
  usual: string;
  answer: string;
  deque: { title: string; url: string };
} = {
  why: "Automated checkers find what a machine can test, but only part of the problems. Even by Deque's count (Deque makes axe), its automated tests found 57% of the issues in its audits: “Deque Study Shows Its Automated Testing Identifies 57 Percent of Digital Accessibility Issues, Surpassing Accepted Industry Benchmarks”, March 2021, over 2,000 audits and 13,000 pages. And no checker can say what a page sounds like.",
  usual:
    "The usual answer, a person with a screen reader, page by page, is slow, hard to show afterward, and hard to repeat.",
  answer:
    "voicecap's answer: keep the person and the real screen reader, and take over the slow parts. Working from the list makes the review more thorough than going page by page by hand: every page is accounted for, none is missed or done twice, and each is read the same way, with the same keys in the same order. voicecap is free and open source, from ICJIA (MIT license).",
  deque: {
    title:
      "Deque Study Shows Its Automated Testing Identifies 57 Percent of Digital Accessibility Issues, Surpassing Accepted Industry Benchmarks",
    url: "https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues/",
  },
};

/**
 * One line of the timeline, which has two tracks: a Windows PC with NVDA (`pc`), and a Mac with
 * VoiceOver (`mac`).
 */
export interface TimelineRow {
  /**
   * The day as an ISO date, or null for "Next". Two rows may share a day, and the renderer may
   * join them.
   */
  date: string | null;
  /** The release this row announces, checked against the CHANGELOG; null for none. */
  release: string | null;
  /**
   * Each cell as HTML, which the renderer inserts as it is: `<b>` and `<code>` only, and null for an
   * empty cell. `both` runs across the two tracks, so a row has it or the other two, never both.
   */
  pc: string | null;
  mac: string | null;
  both: string | null;
}

/**
 * How voicecap came to be, from its first line of code through each release, with what isn't done
 * yet last, as "Next", never shown as done. Its facts come from the Git tags and the CHANGELOG, and
 * a test checks every release here against the CHANGELOG's dates, and that every minor release has
 * its line. When a major feature lands, merged or released, its line goes here, and the README says
 * what it does, in the same change.
 */
export const TIMELINE: TimelineRow[] = [
  {
    date: "2026-09-25",
    release: null,
    pc: null,
    mac: null,
    both: "The first line of code.",
  },
  {
    date: "2026-09-26",
    release: "0.1.0",
    pc: null,
    mac: null,
    both: "<b>0.1.0</b>: runs, transcripts, flags, and the report, tried out on recorded runs on Windows, macOS, and Linux.",
  },
  {
    date: "2026-09-27",
    release: "0.2.0",
    pc: "<b>0.2.0</b>: the real NVDA, checked end to end on Windows 11.",
    mac: null,
    both: null,
  },
  {
    date: "2026-09-28",
    release: "0.3.0",
    pc: null,
    mac: null,
    both: "<b>0.3.0</b>: the sealed audit record, and <code>voicecap verify</code> to check it.",
  },
  {
    date: "2026-09-28",
    release: null,
    pc: null,
    mac: "A first trial on a real Mac: VoiceOver taken through a test site three ways, outside voicecap.",
    both: null,
  },
  {
    date: "2026-09-29",
    release: "0.4.0",
    pc: "<b>0.4.0</b>: checks before every run, and a 20-second live test. On a real Windows PC, the checks found four problems, all fixed that day.",
    mac: "<b>0.4.0</b>: setup, the same checks, and the live test with VoiceOver, checked on a real Mac.",
    both: null,
  },
  {
    date: "2026-09-30",
    release: "0.5.0",
    pc: "<b>0.5.0</b>: a guided demo, each failed page tried up to 5 times, and the reviewer's name on every run. The final checks on a real Windows PC passed. Then, for 0.6.0, runs began recording every failed attempt and whose problem it was, the computer they ran on, and whether the person heard NVDA speaking.",
    mac: null,
    both: null,
  },
  {
    date: "2026-10-01",
    release: null,
    pc: null,
    mac: null,
    both: "For 0.6.0, the shareable page: the site's standing, the person's review, and every problem, with a fingerprint check that works offline. Then <code>voicecap preflight</code>, which checks a computer without starting the screen reader.",
  },
  {
    date: "2026-10-02",
    release: "0.6.0",
    pc: null,
    mac: null,
    both: "<b>0.6.0</b>: the shareable page, what each run records for it, and <code>voicecap preflight</code>. A last check on a real Windows PC found that a run didn't end after its closing question, and that NVDA speaks too fast in a run to follow; the first was fixed that day, and the page now says the person heard NVDA speaking, and read the transcripts.",
  },
  {
    date: null,
    release: null,
    pc: "A Word copy of the shareable report, for managers and auditors.",
    mac: "Full runs with VoiceOver, with voicecap's VoiceOver driver.",
    both: null,
  },
];

/** The six "worth knowing" cards. */
export const WORTH_KNOWING: { title: string; text: string }[] = [
  {
    title: "The real screen reader",
    text: "It's the same NVDA a blind visitor uses, never a simulation of one, with a fresh browser for every page, so no page's results depend on the pages before it.",
  },
  {
    title: "No page missed",
    text: "voicecap works through the list itself, and the report counts every page: in scope, read, and any it couldn't read, with the reason. By hand, pages get missed or done twice.",
  },
  {
    title: "Nothing from other windows",
    text: "Before and after every key press, voicecap checks that the page still has the screen. If not, the step is thrown out.",
  },
  {
    title: "Tamper-evident",
    text: "Every file gets a SHA-256 fingerprint, the same kind of check that shows a download wasn't altered.",
  },
  {
    title: "Both kinds of testing",
    text: "voicecap checks this page's design with axe in its own tests, with no violations: the automated checker and the listen-through, side by side.",
  },
  {
    title: "Tested itself",
    text: "voicecap's own code is checked by over a thousand tests on Windows, macOS, and Linux with every change.",
  },
];

/** What voicecap is, in the footer. */
export const ABOUT =
  "voicecap is free, open-source software that speeds up a person's review of a website with a real screen reader. It presses the screen reader's keys the way a person would, moves from page to page on its own, and saves every word the screen reader says.";
