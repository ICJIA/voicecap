/**
 * The words of the website's Technical details page (./technical.ts), as its design gives them:
 * how voicecap works, for auditors and developers, in the shape of the audit tool's technical page.
 * The wording is voicecap's, as on the shareable page and in the README: voicecap is a human
 * review, sped up; a person hears NVDA at work, reads the transcripts, and decides.
 *
 * Every number about voicecap in these words is taken, and none is typed here:
 * - from voicecap's own code, which this module imports: its passes (PASS_NAMES), its built-in flag
 *   rules (BUILT_IN_RULES) and their thresholds, its defaults (DEFAULT_CONFIG), the exit codes of
 *   `voicecap verify` (ExitCode), and what a silent step is written as (NO_SPEECH);
 * - from what the page is given, through a function for each line that holds one: the version and
 *   its day, what its release recorded of its tests, how many shares a site keeps, and what the
 *   records count. A fact that isn't there is said not to be ("not recorded in this build of
 *   voicecap"), and no line gives a number it doesn't have.
 *
 * What's typed is words, and the test of the page holds the names they use to the code: every
 * command it names is one voicecap's command line declares, with its options, every file is in the
 * repository, every rule is a built-in one, and every npm package's license is the one of the
 * package voicecap installs. The stop reasons are typed against the model's (`StopReason`), so a
 * reason added there and not here doesn't compile.
 *
 * Guidepup is named only in the toolchain's rows, as the owner chose: everywhere else, it's
 * voicecap's NVDA driver.
 *
 * It holds plain words, and nothing in it is escaped: the page escapes each piece as it draws it. In
 * a sentence (`Sentence`), a command or a file is a `{ code }` piece, in the fixed-width font, and a
 * link is its words and where it goes. A table's cells are plain strings, where a command or a file
 * is in backticks, which the page sets in the fixed-width font.
 */
import { DEFAULT_CONFIG } from "../config/defaults.js";
import { BUILT_IN_RULES, type BuiltInRule } from "../flags/evaluate.js";
import { PASS_NAMES, type PassName, type StopReason } from "../model.js";
import { plural } from "../report/html.js";
import { count, names } from "../share/format.js";
import { HOW_TEXT, MAC_HASH, POWERSHELL_HASH } from "../share/text.js";
import { NO_SPEECH } from "../transcripts/format.js";
import { ExitCode } from "../util/errors.js";
import type { RecordFacts, ReleaseFacts } from "./facts.js";
import { SITE_TEXT, type Sentence } from "./text.js";
import { TRUST_TEXT } from "./trust-text.js";

/** voicecap's repository on GitHub. */
const GITHUB = SITE_TEXT.github;

/** Where npm shows a package: the package's name follows. */
const NPM = "https://www.npmjs.com/package/";

/** What a line says in place of a fact this build of voicecap doesn't have. */
const NOT_RECORDED = "not recorded in this build of voicecap";

/** A small count in words, as a heading says it: "three". From eleven on, the digits. */
const NUMBER_WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

const inWords = (n: number): string => NUMBER_WORDS[n] ?? count(n);

/** Words NVDA says, each in quotes, as the page quotes them, a choice of them: "a", "b", or "c". */
function eitherOf(list: readonly string[]): string {
  const words = list.map((each) => `"${each}"`);
  if (words.length <= 2) return words.join(" or ");
  return `${words.slice(0, -1).join(", ")}, or ${words.at(-1)}`;
}

/**
 * A time limit from voicecap's config, in words: "30 seconds", "30 minutes", or in milliseconds when
 * it's neither a whole number of minutes nor of seconds.
 */
export function duration(ms: number): string {
  if (ms > 0 && ms % 60_000 === 0) return plural(ms / 60_000, "minute");
  if (ms > 0 && ms % 1_000 === 0) return plural(ms / 1_000, "second");
  return plural(ms, "millisecond");
}

/**
 * The words in a list, each in the fixed-width font, with commas and "and" between them, as words in
 * a list are written: `a`, `b`, and `c`.
 */
function codes(list: readonly string[]): Sentence {
  return list.flatMap((code, index): Sentence => {
    const before =
      index === 0 ? "" : list.length === 2 ? " and " : index === list.length - 1 ? ", and " : ", ";
    return before === "" ? [{ code }] : [before, { code }];
  });
}

/**
 * Why a pass can stop, as the model's `StopReason` lists them, in its order. The object is typed
 * against the model's reasons, so a reason added there and not here, or one here that isn't there,
 * doesn't compile.
 */
