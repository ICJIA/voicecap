import os from "node:os";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { evaluateFlags } from "../src/flags/evaluate.js";
import type { ManualSessionFile } from "../src/manual/list.js";
import type {
  FlagResult,
  MachineRecord,
  ManualSessionJson,
  PassName,
  ReviewEntry,
  ReviewStatus,
  ReviewsFile,
  RunJson,
  SkipReason,
} from "../src/model.js";
import { pageSlug } from "../src/pages/slug.js";
import { canonicalKey } from "../src/pages/url.js";
import { pageName } from "../src/report/model.js";
import { attentionClauses, attentionLine } from "../src/share/attention.js";
import { changesOf, type Changes } from "../src/share/changes.js";
import { problemsOf } from "../src/share/problems.js";
import { reviewOf } from "../src/share/review.js";
import { standingOf, type Standing } from "../src/share/standing.js";
import { summaryOf, type Summary } from "../src/share/summary.js";
import { findPage, SITE } from "./helpers/report-data.js";
import {
  failedAttempt,
  shareRun,
  type SharePageSpec,
  type ShareSessionSpec,
} from "./helpers/share-data.js";
import { demoRun } from "./helpers/share-fixture.js";

const CHRIS = "Christopher Schweda";
const PAT = "Pat Lee";
const SAM = "Sam Roe";

/** The page's date: reviews are read as of it. Runs are made on 26 September, reviews that day too. */
const AS_OF = "2026-09-27T09:00:00-05:00";
const REVIEWED_AT = "2026-09-26T16:00:00-05:00";

/** The seven pages of the demo site, each with the name a sentence calls it. */
const PAGES: [path: string, label: string][] = [
  ["/", "Home"],
  ["/before-you-start/", "Before you start"],
  ["/how-a-run-works/", "How a run works"],
  ["/reading-transcripts/", "Reading transcripts"],
  ["/the-report/", "The report"],
  ["/ask-a-question/", "Ask a question"],
  ["/common-mistakes/", "Common mistakes"],
];

/** The pages' paths, to review each of them. */
const PATHS = PAGES.map(([path]) => path);

const NO_REVIEWS: ReviewsFile = { schemaVersion: 1, pages: {} };

const options = { home: os.homedir(), platform: process.platform };

/**
 * A run of the seven pages on 26 September. Each page has a line in every pass, so it has a
 * fingerprint a review can agree with; `page` says what else a page has.
 */
function sevenPages(
  settings: {
    id?: string;
    createdAt?: string;
    sessions?: ShareSessionSpec[];
    voicecapVersion?: string;
    page?: (path: string) => Partial<SharePageSpec>;
  } = {},
): RunJson {
  const { id = "r1", createdAt, sessions, voicecapVersion, page } = settings;
  return shareRun({
    id,
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(sessions === undefined ? {} : { sessions }),
    ...(voicecapVersion === undefined ? {} : { voicecapVersion }),
    pages: PAGES.map(([path, label]) => ({
      path,
      label,
      passes: { read: [`Read ${path}`], headings: [`Headings ${path}`], tab: [`Tab ${path}`] },
      ...page?.(path),
    })),
  });
}

/** The same page of a run, found by its path. */
const recordOf = findPage;

/** Which session (1-based) produced each page's transcripts: the first, unless this says. */
const inSessions = (sessions: Record<string, number>) => (path: string) => ({
  session: sessions[path] ?? 1,
});

/**
 * A person's review of a page as `run` shows it: its `content` is the page's, so nothing has changed
 * since, unless `content` says otherwise.
 */
function review(
  run: RunJson,
  path: string,
  status: ReviewStatus,
  settings: {
    reviewer?: string;
    at?: string;
    note?: string | null;
    content?: ReviewEntry["content"];
  } = {},
): ReviewEntry {
  const record = recordOf(run, path);
  return {
    status,
    reviewer: settings.reviewer ?? CHRIS,
    at: settings.at ?? REVIEWED_AT,
    note: settings.note ?? null,
    run: run.id,
    url: record.url,
    files: {},
    content:
      settings.content ??
      Object.fromEntries(
        Object.entries(record.passes).map(([pass, summary]) => [pass, summary.contentSha256]),
      ),
  };
}

/** Review entries, in the order they were recorded, filed under their pages. */
function reviewsOf(...entries: ReviewEntry[]): ReviewsFile {
  const pages: Record<string, ReviewEntry[]> = {};
  for (const entry of entries) (pages[canonicalKey(entry.url)] ??= []).push(entry);
  return { schemaVersion: 1, pages };
}

/** Every one of the seven pages reviewed with `status`, except where `statuses` says otherwise. */
function reviewAll(
  run: RunJson,
  status: ReviewStatus,
  statuses: Record<string, ReviewStatus> = {},
  reviewer = CHRIS,
): ReviewEntry[] {
  return PATHS.map((path) => review(run, path, statuses[path] ?? status, { reviewer }));
}

type Found = { text: string; count: number }[];

/** A flag of a rule that finds items, as voicecap raises it now: with what it found, and a message that lists it. */
function foundFlag(
  rule: "generic-link-text" | "unlabeled",
  pass: PassName,
  found: Found,
): FlagResult {
  const count = found.reduce((sum, item) => sum + item.count, 0);
  const listed = found.map((item) => `"${item.text}" ×${item.count}`).join(", ");
  const message =
    rule === "generic-link-text"
      ? `Generic link text announced ${count} times in the ${pass} pass: ${listed}.`
      : `Unlabeled or poorly labeled items in the ${pass} pass: ${listed}.`;
  return { rule, pass, count, found, message };
}

const genericFlag = (pass: PassName, found: Found) => foundFlag("generic-link-text", pass, found);
const unlabeledFlag = (pass: PassName, found: Found) => foundFlag("unlabeled", pass, found);

const COMMON_MISTAKES_FLAGS = [
  genericFlag("tab", [{ text: "click here", count: 3 }]),
  unlabeledFlag("tab", [
    { text: "edit", count: 1 },
    { text: "button", count: 1 },
  ]),
];

/** The headings flag voicecap raises for a headings pass whose steps say `spoken`. */
function headingsFlag(spoken: string[]): FlagResult {
  const flags = evaluateFlags(
    {
      headings: {
        stopReason: "no-next-heading",
        steps: [...spoken, "no next heading"].map((text, index) => ({
          n: index + 1,
          command: "nextHeading" as const,
          spoken: text,
          durationMs: 1,
          offsetMs: index + 1,
        })),
      },
    },
    DEFAULT_CONFIG.flags,
  );
  const flag = flags.find((candidate) => candidate.rule === "headings");
  if (flag === undefined) throw new Error("No headings flag");
  return flag;
}

/** Every page's flags as its shown transcripts record them. */
function flagsOf(standing: Standing): Map<string, FlagResult[]> {
  return new Map(standing.pages.map((page) => [page.key, page.shown?.page.flags ?? []]));
}

interface Scene {
  runs: RunJson[];
  reviews?: ReviewsFile;
  changes?: Changes | null;
  /** The flags to show, over each page's shown transcripts'. */
  flags?: Map<string, FlagResult[]>;
  name?: (page: { label?: string; url: string }) => string;
}

/** The summary of the runs, built as the share model builds it. */
function summarize(scene: Scene): Summary {
  const standing = standingOf(scene.runs);
  return summaryOf({
    standing,
    review: reviewOf(standing, scene.reviews ?? NO_REVIEWS, [], AS_OF),
    problems: problemsOf(standing, options),
    changes: scene.changes ?? null,
    flags: scene.flags ?? flagsOf(standing),
    name: scene.name ?? pageName,
    linesSpoken: 204,
    nvdaMs: 383_000,
  });
}

/** The page most tests give flags to. */
const COMMON = "/common-mistakes/";

/** What the tasks say when there is nothing left to do. */
const NOTHING_LEFT =
  "Nothing left: every issue found is fixed, every page was read, and every flagged page has a decision.";

/** The slug of a page of the site, which names its card. */
const slugOf = (path: string): string => pageSlug(canonicalKey(new URL(path, SITE).href));

/** `COMMON_MISTAKES_FLAGS` on the page "Common mistakes", and nothing on the others. */
const flagCommonMistakes = (path: string): Partial<SharePageSpec> =>
  path === COMMON ? { flags: COMMON_MISTAKES_FLAGS } : {};

