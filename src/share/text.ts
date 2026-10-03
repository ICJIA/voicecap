/**
 * The shareable page's fixed text: how voicecap works, how it came to be, and the headings, labels,
 * and short lines of each section.
 *
 * These are the words on the page that aren't computed from a run's records. The sentences that are
 * (a section's opening line, a card's title) are built from the model in words.ts, which says them
 * around their numbers and names. Both renderers draw from these two modules, the page now and its
 * Word copy later, so this one holds words and nothing more: the steps' icons are named here and
 * drawn by the renderer, and the only markup is the bold and code in the timeline's cells. A few
 * are functions: for a line (./line.ts) with something in bold, in code, or linked out, which holds
 * those as data, never as markup, or for a sentence with a name or a command in it. What only the
 * Word copy says, the heads of its tables and the labels of their rows, is last, in `WORD_TEXT`.
 *
 * The wording is the design's ("Fixed text: how voicecap works, and how it came to be"), and the
 * owner reads it before each release. voicecap is a person's review with a real screen reader,
 * sped up, so nothing here calls it "automated"; the word appears only for other tools.
 */
import type { PassName } from "../model.js";
import type { OnlyInOnePage } from "./changes.js";
import type { Line } from "./line.js";
import type { Problem } from "./problems.js";

/**
 * The top of the page: the line above the site's name, the labels in the line below its lead (each
 * is followed by what it labels), the words of the link that follows "Made with", and the two
 * addresses the top links to.
 */
export const TOP_TEXT = {
  eyebrow: "Screen reader test results",
  asOf: "As of",
  preparedBy: "Prepared by",
  madeWith: "Made with",
  /** The words of the link that follows `madeWith`, which goes to `github`. */
  madeWithLink: "voicecap",
  siteAddress: "Site address",
  /** Where "voicecap", in "Made with voicecap", links to. */
  github: "https://github.com/ICJIA/voicecap",
  /** Where the screen reader's name links to, when it is NVDA. */
  nvAccess: "https://www.nvaccess.org/",
};

/**
 * The Summary: its heading, the titles of its panels and bars (two of the bars' titles are followed
 * by a phrase that says what the bar counts), the line for no page that needs attention, and the
 * words for what a page's latest result can be.
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
  /**
   * The phrase after that title, which says what each rule's count is. The page sets it beside the
   * title; the Word copy says it in a paragraph of its own, with a capital and a full stop.
   */
  rulesNote: "times each rule was raised, across pages and passes",
  /** Said in place of the rules and their counts, when no flag was raised. */
  noFlagsRaised: "No flags were raised.",
  review: "The human review",
  /**
   * The phrase after that title, which says that each count is out of its total. Each copy says it
   * as it says `rulesNote`.
   */
  reviewNote: "each out of its total",
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
 * "Every page": its heading, what a card says of each pass and of the page's flags, the name of a
 * page's screenshot, and the table of the pages no longer listed.
 */