const STOP_REASONS = Object.keys({
  "end-reached": true,
  "no-next-heading": true,
  "left-document": true,
  "repeat-limit": true,
  "step-cap": true,
  timeout: true,
  error: true,
} satisfies Record<StopReason, true>);

/** How many ways NVDA goes through a page: one for each pass, in words. */
const WAYS = inWords(PASS_NAMES.length);

/** What NVDA says after the last heading, from the pattern voicecap matches it by. */
const NO_NEXT_HEADING = DEFAULT_CONFIG.phrasing.noNextHeading.replace(/^\^|\$$/g, "");

/** The thresholds of the built-in rules, from voicecap's defaults. */
const { genericLinkText, tabBeforeMain, repeatedPhrase } = DEFAULT_CONFIG.flags;

/** A step of how a run works: its title, then what it says, a paragraph each. */
export interface FlowStep {
  title: string;
  words: Sentence[];
}

/** An entry of the transcripts home's tree: its name, what it holds, and what's in it. */
export interface TreeEntry {
  name: string;
  words: Sentence;
  inside?: TreeEntry[];
}

/** A row of the toolchain's table. */
export interface Tool {
  /** Its name, which links to where it lives: its package on npm, or its source. */
  tool: string;
  /** What it does for voicecap. */
  job: string;
  /** Its license, as its package or its source states it. */
  license: string;
  /** Where in voicecap it's used. */
  where: string;
  /**
   * Its package on npm: one voicecap installs, whose own `license` the row's is held to by a test,
   * or voicecap's own, held to voicecap's package.json.
   */
  npm?: string;
  /** Where its source is, for a tool with no package on npm: NVDA, Chromium, and Node.js. */
  source?: string;
}