describe("attentionLine", () => {
  it("joins what a listener hears on a page into one plain line", () => {
    const line = attentionLine(
      "Common mistakes",
      [
        genericFlag("read", [{ text: "click here", count: 3 }]),
        unlabeledFlag("read", [
          { text: "edit", count: 1 },
          { text: "button", count: 1 },
        ]),
      ],
      null,
      null,
    );

    expect(line).toBe(
      "Common mistakes: 3 links say only “click here”; 2 controls have no names, so NVDA says only “edit” and “button”",
    );
  });

  it("names what was found as a list: one, two, or three or more", () => {
    const said = (found: Found) => attentionLine("Page", [genericFlag("tab", found)], null, null);

    expect(said([{ text: "read more", count: 4 }])).toBe("Page: 4 links say only “read more”");
    expect(
      said([
        { text: "click here", count: 2 },
        { text: "read more", count: 1 },
      ]),
    ).toBe("Page: 3 links say only “click here” and “read more”");
    expect(
      said([
        { text: "click here", count: 2 },
        { text: "read more", count: 1 },
        { text: "learn more", count: 1 },
      ]),
    ).toBe("Page: 4 links say only “click here”, “read more”, and “learn more”");
  });

  it("says one link, or one control, in the singular", () => {
    expect(
      attentionLine("Page", [genericFlag("tab", [{ text: "read more", count: 1 }])], null, null),
    ).toBe("Page: 1 link says only “read more”");
    expect(
      attentionLine("Page", [unlabeledFlag("tab", [{ text: "edit", count: 1 }])], null, null),
    ).toBe("Page: 1 control has no name, so NVDA says only “edit”");
  });

  it("says a link with no name says only what NVDA says of any link", () => {
    const flags = [
      genericFlag("tab", [
        { text: "click here", count: 2 },
        { text: "(no name)", count: 1 },
      ]),
    ];

    expect(attentionLine("Page", flags, null, null)).toBe(
      "Page: 3 links say only “click here” and “link”",
    );
  });

  it("writes one clause for a rule raised in both passes, by the most either pass found", () => {
    // The same three links are heard in the read pass and again in the Tab pass: they are three
    // links, not six. What only one pass reached still counts.
    const flags = [
      genericFlag("read", [{ text: "click here", count: 3 }]),
      genericFlag("tab", [
        { text: "click here", count: 3 },
        { text: "read more", count: 1 },
      ]),
      unlabeledFlag("read", [{ text: "button", count: 1 }]),
      unlabeledFlag("tab", [
        { text: "button", count: 1 },
        { text: "edit", count: 1 },
      ]),
    ];

    expect(attentionLine("Common mistakes", flags, null, null)).toBe(
      "Common mistakes: 4 links say only “click here” and “read more”; 2 controls have no names, so NVDA says only “button” and “edit”",
    );
  });

  it("puts what was found most often first, whichever pass found it", () => {
    const flags = [
      genericFlag("read", [{ text: "read more", count: 1 }]),
      genericFlag("tab", [{ text: "click here", count: 3 }]),
    ];

    expect(attentionLine("Page", flags, null, null)).toBe(
      "Page: 4 links say only “click here” and “read more”",
    );
  });

  it("writes the headings flags as a listener would say them", () => {
    // Made by the rules themselves, so a change in the rule's wording shows up here.
    expect(attentionLine("Page", [headingsFlag(["heading, level 2, Resources"])], null, null)).toBe(
      "Page: its first heading is level 2, not 1",
    );
    expect(attentionLine("Page", [headingsFlag([])], null, null)).toBe("Page: it has no headings");
    // A message this version doesn't know is the message, in a clause.
    expect(
      attentionLine(
        "Page",
        [{ rule: "headings", message: "The headings skip a level." }],
        null,
        null,
      ),
    ).toBe("Page: the headings skip a level");
  });

  it("writes each of the other rules' flags", () => {
    const flag = (rule: string, message: string, pass: PassName): FlagResult => ({
      rule,
      pass,
      message,
    });

    expect(
      attentionLine(
        "Page",
        [
          flag("read-not-finished", "The read pass stopped at its step cap (400 steps).", "read"),
          flag("tab-no-stops", "Tab reached no focusable elements on the page.", "tab"),
          flag(
            "tab-before-main",
            "11 focus stops before main content, and the first stop isn't a skip link (possible missing skip link).",
            "tab",
          ),
        ],
        null,
        null,
      ),
    ).toBe(
      "Page: NVDA's reading stopped before the end of the page; Tab reaches nothing on the page; Tab stops before the main content, and the first stop isn't a skip link",
    );
  });

  it("gives a repeated phrase's and a custom rule's own message, without its closing period", () => {
    const flags: FlagResult[] = [
      {
        rule: "repeated-phrase",
        pass: "tab",
        count: 5,
        message:
          '"Close, button" repeated 5 times in a row in the tab pass (possible focus trap or duplicated content).',
      },
      {
        rule: "pdf-links",
        pass: "read",
        count: 2,
        message: "Links to PDFs (2 matches in the read pass).",
      },
    ];

    expect(attentionLine("Page", flags, null, null)).toBe(
      'Page: "Close, button" repeated 5 times in a row in the tab pass (possible focus trap or duplicated content); Links to PDFs (2 matches in the read pass)',
    );
  });

  it("uses a generic or unlabeled flag's message when an older record has no list of what it found", () => {
    const message = 'Generic link text announced 3 times in the read pass: "click here" ×3.';
    const flags: FlagResult[] = [
      { rule: "generic-link-text", pass: "read", count: 3, message },
      {
        rule: "unlabeled",
        pass: "tab",
        count: 2,
        message: 'Unlabeled or poorly labeled items in the tab pass: "button" ×1, "edit" ×1.',
      },
    ];

    expect(attentionLine("Page", flags, null, null)).toBe(
      'Page: Generic link text announced 3 times in the read pass: "click here" ×3; Unlabeled or poorly labeled items in the tab pass: "button" ×1, "edit" ×1',
    );
  });

  it("writes a failure and an issue after the flags", () => {
    expect(
      attentionLine(
        "The report",
        [genericFlag("tab", [{ text: "read more", count: 2 }])],
        "another window took the screen",
        "The search box has no name.",
      ),
    ).toBe(
      "The report: 2 links say only “read more”; it couldn't be read after every attempt (another window took the screen); a reviewer found an issue: The search box has no name",
    );
  });

  it("says a failure without its kind, and an issue without its note, as far as it goes", () => {
    expect(attentionLine("The report", [], "", null)).toBe(
      "The report: it couldn't be read after every attempt",
    );
    expect(attentionLine("The report", [], null, "")).toBe("The report: a reviewer found an issue");
  });

  it("keeps a reviewer's note to one line", () => {
    expect(attentionLine("Page", [], null, "  The search box\n  has no   name.  ")).toBe(
      "Page: a reviewer found an issue: The search box has no name",
    );
  });

  it("gives just the name when there is nothing to say", () => {
    expect(attentionLine("Page", [], null, null)).toBe("Page");
  });

  it("gives the clauses alone, for a page's line to follow its name", () => {
    const flags = [genericFlag("tab", [{ text: "read more", count: 2 }])];

    expect(attentionClauses(flags, "another window took the screen", "")).toBe(
      "2 links say only “read more”; it couldn't be read after every attempt (another window took the screen); a reviewer found an issue",
    );
    expect(attentionLine("Page", flags, null, null)).toBe(
      `Page: ${attentionClauses(flags, null, null)}`,
    );
    // Nothing to say is nothing, not a name.
    expect(attentionClauses([], null, null)).toBe("");
  });
});

