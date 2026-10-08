/**
 * The words of the website's "Can I trust this?" page (./trust.ts), as its design gives them. The
 * page persuades by showing: who built voicecap, how what it records can be checked, and how it
 * tests itself, so that a manager needn't take one person's tool on trust.
 *
 * Every number and date about voicecap in these words is a fact the page is given (./facts.ts), and
 * none is typed here: a function makes each line that holds one, with `count` for a number,
 * `longDate` for a day, and `dateAndTime` for when the newest report was shared, and a list in
 * words is "A, B, and C", or "A and B" (`names`). The one exception is the law's: its compliance
 * dates are the rule's own, quoted, with a link to it. A fact that isn't there is said not to be,
 * in its place ("not recorded in this build of voicecap"), and no line gives a number it doesn't
 * have. The words "since voicecap 0.11.0", on the card of what each report keeps, are a part of
 * voicecap's history, not a fact of this build: the version whose reports began to keep a
 * screenshot of each page, so a report shared before it has none.
 *
 * The wording is voicecap's, as on every page made for managers: voicecap is a person's review of a
 * website with a real screen reader, sped up; a person hears what NVDA says, reads it, and decides.
 *
 * It holds plain words, and nothing in it is escaped: the page escapes each piece as it draws it. A
 * command is in the fixed-width font (a piece of a `Line`). A link is its words and where it goes;
 * a link to a part of the page, or to the website's own page, is its words alone here, and the page
 * knows where it goes.
 */
import { count, dateAndTime, longDate, names } from "../share/format.js";
import type { Line } from "../share/line.js";
import type { RecordFacts, ReleaseFacts } from "./facts.js";
import { SITE_TEXT } from "./text.js";

/** voicecap's repository on GitHub, where the footer's link goes too. */
const GITHUB = SITE_TEXT.github;

/** voicecap's CHANGELOG, as GitHub shows it. */
const CHANGELOG = `${GITHUB}/blob/main/CHANGELOG.md`;

/** voicecap's package on npm. */
const NPM = "https://www.npmjs.com/package/@icjia/voicecap";

/**
 * What a line says in place of a fact this build of voicecap doesn't have, as a build that wasn't
 * released has no release facts.
 */
const NOT_RECORDED = "not recorded in this build of voicecap";

/** What the stamp says of a website with no report yet, not even the demo's. */
const NO_REPORT = "no report has been shared yet";

/** A day the facts give as YYYY-MM-DD, as the page says it: "9 October 2026". */
const day = (date: string): string => longDate(`${date}T00:00`);

/**
 * What needs attention in the pages counted, at the end of their line: ", where nothing needs
 * attention", ", where 1 problem needs attention", or ", where 3 problems need attention". As
 * voicecap's verdict says it (verdictOf, in ../share/verdict.ts), when NVDA read fewer pages than
 * are in scope, nothing needs attention only "on the pages read".
 */
function attention({ read, pages, problems }: NonNullable<RecordFacts["reading"]>): string {
  if (problems === 0) {
    return read < pages
      ? ", where nothing needs attention on the pages read"
      : ", where nothing needs attention";
  }
  if (problems === 1) return ", where 1 problem needs attention";
  return `, where ${count(problems)} problems need attention`;
}