export const TECHNICAL_TEXT = {
  /** The page's title, as the website's other pages' are: its kicker's words, then the website's. */
  title: `${SITE_TEXT.technical} · ${SITE_TEXT.title}`,
  /** Above the heading, a few words that say what follows: the page's name, as both bars say it. */
  kicker: SITE_TEXT.technical,
  /** The page's one heading of the first level. */
  heading: "How voicecap works",
  /** Under the heading: what the page is, with a link to the short version, the trust page. */
  lead: [
    "The technical reference, for auditors and developers: how a run works, what it records, how anyone can check the records, and how this website is built. Every claim here can be checked against voicecap's code. For the short version, see ",
    { link: SITE_TEXT.trust, href: "trust.html" },
  ] satisfies Sentence,
  /**
   * Under the lead: the version of voicecap the page is from, and the day it was released, which
   * the page sets in a `time`: "From voicecap 0.15.0, released 9 October 2026." With no day, it says
   * the day isn't recorded.
   */
  stamp: {
    from: (version: string): string => `From voicecap ${version}`,
    released: "released",
    notRecorded: `whose release date is ${NOT_RECORDED}`,
  },
  /** The name of the navigation that links to each part, which its words show too. */
  onThisPage: SITE_TEXT.onThisPage,
  /** The page's parts, in order: each one's id (its heading's), kicker, heading, and words. */
  parts: {
    does: {
      id: "what-voicecap-does",
      kicker: "the method",
      heading: "What voicecap does",
      points: [
        [
          "A human review, sped up. voicecap presses NVDA's keys the way a person would, moves from page to page, and saves every word NVDA says. The person running it hears NVDA at work, reads the transcripts, records what they found, and fixes it.",
        ],
        [
          "The real screen reader, never a simulation: every line of a transcript is what NVDA said.",
        ],
        [
          "Where it runs: real NVDA runs need Windows. Reviews, reports, sharing, this website, and ",
          { code: "voicecap verify" },
          " work on any computer, and hearing a page again with ",
          { code: "voicecap review --replay" },
          " needs Windows or a Mac. VoiceOver on a Mac comes later.",
        ],
      ] satisfies Sentence[],
    },
    run: {
      id: "how-a-run-works",
      kicker: "a run, end to end",
      heading: "How a run works",
      lead: "Each step of a run, in order, to its sealed record, and what follows it: the person's review, sharing, and this website.",
      /** The steps, the last of which says how many shares a site keeps on this website. */
      steps: (kept: number): FlowStep[] => [
        {
          title: "The page list",
          words: [
            [
              "A sitemap, a page list, pages named one by one, or a walkthrough file. It's cleaned up first: one address a page, and pages off the site, or not HTML, left out.",
            ],
          ],
        },
        {
          title: "Quick checks",
          words: [
            [
              "Before NVDA starts. A computer that isn't ready stops the run before anything is written.",
            ],
          ],
        },
        {
          title: "The real tools start",
          words: [
            [
              "voicecap's own copy of NVDA, and Chrome. The person's own NVDA is closed, and started again afterwards.",
            ],
          ],
        },
        {
          title: `Each page, ${WAYS} ways`,
          words: [
            ["A new Chrome, with a new profile, opens the page, and its screenshot is taken."],
            ["The window comes to the front, and NVDA confirms it."],
            [
              `NVDA reads the page ${names(PASS_NAMES.map((pass) => HOW_TEXT.ways[pass].words))}, and every word is saved.`,
            ],
          ],
        },
        {
          title: "Safeguards on every key",
          words: [
            ["Focus is checked before and after each key."],
            [
              "A step during which another window came forward is thrown away, and the page tried again, with earlier tries kept.",
            ],
            [
              "While focus is inside a frame, a switch to another window is noticed only if it lasts until the step ends.",
            ],
            ["Silence is never recorded for a stopped NVDA or a locked screen."],
          ],
        },
        {
          title: "Flags",
          words: [["They point a person at moments worth a closer look."]],
        },
        {
          title: "A sealed record",
          words: [
            [
              "When a run ends at a terminal, voicecap asks whether the person heard NVDA, and Enter means No. The answer goes in the run's record.",
            ],
            [
              "The record is sealed when the run completes, and the report, the shareable page, and its Word copy are written.",
            ],
          ],
        },
        {
          title: "The person's review",
          words: [
            [
              "The person reads the transcripts, and records a decision for each page with ",
              { code: "voicecap review" },
              ".",
            ],
            [
              "They can hear the shareable page's transcripts again, read aloud, with ",
              { code: "voicecap review --replay" },
              ".",
            ],
          ],
        },
        {
          title: "Sharing",
          words: [
            [
              { code: "voicecap share" },
              " makes a dated copy of the shareable page and its Word copy, with each run's walkthrough file, recorded in a sealed, chained ",
              { code: "shares.json" },
              ".",
            ],
          ],
        },
        {
          title: "This website",
          words: [
            [
              { code: "voicecap site" },
              ` publishes each site's newest ${count(kept)} shares, every file checked against its fingerprint.`,
            ],
          ],
        },
      ],
      commands: {
        id: "the-commands",
        heading: "The commands",
        lead: "Each command, in the order a person uses them.",
        columns: ["Command", "What it's for"],
      },
    },
    passes: {
      id: "the-passes",
      kicker: "the screen reader",
      heading: `NVDA's ${WAYS} passes`,
      columns: ["Pass", "Key", "Where it starts", "What ends it"],
      /** For each pass, where it starts and what ends it. Its key is the shareable page's. */
      passes: {
        read: {
          start: "The top of the page, once Ctrl+End has found its last line",
          end: "The last line is said, and the next steps repeat it: NVDA has no message for the end of a page",
        },
        headings: {
          start: "The top of the page",
          end: `NVDA says "${NO_NEXT_HEADING}"`,
        },
        tab: {
          start:
            "Nothing focused. The first Tab goes to the browser itself, so a skip link isn't passed over, and the rest go through NVDA",
          end: "Focus leaves the page, which the browser reports, not NVDA's words",
        },
      } satisfies Record<PassName, { start: string; end: string }>,
      stops: [
        "Every pass also stops at its step cap, or at its repeat limit, and records why it stopped. The reasons are ",
        ...codes(STOP_REASONS),
        ".",
      ] satisfies Sentence,
      caught: {
        heading: "How NVDA's words are caught",
        points: [
          [
            "voicecap's NVDA driver connects to NVDA's Remote Access service, only on the computer running the test, sends each key, and receives what NVDA speaks.",
          ],
          [
            "It silences NVDA before each key, and waits until a second passes with no more speech.",
          ],
          [
            "A step's words are what NVDA said for that key, and a step where NVDA said nothing is written ",
            { code: NO_SPEECH },
            ".",
          ],
          ["The run's record keeps NVDA's settings that differ from NVDA's own defaults."],
        ] satisfies Sentence[],
      },
      defaults: {
        id: "the-defaults",
        heading: "voicecap's defaults",
        lead: "Each can be changed in voicecap's config, by its setting's name.",
        columns: ["Setting", "Default", "What it sets"],
        /** What a step cap sets, for the pass it's of. */
        stepCap: (pass: PassName): string => `The most steps the ${pass} pass takes`,
        repeatLimit: "How many times in a row the same words stop a pass",
        stepMs: "The longest a step may take",
        pageMs: "The longest a page may take",
        pageAttempts: "The tries a page gets, before it's recorded as failed",
        restartEvery: "How many pages go by before NVDA and the browser are started again",
        maxConsecutiveFailures:
          "How many failed pages in a row stop a run, which can then be resumed",
      },
    },
    record: {
      id: "what-a-run-records",
      kicker: "the record",
      heading: "What a run records",
      lead: "The transcripts home, where voicecap keeps every record, and what each part of it holds:",
      tree: [
        {
          name: "<transcripts home>/",
          words: ["Every record voicecap keeps, in a folder of the person's own"],
          inside: [
            {
              name: "<site>/",
              words: ["A folder for each site, named for its host"],
              inside: [
                {
                  name: "<date>/<time>/",
                  words: ["One run"],
                  inside: [
                    {
                      name: "run.json",
                      words: [
                        "The run's record: its settings, each page and every failed try at it, the fingerprints of each page's transcripts and screenshot and of the event log, and, once it completes, its seal",
                      ],
                    },
                    {
                      name: "events.jsonl",
                      words: ["The event log: one line for each event, as it happens"],
                    },
                    {
                      name: "pages/<page>/",
                      words: [
                        ...codes(PASS_NAMES.map((pass) => `${pass}.txt`)),
                        ", each with its ",
                        { code: ".json" },
                        " of every step (the key, the words, and their timing), and ",
                        { code: "screenshot.jpg" },
                      ],
                    },
                    { name: "attempts/", words: ["The earlier tries at a page, kept"] },
                  ],
                },
                { name: "reviews.json", words: ["The review history, by page"] },
                {
                  name: "share/",
                  words: [
                    "The shareable page, its Word copy, the dated copies, the walkthrough files, and ",
                    { code: "shares.json" },
                  ],
                },
              ],
            },
          ],
        },
      ] satisfies TreeEntry[],
      points: [
        [
          "What a run's record of the computer keeps: the system, processor, memory, display, browser window, time zone, language, and versions.",
        ],
        ["What it never keeps: the computer's maker, model, or name, or the account."],
      ] satisfies Sentence[],
    },
    flags: {
      id: "the-flags",
      kicker: "pointers, not verdicts",
      heading: "The flags: what voicecap points out for a person to check",
      rules: {
        id: "the-rules",
        heading: `The ${count(BUILT_IN_RULES.length)} built-in rules`,
        columns: ["Rule", "What it points out"],
      },
      points: [
        [
          "A rule of one's own can be added in voicecap's config: a pattern of NVDA's words, in the passes it names.",
        ],
        ["Flags never fail a page or change the exit code, and they match NVDA's English wording."],
        [
          'On the shareable page, "What needs attention" turns them into cards, with a suggested fix where there is one. The person decides.',
        ],
      ] satisfies Sentence[],
    },
    evidence: {
      id: "fingerprints-and-seals",
      kicker: "the evidence",
      heading: ["Fingerprints, seals, and ", { code: "voicecap verify" }] satisfies Sentence,
      points: [
        [
          "A run's record holds the SHA-256 of each page's transcripts and screenshot, recorded as each is written, and of the event log, recorded at the end of each session. Earlier tries a run kept, its own report, and its comparisons have none. A run also records the SHA-256 of its page list, or of each sitemap it read, and of its config, and ",
          { code: "shares.json" },
          " records each shared copy's.",
        ],
        [
          "A seal is the SHA-256 of a record itself, with its seal left out. Each completed run, manual session, review, and share has one. A completed run's folder is never written again.",
        ],
        [
          "The chains: each review, and each share, carries the seal of the one before it, in one chain of reviews and one of shares for each site's folder.",
        ],
        [
          { code: "voicecap verify" },
          ` checks every seal, every chain, and every file the records list in the home, but not the page list, sitemaps, or config, which aren't in the home. It exits ${ExitCode.ok} when everything matches, ${ExitCode.verifyProblems} when something doesn't.`,
        ],
        [
          "Each report's \"Check the fingerprints\" does the same for the report's own records, in the reader's browser, with nothing sent anywhere.",
        ],
        [
          "What no check can catch: someone who edits a record and seals it, and every record after it, again; and someone who deletes the newest records, or a whole run. The Git history, pushed to a protected branch, shows both.",
        ],
      ] satisfies Sentence[],
    },
    website: {
      id: "this-website",
      kicker: "this website",
      heading: "How this website is built and protected",
      published: {
        heading: "What's published",
        /** How many shares of each site it publishes, from the build. */
        points: (kept: number): Sentence[] => [
          [
            `Each site's newest ${count(kept)} shares, from their sealed `,
            { code: "shares.json" },
            " records only.",
          ],
          ["A file only when its size and SHA-256 are the ones recorded when it was shared."],
          [
            "The pages of voicecap's own demo site, in ",
            { code: "demo-site/" },
            ", from voicecap itself.",
          ],
          ["Anything else is left out, and the build names it."],
        ],
      },
      protection: {
        heading: "How each page is protected",
        points: [
          [
            "Each of the website's own pages, and each report, is one file, and loads nothing from outside.",
          ],
          [
            "Each one's Content Security Policy is made from the SHA-256 of its own style and script, and allows no connection.",
          ],
          [
            "The demo site's pages have their style sheet beside them, and a policy of their own, which allows it and no script.",
          ],
          [
            "The headers voicecap's ",
            { code: "netlify.toml" },
            " asks Netlify for: no indexing, no referrer, no sniffing, no framing, no camera, microphone, location, payment, or USB, HTTPS only, and the same-origin rules.",
          ],
          [
            "Who can see it: ",
            { code: "robots.txt" },
            " asks every crawler away. That's a request, not a lock: anyone with the address can read this website.",
          ],
        ] satisfies Sentence[],
      },
      built: {
        heading: "How it's built",
        /** `command` is the build command voicecap writes into netlify.toml, from its version. */
        points: (command: string): Sentence[] => [
          [
            "Netlify builds it on every push to the transcripts repository, which the README says to keep private.",
          ],
          [
            "The build's command is in the repository's ",
            { code: "netlify.toml" },
            ", which voicecap writes once. From this version, it's ",
            { code: command },
            ".",
          ],
        ],
      },
      now: {
        heading: "This website, now",
        /**
         * What the records count: the reports of the sites, or that no site's report has been shared
         * yet; then the files published, in the trust page's words.
         */
        points: ({ sites, reports, files }: RecordFacts): Sentence[] => [
          [
            reports === 0
              ? "No site's report has been shared yet."
              : `It shows ${plural(reports, "report")} of ${plural(sites, "site")}.`,
          ],
          [TRUST_TEXT.evidence.published(files)],
        ],
      },
    },
    toolchain: {
      id: "the-toolchain",
      kicker: "open source",
      heading: "The toolchain",
      lead: "Each tool voicecap uses, what it does, its license, and where it's used.",
      columns: ["Tool", "Its job", "License", "Where it's used"],
      after:
        "Each npm package's license is that of the package voicecap installs, or, for voicecap itself, of its own package, and voicecap's tests check each. NVDA, Chromium, and Node.js link to their source.",
    },
    privacy: {
      id: "privacy-and-security",
      kicker: "what stays, and what goes",
      heading: "Privacy and security",
      stays: {
        heading: "On the computer running the test",
        points: [
          [
            "Everything a run makes stays there: transcripts, records, screenshots, and reports. voicecap never commits or pushes them: the person does.",
          ],
          ["voicecap talks to NVDA and to Chrome only on the computer running the test."],
        ] satisfies Sentence[],
      },
      goes: {
        heading: "What goes out",
        points: [
          ["Chrome loads each page under test, and what that page loads."],
          [
            "A run with ",
            { code: "--sitemap" },
            ", or ",
            { code: "voicecap list-urls" },
            ", reads the site's sitemap. ",
            { code: "voicecap init" },
            " reads the site's front page, its ",
            { code: "robots.txt" },
            ", and its sitemap, to find its pages.",
          ],
          [
            { code: "voicecap setup" },
            " downloads NVDA's build from GitHub, checked by its SHA-256 (on a Mac, the files VoiceOver needs), and Chromium where Chrome isn't installed.",
          ],
          ["voicecap itself comes from npm, through ", { code: "npx" }, "."],
          ["Nothing else."],
        ] satisfies Sentence[],
      },
      needs: {
        heading: "Nothing voicecap doesn't need",
        points: [
          [
            "No telemetry, analytics, or cookies. A voicecap page stores only the reader's choice of theme, in their browser.",
          ],
          ["No accounts, keys, or passwords, read or stored."],
          [
            "The browser gets a new profile for each page load, deleted after, with sync, background networking, and extensions off, and downloads refused.",
          ],
          [
            "A window's title, which can hold private text, is kept only in the event log, never on a page or in a Word copy.",
          ],
          [
            "An NVDA log from a manual session can hold every keystroke, so voicecap warns, can take typed text out, and keeps the raw copy out of Git.",
          ],
          [
            "Walkthrough files may come from anyone, so they're read with strict limits, and never change NVDA's settings or the browser.",
          ],
          [
            "Where it lives: the transcripts repository, which the README says to keep private, and this website, which is public to anyone with its address.",
          ],
        ] satisfies Sentence[],
      },
    },
    limits: {
      id: "the-limits",
      kicker: "the limits",
      heading: "What it can't do: the limits",
      points: [
        [
          "NVDA speaks very fast during a run, so its words are read in the transcripts, which have every word.",
        ],
        [
          "A run is timing-sensitive: a slow page or a busy computer can change what's said, so runs are compared with care.",
        ],
        [
          "NVDA is voicecap's own copy, with its own settings, in one browser. Real users' versions, settings, and browsers differ.",
        ],
        [
          "NVDA's interface is to be in English: voicecap knows a pass has ended, and raises its flags, by NVDA's English words.",
        ],
        ["The computer is voicecap's during a run, for one voicecap at a time."],
        [
          "While focus is inside a frame, such as an embedded video, map, or form, a switch to another window is noticed only if it lasts until the step ends.",
        ],
        [
          "While a page is open, its browser's debugging port can be reached by other people signed in to the same computer at the same time.",
        ],
        [
          `A page that talks without stopping can time out: voicecap tries it ${plural(DEFAULT_CONFIG.pageAttempts, "time")} in all, then records it as failed.`,
        ],
        ["VoiceOver runs on a Mac come later."],
      ] satisfies Sentence[],
    },
    verify: {
      id: "verify-for-yourself",
      kicker: "check it",
      heading: "Verify for yourself",
      code: {
        heading: "The code that built this website",
        lead: (version: string): string => `At voicecap ${version}'s tag on GitHub:`,
      },
      copy: {
        heading: "How to check a copy you were sent",
        points: [
          [
            { code: POWERSHELL_HASH },
            " in PowerShell, or ",
            { code: MAC_HASH },
            " on a Mac, gives a file's fingerprint, to compare with the one the sender gave. PowerShell shows the same letters in capitals.",
          ],
          [
            { code: "voicecap verify" },
            " checks a copy of the records against their fingerprints and seals.",
          ],
        ] satisfies Sentence[],
      },
      tested: {
        heading: "How this version was tested",
        /** What the release recorded of its tests and of CI, or that it isn't recorded. */
        points: (version: string, release: ReleaseFacts | null): Sentence[] => {
          if (release === null) {
            return [
              [`How this version was tested, and where CI runs its tests, are ${NOT_RECORDED}.`],
            ];
          }
          const { tests, ci } = release;
          return [
            [
              `Before voicecap ${version} was released, ${count(tests.passed)} tests passed on ${tests.system}, with ${count(tests.skipped)} skipped, in ${count(tests.files)} files.`,
            ],
            [
              `On every change, CI runs the same tests on ${names(ci.systems)}, with Node ${names(ci.node)}.`,
            ],
          ];
        },
      },
    },
    related: {
      id: "related-documents",
      heading: "Related documents",
    },
  },
  /**
   * What each built-in rule points out, with its threshold from voicecap's defaults. The record is
   * typed by the rules' ids, so each rule has one, and no other.
   */
  rules: {
    "generic-link-text": `A pass announces generic link text at least ${plural(genericLinkText.minCount, "time")}, such as ${eitherOf(genericLinkText.phrases.slice(0, 3))}, or a link with no name.`,
    unlabeled:
      'A button, a form field, or a graphic announced with no name, or NVDA saying "unlabeled". Form fields count only in the tab pass: in the read pass, NVDA says a field\'s label apart from it.',
    "read-not-finished":
      "The read pass stopped at its step cap, or at its repeat limit, before the page's end.",
    headings: "The page has no headings, or its first heading isn't level 1.",
    "tab-no-stops": "Tab reached nothing that takes focus.",
    "tab-before-main": `${count(tabBeforeMain.maxStops)} or more Tab stops come before the main content, and the first isn't a skip link, judged from what has focus, not from NVDA's words.`,
    "repeated-phrase": `The same words ${count(repeatedPhrase.minRun)} or more times in a row: a possible focus trap, or content repeated that often. The read pass's repeat at the page's end doesn't count.`,
  } satisfies Record<BuiltInRule, string>,
  /**
   * Each command, in the order a person uses them, and what it's for: each subcommand as
   * `voicecap <name>`, and the run by its first option, `voicecap --site <url> …`.
   */
  commands: [
    {
      name: "voicecap preflight",
      job: "Checks the computer it runs on is ready for a run, without starting the screen reader.",
    },
    {
      name: "voicecap setup",
      job: "Installs and checks what voicecap needs on the computer it runs on: on Windows, voicecap's own copy of NVDA, and Chromium where Chrome isn't installed.",
    },
    {
      name: "voicecap doctor",
      job: "Checks the computer it runs on, with a short live test of the screen reader, and prints a summary to paste into a bug report.",
    },
    { name: "voicecap demo", job: "A guided first run, on a demo site that comes with voicecap." },
    {
      name: "voicecap init",
      job: "Asks a few questions and composes a run command, with the option to run it.",
    },
    {
      name: "voicecap list-urls",
      job: "Exports a sitemap as a page list, or drafts a sample to curate.",
    },
    {
      name: "voicecap --site <url> …",
      job: "The run: NVDA reads each page on the list, and every word it says is saved.",
    },
    { name: "voicecap review", job: "Adds a person's decision on a page to its review history." },
    {
      name: "voicecap review --replay",
      job: 'Reads the saved words of the pages "What needs attention" names aloud (every page\'s, with `--all`), at a speed a person can follow, and records each decision.',
    },
    {
      name: "voicecap manual add",
      job: "Imports a hands-on NVDA session for a page, from a Speech Viewer copy or an NVDA log, as a sealed record of its own.",
    },
    {
      name: "voicecap report",
      job: "Writes a site's report, its shareable page, and its Word copy again.",
    },
    {
      name: "voicecap walkthrough",
      job: "Writes a run's walkthrough file, so anyone can repeat the run.",
    },
    {
      name: "voicecap share",
      job: "Makes a dated copy of the shareable page, its Word copy, and each run's walkthrough file, to send, and records them.",
    },
    { name: "voicecap site", job: "Builds this website from the shares." },
    { name: "voicecap verify", job: "Checks the records against their fingerprints and seals." },
  ] satisfies { name: string; job: string }[],
  /** The toolchain, a row each: Guidepup is named here, and nowhere else on the page. */
  toolchain: [
    {
      tool: "NVDA",
      job: "The screen reader that reads each page",
      license: "GPL-2.0",
      where: "A run",
      source: "https://github.com/nvaccess/nvda",
    },
    {
      tool: "Guidepup",
      job: "Starts NVDA, presses its keys, and hears what it says: voicecap's NVDA driver is built on it. On a Mac, it starts VoiceOver for the live test",
      license: "MIT",
      where: "A run, and the live test",
      npm: "@guidepup/guidepup",
    },
    {
      tool: "@guidepup/setup",
      job: "Installs NVDA's build for voicecap, and on a Mac, the files VoiceOver needs",
      license: "MIT",
      where: "`voicecap setup`",
      npm: "@guidepup/setup",
    },
    {
      tool: "Chrome, or Chromium",
      job: "The browser each page opens in, with a new profile each time",
      license: "BSD-3-Clause (Chromium, which Chrome is built on)",
      where: "A run",
      source: "https://github.com/chromium/chromium",
    },
    {
      tool: "Playwright",
      job: "Drives the browser, and installs Chromium where Chrome isn't installed",
      license: "Apache-2.0",
      where: "A run, `voicecap setup`, and voicecap's tests",
      npm: "playwright",
    },
    {
      tool: "Node.js",
      job: "Runs voicecap",
      license: "MIT",
      where: "Every command, and this website's build",
      source: "https://github.com/nodejs/node",
    },
    {
      tool: "commander",
      job: "Reads each command and its options",
      license: "MIT",
      where: "Every command",
      npm: "commander",
    },
    {
      tool: "csv-parse",
      job: "Reads a page list in CSV",
      license: "MIT",
      where: "`--pages`",
      npm: "csv-parse",
    },
    {
      tool: "jsonc-parser",
      job: "Reads a page list in JSON",
      license: "MIT",
      where: "`--pages`",
      npm: "jsonc-parser",
    },
    {
      tool: "fast-xml-parser",
      job: "Reads a sitemap",
      license: "MIT",
      where: "`--sitemap`, and `voicecap list-urls`",
      npm: "fast-xml-parser",
    },
    {
      tool: "picomatch",
      job: "Matches the patterns of `--include` and `--exclude`",
      license: "MIT",
      where: "A run, and `voicecap list-urls`",
      npm: "picomatch",
    },
    {
      tool: "jiti",
      job: "Loads a config written in TypeScript or JavaScript",
      license: "MIT",
      where: "`voicecap.config.ts`",
      npm: "jiti",
    },
    {
      tool: "zod",
      job: "Checks a config, and a walkthrough file",
      license: "MIT",
      where: "Every command that reads one",
      npm: "zod",
    },
    {
      tool: "diff",
      job: "Finds the lines that changed between two runs",
      license: "BSD-3-Clause",
      where: '`--compare`, and the shareable page\'s "What changed since the last run"',
      npm: "diff",
    },
    {
      tool: "docx",
      job: "Writes the Word copy",
      license: "MIT",
      where: "The shareable page's Word copy",
      npm: "docx",
    },
    {
      tool: "axe-core",
      job: "An automated accessibility checker, which voicecap's tests run on the shareable page and on this website, in both themes",
      license: "MPL-2.0",
      where: "voicecap's tests",
      npm: "axe-core",
    },
    {
      tool: "Vitest",
      job: "Runs voicecap's tests",
      license: "MIT",
      where: "voicecap's tests",
      npm: "vitest",
    },
    {
      tool: "TypeScript",
      job: "The language voicecap is written in, built to JavaScript",
      license: "Apache-2.0",
      where: "voicecap's code",
      npm: "typescript",
    },
    {
      tool: "The computer's own voice",
      job: "Reads a page's saved words aloud: System.Speech on Windows, and `say` on a Mac",
      license: "Part of Windows, and of macOS",
      where: "`voicecap review --replay`",
    },
    {
      tool: "voicecap",
      job: "Takes NVDA page by page, saves every word, and makes the reports and this website",
      license: "MIT",
      where: "The computer that runs it, and this website's build",
      npm: "@icjia/voicecap",
    },
  ] satisfies Tool[],
  /** The code that built this website, linked at its version's tag: what each part is, and where. */
  code: [
    { label: "The NVDA driver", path: "src/drivers/" },
    { label: "The passes", path: "src/passes/" },
    { label: "The flags", path: "src/flags/evaluate.ts" },
    { label: "The seals", path: "src/util/hash.ts" },
    { label: "voicecap verify", path: "src/verify.ts" },
    { label: "The website", path: "src/site/" },
  ] satisfies { label: string; path: string }[],
  /** The four related documents, a card each, as the audit tool's: its label, title, and line. */
  related: [
    {
      label: "Trust",
      title: SITE_TEXT.trust,
      line: "The short version: who built voicecap, how what it records can be checked, and how it tests itself.",
      href: "trust.html",
    },
    {
      label: "History",
      title: SITE_TEXT.whatsNew.heading,
      line: "Every release of voicecap, newest first, from its CHANGELOG.",
      href: "whats-new.html",
    },
    {
      label: "Code",
      title: "Source on GitHub",
      line: "voicecap's code, open source under the MIT license: every claim on this page can be checked against it.",
      href: GITHUB,
    },
    {
      label: "Manual",
      title: "The README",
      line: "How to install and run voicecap.",
      href: `${GITHUB}/blob/main/README.md`,
    },
  ] satisfies { label: string; title: string; line: string; href: string }[],
};

/** Where a tool of the toolchain lives: its package on npm, its source, or nowhere (null). */
export function toolHref({ npm, source }: Tool): string | null {
  if (npm !== undefined) return `${NPM}${npm}`;
  return source ?? null;
}

/**
 * The command voicecap writes into netlify.toml to build the website, for `version`: npm reads its
 * minor version (`@0.15`) as the newest release of it. A version that doesn't start with two numbers
 * names none, and the command says `<version>` in its place.
 */
export function buildCommand(version: string): string {
  const minor = /^\d+\.\d+/.exec(version)?.[0] ?? "<version>";
  return `npx --yes @icjia/voicecap@${minor} site --home . --out _site`;
}