describe("reviewOf", () => {
  it("takes each page's latest review up to the page's date, and says when its transcript changed since", () => {
    const run = sevenPages();
    const standing = standingOf([run]);
    const reviews = reviewsOf(
      // The page's latest review up to the date is its first: the second was recorded after it.
      review(run, "/", "reviewed", { at: "2026-09-26T16:00:00-05:00" }),
      review(run, "/", "issue", { at: "2026-09-28T10:00:00-05:00", note: "After the date" }),
      // Recorded on the date itself, to the second: it counts.
      review(run, "/the-report/", "reviewed", { at: AS_OF }),
      // The transcripts it saw were not these: its read pass says something else.
      review(run, "/before-you-start/", "reviewed", {
        content: {
          read: "0".repeat(64),
          headings: recordOf(run, "/before-you-start/").passes.headings?.contentSha256 ?? "",
          tab: recordOf(run, "/before-you-start/").passes.tab?.contentSha256 ?? "",
        },
      }),
      // Only after the date: as if never reviewed.
      review(run, "/ask-a-question/", "issue", { at: "2026-09-27T09:00:01-05:00" }),
    );

    const reviewed = reviewOf(standing, reviews, [], AS_OF);

    expect(reviewed.get(recordOf(run, "/").key)).toMatchObject({
      latest: { status: "reviewed", at: "2026-09-26T16:00:00-05:00" },
      changedSinceReview: false,
    });
    expect(reviewed.get(recordOf(run, "/the-report/").key)?.latest?.at).toBe(AS_OF);
    expect(reviewed.get(recordOf(run, "/before-you-start/").key)).toMatchObject({
      latest: { status: "reviewed" },
      changedSinceReview: true,
    });
    expect(reviewed.get(recordOf(run, "/ask-a-question/").key)).toMatchObject({
      latest: null,
      changedSinceReview: false,
    });
    expect(reviewed.get(recordOf(run, "/how-a-run-works/").key)).toMatchObject({
      latest: null,
      changedSinceReview: false,
    });
  });

  it("has a review for every page in scope, and for no other", () => {
    const earlier = sevenPages({ id: "r1", createdAt: "2026-09-25T10:00:00-05:00" });
    const latest = shareRun({
      id: "r2",
      createdAt: "2026-09-26T14:05:00-05:00",
      pages: [{ path: "/" }, { path: "/new/" }],
    });
    const standing = standingOf([earlier, latest]);

    const reviewed = reviewOf(
      standing,
      reviewsOf(review(earlier, "/the-report/", "reviewed")),
      [],
      AS_OF,
    );

    expect([...reviewed.keys()]).toEqual(standing.pages.map((page) => page.key));
    expect(standing.noLongerListed.length).toBeGreaterThan(0);
  });

  describe("says an issue was found, and that it was fixed, from a page's history", () => {
    // A page's reviews in the order they were recorded, one an hour after the one before.
    const historyOf = (statuses: ReviewStatus[]) => {
      const run = sevenPages();
      const entries = statuses.map((status, index) =>
        review(run, "/", status, { at: `2026-09-26T${10 + index}:00:00-05:00` }),
      );
      return reviewOf(standingOf([run]), reviewsOf(...entries), [], AS_OF).get(
        recordOf(run, "/").key,
      );
    };

    it.each<[string, ReviewStatus[], boolean, boolean]>([
      ["no review", [], false, false],
      ["an issue, then fixed", ["issue", "fixed"], true, true],
      // The fix follows the page's last issue, whatever came after it.
      ["an issue, fixed, then reviewed again", ["issue", "fixed", "reviewed"], true, true],
      [
        "an issue, fixed, then another issue, fixed",
        ["issue", "fixed", "issue", "fixed"],
        true,
        true,
      ],
      ["an issue and nothing after it", ["issue"], true, false],
      // Nothing was found before it, so nothing was fixed.
      ["a fixed entry with no issue before it", ["fixed"], false, false],
      ["a fix, then an issue", ["fixed", "issue"], true, false],
      // The issue came after the fix: it's open again.
      ["an issue, fixed, then a new issue", ["issue", "fixed", "issue"], true, false],
      // Reviewed again with no fix recorded: an issue was found, and it wasn't fixed.
      ["an issue, then reviewed with no fix recorded", ["issue", "reviewed"], true, false],
      ["reviews with no issue in them", ["reviewed", "unreviewed", "reviewed"], false, false],
    ])("for %s", (_, statuses, issueFound, fixed) => {
      expect(historyOf(statuses)).toMatchObject({ issueFound, fixed });
    });

    it("reads only the reviews up to the page's date", () => {
      const run = sevenPages();
      const reviews = reviewsOf(
        // Found before the date, fixed after it: as of the date, the issue is open.
        review(run, "/", "issue", { at: "2026-09-26T10:00:00-05:00" }),
        review(run, "/", "fixed", { at: "2026-09-28T10:00:00-05:00" }),
        // Found after the date: as of it, there's no issue.
        review(run, "/the-report/", "issue", { at: "2026-09-28T10:00:00-05:00" }),
      );

      const reviewed = reviewOf(standingOf([run]), reviews, [], AS_OF);

      expect(reviewed.get(recordOf(run, "/").key)).toMatchObject({
        issueFound: true,
        fixed: false,
      });
      expect(reviewed.get(recordOf(run, "/the-report/").key)).toMatchObject({
        issueFound: false,
        fixed: false,
      });
    });
  });

  it("counts a page as listened to only when its session answered all of them", () => {
    const run = sevenPages({
      sessions: [
        { reviewer: CHRIS, listener: "all" },
        { reviewer: PAT, listener: "part" },
        { reviewer: SAM, listener: "no" },
        { reviewer: "Kim Doe" },
        { reviewer: null, listener: "all" },
      ],
      page: inSessions({
        "/before-you-start/": 5,
        "/how-a-run-works/": 2,
        "/reading-transcripts/": 2,
        "/the-report/": 3,
        "/ask-a-question/": 4,
      }),
    });
    const summary = summarize({ runs: [run] });
    const reviewed = reviewOf(standingOf([run]), NO_REVIEWS, [], AS_OF);
    const listened = (path: string) => reviewed.get(recordOf(run, path).key)?.listened;

    // "Part of them" is shown on its page and never counted.
    expect(listened("/how-a-run-works/")).toEqual({ answer: "part", name: PAT });
    expect(listened("/reading-transcripts/")).toEqual({ answer: "part", name: PAT });
    expect(listened("/")).toEqual({ answer: "all", name: CHRIS });
    expect(listened("/common-mistakes/")).toEqual({ answer: "all", name: CHRIS });
    // A session with no name still heard them.
    expect(listened("/before-you-start/")).toEqual({ answer: "all", name: null });
    // "No", and no statement, say nothing a page can show.
    expect(listened("/the-report/")).toBeNull();
    expect(listened("/ask-a-question/")).toBeNull();

    // Pages 1 and 7 (by Christopher Schweda) and "Before you start" (a session with no name).
    expect(summary.numbers.listened).toBe(3);
    expect(summary.bars.review.listened).toEqual([3, 7]);
    expect(summary.sentence).toMatch(
      /^Christopher Schweda and another person listened as NVDA read 3 of the 7 pages\./,
    );
  });

  it("takes who listened from the session that produced the transcripts shown", () => {
    // The latest run couldn't read /how-a-run-works/: its transcripts are the earlier run's, and so
    // is who listened to them.
    const earlier = sevenPages({
      id: "r1",
      createdAt: "2026-09-25T10:00:00-05:00",
      sessions: [{ reviewer: PAT, listener: "all" }],
    });
    const latest = sevenPages({
      id: "r2",
      createdAt: "2026-09-26T14:05:00-05:00",
      sessions: [{ reviewer: CHRIS }],
      page: (path) => (path === "/how-a-run-works/" ? { status: "failed" } : {}),
    });
    const reviewed = reviewOf(standingOf([earlier, latest]), NO_REVIEWS, [], AS_OF);
    const listened = (path: string) => reviewed.get(recordOf(latest, path).key)?.listened;

    expect(listened("/how-a-run-works/")).toEqual({ answer: "all", name: PAT });
    expect(listened("/")).toBeNull();
  });

  it("lists a page's manual sessions, and no other page's", () => {
    const run = sevenPages();
    const session = (path: string, id: string): ManualSessionFile => {
      const url = new URL(path, SITE).href;
      const key = canonicalKey(url);
      const json: ManualSessionJson = {
        schemaVersion: 1,
        voicecap: "0.5.0",
        id,
        page: { url, key, slug: pageSlug(key) },
        input: {
          format: "nvda-log",
          fileName: "nvda.log",
          sha256: "d".repeat(64),
          bytes: 1,
          raw: { kept: false, reason: "no-raw" },
        },
        session: {
          date: id.slice(0, 10),
          dateSource: "option",
          start: null,
          end: null,
          from: null,
          to: null,
          crossesMidnight: false,
        },
        nvdaVersion: null,
        importedAt: "2026-09-26T09:00:00-05:00",
        reviewer: "Sam Tester",
        redaction: { applied: false, keystrokes: 0, speech: 0, note: null },
        warnings: [],
        entries: [],
      };
      return {
        json,
        jsonPath: `${id}/session.json`,
        txtPath: `${id}/session.txt`,
        rawPath: null,
      };
    };
    const first = session("/", "2026-09-25_0900");
    const second = session("/", "2026-09-25_1000");
    const other = session("/the-report/", "2026-09-25_1100");
    const unlisted = session("/gone/", "2026-09-25_1200");

    const reviewed = reviewOf(
      standingOf([run]),
      NO_REVIEWS,
      [first, second, other, unlisted],
      AS_OF,
    );

    expect(reviewed.get(recordOf(run, "/").key)?.manual).toEqual([first, second]);
    expect(reviewed.get(recordOf(run, "/the-report/").key)?.manual).toEqual([other]);
    expect(reviewed.get(recordOf(run, "/common-mistakes/").key)?.manual).toEqual([]);
  });

  it("refuses a date it can't read, rather than leave out every review", () => {
    const run = sevenPages();

    expect(() => reviewOf(standingOf([run]), NO_REVIEWS, [], "yesterday")).toThrow(/Not a time/);
  });

  it("has no review for a standing with no run that counts", () => {
    const standing = standingOf([shareRun({ id: "p1", replayed: true, pages: [{ path: "/" }] })]);

    expect(reviewOf(standing, NO_REVIEWS, [], AS_OF).size).toBe(0);
  });
});