export const TRUST_TEXT = {
  /** The page's title: the bar's words for the page, then the website's title. */
  title: `${SITE_TEXT.trust} · ${SITE_TEXT.title}`,
  /** What a screen reader hears in place of a big number's "—": a fact this build doesn't have. */
  notRecorded: "not recorded",
  /** The page's banner, and what follows it. */
  hero: {
    /** The page's one heading of the first level, in its banner. */
    heading: "Built to be checked. See for yourself.",
    kicker: "voicecap · a human review, sped up",
    lead: "Every claim on this page can be checked without taking anyone's word for it, the builder's included.",
    /**
     * Where the numbers come from, under the lead: the version and the day it was released, then
     * when the newest report was shared. "voicecap 0.13.2, released 9 October 2026 · records as of
     * 3 October 2026, 14:05".
     */
    stamp: (version: string, released: string | null, newest: string | null): string => {
      const which =
        released === null
          ? `voicecap ${version}, whose release date isn't recorded in this build`
          : `voicecap ${version}, released ${day(released)}`;
      return `${which} · ${newest === null ? NO_REPORT : `records as of ${dateAndTime(newest)}`}`;
    },
  },
  /**
   * The four big numbers: for each, the line under it, which says what it counts, and its link's
   * words. A line follows its number, so it starts with what is counted.
   */
  tiles: {
    tests: {
      line: (tests: ReleaseFacts["tests"] | null): string =>
        tests === null
          ? `tests passed before this release: ${NOT_RECORDED}`
          : `tests passed on ${tests.system} before this release: every one must pass, or nothing is published`,
      link: "How it's tested",
    },
    pages: {
      /** Between the pages NVDA read and the pages in scope: "41 of 41". */
      of: "of",
      /**
       * Which current reports the pages are counted in, and what needs attention in them. With no
       * site's report, there are none yet, whether or not the demo's is there (the demo is no
       * site); with reports none of whose shares says what it found, the pages read aren't
       * recorded in them, whatever the reason (a share from before voicecap 0.12.3, or one whose
       * runs counted no page); and when only some sites' current reports say it, the line says how
       * many of the sites it counted.
       */
      line: ({ sites, reports, reading }: RecordFacts): string => {
        if (reports === 0) {
          return "pages NVDA read in the current reports on this website: no site's report has been shared yet";
        }
        if (reading === null) {
          return "pages NVDA read in the current reports: not recorded in the shares on this website";
        }
        const counted =
          reading.sitesCounted < sites
            ? `, in ${count(reading.sitesCounted)} of its ${count(sites)} sites`
            : "";
        return `pages NVDA read in the current reports on this website${counted}${attention(reading)}`;
      },
      link: "See the reports",
    },
    files: {
      /**
       * One file is "file", and one left out is "it". With none published there is nothing to say
       * "each" of, so the line is only what is counted. Those left out are "missing or changed
       * since they were shared", with files published or with none: the build leaves out a file
       * that no longer matches its fingerprint, and one that's gone, isn't a regular file, or can't
       * be read, which the website's own page calls missing.
       */
      line: ({ published, leftOut }: RecordFacts["files"]): string => {
        const files =
          published === 0
            ? "files on this website"
            : published === 1
              ? "file on this website, matching the fingerprint recorded when it was shared"
              : "files on this website, each matching the fingerprint recorded when it was shared";
        if (leftOut === 0) return files;
        const since = leftOut === 1 ? "since it was shared" : "since they were shared";
        return `${files}; ${count(leftOut)} left out, missing or changed ${since}`;
      },
      link: "How to check a copy",
    },
    releases: {
      /**
       * The public changes since the first, after the releases. A CHANGELOG ships with every
       * package, so one with no release in it wasn't read: the releases aren't recorded, and the
       * page never says there are none.
       */
      line: (releases: number, commits: ReleaseFacts["commits"] | null): string => {
        if (releases === 0) return `releases: ${NOT_RECORDED}`;
        if (commits === null) {
          return `releases, each dated in the CHANGELOG; the public changes behind them are ${NOT_RECORDED}`;
        }
        return `releases, and ${count(commits.count)} public changes, since ${day(commits.first)}: every step on the record`;
      },
      link: "How it got here",
    },
  },
  does: {
    kicker: "what it does",
    heading: "One job: hear a website the way a screen reader user hears it.",
    text: "Many people who are blind or can't see well use a screen reader: software that reads what's on the screen out loud. voicecap has a real screen reader, NVDA, read every page of a website three ways (line by line, heading by heading, and control by control) and saves every word it says. A person then reads what it said, and decides what each page needs. It's a human review, sped up.",
  },
  nvda: {
    kicker: "the screen reader",
    heading: "Real NVDA, not a simulation.",
    text: "voicecap drives NVDA, the free screen reader many blind people use on Windows, and records exactly what it says on each page. Every transcript is NVDA's own words, so what you read is what a screen reader user hears.",
  },
  /**
   * The law's three names, a card each: what kind of rule it is, its name, which is its card's
   * heading and links to its source, and what it says, as the audit tool's trust page says it. Its
   * compliance dates are the rule's own.
   */
  law: {
    kicker: "the law · three names, one idea",
    heading: "Title II. IITAA. WCAG.",
    lead: 'Government information must work for everyone. Two laws say so; one rulebook defines "works."',
    cards: [
      {
        tag: "federal law",
        heading: "Title II of the ADA",
        href: "https://www.ada.gov/resources/2024-03-08-web-rule/",
        words: [
          "The Department of Justice rule for state and local government. It names WCAG 2.1 Level AA as the standard, and its compliance dates are April 26, 2027 for entities serving 50,000 people or more and April 26, 2028 for smaller ones and special districts.",
        ],
      },
      {
        tag: "Illinois law",
        heading: "IITAA",
        href: "https://doit.illinois.gov/initiatives/accessibility.html",
        words: [
          "The Illinois Information Technology Accessibility Act, our state's own accessibility law, older than the federal rule, also built on WCAG 2.1 AA. It applies to Illinois state agencies and universities.",
        ],
      },
      {
        tag: "the rulebook",
        heading: "WCAG",
        href: "https://www.w3.org/WAI/standards-guidelines/wcag/",
        words: [
          "The Web Content Accessibility Guidelines, the international rulebook both laws point to.",
          "For voicecap: what NVDA says is how a screen reader user meets a page, so its transcripts show, word for word, how a page's images, headings, links, and controls come across against that rulebook; the person reviewing decides.",
        ],
      },
    ],
  },
  /** How every word can be checked, a point each, with a link to where each is shown. */
  evidence: {
    kicker: "the evidence",
    heading: "Every word can be checked.",
    sealed: {
      words: [
        "Every transcript and screenshot has a SHA-256 fingerprint. Every run's record is sealed, and every share and every review is chained to the one before it.",
      ] satisfies Line,
      link: { words: "The audit record", href: `${GITHUB}#the-audit-record` },
    },
    verify: {
      words: [
        { text: "voicecap verify", mono: true },
        " checks a whole audit record against its seals and fingerprints.",
      ] satisfies Line,
      link: {
        words: "How to check a record",
        href: `${GITHUB}#checking-the-record-voicecap-verify`,
      },
    },
    browser: {
      words: [
        'Each report checks its own fingerprints in your browser, with no network: open a report and press "Check the fingerprints".',
      ] satisfies Line,
      link: "See the reports",
    },
    /** How many files the website publishes, and leaves out: "11 today, and 2 left out". */
    published: ({ published, leftOut }: RecordFacts["files"]): string =>
      `This website publishes only files that still match the fingerprints recorded when they were shared: ${count(published)} today${leftOut > 0 ? `, and ${count(leftOut)} left out` : ""}.`,
    walkthrough: {
      words: [
        "Each report's walkthrough file repeats its run, page for page, so anyone can run it again and compare.",
      ] satisfies Line,
      link: {
        words: "The walkthrough file",
        href: `${GITHUB}#repeating-a-run-the-walkthrough-file`,
      },
    },
  },
  /**
   * How voicecap tests itself: before a release, and on every change, from what the release
   * recorded.
   */
  tested: {
    kicker: "the tests",
    heading: "It tests itself before every release.",
    /**
     * The checks publish.sh runs, in its order: the lint and the type checks, then every test, then
     * the check that the package installs and runs. With the release's facts, the count and the
     * system are this release's own run's, so the line is of this release; without them, it's what
     * each release does, with no number.
     */
    release: (tests: ReleaseFacts["tests"] | null): string =>
      tests === null
        ? `Before each release: the lint and the type checks, then every test, then a check that the package installs and runs. The count is ${NOT_RECORDED}.`
        : `Before this release: the lint and the type checks, then ${count(tests.passed)} tests passed on ${tests.system}, with ${count(tests.skipped)} skipped, in ${count(tests.files)} files, then a check that the package installs and runs. If one test fails, nothing is published.`,
    /** CI's matrix: the systems it runs on, the Node versions, and how many pairs they make. */
    change: (ci: ReleaseFacts["ci"] | null): string =>
      ci === null
        ? `On every change: the same tests, on every system in its CI; ${NOT_RECORDED}.`
        : `On every change: the same tests on ${names(ci.systems)}, with Node ${names(ci.node)}: ${count(ci.systems.length * ci.node.length)} combinations, and a run of the command line with its replay driver.`,
    /**
     * Only the pages whose tests run axe in both themes and at a phone's width: the shareable
     * page (the report) and the website's own two pages. A run's own report and the demo site's
     * pages aren't checked that way, so no line says every page voicecap writes is.
     */
    axe: "The shareable page (the report you open from this website) and this website itself are checked with axe, an accessibility testing engine, in a real browser, in both themes and at a phone's width.",
    nvda: "A run with real NVDA at a PC comes before any release that changes how voicecap drives NVDA.",
  },
  limits: {
    kicker: "the limits",
    heading: "What it doesn't do.",
    items: [
      "It doesn't decide what's accessible: a person does, from what NVDA said.",
      "It uses NVDA only, for now. VoiceOver on a Mac comes later.",
      "A transcript shows what NVDA said, not what every screen reader would say.",
      "Automated checkers such as axe find what code can find; a person's review finds the rest.",
    ],
  },
  /** The objection that one person built it, answered in six cards. */
  builder: {
    kicker: "the objection",
    heading: '"One person built this."',
    lead: "Built by Christopher Schweda at ICJIA. You don't have to take that on trust:",
    code: {
      heading: "The code is public",
      words:
        "Every line is on GitHub, free under the MIT license, for anyone to read, run, or check.",
      link: { words: "voicecap on GitHub", href: GITHUB },
    },
    reader: {
      heading: "The real screen reader",
      words: "voicecap records NVDA itself, the screen reader people use, not an imitation of one.",
    },
    /** A report shared before voicecap 0.11.0 has no screenshots. */
    record: {
      heading: "Every word on the record",
      words:
        "Each report keeps every transcript, word for word, and, since voicecap 0.11.0, a screenshot of each page NVDA read.",
    },
    fingerprints: {
      heading: "Fingerprints anyone can check",
      words: [
        "A report checks its own files in your browser, and ",
        { text: "voicecap verify", mono: true },
        " checks the whole record.",
      ] satisfies Line,
    },
    tests: {
      heading: (tests: ReleaseFacts["tests"] | null): string =>
        tests === null ? "Its own tests" : `${count(tests.passed)} tests`,
      /**
       * With the release's facts, what this release's computer did: the system is that one's, not
       * every release's.
       */
      words: (tests: ReleaseFacts["tests"] | null): string =>
        tests === null
          ? `Every release passes them first, and CI runs them on every change. Their count is ${NOT_RECORDED}.`
          : `This release passed them first, on ${tests.system}, and CI runs them on every change.`,
    },
    dated: {
      heading: "A public, dated record",
      /**
       * The releases and the public changes since the first, each said not to be recorded when it
       * isn't.
       */
      words: (releases: number, commits: ReleaseFacts["commits"] | null): string => {
        const changes =
          commits === null
            ? null
            : `${count(commits.count)} public changes since ${day(commits.first)}`;
        if (releases === 0) {
          return changes === null
            ? `The releases, and the public changes behind them, are ${NOT_RECORDED}.`
            : `${changes}. The releases are ${NOT_RECORDED}.`;
        }
        if (changes === null) {
          return `${count(releases)} releases, each dated in the CHANGELOG. The public changes behind them are ${NOT_RECORDED}.`;
        }
        return `${count(releases)} releases and ${changes}, each release dated in the CHANGELOG.`;
      },
      link: { words: "The CHANGELOG", href: CHANGELOG },
    },
  },
  /** Every release, the newest first, from the CHANGELOG. */
  releases: {
    kicker: "the record",
    heading: "How it got here.",
    /** A release's day, after its version: "9 October 2026". */
    day,
    /** The fold of the releases after the newest five: "Every earlier release (15)". */
    earlier: (releases: number): string => `Every earlier release (${count(releases)})`,
    /** Said in place of the releases, when the CHANGELOG has none. */
    none: `The releases are ${NOT_RECORDED}.`,
    changelog: { words: "The full CHANGELOG", href: CHANGELOG },
  },
  /** The line of links above the footer, and the version that ends it. */
  links: {
    github: { words: "voicecap on GitHub", href: GITHUB },
    changelog: { words: "The CHANGELOG", href: CHANGELOG },
    npm: { words: "voicecap on npm", href: NPM },
    version: (version: string): string => `voicecap ${version}`,
  },
};
