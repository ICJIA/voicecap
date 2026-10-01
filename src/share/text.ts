/**
 * The shareable page's fixed text: how voicecap works, and how it came to be.
 *
 * These are the only words on the page that aren't computed from a run's records, and none of them
 * says anything about a run's results. Both renderers draw from this one module, the page now and
 * its Word copy later, so it holds words and nothing more: the steps' icons are named here and
 * drawn by the renderer, and the only markup is the bold and code in the timeline's cells.
 *
 * The wording is the design's ("Fixed text: how voicecap works, and how it came to be"), and the
 * owner reads it before each release. voicecap is a person's review with a real screen reader,
 * sped up, so nothing here calls it "automated"; the word appears only for other tools.
 */

/** The paragraph that opens "How voicecap works". */
export const HOW_LEAD =
  "Automated checkers read a page's code and test it against rules. voicecap takes a real screen reader through each page the way a person would, and saves every word it says. It can spot-check a large site, zero in on the pages that need attention, or go through a whole small site. The person running it listens along, then reads the transcripts and fixes what they find. voicecap presses the keys and turns the pages, so the person can give the listening their full attention.";

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
    title: "A person listens, reads, and fixes",
    text: "The person running voicecap listens as it reads, and says so when the run ends. Then they read the transcripts, record what they found, and fix it. Flags point to moments worth a second listen.",
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
    "voicecap's answer: keep the person and the real screen reader, and take over the slow parts. Working from the list makes the review more thorough than going page by page by hand: every page is accounted for, none is missed or done twice, and each is heard the same way, with the same keys in the same order. voicecap is free and open source, from ICJIA (MIT license).",
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
    pc: "<b>0.5.0</b>: a guided demo, each failed page tried up to 5 times, and the reviewer's name on every run. The final checks on a real Windows PC passed. Then, for 0.6.0, runs began recording every failed attempt and whose problem it was, the computer they ran on, and whether the person listened.",
    mac: null,
    both: null,
  },
  {
    date: null,
    release: null,
    pc: "<b>0.6.0</b>: the shareable report, a page and a Word copy for managers and auditors.",
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
    text: "This report is itself checked with axe, with no violations: the automated checker and the listen-through, side by side.",
  },
  {
    title: "Tested itself",
    text: "voicecap's own code is checked by over a thousand tests on Windows, macOS, and Linux with every change.",
  },
];

/** What voicecap is, in the footer. */
export const ABOUT =
  "voicecap is free, open-source software that speeds up a person's review of a website with a real screen reader. It presses the screen reader's keys the way a person would, moves from page to page on its own, and saves every word the screen reader says.";