describe("summaryOf: the sentence", () => {
  it("leads with the person who listened and reviewed", () => {
    // Seven pages, all listened to and reviewed by one person. Common mistakes has flags, and an
    // issue found in review, so it is one finding, not two.
    const run = sevenPages({
      sessions: [{ reviewer: CHRIS, listener: "all" }],
      page: flagCommonMistakes,
    });
    const reviews = reviewsOf(...reviewAll(run, "reviewed", { [COMMON]: "issue" }));

    const { sentence } = summarize({ runs: [run], reviews });

    expect(sentence).toBe(
      "Christopher Schweda listened as NVDA read all 7 pages, and reviewed every transcript. 1 page has an issue a screen reader user would hear, found in review.",
    );
  });

  it("never leads with what's missing", () => {
    const run = sevenPages({ sessions: [{ reviewer: CHRIS }] });

    const { sentence } = summarize({ runs: [run] });

    expect(sentence).toBe(
      "NVDA read all 7 pages, run by Christopher Schweda. No flags were raised, and no issues were found.",
    );
    expect(sentence).not.toMatch(/\bnot\b/i);
    expect(sentence).not.toMatch(/\bno one\b/i);
    // Flagged, with no statement and no reviews: still nothing about what hasn't been done.
    const flagged = summarize({
      runs: [sevenPages({ sessions: [{ reviewer: CHRIS }], page: flagCommonMistakes })],
    }).sentence;
    expect(flagged).toBe(
      "NVDA read all 7 pages, run by Christopher Schweda. 1 page has flags worth a closer listen.",
    );
    expect(flagged).not.toMatch(/\bnot\b/i);
    expect(flagged).not.toMatch(/\bno one\b/i);
  });

  it("says the person who ran it only when a name is recorded", () => {
    expect(summarize({ runs: [sevenPages({ sessions: [{ reviewer: null }] })] }).sentence).toMatch(
      /^NVDA read all 7 pages\. /,
    );
    // A run from before voicecap recorded who ran it.
    expect(summarize({ runs: [sevenPages()] }).sentence).toMatch(/^NVDA read all 7 pages\. /);
    // More than one person ran the sessions.
    const run = sevenPages({
      sessions: [{ reviewer: CHRIS }, { reviewer: PAT }, { reviewer: CHRIS }],
      page: inSessions({ "/the-report/": 2, "/ask-a-question/": 3 }),
    });
    expect(summarize({ runs: [run] }).sentence).toMatch(
      /^NVDA read all 7 pages, run by Christopher Schweda and Pat Lee\. /,
    );
  });

  it("names everyone who ran the sessions the transcripts shown come from", () => {
    // Run r2 couldn't read /how-a-run-works/, so that page's transcripts are r1's, run by someone else.
    const earlier = sevenPages({
      id: "r1",
      createdAt: "2026-09-25T10:00:00-05:00",
      sessions: [{ reviewer: PAT }],
    });
    const latest = sevenPages({
      id: "r2",
      createdAt: "2026-09-26T14:05:00-05:00",
      sessions: [{ reviewer: CHRIS }],
      page: (path) => (path === "/how-a-run-works/" ? { status: "failed" } : {}),
    });

    expect(summarize({ runs: [earlier, latest] }).sentence).toBe(
      "NVDA read all 7 pages, run by Christopher Schweda and Pat Lee. No flags were raised, and no issues were found.",
    );
  });

  it("says how many pages NVDA read of those in scope, run by whom", () => {
    const run = sevenPages({
      sessions: [{ reviewer: CHRIS }],
      page: (path) => (path === "/the-report/" ? { status: "failed" } : {}),
    });

    expect(summarize({ runs: [run] }).sentence).toBe(
      "NVDA read 6 of the 7 pages, run by Christopher Schweda. No flags were raised, and no issues were found. 1 page couldn't be read after every attempt.",
    );
  });

  it("says how many of the pages were listened to, when only some were", () => {
    const run = sevenPages({
      sessions: [
        { reviewer: CHRIS, listener: "all" },
        { reviewer: CHRIS, listener: "part" },
      ],
      page: inSessions({
        "/how-a-run-works/": 2,
        "/reading-transcripts/": 2,
        "/the-report/": 2,
        "/ask-a-question/": 2,
      }),
    });

    expect(summarize({ runs: [run] }).sentence).toBe(
      "Christopher Schweda listened as NVDA read 3 of the 7 pages. No flags were raised, and no issues were found.",
    );
  });

  it("says it's part of the runs when no one listened to all of any session", () => {
    const run = sevenPages({
      sessions: [
        { reviewer: PAT, listener: "part" },
        { reviewer: SAM, listener: "part" },
        { reviewer: CHRIS, listener: "no" },
      ],
      page: inSessions({
        "/": 3,
        "/before-you-start/": 3,
        "/the-report/": 3,
        "/reading-transcripts/": 2,
        "/ask-a-question/": 2,
      }),
    });

    expect(summarize({ runs: [run] }).sentence).toBe(
      "Pat Lee and Sam Roe listened to part of the runs as NVDA read 7 pages. No flags were raised, and no issues were found.",
    );
  });

  it("says the person running it when no name was recorded", () => {
    const sessions = [{ reviewer: null, listener: "all" as const }];

    expect(summarize({ runs: [sevenPages({ sessions })] }).sentence).toBe(
      "The person running voicecap listened as NVDA read all 7 pages. No flags were raised, and no issues were found.",
    );
    const mixed = sevenPages({
      sessions: [{ reviewer: CHRIS, listener: "all" }, ...sessions],
      page: inSessions({ "/the-report/": 2 }),
    });
    expect(summarize({ runs: [mixed] }).sentence).toMatch(
      /^Christopher Schweda and another person listened as NVDA read all 7 pages\./,
    );
  });

  it("says the reviewing as far as the reviews go", () => {
    const run = sevenPages({ sessions: [{ reviewer: CHRIS, listener: "all" }] });
    const some = reviewsOf(
      review(run, "/", "reviewed"),
      review(run, "/before-you-start/", "issue"),
      review(run, "/the-report/", "fixed"),
      // Not a decision, however it got there.
      review(run, "/ask-a-question/", "unreviewed"),
    );

    expect(summarize({ runs: [run], reviews: some }).sentence).toBe(
      "Christopher Schweda listened as NVDA read all 7 pages, and reviewed 3 of the 7 transcripts. 1 page has an issue a screen reader user would hear, found in review.",
    );
    expect(summarize({ runs: [run] }).sentence).toBe(
      "Christopher Schweda listened as NVDA read all 7 pages. No flags were raised, and no issues were found.",
    );
  });

  it("names the reviewers before 'reviewed' when they aren't the people who listened", () => {
    const run = sevenPages({ sessions: [{ reviewer: CHRIS, listener: "all" }] });
    const by = (reviewer: string) => reviewsOf(...reviewAll(run, "reviewed", {}, reviewer));

    expect(summarize({ runs: [run], reviews: by(PAT) }).sentence).toMatch(
      /^Christopher Schweda listened as NVDA read all 7 pages, and Pat Lee reviewed every transcript\. /,
    );
    const two = reviewsOf(
      ...reviewAll(run, "reviewed", {}, PAT).slice(0, 3),
      ...reviewAll(run, "reviewed", {}, SAM).slice(3),
    );
    expect(summarize({ runs: [run], reviews: two }).sentence).toMatch(
      /^Christopher Schweda listened as NVDA read all 7 pages, and Pat Lee and Sam Roe reviewed every transcript\. /,
    );
    // The listener and another person: it isn't only the person who listened.
    const mixed = reviewsOf(
      ...reviewAll(run, "reviewed", {}, CHRIS).slice(0, 3),
      ...reviewAll(run, "reviewed", {}, PAT).slice(3),
    );
    expect(summarize({ runs: [run], reviews: mixed }).sentence).toMatch(
      /, and Christopher Schweda and Pat Lee reviewed every transcript\. /,
    );
    // The person running it with no name: who reviewed is named, since nothing says it's the same.
    const unnamed = sevenPages({ sessions: [{ reviewer: null, listener: "all" }] });
    expect(
      summarize({ runs: [unnamed], reviews: reviewsOf(...reviewAll(unnamed, "reviewed")) })
        .sentence,
    ).toMatch(
      /^The person running voicecap listened as NVDA read all 7 pages, and Christopher Schweda reviewed every transcript\. /,
    );
  });

  it("says who reviewed when no one is said to have listened", () => {
    const run = sevenPages({ sessions: [{ reviewer: CHRIS }] });
    const by = (reviewer: string) => reviewsOf(...reviewAll(run, "reviewed", {}, reviewer));

    // The person who ran it, and reviewed it.
    expect(summarize({ runs: [run], reviews: by(CHRIS) }).sentence).toMatch(
      /^NVDA read all 7 pages, run by Christopher Schweda, who reviewed every transcript\. /,
    );
    expect(summarize({ runs: [run], reviews: by(PAT) }).sentence).toMatch(
      /^NVDA read all 7 pages, run by Christopher Schweda, and Pat Lee reviewed every transcript\. /,
    );
    const unnamed = sevenPages();
    expect(
      summarize({ runs: [unnamed], reviews: reviewsOf(...reviewAll(unnamed, "reviewed")) })
        .sentence,
    ).toMatch(/^NVDA read all 7 pages, and Christopher Schweda reviewed every transcript\. /);
  });

  it("doesn't count a review of transcripts that have changed since", () => {
    // The person reviewed run r1's transcripts. Run r2 read /the-report/ differently, and no one has
    // reviewed what it said.
    const first = sevenPages({ id: "r1", createdAt: "2026-09-25T10:00:00-05:00" });
    const second = sevenPages({
      id: "r2",
      createdAt: "2026-09-26T14:05:00-05:00",
      sessions: [{ reviewer: CHRIS, listener: "all" }],
      page: (path) =>
        path === "/the-report/"
          ? {
              passes: {
                read: ["The report, said another way"],
                headings: [`Headings ${path}`],
                tab: [`Tab ${path}`],
              },
            }
          : {},
    });
    const reviews = reviewsOf(...reviewAll(first, "reviewed"));

    const summary = summarize({ runs: [first, second], reviews });

    expect(summary.sentence).toBe(
      "Christopher Schweda listened as NVDA read all 7 pages, and reviewed 6 of the 7 transcripts. No flags were raised, and no issues were found.",
    );
    expect(summary.bars.review.reviewed).toEqual([6, 7]);
  });

  it("says a page in the singular", () => {
    const run = shareRun({
      id: "r1",
      sessions: [{ reviewer: CHRIS, listener: "all" }],
      pages: [{ path: "/", label: "Home", passes: { read: ["Home"] } }],
    });
    const reviews = reviewsOf(review(run, "/", "reviewed"));

    expect(summarize({ runs: [run], reviews }).sentence).toBe(
      "Christopher Schweda listened as NVDA read 1 page, and reviewed the transcript. No flags were raised, and no issues were found.",
    );
    expect(summarize({ runs: [run] }).sentence).toBe(
      "Christopher Schweda listened as NVDA read 1 page. No flags were raised, and no issues were found.",
    );
  });

  describe("its findings", () => {
    const run = sevenPages({
      sessions: [{ reviewer: CHRIS, listener: "all" }],
      page: (path) =>
        ["/before-you-start/", "/the-report/", COMMON].includes(path)
          ? { flags: [genericFlag("tab", [{ text: "read more", count: 2 }])] }
          : {},
    });
    /** The sentence after the first, which says who listened and reviewed. */
    const findings = (reviews: ReviewsFile) => {
      const { sentence } = summarize({ runs: [run], reviews });
      const end = sentence.indexOf(". ");
      return end === -1 ? "" : sentence.slice(end + 2);
    };

    it("says how many pages have flags no one has decided about", () => {
      expect(findings(NO_REVIEWS)).toBe("3 pages have flags worth a closer listen.");
      expect(
        findings(
          reviewsOf(review(run, "/the-report/", "reviewed"), review(run, COMMON, "reviewed")),
        ),
      ).toBe("1 page has flags worth a closer listen.");
    });

    it("says a review whose transcripts have changed doesn't settle a page's flags", () => {
      const stale = review(run, "/the-report/", "reviewed", { content: { read: "0".repeat(64) } });

      expect(findings(reviewsOf(stale))).toBe("3 pages have flags worth a closer listen.");
    });

    it("says how many pages have an issue, and how many have flags no one has decided about", () => {
      const reviews = reviewsOf(
        review(run, "/before-you-start/", "issue"),
        review(run, COMMON, "reviewed"),
      );

      expect(findings(reviews)).toBe(
        "1 page has an issue a screen reader user would hear, found in review. 1 page has flags worth a closer listen.",
      );
      expect(
        findings(
          reviewsOf(
            review(run, "/before-you-start/", "issue"),
            review(run, "/the-report/", "issue"),
            review(run, COMMON, "reviewed"),
          ),
        ),
      ).toBe("2 pages have an issue a screen reader user would hear, found in review.");
    });

    it("counts a flagged page with an issue once, even when its transcripts have changed since", () => {
      const stale = review(run, "/before-you-start/", "issue", {
        content: { read: "0".repeat(64) },
      });

      expect(findings(reviewsOf(stale))).toBe(
        "1 page has an issue a screen reader user would hear, found in review. 2 pages have flags worth a closer listen.",
      );
    });

    it("says a flagged page with an issue found is one finding, whatever its review's note", () => {
      const reviews = reviewsOf(
        review(run, "/before-you-start/", "issue", { note: "Links say only “read more”" }),
        review(run, "/the-report/", "reviewed"),
        review(run, COMMON, "reviewed"),
      );

      expect(findings(reviews)).toBe(
        "1 page has an issue a screen reader user would hear, found in review.",
      );
    });

    it("says every flagged page was reviewed, when the reviews settle every flag", () => {
      const reviews = reviewsOf(
        review(run, "/before-you-start/", "reviewed"),
        review(run, "/the-report/", "reviewed"),
        review(run, COMMON, "reviewed"),
      );

      expect(findings(reviews)).toBe(
        "Every page with flags was reviewed, and no issues were found.",
      );
    });

    it("says the issues found were fixed, when they all were", () => {
      const reviews = reviewsOf(
        review(run, "/before-you-start/", "issue", { at: "2026-09-26T15:00:00-05:00" }),
        review(run, "/before-you-start/", "fixed", { at: "2026-09-26T16:00:00-05:00" }),
        review(run, "/the-report/", "reviewed"),
        review(run, COMMON, "reviewed"),
      );

      expect(findings(reviews)).toBe("Every issue found in review was fixed.");
    });

    it("says nothing was raised or found only when it's so", () => {
      const clean = sevenPages({ sessions: [{ reviewer: CHRIS, listener: "all" }] });
      const reviews = reviewsOf(...reviewAll(clean, "reviewed"));

      expect(summarize({ runs: [clean], reviews }).sentence).toBe(
        "Christopher Schweda listened as NVDA read all 7 pages, and reviewed every transcript. No flags were raised, and no issues were found.",
      );
    });
  });

  describe("its words about issues, from each page's history", () => {
    const run = sevenPages({ sessions: [{ reviewer: CHRIS, listener: "all" }] });
    // A page's reviews in the order they were recorded, one an hour after the one before.
    const history = (path: string, ...statuses: ReviewStatus[]) =>
      statuses.map((status, index) =>
        review(run, path, status, { at: `2026-09-26T${10 + index}:00:00-05:00` }),
      );
    const summed = (...entries: ReviewEntry[]) =>
      summarize({ runs: [run], reviews: reviewsOf(...entries) });
    const LEAD = "Christopher Schweda listened as NVDA read all 7 pages";

    it("says every issue was fixed when it was fixed and the page was then reviewed again", () => {
      const summary = summed(...history("/", "issue", "fixed", "reviewed"));

      expect(summary.sentence).toBe(
        `${LEAD}, and reviewed 1 of the 7 transcripts. Every issue found in review was fixed.`,
      );
      expect(summary.sentence).not.toMatch(/no issues were found/);
      expect(summary.bars.review.fixed).toEqual([1, 1]);
      // Every issue found is fixed, so there is nothing to record.
      expect(summary.todo).toEqual([NOTHING_LEFT]);
    });

    it("says every issue was fixed when an issue was found and then fixed", () => {
      const summary = summed(...history("/", "issue", "fixed"));

      expect(summary.sentence).toBe(
        `${LEAD}, and reviewed 1 of the 7 transcripts. Every issue found in review was fixed.`,
      );
      expect(summary.bars.review.fixed).toEqual([1, 1]);
      expect(summary.todo).toEqual([NOTHING_LEFT]);
    });

    it("counts a fixed entry with no issue before it as neither found nor fixed", () => {
      const summary = summed(...history("/", "fixed"));

      expect(summary.sentence).toBe(
        `${LEAD}, and reviewed 1 of the 7 transcripts. No flags were raised, and no issues were found.`,
      );
      expect(summary.bars.review.fixed).toEqual([0, 0]);
      expect(summary.todo).toEqual([NOTHING_LEFT]);
    });

    it("says neither no issues nor every issue fixed when an issue was reviewed again with no fix", () => {
      const summary = summed(...history("/", "issue", "reviewed"));

      expect(summary.sentence).toBe(`${LEAD}, and reviewed 1 of the 7 transcripts.`);
      expect(summary.bars.review.fixed).toEqual([0, 1]);
      // The bar says 0 of 1 fixed, so the tasks can't say every issue found is fixed: someone has
      // to record whether it was.
      expect(summary.todo).toEqual(["Record whether the issue found on Home was fixed."]);
      expect(summary.todo).not.toContain(NOTHING_LEFT);
    });

    it("says every issue was fixed only when every page that had one was fixed", () => {
      const summary = summed(
        ...history("/", "issue", "fixed"),
        ...history("/before-you-start/", "issue", "reviewed"),
      );

      expect(summary.sentence).toBe(`${LEAD}, and reviewed 2 of the 7 transcripts.`);
      expect(summary.bars.review.fixed).toEqual([1, 2]);
      expect(summary.todo).toEqual([
        "Record whether the issue found on Before you start was fixed.",
      ]);
    });

    it("names the pages whose issue isn't recorded as fixed, in the plural, up to four and then a count", () => {
      const two = summed(
        ...history("/", "issue", "reviewed"),
        ...history("/before-you-start/", "issue", "reviewed"),
      );
      expect(two.todo).toEqual([
        "Record whether the issues found on Home and Before you start were fixed.",
      ]);

      const five = summed(
        ...history("/", "issue", "reviewed"),
        ...history("/before-you-start/", "issue", "reviewed"),
        ...history("/how-a-run-works/", "issue", "reviewed"),
        ...history("/reading-transcripts/", "issue", "reviewed"),
        ...history("/the-report/", "issue", "reviewed"),
      );
      expect(five.todo).toEqual([
        "Record whether the issues found on Home, Before you start, How a run works, and 2 more were fixed.",
      ]);
    });

    it("asks for the fix of an open issue first, and then for the record of one that isn't", () => {
      const summary = summed(
        ...history("/", "issue"),
        ...history("/before-you-start/", "issue", "reviewed"),
        ...history("/how-a-run-works/", "issue", "fixed"),
      );

      expect(summary.todo).toEqual([
        "Fix the issue found on Home, then record it as fixed.",
        "Record whether the issue found on Before you start was fixed.",
      ]);
    });

    it("counts an issue found after a fix as open again", () => {
      const summary = summed(...history("/", "issue", "fixed", "issue"));

      expect(summary.sentence).toBe(
        `${LEAD}, and reviewed 1 of the 7 transcripts. 1 page has an issue a screen reader user would hear, found in review.`,
      );
      expect(summary.bars.review.fixed).toEqual([0, 1]);
      expect(summary.todo).toEqual(["Fix the issue found on Home, then record it as fixed."]);
    });

    it("says an issue is open on one page while another's was fixed", () => {
      const summary = summed(
        ...history("/", "issue", "fixed"),
        ...history("/before-you-start/", "issue"),
      );

      expect(summary.sentence).toBe(
        `${LEAD}, and reviewed 2 of the 7 transcripts. 1 page has an issue a screen reader user would hear, found in review.`,
      );
      expect(summary.bars.review.fixed).toEqual([1, 2]);
    });

    it("doesn't say no issues were found after a flagged page's review when another page had an issue", () => {
      // A page with flags was reviewed and cleared. That doesn't make it true that no issue was found.
      const flagged = sevenPages({
        sessions: [{ reviewer: CHRIS, listener: "all" }],
        page: flagCommonMistakes,
      });
      const entries = [
        review(flagged, COMMON, "reviewed"),
        review(flagged, "/", "issue", { at: "2026-09-26T10:00:00-05:00" }),
        review(flagged, "/", "reviewed", { at: "2026-09-26T11:00:00-05:00" }),
      ];

      const { sentence } = summarize({ runs: [flagged], reviews: reviewsOf(...entries) });

      expect(sentence).not.toMatch(/no issues were found/);
      expect(sentence).not.toMatch(/Every issue found/);
    });
  });

  it("says no flags or issues only about pages that were read", () => {
    const run = sevenPages({
      sessions: [{ reviewer: CHRIS }],
      page: () => ({ status: "failed" }),
    });

    expect(summarize({ runs: [run] }).sentence).toBe(
      "NVDA read 0 of the 7 pages, run by Christopher Schweda. 7 pages couldn't be read after every attempt.",
    );
  });

  it("counts a page whose latest attempt failed, but whose older transcripts are shown, as read", () => {
    const earlier = sevenPages({ id: "r1", createdAt: "2026-09-25T10:00:00-05:00" });
    const latest = sevenPages({
      id: "r2",
      createdAt: "2026-09-26T14:05:00-05:00",
      sessions: [{ reviewer: CHRIS }],
      page: (path) =>
        path === "/how-a-run-works/"
          ? { status: "failed", failedAttempts: [failedAttempt({ n: 1 })] }
          : {},
    });

    const summary = summarize({ runs: [earlier, latest] });

    expect(summary.sentence).toBe(
      "NVDA read all 7 pages, run by Christopher Schweda. No flags were raised, and no issues were found.",
    );
    expect(summary.numbers.transcribed).toBe(7);
    expect(summary.attention).toEqual([]);
    expect(summary.bars.results).toEqual({ done: 7, flagged: 0, never: 0 });
  });
});