export const PAGES_TEXT = {
  title: "Every page",
  /** The label of each number on a card: what each pass captured, and how long the page took. */
  captured: { read: "Read", headings: "Headings", tab: "Tab stops", time: "Time" },
  /** What a card says of a pass the shown run didn't read, which is never "0". */
  notRead: "Not read",
  /**
   * What a card says of a time when its record has no words of its own for it, and what goes in
   * front of any line that says a record has nothing but doesn't say so itself (`notRecordedLine`).
   */
  notRecorded: "Not recorded",
  /**
   * What a page's screenshot is called: the page names its picture, or the line that says it wasn't
   * recorded, by it for a screen reader, and the Word copy says it before that line.
   */
  screenshot: "Screenshot",
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

/**
 * "What changed since the last run": its heading, what it says with no earlier run to compare with,
 * the lead before the tools that differ, why a page is in only one of the two runs, what a rule did
 * between them, and the words of a pass's table of lines.
 */
export const CHANGES_TEXT = {
  title: "What changed since the last run",
  /** Said in place of the section, when no earlier run has the same pages. */
  none: "No earlier run with the same pages to compare with.",
  /**
   * The lead before the tools that differ between the two runs, which can make a page sound
   * different alone: its first words are in bold.
   */
  tools: (): Line => [
    { text: "The tools differ between the two runs,", bold: true },
    " so anything that sounds different may come from the tools rather than the site:",
  ],
  /** Why a page is in only one of the two runs, in words that follow the model's reason. */
  reasons: {
    new: "new, not in the run before",
    "no longer listed": "no longer listed, not in the latest run",
    "failed in one run": "failed in one run, read in full in the other",
    "skipped in one run": "skipped in one run, read in full in the other",
  } satisfies Record<OnlyInOnePage["reason"], string>,
  /** What a rule did between the runs, said after the rule's name: "generic-link-text resolved". */
  rules: { resolved: "resolved", fresh: "new" },
  /** The heads of a pass's table of lines: the change, and what NVDA said. */
  head: ["Change", "What NVDA said"],
  /**
   * What a row of that table is: a line the same, a line removed, a line added, and (the mark
   * before its count) a run of lines the same.
   */
  rows: { same: "Same", removed: "Removed", added: "Added", collapsed: "…" },
  /** Said of a pass that sounds different but whose transcript can't be read here. */
  unreadable: (pass: PassName): string =>
    `The ${PASS_WORDS[pass]} pass sounds different, but its transcript couldn't be read here.`,
};

/** Where an error voicecap didn't expect is reported, which a copy links to. */
export const ISSUES_URL = "https://github.com/ICJIA/voicecap/issues";

/** The address as the request to report an error, and the table of kinds, print it. */
const ISSUES_ADDRESS = "github.com/ICJIA/voicecap/issues";

/**
 * "Problems during the runs": its heading, what it says of what's in it, the labels of a problem's
 * questions, the request to report an unexpected error, the words for whether a problem happened
 * again and for a problem with no time, the parts of a problem's record, and the table of kinds.
 */
export const PROBLEMS_TEXT = {
  title: "Problems during the runs",
  /** What the section says of what's in it, when something is. */
  gist: "Every attempt that failed in the runs these results come from is here, with what voicecap recorded about it, word for word: what happened, what voicecap did, whether it happened again, and what it means for the results.",
  /** The labels of a problem's questions, each followed by its answer. */
  questions: {
    happened: "What happened",
    decided: "How the kind was decided",
    did: "What voicecap did",
    again: "Did it happen again?",
    effect: "Effect on the results",
    report: "Report it",
  },
  /** What an unexpected error asks of a reader: to report it, with the address linked. */
  report: (): Line => [
    "This could be a problem in voicecap itself. Please report it, with this record, at ",
    { text: ISSUES_ADDRESS, href: ISSUES_URL },
    ".",
  ],
  /** Said on a problem's line in place of its time, when the run kept none. */
  noTime: "time not recorded",
  /** Whether a problem happened again, in words that stand alone, as a chip's do. */
  again: {
    no: "Didn't happen again",
    same: "Happened again",
    different: "Happened again, in different ways",
    unknown: "Not tried again",
  } satisfies Record<Problem["again"], string>,
  /**
   * A problem's record, word for word: its title, the heads of its table, and what a time says when
   * the run kept none.
   */
  record: {
    title: "The record of this problem, word for word",
    head: ["Time", "From", "What was recorded"],
    noTime: "Not recorded",
  },
  /** The title of the stack an unexpected error left: where in voicecap's code it happened. */
  stack: "Where in voicecap's code it happened",
  /**
   * The table of kinds of problem: its title, what its line says is in it (the number of kinds is
   * the table's), and the heads of its columns.
   */
  kinds: {
    title: "How voicecap tells causes apart",
    inside: (kinds: number): string => `${kinds} kinds of problem, and whose each is`,
    head: ["What happened", "Whose it is", "What voicecap does, and what it means"],
  },
  /** The address where an unexpected error is reported, as the table of kinds prints it. */
  issues: ISSUES_ADDRESS,
};

/** "What these results cover": its heading, and the titles of its two panels. */
export const COVERAGE_TEXT = {
  title: "What these results cover",
  covered: "Covered",
  limits: "Technical limits",
};

/**
 * The commands that show a file's own fingerprint, which both copies name: the sender's `voicecap
 * share` prints it, and whoever receives the file computes it with PowerShell's or the Mac's. The
 * two that a receiver runs are exported because `voicecap share` names them too, in the line it
 * prints for the email that sends the copies: the email and the copies' own check must tell a
 * reader to run the same commands.
 */
const SHARE_COMMAND = "voicecap share";
export const POWERSHELL_HASH = "Get-FileHash <file>";
export const MAC_HASH = "shasum -a 256 <file>";

/**
 * "The evidence behind these results": its heading, what a fingerprint is, what the check proves,
 * what a run's line says it is, the titles of a run's parts, the heads of its tables, and the runs
 * left out.
 */
export const EVIDENCE_TEXT = {
  title: "The evidence behind these results",
  /** What a fingerprint is: its question, which a copy sets in bold, and the answer. */
  fingerprint:
    "What's a fingerprint? A fingerprint (SHA-256) is a code computed from a file's exact contents: change one character, and it changes completely. voicecap took one of every file as it wrote it, so a matching fingerprint shows the file hasn't changed since.",
  /**
   * What the check proves, and what it can't, with the two stronger checks: the file's own
   * fingerprint against the one its sender recorded (`voicecap share` prints it, for the email that
   * sends the file), and `verify`, the command that checks the originals on the transcripts folder.
   */
  proves: (verify: string): Line => [
    { text: "What the check proves:", bold: true },
    " this page is consistent with itself, so the transcripts shown are exactly the ones the sealed records list. It can't prove the page itself wasn't changed, since whoever changed it could change the fingerprints too. For that, compare this file's own fingerprint with the one its sender recorded: ",
    { text: SHARE_COMMAND, mono: true },
    " prints it, ready for the email that sends the file, and ",
    { text: POWERSHELL_HASH, mono: true },
    " in PowerShell, or ",
    { text: MAC_HASH, mono: true },
    " on a Mac, shows it for the file you received. Or run ",
    { text: verify, mono: true },
    " on the transcripts folder.",
  ],
  /** What a run's line says it is: that it completed, and that it was sealed. */
  completed: "completed",
  sealed: "sealed",
  /** The titles of a run's four parts. */
  parts: {
    timeline: "Minute by minute",
    nvdaLog: "NVDA's own log, checked against the transcripts",
    environment: "Test environment",
    fingerprints: "Fingerprints (SHA-256)",
  },
  /** The heads of the table of a run's test environment: what, and what the run recorded. */
  rowsHead: ["What", "What the run recorded"],
  /** The heads of the table of a run's files. */
  filesHead: ["Page", "File", "Size", "SHA-256"],
  /** Said in place of that table, for a run whose record lists no files. */
  noFiles: "This run's record lists no files.",
  /** Before the command that checks a run's files against its record. */
  verify: "To check these against the recorded files, anyone with the transcripts folder runs:",
  /** The runs left out: their title, and why a run is left out. */
  leftOut: {
    title: "Runs left out",
    lead: "These runs aren't counted in any result on this page. A run counts only when it completed, was sealed, and wasn't a replay.",
  },
};

/**
 * "Appendix: every transcript": its heading, what a transcript's heading says of its page, and what
 * it says in place of a transcript's words.
 */
export const APPENDIX_TEXT = {
  title: "Appendix: every transcript",
  /**
   * Between a transcript's pass and its page's address, in its heading: "Read transcript of
   * /about/". The page sets it apart for a screen reader, which reads each heading alone; the Word
   * copy has it in view.
   */
  transcriptOf: "transcript of",
  /** For a transcript with no lines. */
  noLines: "This transcript has no lines.",
  /**
   * For a transcript the run recorded but whose file couldn't be read here, as both copies say it,
   * before its full stop. The page goes on to say what its fingerprint check does with it
   * (`unreadableCheck`).
   */
  unreadable: "This transcript was recorded, but its file couldn't be read here, so it isn't shown",
  /**
   * What the page adds to that sentence, before its full stop: its fingerprint check leaves the
   * transcript out. The Word copy has no check, so it says none of this.
   */
  unreadableCheck: ", and the fingerprint check leaves it out",
  /** For a page whose record lists no transcript files. */
  noFiles: "This run's record lists no transcript files for the page.",
};

/**
 * How voicecap began, and why it exists, in the order the page tells it: `began` first, then `why`,
 * then `usual` and `answer` in the fold beneath. `began` is why it was needed. `why` quotes the
 * study it rests on by its article's headline, once, and `deque` is that article: the renderer
 * links the title where `why` has it, to `url`. The title is the headline word for word, as Deque
 * printed it on 10 March 2021, since a quoted title shown to auditors must be exact.
 */
export const STORY: {
  began: string;
  why: string;
  usual: string;
  answer: string;
  deque: { title: string; url: string };
} = {
  began:
    "voicecap began at the Illinois Criminal Justice Information Authority (ICJIA) with a practical need: more than a dozen websites to review before the April 2027 ADA Title II deadline for accessible digital content. Automated checkers such as axe, Lighthouse, and Pa11y were one half of that review. The other half was to go through every site methodically with a real screen reader, NVDA or VoiceOver, and keep a transcript of what it said.",
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
 * "How voicecap came to be", apart from the story itself (`STORY`), the timeline's rows, and the
 * points worth knowing: its heading, the titles and lines of its two folds, and the timeline's
 * caption and headings.
 */
export const STORY_TEXT = {
  title: "How voicecap came to be",
  /** The fold on the rest of the story: its title, and what its line says is inside. */
  rest: { title: "The rest of the story", inside: "the usual answer, and voicecap's" },
  /** The title of the fold on the points worth knowing (`WORTH_KNOWING`). */
  worth: "A few things worth knowing",
  /**
   * The timeline: its caption, the head of its days, the head of each track (the platform, and the
   * screen reader that goes with it), and what heads the row of what isn't done yet.
   */
  timeline: {
    caption: "From the first line of code to today, on a Windows PC and on a Mac",
    when: "When",
    pc: { name: "Windows PC", reader: "with NVDA" },
    mac: { name: "Mac", reader: "with VoiceOver" },
    next: "Next",
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
    text: "voicecap checks the design of this report's web page with axe in its own tests, with no violations: the automated checker and the listen-through, side by side.",
  },
  {
    title: "Tested itself",
    text: "voicecap's own code is checked by over a thousand tests on Windows, macOS, and Linux with every change.",
  },
];

/** What voicecap is, in the footer. */
export const ABOUT =
  "voicecap is free, open-source software that speeds up a person's review of a website with a real screen reader. It presses the screen reader's keys the way a person would, moves from page to page on its own, and saves every word the screen reader says.";

/**
 * The footer, apart from what voicecap is (`ABOUT`) and when the page was made (`generatedLine`,
 * in words.ts): the address its link to voicecap shows (the link goes to `TOP_TEXT.github`), and
 * the line that names the file and its other copy. Each copy says its own name first, then the
 * other's, both in the fixed-width font. They take the page's file name, then the Word copy's,
 * whichever copy is saying it.
 */
export const FOOTER_TEXT = {
  address: "github.com/ICJIA/voicecap",
  /** The page's line: "This file: current.html. Its Word copy: current.docx." */
  page: (fileName: string, wordName: string): Line => [
    "This file: ",
    { text: fileName, mono: true },
    ". Its Word copy: ",
    { text: wordName, mono: true },
    ".",
  ],
  /** The Word copy's line: "This file: current.docx. Its web page: current.html." */
  word: (fileName: string, wordName: string): Line => [
    "This file: ",
    { text: wordName, mono: true },
    ". Its web page: ",
    { text: fileName, mono: true },
    ".",
  ],
};

/**
 * The Word copy's own words, in a group for each section: where the page draws tiles and bars, the
 * Word copy has tables, and these are the heads of their columns and the labels of their rows. A
 * few say a word of the page's in the Word copy's form ("Without flags", for the page's "without
 * flags"); the rest are the Word copy's alone, such as what it says in place of the page's
 * fingerprint check, which a Word document has none of.
 */
export const WORD_TEXT = {
  /** The Summary: the table of its six numbers, and the three tables that stand in for its bars. */
  summary: {
    /** The heads of the table of the six numbers: the number, and what it counts. */
    numbersHead: ["Number", "What it counts"],
    /** A count out of its total, in that table: "7 of 7". */
    outOf: (part: string, whole: string): string => `${part} of ${whole}`,
    /** The heads of the table of each page's latest result. */
    resultsHead: ["Result", "Pages", "Share"],
    /** What a page's latest result can be, as the label of a row: the page's words, capitalized. */
    results: {
      done: "Without flags",
      flagged: "With flags",
      never: "Never transcribed",
    } satisfies Record<keyof typeof SUMMARY_TEXT.resultWords, string>,
    /** The heads of the table of flags by rule: the rule, how often it was raised, its share. */
    rulesHead: ["Rule", "Times raised", "Share of all flags raised"],
    /** The heads of the table of the human review: what, how many, out of how many, the share. */
    reviewHead: ["What", "Count", "Out of", "Share"],
  },
  /** "How voicecap works": the heads of the table of its six steps. */
  how: {
    stepsHead: ["No.", "Step", "What it means"],
  },
  /**
   * "Every page": where the page has a card for each page, the Word copy has one table. These are
   * the heads of its columns, and what its flags column says of a page that has no transcripts.
   */
  pages: {
    /** The heads of the table of every page, one column for each part of a card. */
    head: ["No.", "Page", "Result", "Flags", "The person's review", "What each pass captured"],
    /**
     * Said in a page's flags cell when it has no transcripts, so that an empty cell never reads as
     * no flags. The page's card has no flags chip for such a page: its result says it wasn't read.
     */
    nothingToFlag: "Nothing was read to flag",
  },
  /**
   * "Problems during the runs": where the page sets a problem's questions and answers as a list,
   * the Word copy has a table. The heads of its other tables (the record, the kinds) and of the
   * changes' are the page's own.
   */
  problems: {
    /** The heads of the table of a problem's questions and answers. */
    questionsHead: ["Question", "Answer"],
  },
  /**
   * "The evidence behind these results": the Word copy has no fingerprint check of its own, so it
   * leaves out the page's (its buttons, its result, its list of every file checked, and what it
   * can prove), and says instead what a reader can check, and that the web page can check the
   * transcripts it shows.
   */
  evidence: {
    /** What a run's line says it is, as a sentence: the page's chips, "completed" and "sealed". */
    status: "Completed and sealed.",
    /** Before the two checks a reader can make. */
    checks: "A Word document can't check itself. Two checks show whether anything has changed:",
    /** The first check: this file's own fingerprint against the one its sender recorded. */
    compare: (): Line => [
      "Compare this file's own fingerprint with the one its sender recorded. ",
      { text: SHARE_COMMAND, mono: true },
      " prints it, ready for the email that sends the file. ",
      { text: POWERSHELL_HASH, mono: true },
      " in PowerShell, or ",
      { text: MAC_HASH, mono: true },
      " on a Mac, shows it for the file you received.",
    ],
    /** The second check: the command that checks the originals, run on the transcripts folder. */
    verify: (command: string): Line => [
      "Run ",
      { text: command, mono: true },
      " on the transcripts folder. It checks every recorded file against its fingerprint, and every sealed record against its seal.",
    ],
    /** That the report's web page can check the transcripts it shows, named by its file's name. */
    webPage: (fileName: string): Line => [
      "This report's web page, ",
      { text: fileName, mono: true },
      ", can also check the transcripts it shows against their fingerprints, in any browser, offline.",
    ],
  },
  /**
   * "How voicecap came to be": the heads of the timeline's table, which has two columns where the
   * page's has three: the page's own word for when, and what happened. A track's label is the page's
   * own head for it (`STORY_TEXT.timeline`).
   */
  story: {
    head: [STORY_TEXT.timeline.when, "What happened"],
  },
  /** The heading the Word copy gives the page's footer, a landmark with no heading on the page. */
  footer: {
    heading: "About this report",
  },
  /**
   * The document itself: its author, when the records name no one who prepared it, and what each
   * page's footer says before its page number ("Grants, as of 30 September 2026").
   */
  document: {
    author: "voicecap",
    footer: (siteName: string, asOf: string): string => `${siteName}, as of ${asOf}`,
  },
};