describe("summaryOf: the numbers and the bars", () => {
  const run = sevenPages({
    sessions: [{ reviewer: CHRIS, listener: "all" }],
    page: (path) => {
      if (path === COMMON) {
        return {
          flags: [
            genericFlag("read", [{ text: "click here", count: 3 }]),
            genericFlag("tab", [{ text: "click here", count: 3 }]),
            unlabeledFlag("read", [{ text: "button", count: 1 }]),
            unlabeledFlag("tab", [
              { text: "button", count: 1 },
              { text: "edit", count: 1 },
            ]),
            headingsFlag(["heading, level 2, Common mistakes"]),
          ],
        };
      }
      if (path === "/ask-a-question/") {
        return { flags: [{ rule: "repeated-phrase", pass: "tab", count: 5, message: "x" }] };
      }
      if (path === "/the-report/") return { status: "failed" };
      return {};
    },
  });

  it("counts the pages in scope, the pages transcribed, and the pages with flags and their rules", () => {
    const { numbers } = summarize({ runs: [run] });

    expect(numbers).toEqual({
      pagesInScope: 7,
      transcribed: 6,
      flagged: 2,
      // generic-link-text, unlabeled, headings, and repeated-phrase.
      rules: 4,
      listened: 6,
      linesSpoken: 204,
      nvdaMs: 383_000,
    });
  });

  it("gives each page's latest result: no flags, flags, or never transcribed", () => {
    expect(summarize({ runs: [run] }).bars.results).toEqual({ done: 4, flagged: 2, never: 1 });
  });

  it("counts how many times each rule was raised, in every pass, most often first", () => {
    expect(summarize({ runs: [run] }).bars.flagsByRule).toEqual([
      { rule: "generic-link-text", count: 6 },
      { rule: "repeated-phrase", count: 5 },
      { rule: "unlabeled", count: 3 },
      { rule: "headings", count: 1 },
    ]);
  });

  it("puts rules raised as often in alphabetical order", () => {
    const flags = (rule: string) => [{ rule, pass: "read" as const, count: 2, message: "x" }];
    const tied = sevenPages({
      page: (path) =>
        path === "/" ? { flags: flags("zebra") } : path === COMMON ? { flags: flags("apple") } : {},
    });

    expect(summarize({ runs: [tied] }).bars.flagsByRule).toEqual([
      { rule: "apple", count: 2 },
      { rule: "zebra", count: 2 },
    ]);
  });

  it("counts a flag with no count of its own once", () => {
    const once = sevenPages({
      page: (path) => (path === "/" ? { flags: [headingsFlag([])] } : {}),
    });

    expect(summarize({ runs: [once] }).bars.flagsByRule).toEqual([{ rule: "headings", count: 1 }]);
  });

  it("gives the human review out of its totals", () => {
    const reviews = reviewsOf(
      review(run, "/", "reviewed"),
      review(run, "/before-you-start/", "reviewed"),
      review(run, "/how-a-run-works/", "issue"),
      review(run, "/reading-transcripts/", "issue"),
      review(run, "/reading-transcripts/", "fixed"),
      review(run, COMMON, "issue"),
      review(run, COMMON, "fixed"),
      review(run, "/ask-a-question/", "unreviewed"),
    );

    expect(summarize({ runs: [run], reviews }).bars.review).toEqual({
      listened: [6, 6],
      reviewed: [5, 6],
      // Two of the three pages that had an issue were fixed.
      fixed: [2, 3],
    });
  });

  it("has no flags or rules when no page was flagged", () => {
    const clean = summarize({ runs: [sevenPages()] });

    expect(clean.numbers).toMatchObject({ flagged: 0, rules: 0 });
    expect(clean.bars.flagsByRule).toEqual([]);
    expect(clean.bars.results).toEqual({ done: 7, flagged: 0, never: 0 });
    expect(clean.bars.review).toEqual({ listened: [0, 7], reviewed: [0, 7], fixed: [0, 0] });
  });

  it("takes a page's flags from the flags it's given, and only for pages with transcripts", () => {
    const standing = standingOf([run]);
    const flags = flagsOf(standing);
    // A page that was never transcribed has no flags to show, whatever the map says.
    flags.set(recordOf(run, "/the-report/").key, [headingsFlag([])]);
    // A page can be given other flags than its record's, as when they're computed afresh.
    flags.set(recordOf(run, "/").key, [headingsFlag([])]);

    const { numbers, bars } = summarize({ runs: [run], flags });

    expect(numbers.flagged).toBe(3);
    expect(bars.results).toEqual({ done: 3, flagged: 3, never: 1 });
  });
});

describe("summaryOf: the panels", () => {
  it("writes what a listener hears on a page that needs attention", () => {
    const run = sevenPages({ page: flagCommonMistakes });

    expect(summarize({ runs: [run] }).attention).toEqual([
      {
        slug: slugOf(COMMON),
        name: "Common mistakes",
        clauses:
          "3 links say only “click here”; 2 controls have no names, so NVDA says only “edit” and “button”",
      },
    ]);
    // As one line of plain text, the name and the clauses.
    expect(attentionLine("Common mistakes", COMMON_MISTAKES_FLAGS, null, null)).toBe(
      "Common mistakes: 3 links say only “click here”; 2 controls have no names, so NVDA says only “edit” and “button”",
    );
  });

  it("lists a page with flags, a failure, or an open issue, in page order", () => {
    const run = sevenPages({
      page: (path) => {
        if (path === "/before-you-start/") return { flags: [headingsFlag([])] };
        if (path === "/the-report/") {
          return {
            status: "failed",
            failedAttempts: [
              failedAttempt({
                n: 1,
                cause: "step-timeout",
                message: "nextLine did not finish within 30s",
              }),
            ],
          };
        }
        return {};
      },
    });
    const reviews = reviewsOf(
      review(run, "/", "issue", { note: "The skip link goes nowhere." }),
      review(run, "/before-you-start/", "reviewed"),
      review(run, "/ask-a-question/", "issue"),
      review(run, "/how-a-run-works/", "fixed"),
      review(run, "/reading-transcripts/", "reviewed"),
    );

    expect(summarize({ runs: [run], reviews }).attention).toEqual([
      {
        slug: slugOf("/"),
        name: "Home",
        clauses: "a reviewer found an issue: The skip link goes nowhere",
      },
      // A flag stays on the page whatever the review decided: it's what NVDA says.
      {
        slug: slugOf("/before-you-start/"),
        name: "Before you start",
        clauses: "it has no headings",
      },
      {
        slug: slugOf("/the-report/"),
        name: "The report",
        clauses: "it couldn't be read after every attempt (a step took too long)",
      },
      {
        slug: slugOf("/ask-a-question/"),
        name: "Ask a question",
        clauses: "a reviewer found an issue",
      },
    ]);
  });

  it("names a failed page's kind of failure from its last problem, and leaves it off when there's none recorded", () => {
    const failed = (failedAttempts: ReturnType<typeof failedAttempt>[]) =>
      sevenPages({
        page: (path) => (path === "/the-report/" ? { status: "failed", failedAttempts } : {}),
      });
    const clauses = (run: RunJson) =>
      summarize({ runs: [run] }).attention.map((item) => item.clauses);

    expect(
      clauses(
        failed([
          failedAttempt({ n: 1 }),
          failedAttempt({ n: 2, cause: "browser", message: "Chrome didn't start" }),
        ]),
      ),
    ).toEqual(["it couldn't be read after every attempt (the browser stopped or didn't start)"]);
    expect(
      clauses(failed([failedAttempt({ n: 1, cause: "unexpected", message: "boom" })])),
    ).toEqual(["it couldn't be read after every attempt (an unexpected error)"]);
    // A record that lists no attempt and no error says no kind.
    expect(clauses(failed([]))).toEqual(["it couldn't be read after every attempt"]);
  });

  it("leaves a failed page's kind off when only an earlier run recorded why it failed", () => {
    const failedIn = (
      id: string,
      createdAt: string,
      failedAttempts: ReturnType<typeof failedAttempt>[],
    ) =>
      sevenPages({
        id,
        createdAt,
        page: (path) => (path === "/the-report/" ? { status: "failed", failedAttempts } : {}),
      });
    const earlier = failedIn("r1", "2026-09-25T10:00:00-05:00", [failedAttempt({ n: 1 })]);
    const latest = failedIn("r2", "2026-09-26T14:05:00-05:00", []);

    expect(summarize({ runs: [earlier, latest] }).attention).toEqual([
      {
        slug: slugOf("/the-report/"),
        name: "The report",
        clauses: "it couldn't be read after every attempt",
      },
    ]);
  });

  it("says how complete the test was", () => {
    const run = sevenPages();
    const standing = standingOf([run]);

    const { complete } = summarize({ runs: [run] });

    expect(complete).toEqual([
      "Pages read: 7 of 7.",
      problemsOf(standing, options).line,
      "Unexpected errors: none.",
    ]);
    expect(complete[1]).toBe("No problems during the runs: every page was read in full.");
  });

  it("says when pages couldn't be read after every attempt, or were skipped", () => {
    const run = sevenPages({
      page: (path) => {
        if (path === "/the-report/" || path === "/ask-a-question/") return { status: "failed" };
        if (path === "/") return { status: "skipped" };
        return {};
      },
    });

    const { complete, bars, sentence, todo } = summarize({ runs: [run] });

    expect(complete.filter((line) => /^(Pages read|Couldn't|Skipped)/.test(line))).toEqual([
      "Pages read: 4 of 7.",
      "Couldn't be read after every attempt: 2.",
      "Skipped, not read: 1.",
    ]);
    // Neither kind of page has transcripts: both are "never transcribed".
    expect(bars.results).toEqual({ done: 4, flagged: 0, never: 3 });
    expect(sentence).toBe(
      "NVDA read 4 of the 7 pages. No flags were raised, and no issues were found. 2 pages couldn't be read after every attempt. 1 page was skipped, not read.",
    );
    expect(todo).toEqual([
      "Run voicecap again on The report and Ask a question: they couldn't be read after every attempt.",
      "Home was skipped: the site didn't answer with an HTML page. Check whether it belongs on the list.",
    ]);
  });

  it("says how many problems were unexpected errors, and where to see them", () => {
    const run = sevenPages({
      page: (path) =>
        path === "/"
          ? {
              failedAttempts: [
                failedAttempt({
                  n: 1,
                  cause: "unexpected",
                  message: "boom",
                  stack: "Error: boom\n    at somewhere",
                }),
              ],
            }
          : {},
    });

    const { complete } = summarize({ runs: [run] });

    expect(complete.at(-1)).toBe(
      "Unexpected errors: 1, which could mean a problem in voicecap itself (see Problems during the runs).",
    );
    expect(complete[1]).toMatch(/^1 problem: an unexpected error\./);
  });

  it("lists what's still to do as tasks, or says nothing is left", () => {
    const flags = [genericFlag("tab", [{ text: "read more", count: 2 }])];
    const run = sevenPages({
      page: (path) => {
        if (path === "/the-report/") return { status: "failed" };
        return ["/before-you-start/", "/ask-a-question/", COMMON].includes(path) ? { flags } : {};
      },
    });
    const stale = review(run, "/before-you-start/", "reviewed", {
      content: { read: "0".repeat(64) },
    });
    const reviews = reviewsOf(
      review(run, COMMON, "issue", { note: "Links say only “read more”." }),
      // A review of transcripts that have changed doesn't settle the flags on them.
      stale,
      // A page without flags has nothing to decide.
      review(run, "/", "unreviewed"),
    );

    expect(summarize({ runs: [run], reviews }).todo).toEqual([
      "Fix the issue found on Common mistakes, then record it as fixed.",
      "Run voicecap again on The report: it couldn't be read after every attempt.",
      "Take a closer listen to Before you start and Ask a question, where flags were raised, and record what you decide.",
    ]);

    const done = sevenPages({ page: (path) => (path === COMMON ? { flags } : {}) });
    const settled = reviewsOf(
      review(done, COMMON, "issue", { at: "2026-09-26T15:00:00-05:00" }),
      review(done, COMMON, "fixed", { at: "2026-09-26T16:00:00-05:00" }),
    );
    expect(summarize({ runs: [done], reviews: settled }).todo).toEqual([
      "Nothing left: every issue found is fixed, every page was read, and every flagged page has a decision.",
    ]);
    expect(
      summarize({ runs: [done], reviews: reviewsOf(review(done, COMMON, "reviewed")) }).todo,
    ).toEqual([
      "Nothing left: every issue found is fixed, every page was read, and every flagged page has a decision.",
    ]);
  });

  it("writes each task in the plural, and keeps a long list of pages short", () => {
    const flags = [genericFlag("tab", [{ text: "read more", count: 2 }])];
    const run = sevenPages({
      page: (path) => {
        if (path === "/the-report/") return { status: "failed" };
        return path === "/" ? {} : { flags };
      },
    });
    const reviews = reviewsOf(
      review(run, "/before-you-start/", "issue"),
      review(run, "/how-a-run-works/", "issue"),
      review(run, "/reading-transcripts/", "issue"),
    );

    expect(summarize({ runs: [run], reviews }).todo).toEqual([
      "Fix the issues found on Before you start, How a run works, and Reading transcripts, then record them as fixed.",
      "Run voicecap again on The report: it couldn't be read after every attempt.",
      "Take a closer listen to Ask a question and Common mistakes, where flags were raised, and record what you decide.",
    ]);

    const many = shareRun({
      id: "many",
      pages: Array.from({ length: 12 }, (_, index) => ({
        path: `/page-${index + 1}/`,
        label: `Page ${index + 1}`,
        flags,
      })),
    });
    const [listen] = summarize({ runs: [many] }).todo;
    expect(listen).toBe(
      "Take a closer listen to Page 1, Page 2, Page 3, and 9 more, where flags were raised, and record what you decide.",
    );
  });

  it("says when and how: the date, who ran it, the screen reader, the browser, and the operating system", () => {
    const run = sevenPages({
      createdAt: "2026-09-29T23:30:00-05:00",
      sessions: [
        {
          reviewer: CHRIS,
          startedAt: "2026-09-29T23:30:00-05:00",
          endedAt: "2026-09-29T23:50:00-05:00",
        },
        {
          reviewer: PAT,
          startedAt: "2026-09-30T08:00:00-05:00",
          endedAt: "2026-09-30T08:20:00-05:00",
          environment: { browser: { name: "Chrome", version: "142.0.7444.60" } },
        },
      ],
    });

    expect(summarize({ runs: [run] }).whenHow).toEqual([
      { label: "Date", value: "29 to 30 September 2026" },
      { label: "Run by", value: "Christopher Schweda and Pat Lee" },
      { label: "Screen reader", value: "NVDA 2026.2" },
      { label: "Browser", value: "Chrome 141.0.7390.55 and Chrome 142.0.7444.60" },
      { label: "Operating system", value: "Windows 11 Pro 24H2 (10.0.26100)" },
    ]);
  });

  it("says one day's date as one date, and the machine's own operating system when it's recorded", () => {
    const machine: MachineRecord = {
      os: { name: "Windows 11 Pro 25H2", build: "10.0.26200.9550", arch: "x64" },
      cpu: { name: "Test CPU", baseMhz: 3000, physicalCores: 4, logicalProcessors: 8 },
      memoryBytes: 16 * 1024 ** 3,
      display: null,
      browserWindow: { width: 1280, height: 960 },
      timeZone: "America/Chicago",
      utcOffset: "-05:00",
      language: "en-US",
      software: { node: "22.19.0", voicecap: "0.6.0", guidepup: "0.34.0", playwright: "1.50.0" },
    };
    const run = sevenPages({
      sessions: [
        {
          reviewer: CHRIS,
          startedAt: "2026-09-29T09:00:00-05:00",
          endedAt: "2026-09-29T09:30:00-05:00",
          environment: { machine },
        },
      ],
    });

    const { whenHow } = summarize({ runs: [run] });

    expect(whenHow[0]).toEqual({ label: "Date", value: "29 September 2026" });
    expect(whenHow.find((row) => row.label === "Operating system")?.value).toBe(
      "Windows 11 Pro 25H2",
    );
  });

  it("says who ran it was not recorded, as far as the record says", () => {
    const rowOf = (run: RunJson) =>
      summarize({ runs: [run] }).whenHow.find((row) => row.label === "Run by")?.value;

    expect(rowOf(sevenPages({ voicecapVersion: "0.4.1" }))).toBe(
      "Not recorded: this run used voicecap 0.4.1.",
    );
    expect(rowOf(sevenPages({ sessions: [{ reviewer: null }] }))).toBe(
      "Not recorded: no name was available when the run started.",
    );
  });

  it("gives the line about the run before when there is one", () => {
    const before = sevenPages({ id: "r1", createdAt: "2026-09-25T10:00:00-05:00" });
    const after = sevenPages({
      id: "r2",
      createdAt: "2026-09-26T14:05:00-05:00",
      page: (path) =>
        path === COMMON
          ? {
              passes: {
                read: ["Common mistakes, said another way"],
                headings: [`Headings ${path}`],
                tab: [`Tab ${path}`],
              },
            }
          : {},
    });
    const changes = changesOf(
      before,
      after,
      (run) => (run === "r1" ? ["Common mistakes"] : ["Common mistakes, said another way"]),
      pageName,
    );

    const withRun = summarize({ runs: [before, after], changes });

    expect(withRun.changesLine).toBe(changes.summaryLine);
    expect(withRun.changesLine).toMatch(
      /^Since the last run on 25 September: 1 page sounds different/,
    );
    expect(summarize({ runs: [before, after] }).changesLine).toBeNull();
  });

  it("is the same second line every time", () => {
    const second =
      "A human review, sped up: voicecap pressed NVDA's keys and moved from page to page; a person did the listening, the reading, and the deciding.";

    expect(summarize({ runs: [sevenPages()] }).second).toBe(second);
    expect(summarize({ runs: [] }).second).toBe(second);
  });
});

describe("summaryOf: pages that were skipped", () => {
  /** A run of the pages `skipped` names, which voicecap loaded and skipped, and two it read. */
  function withSkipped(
    skipped: [path: string, label: string, skip?: SkipReason | null][],
  ): RunJson {
    return shareRun({
      id: "r1",
      sessions: [{ reviewer: CHRIS }],
      pages: [
        { path: "/", label: "Home" },
        { path: "/about/", label: "About" },
        ...skipped.map(([path, label, skip]) => ({
          path,
          label,
          status: "skipped" as const,
          ...(skip === undefined ? {} : { skip }),
        })),
      ],
    });
  }

  /**
   * An earlier run that read all seven pages, and a later one that loaded the pages `paths` names
   * and skipped them (for `skip`, as the helper has it), and read the rest.
   */
  function skippedLater(paths: string[], skip?: SkipReason | null): RunJson[] {
    return [
      sevenPages({ id: "r1", createdAt: "2026-09-25T10:00:00-05:00" }),
      sevenPages({
        id: "r2",
        createdAt: "2026-09-26T14:05:00-05:00",
        sessions: [{ reviewer: CHRIS }],
        page: (path) =>
          paths.includes(path)
            ? { status: "skipped", ...(skip === undefined ? {} : { skip }) }
            : {},
      }),
    ];
  }

  it("says a skipped page in the sentence, and as a task to check", () => {
    const run = withSkipped([["/files/report/", "Annual report"]]);

    const summary = summarize({ runs: [run] });

    expect(summary.sentence).toBe(
      "NVDA read 2 of the 3 pages, run by Christopher Schweda. No flags were raised, and no issues were found. 1 page was skipped, not read.",
    );
    expect(summary.todo).toEqual([
      "Annual report was skipped: the site didn't answer with an HTML page. Check whether it belongs on the list.",
    ]);
    expect(summary.todo).not.toContain(NOTHING_LEFT);
    expect(summary.complete).toContain("Skipped, not read: 1.");
  });

  it.each<[SkipReason, string]>([
    ["non-html-response", "the site didn't answer with an HTML page"],
    ["redirect-off-origin", "it redirected to another site"],
    ["non-html-extension", "its address isn't an HTML page"],
    ["off-origin", "it's on another site"],
  ])("says why a page was skipped, from its record: %s", (reason, why) => {
    const run = withSkipped([["/files/report/", "Annual report", reason]]);

    expect(summarize({ runs: [run] }).todo).toEqual([
      `Annual report was skipped: ${why}. Check whether it belongs on the list.`,
    ]);
  });

  it("says a page was skipped, and no more, when its record has no reason, or one this version doesn't know", () => {
    const task = "Annual report was skipped. Check whether it belongs on the list.";

    expect(
      summarize({ runs: [withSkipped([["/files/report/", "Annual report", null]])] }).todo,
    ).toEqual([task]);
    // A newer voicecap's reason.
    const newer = "somewhere-new" as SkipReason;
    expect(
      summarize({ runs: [withSkipped([["/files/report/", "Annual report", newer]])] }).todo,
    ).toEqual([task]);
  });

  it("counts a page the latest run skipped, with an earlier run's transcripts, as read, and still asks about it", () => {
    const summary = summarize({ runs: skippedLater(["/"]) });

    // Home's transcripts are the earlier run's, so all seven pages were read: nothing is "skipped,
    // not read" beside that.
    expect(summary.sentence).toBe(
      "NVDA read all 7 pages, run by Christopher Schweda. No flags were raised, and no issues were found.",
    );
    expect(summary.numbers.transcribed).toBe(7);
    expect(summary.todo).toEqual([
      "Home was skipped in the latest run: the site didn't answer with an HTML page. Its transcripts are from an earlier run. Check whether it belongs on the list.",
    ]);
    expect(summary.todo).not.toContain(NOTHING_LEFT);
    // The line about the problems agrees with "Pages read: 7 of 7".
    expect(summary.complete).toEqual([
      "Pages read: 7 of 7.",
      "No problems during the runs: no attempt failed. 1 page was skipped in the latest run.",
      "Unexpected errors: none.",
    ]);
  });

  it("says a page skipped in the latest run, with transcripts from before, without a reason when the record has none", () => {
    expect(summarize({ runs: skippedLater(["/"], null) }).todo).toEqual([
      "Home was skipped in the latest run. Its transcripts are from an earlier run. Check whether it belongs on the list.",
    ]);
    expect(summarize({ runs: skippedLater(["/"], "somewhere-new" as SkipReason) }).todo).toEqual([
      "Home was skipped in the latest run. Its transcripts are from an earlier run. Check whether it belongs on the list.",
    ]);
  });

  it("says each page the latest run skipped its own way: one read before, and one never read", () => {
    const earlier = shareRun({
      id: "r1",
      createdAt: "2026-09-25T10:00:00-05:00",
      pages: [
        { path: "/", label: "Home" },
        { path: "/about/", label: "About", status: "skipped" },
      ],
    });
    const latest = shareRun({
      id: "r2",
      createdAt: "2026-09-26T14:05:00-05:00",
      sessions: [{ reviewer: CHRIS }],
      pages: [
        { path: "/", label: "Home", status: "skipped", skip: "redirect-off-origin" },
        { path: "/about/", label: "About", status: "skipped", skip: "off-origin" },
        { path: "/contact/", label: "Contact" },
      ],
    });

    const summary = summarize({ runs: [earlier, latest] });

    // Only About was never read: it's the one the sentence and "Skipped, not read" count.
    expect(summary.sentence).toBe(
      "NVDA read 2 of the 3 pages, run by Christopher Schweda. No flags were raised, and no issues were found. 1 page was skipped, not read.",
    );
    expect(summary.todo).toEqual([
      "Home was skipped in the latest run: it redirected to another site. Its transcripts are from an earlier run. Check whether it belongs on the list.",
      "About was skipped: it's on another site. Check whether it belongs on the list.",
    ]);
    expect(summary.complete).toEqual([
      "Pages read: 2 of 3.",
      "No problems during the runs: no attempt failed. 1 page was skipped, not read. 1 page was skipped in the latest run.",
      "Unexpected errors: none.",
      "Skipped, not read: 1.",
    ]);
  });

  it("says each skipped page as a task, up to four, and then how many more", () => {
    const pages = (count: number): [string, string][] =>
      Array.from({ length: count }, (_, index) => [`/file-${index + 1}/`, `File ${index + 1}`]);
    const task = (name: string) =>
      `${name} was skipped: the site didn't answer with an HTML page. Check whether it belongs on the list.`;

    const four = summarize({ runs: [withSkipped(pages(4))] });
    expect(four.todo).toEqual([task("File 1"), task("File 2"), task("File 3"), task("File 4")]);
    expect(four.sentence).toMatch(/ 4 pages were skipped, not read.$/);

    const five = summarize({ runs: [withSkipped(pages(5))] });
    expect(five.todo).toEqual([
      task("File 1"),
      task("File 2"),
      task("File 3"),
      "And 2 more pages were skipped. Check whether they belong on the list.",
    ]);
    expect(five.sentence).toMatch(/ 5 pages were skipped, not read.$/);
  });

  it("says skipped pages after those that couldn't be read, in the sentence and in the tasks", () => {
    const flags = [genericFlag("tab", [{ text: "read more", count: 2 }])];
    const run = sevenPages({
      sessions: [{ reviewer: CHRIS }],
      page: (path) => {
        if (path === "/") return { status: "skipped" };
        if (path === "/the-report/") return { status: "failed" };
        if (path === "/how-a-run-works/") return { status: "skipped", skip: "redirect-off-origin" };
        return path === COMMON ? { flags } : {};
      },
    });
    const reviews = reviewsOf(review(run, "/reading-transcripts/", "issue"));

    const summary = summarize({ runs: [run], reviews });

    expect(summary.sentence).toBe(
      "NVDA read 4 of the 7 pages, run by Christopher Schweda, who reviewed 1 of the 4 transcripts. 1 page has an issue a screen reader user would hear, found in review. 1 page has flags worth a closer listen. 1 page couldn't be read after every attempt. 2 pages were skipped, not read.",
    );
    // Issues first, then pages to read again, then pages to check, then flags to decide about.
    expect(summary.todo).toEqual([
      "Fix the issue found on Reading transcripts, then record it as fixed.",
      "Run voicecap again on The report: it couldn't be read after every attempt.",
      "Home was skipped: the site didn't answer with an HTML page. Check whether it belongs on the list.",
      "How a run works was skipped: it redirected to another site. Check whether it belongs on the list.",
      "Take a closer listen to Common mistakes, where flags were raised, and record what you decide.",
    ]);
  });
});

describe("summaryOf: the demo runs of 29 September 2026", () => {
  // voicecap 0.4.1 recorded these: no reviewers, no listener's statement, and flags with no list of
  // what they found. Each of runs 1315 and 1402 lost a page the other read.
  const runs = () => [demoRun("1315"), demoRun("1402")];
  const pathOf = (page: { url: string }) => new URL(page.url).pathname;
  /** The slug of a demo page, as its record has it: it names the page's card. */
  const slugOfDemo = (path: string): string => {
    const page = standingOf(runs()).pages.find((candidate) => pathOf(candidate) === path);
    if (page === undefined) throw new Error(`No demo page ${path}`);
    return page.slug;
  };

  it("counts the page that failed in the latest run as read, from the run that read it", () => {
    const summary = summarize({ runs: runs(), name: pathOf });

    expect(summary.sentence).toBe("NVDA read all 7 pages. 1 page has flags worth a closer listen.");
    expect(summary.numbers).toEqual({
      pagesInScope: 7,
      transcribed: 7,
      flagged: 1,
      rules: 3,
      listened: 0,
      linesSpoken: 204,
      nvdaMs: 383_000,
    });
    expect(summary.bars.results).toEqual({ done: 6, flagged: 1, never: 0 });
    expect(summary.bars.flagsByRule).toEqual([
      { rule: "generic-link-text", count: 6 },
      { rule: "unlabeled", count: 3 },
      { rule: "headings", count: 1 },
    ]);
  });

  it("says each flag's message when the record has no list of what it found", () => {
    const { attention } = summarize({ runs: runs(), name: pathOf });

    expect(attention).toEqual([
      {
        slug: slugOfDemo("/common-mistakes/"),
        name: "/common-mistakes/",
        clauses:
          'Generic link text announced 3 times in the read pass: "click here" ×3; Generic link text announced 3 times in the tab pass: "click here" ×3; Unlabeled or poorly labeled items in the read pass: "button" ×1; Unlabeled or poorly labeled items in the tab pass: "button" ×1, "edit" ×1; its first heading is level 2, not 1',
      },
    ]);
  });

  it("says what a listener hears, when the flags are computed afresh with what they found", () => {
    const standing = standingOf(runs());
    const flags = flagsOf(standing);
    const key = standing.pages.find((page) => pathOf(page) === "/common-mistakes/")?.key ?? "";
    flags.set(key, [
      genericFlag("read", [{ text: "click here", count: 3 }]),
      genericFlag("tab", [{ text: "click here", count: 3 }]),
      unlabeledFlag("read", [{ text: "button", count: 1 }]),
      unlabeledFlag("tab", [
        { text: "button", count: 1 },
        { text: "edit", count: 1 },
      ]),
      ...(flagsOf(standing).get(key) ?? []).filter((flag) => flag.rule === "headings"),
    ]);

    expect(summarize({ runs: runs(), flags, name: pathOf }).attention).toEqual([
      {
        slug: slugOfDemo("/common-mistakes/"),
        name: "/common-mistakes/",
        clauses:
          "3 links say only “click here”; 2 controls have no names, so NVDA says only “button” and “edit”; its first heading is level 2, not 1",
      },
    ]);
  });

  it("says how complete the test was, and what is still to do", () => {
    const standing = standingOf(runs());
    const { complete, todo } = summarize({ runs: runs(), name: pathOf });

    expect(complete).toEqual([
      "Pages read: 7 of 7.",
      problemsOf(standing, options).line,
      "Unexpected errors: none.",
    ]);
    expect(complete[1]).toMatch(
      /^2 problems, both outside voicecap: another window took the screen\./,
    );
    expect(todo).toEqual([
      "Take a closer listen to /common-mistakes/, where flags were raised, and record what you decide.",
    ]);
  });

  it("says when and how, and that who ran it was not recorded", () => {
    expect(summarize({ runs: runs(), name: pathOf }).whenHow).toEqual([
      { label: "Date", value: "29 September 2026" },
      { label: "Run by", value: "Not recorded: this run used voicecap 0.4.1." },
      { label: "Screen reader", value: "NVDA 2026.2" },
      { label: "Browser", value: "Chrome 154.0.8037.58" },
      { label: "Operating system", value: "Windows 11 Pro 25H2 (10.0.26200)" },
    ]);
  });

  it("gives the line about the run before", () => {
    const [before, after] = runs();
    if (before === undefined || after === undefined) throw new Error("No demo runs");
    const changes = changesOf(before, after, () => null, pathOf);

    expect(summarize({ runs: runs(), changes, name: pathOf }).changesLine).toBe(
      "Since the last run on 29 September: every page sounds the same.",
    );
  });
});

describe("summaryOf: no run counts yet", () => {
  it("says so, and leaves everything else empty", () => {
    const replayed = shareRun({ id: "p1", replayed: true, pages: [{ path: "/" }] });
    const interrupted = shareRun({
      id: "p2",
      status: "incomplete",
      pages: [{ path: "/", flags: [headingsFlag([])] }],
    });

    for (const runs of [[], [replayed, interrupted]]) {
      expect(summarize({ runs })).toEqual({
        sentence:
          "No live run counts yet: voicecap shows only completed, sealed runs with a real screen reader.",
        second:
          "A human review, sped up: voicecap pressed NVDA's keys and moved from page to page; a person did the listening, the reading, and the deciding.",
        numbers: {
          pagesInScope: 0,
          transcribed: 0,
          flagged: 0,
          rules: 0,
          listened: 0,
          linesSpoken: 0,
          nvdaMs: 0,
        },
        attention: [],
        complete: [],
        todo: [],
        whenHow: [],
        bars: {
          results: { done: 0, flagged: 0, never: 0 },
          flagsByRule: [],
          review: { listened: [0, 0], reviewed: [0, 0], fixed: [0, 0] },
        },
        changesLine: null,
      });
    }
  });
});
