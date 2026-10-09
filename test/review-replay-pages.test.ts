/**
 * Which pages the replay plays, and the lines it plays of each (src/review-replay/pages.ts). By
 * default, the pages a card of What needs attention names, among those NVDA read (D2); with `all`,
 * every page; with a page's key, that page. Each pass plays the steps the flag rules read, each
 * line with its number in the TXT transcript, and a mark for each flag it raised (D5, D6). A rule
 * whose quote stands for a place on the page marks that place, not the same words said elsewhere
 * (Ruling R8, flagQuotedSteps in src/flags/evaluate.ts).
 *
 * The cases are the scripted site's counted run, the i2i v3 run of 6 October 2026 (read in place,
 * or from a temporary copy when a test takes a file away), and runs built in memory.
 */
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { VoicecapConfig } from "../src/config/schema.js";
import {
  evaluateFlags,
  flagQuotedSteps,
  flagQuotes,
  type PagePasses,
} from "../src/flags/evaluate.js";
import type { DriverCommand, FlagResult, ReviewStatus, RunJson, StepRecord } from "../src/model.js";
import { normalizeSpeech } from "../src/passes/steps.js";
import {
  replayPagesOf,
  transcriptsOf,
  type ReplayChoice,
  type ReplayPage,
} from "../src/review-replay/pages.js";
import type { PlayLine } from "../src/review-replay/player.js";
import { addReview } from "../src/reviews/review.js";
import { loadShareInput } from "../src/share/load.js";
import { buildShareModel, namedByAttention } from "../src/share/model.js";
import { UsageError, errorMessage } from "../src/util/errors.js";
import { createMemoryLogger } from "../src/util/log.js";
import { config, homeWithCountedRun, setup } from "./helpers/run-site.js";
import { failedAttempt, shareRun } from "./helpers/share-data.js";
import { inputOf, LINES, LINK_FLAG, storeOf, TRANSCRIPTS } from "./helpers/share-model.js";

/** The i2i v3 run of 6 October 2026: its site's folder, read in place, never written to. */
const I2I = fileURLToPath(new URL("../fixture/i2i-v3-run/v3--i2i.netlify.app", import.meta.url));

/** The i2i home page's key: the run read its logo with no name, twice in the read pass. */
const I2I_HOME = "https://v3--i2i.netlify.app/";

/** The i2i Contact page: its folder in the run, and its key. */
const CONTACT = { slug: "contact-bf1e63ff97", key: "https://v3--i2i.netlify.app/contact" };

/** The scripted site's pages, by their keys. */
const ABOUT = "https://example.illinois.gov/about";
const RESOURCES = "https://example.illinois.gov/resources";

/** The flagged page of the run built in memory (neverReadRun), by its key. */
const FLAGGED = "https://example.illinois.gov/flagged";

const BY_DEFAULT: ReplayChoice = { page: null, all: false };
const EVERY_PAGE: ReplayChoice = { page: null, all: true };
const only = (page: string): ReplayChoice => ({ page, all: false });

/** Each folder made here, taken away at the end. */
const folders: string[] = [];

afterAll(async () => {
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
});

/** A home with the scripted site's counted run, in a folder taken away at the end. */
async function countedHome() {
  const dir = await setup();
  folders.push(dir);
  return homeWithCountedRun(dir);
}

/** A copy of the i2i run's site folder without one page's read.json, taken away at the end. */
async function i2iWithoutRead(slug: string): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), "voicecap-replay-pages-"));
  folders.push(home);
  const siteDir = path.join(home, "v3--i2i.netlify.app");
  await cp(I2I, siteDir, { recursive: true });
  await rm(path.join(siteDir, "2026-10-06", "1134", "pages", slug, "read.json"));
  return siteDir;
}

/** The pages `choice` picks in a site's folder, and the model they were picked from. */
async function picked(siteDir: string, settings: VoicecapConfig, choice: ReplayChoice) {
  const input = await loadShareInput({ siteDir, config: settings });
  const model = buildShareModel(input);
  return { ...replayPagesOf(input, model, choice), model };
}

const pathsOf = (pages: ReplayPage[]): string[] => pages.map((page) => page.path);

/** The one page picked: the test fails here when there isn't exactly one. */
function theOne(pages: ReplayPage[]): ReplayPage {
  expect(pages).toHaveLength(1);
  return pages[0]!;
}

/** Whole numbers from `first` to `last`. */
const upTo = (first: number, last: number): number[] =>
  Array.from({ length: last - first + 1 }, (_, index) => first + index);

/** What `act` was refused with: a UsageError's message. The test fails when there's none. */
function refusalOf(act: () => unknown): string {
  try {
    act();
  } catch (error) {
    expect(error).toBeInstanceOf(UsageError);
    return errorMessage(error);
  }
  throw new Error("It wasn't refused.");
}

/**
 * The run of share-model.test.ts's "counts a page never read as not read": / is read, /flagged is
 * read with a generic link in its read pass, and /never failed, so no run read it.
 */
function neverReadRun(): RunJson {
  return shareRun({
    id: "r1",
    pages: [
      { path: "/", files: TRANSCRIPTS, passes: LINES },
      { path: "/flagged", files: TRANSCRIPTS, passes: LINES, flags: [LINK_FLAG] },
      { path: "/never", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
    ],
  });
}

/** A step of a pass: what NVDA said after `command`, and at a Tab stop, if it was in the page. */
function step(n: number, command: DriverCommand, spoken: string, inDocument?: boolean): StepRecord {
  return {
    n,
    command,
    spoken,
    durationMs: 1000,
    offsetMs: n * 1000,
    ...(inDocument === undefined ? {} : { inDocument }),
  };
}

/** A Tab stop on a link in the page, in the main content or not. */
function stop(n: number, name: string, inMain = false): StepRecord {
  return {
    ...step(n, "nextFocusable", `${name}, link`, true),
    focused: { tag: "a", role: "link", name, inMain, href: "/" },
  };
}

/**
 * Passes that say the same words at more than one place. The read stopped at its step limit on a
 * "Read more" link it had read twice before. The first heading's words come again later. Tab stops
 * five times before the main content, with no skip link, and two of those stops come again in the
 * footer.
 */
const PLACES: PagePasses = {
  read: {
    steps: [
      step(1, "toBottom", "Footer"),
      step(2, "toTop", "Welcome"),
      step(3, "nextLine", "link, Read more"),
      step(4, "nextLine", "Text"),
      step(5, "nextLine", "link, Read more"),
      step(6, "nextLine", "link, Read more"),
    ],
    stopReason: "step-cap",
  },
  headings: {
    steps: [
      step(1, "nextHeading", "heading, level 2, News"),
      step(2, "nextHeading", "heading, level 3, Grants"),
      step(3, "nextHeading", "heading, level 2, News"),
      step(4, "nextHeading", "no next heading"),
    ],
    stopReason: "no-next-heading",
  },
  tab: {
    steps: [
      stop(1, "Home"),
      stop(2, "About"),
      stop(3, "Home"),
      stop(4, "Contact"),
      stop(5, "Search"),
      stop(6, "Apply", true),
      stop(7, "About"),
      stop(8, "Home"),
      step(9, "nextFocusable", "Address and search bar, edit", false),
    ],
    stopReason: "left-document",
  },
};

/** The rules PLACES is read with: a missing skip link is flagged from 3 stops before the main. */
const PLACE_RULES = {
  ...DEFAULT_CONFIG.flags,
  tabBeforeMain: { ...DEFAULT_CONFIG.flags.tabBeforeMain, maxStops: 3 },
};

/**
 * The flags those rules raise on PLACES: generic-link-text in the read pass, read-not-finished,
 * headings, and tab-before-main.
 */
const PLACE_FLAGS = evaluateFlags(PLACES, PLACE_RULES);

/** PLACES' lines to play, with their marks. */
const placeLines = () => transcriptsOf(PLACES, PLACE_FLAGS, PLACE_RULES);

/** The flag `rule` raised on PLACES. */
function placeFlag(rule: string): FlagResult {
  const flag = PLACE_FLAGS.find((each) => each.rule === rule);
  if (flag === undefined) throw new Error(`No ${rule} flag`);
  return flag;
}

/** Each marked line of a transcript: its number, and its marks. */
const markedLines = (lines: PlayLine[] | undefined) =>
  (lines ?? []).filter((line) => line.marks.length > 0).map(({ n, marks }) => [n, marks]);

describe("replayPagesOf", () => {
  let counted: Awaited<ReturnType<typeof countedHome>>;

  beforeAll(async () => {
    counted = await countedHome();
  });

  it("takes the pages What needs attention names, every page, or one", async () => {
    const { siteDir, run } = counted;
    const settings = config().config;

    // Only /resources raised flags, so only it is on a card of What needs attention (D2): the
    // ring's "Read, with problems".
    const byDefault = await picked(siteDir, settings, BY_DEFAULT);
    expect(pathsOf(byDefault.pages)).toEqual(["/resources"]);
    expect(byDefault.leftOut).toEqual([]);
    expect(byDefault.model.ring.needAttention).toBe(1);

    const every = await picked(siteDir, settings, EVERY_PAGE);
    expect(pathsOf(every.pages)).toEqual(["/", "/about", "/resources"]);
    expect(every.leftOut).toEqual([]);

    expect(pathsOf((await picked(siteDir, settings, only(ABOUT))).pages)).toEqual(["/about"]);

    // Each plays the counted run's transcripts, and is named as that run's record names it.
    expect(
      every.pages.map(({ key, url, run: played, flags }) => ({ key, url, run: played, flags })),
    ).toEqual([
      {
        key: "https://example.illinois.gov/",
        url: "https://example.illinois.gov/",
        run: run.runId,
        flags: 0,
      },
      { key: ABOUT, url: "https://example.illinois.gov/about", run: run.runId, flags: 0 },
      { key: RESOURCES, url: "https://example.illinois.gov/resources", run: run.runId, flags: 5 },
    ]);
    expect(every.pages.map((page) => page.url)).toEqual(run.run.pages.map((page) => page.url));
  });

  it("marks the lines that raised a flag, by what the rule found", async () => {
    const { pages, leftOut } = await picked(I2I, DEFAULT_CONFIG, only(I2I_HOME));
    expect(leftOut).toEqual([]);
    const home = theOne(pages);
    expect(home).toMatchObject({
      key: I2I_HOME,
      url: I2I_HOME,
      path: "/",
      run: "2026-10-06_1134",
      flags: 2,
    });

    const read = home.transcripts.read ?? [];
    // D6: from Ctrl+Home's line, line 2 of read.txt, shown with its label and said without it...
    expect(read[0]).toEqual({
      n: 2,
      text: "[to top] out of list, Skip links, navigation landmark, same page, link, Skip to main content",
      spoken: "out of list, Skip links, navigation landmark, same page, link, Skip to main content",
      marks: [],
    });
    // ...without Ctrl+End's line 1, and with the last line (32) once, not its repeats (33 and 34).
    expect(read.some((line) => line.n === 1)).toBe(false);
    expect(read.map((line) => line.n)).toEqual(upTo(2, 32));
    // D5: the two lines where NVDA said "Unlabeled graphic", marked with what the rule found.
    expect(read.filter((line) => line.marks.length > 0).map(({ n, marks }) => [n, marks])).toEqual([
      [4, ["unlabeled graphic"]],
      [11, ["unlabeled graphic"]],
    ]);
    expect(read.find((line) => line.n === 11)).toEqual({
      n: 11,
      text: "main landmark, Unlabeled graphic, i 2i logo",
      spoken: "main landmark, Unlabeled graphic, i 2i logo",
      marks: ["unlabeled graphic"],
    });

    // The Tab pass raised its own flag, at the logo's stop: without the stop that left the page.
    const tab = home.transcripts.tab ?? [];
    expect(tab.find((line) => line.n === 3)?.marks).toEqual(["unlabeled graphic"]);
    expect(tab.filter((line) => line.marks.length > 0).map((line) => line.n)).toEqual([3]);
    expect(tab.map((line) => line.n)).toEqual(upTo(1, 17));
    // The headings, without "no next heading", and none flagged.
    expect(home.transcripts.headings?.map(({ n, marks }) => [n, marks])).toEqual(
      upTo(1, 6).map((n) => [n, []]),
    );
  });

  it("marks a heading the headings rule quoted, by the rule's id", async () => {
    const resources = theOne(
      (await picked(counted.siteDir, config().config, only(RESOURCES))).pages,
    );

    expect(resources.transcripts.headings).toEqual([
      {
        n: 1,
        text: "heading, level 2, Resources",
        spoken: "heading, level 2, Resources",
        marks: ["headings"],
      },
    ]);
    // The headings flag marks only its own pass: the read pass's same words have no mark. Each
    // "link, Read more" has what the generic-link-text rule found, once; "Text" has none.
    expect(resources.transcripts.read).toEqual([
      {
        n: 2,
        text: "[to top] heading, level 2, Resources",
        spoken: "heading, level 2, Resources",
        marks: [],
      },
      { n: 3, text: "link, Read more", spoken: "link, Read more", marks: ["read more"] },
      { n: 4, text: "Text", spoken: "Text", marks: [] },
      { n: 5, text: "link, Read more", spoken: "link, Read more", marks: ["read more"] },
      { n: 6, text: "button", spoken: "button", marks: ["button"] },
      { n: 7, text: "End", spoken: "End", marks: [] },
    ]);
    expect(resources.transcripts.tab).toEqual([
      { n: 1, text: "Read more, link", spoken: "Read more, link", marks: ["read more"] },
      { n: 2, text: "Read more, link", spoken: "Read more, link", marks: ["read more"] },
      { n: 3, text: "button", spoken: "button", marks: ["button"] },
    ]);
  });

  it("marks a line a custom rule matched by its id, after what the rules found", async () => {
    const custom = (id: string, description: string, pattern: string) => ({
      id,
      description,
      passes: ["read" as const],
      pattern,
      minCount: 1,
    });
    const settings = config({
      flags: {
        custom: [
          custom("vague-link", "A link that says only Read more", "read more$"),
          // An id that is also what the unlabeled rule finds on the same line: one mark, once.
          custom("button", "A button, said alone", "^button$"),
        ],
      },
    }).config;
    const resources = theOne((await picked(counted.siteDir, settings, only(RESOURCES))).pages);

    // The config's rules raised two more flags, each in the read pass alone.
    expect(resources.flags).toBe(7);
    expect(
      resources.transcripts.read
        ?.filter((line) => line.marks.length > 0)
        .map(({ n, marks }) => [n, marks]),
    ).toEqual([
      [3, ["read more", "vague-link"]],
      [5, ["read more", "vague-link"]],
      [6, ["button"]],
    ]);
    expect(resources.transcripts.tab?.map((line) => line.marks)).toEqual([
      ["read more"],
      ["read more"],
      ["button"],
    ]);
  });

  it("follows the review, as What needs attention does", async () => {
    const { dir, siteDir } = await countedHome();
    const settings = config();
    const review = (status: ReviewStatus) =>
      addReview({
        page: "/resources",
        status,
        reviewer: "Pat Reviewer",
        cwd: dir,
        env: {},
        logger: createMemoryLogger(),
        config: settings,
        regenerateReport: false,
      });

    await review("reviewed");
    const settled = await picked(siteDir, settings.config, BY_DEFAULT);
    expect(settled.pages).toEqual([]);
    expect(settled.leftOut).toEqual([]);
    expect(settled.model.ring.needAttention).toBe(0);

    await review("issue");
    const open = await picked(siteDir, settings.config, BY_DEFAULT);
    expect(pathsOf(open.pages)).toEqual(["/resources"]);
    expect(open.model.ring.needAttention).toBe(1);
  });

  it("leaves out a page with nothing to hear, and says so", async () => {
    const siteDir = await i2iWithoutRead(CONTACT.slug);

    const every = await picked(siteDir, DEFAULT_CONFIG, EVERY_PAGE);
    expect(every.pages).toHaveLength(31);
    expect(pathsOf(every.pages)).not.toContain("/contact/");
    expect(every.leftOut).toEqual(["/contact/"]);

    // By default too: its flags are on a card, as its record has them, though it can't be heard.
    const byDefault = await picked(siteDir, DEFAULT_CONFIG, BY_DEFAULT);
    expect(byDefault.pages).toHaveLength(31);
    expect(byDefault.leftOut).toEqual(["/contact/"]);
  });

  it("says why one page can't be heard", async () => {
    const input = inputOf([neverReadRun()], { transcripts: storeOf() });
    const model = buildShareModel(input);
    const refused = (key: string) => refusalOf(() => replayPagesOf(input, model, only(key)));

    expect(refused("https://example.illinois.gov/nowhere")).toBe(
      "https://example.illinois.gov/nowhere isn't one of the pages in scope, so there's no transcript of it to hear.",
    );
    expect(refused("https://example.illinois.gov/never")).toBe(
      "No run that counts has transcripts for https://example.illinois.gov/never yet.",
    );

    // A page whose read pass can't be read here: its read.json is gone.
    const siteDir = await i2iWithoutRead(CONTACT.slug);
    const copy = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });
    expect(refusalOf(() => replayPagesOf(copy, buildShareModel(copy), only(CONTACT.key)))).toBe(
      "The read transcript of /contact/ can't be read here.",
    );
  });

  it("takes no page NVDA didn't read by default, and leaves it out of every page", () => {
    const input = inputOf([neverReadRun()], { transcripts: storeOf() });
    const model = buildShareModel(input);
    const slugOf = (at: string) => model.pages.find((card) => card.path === at)?.slug;

    // /never's failure is on a card, as /flagged's link is, but NVDA never read /never (D2).
    expect(namedByAttention(model.attention)).toEqual(
      new Set([slugOf("/flagged"), slugOf("/never")]),
    );
    const byDefault = replayPagesOf(input, model, BY_DEFAULT);
    expect(pathsOf(byDefault.pages)).toEqual(["/flagged"]);
    expect(byDefault.leftOut).toEqual([]);
    expect(model.ring.needAttention).toBe(1);

    const every = replayPagesOf(input, model, EVERY_PAGE);
    expect(pathsOf(every.pages)).toEqual(["/", "/flagged"]);
    expect(every.leftOut).toEqual(["/never"]);
  });

  it("plays a page from its shown run, though a later run couldn't read it", () => {
    // The earlier run read /about/ and found a generic link; the latest couldn't read /about. The
    // page shows the earlier run's transcripts, so it plays them, and a decision on it is recorded
    // against that run (C3), for the page as that run recorded it.
    const earlier = shareRun({
      id: "r1",
      createdAt: "2026-09-25T10:00:00-05:00",
      pages: [
        { path: "/", files: TRANSCRIPTS, passes: LINES },
        { path: "/about/", files: TRANSCRIPTS, passes: LINES, flags: [LINK_FLAG] },
      ],
    });
    const latest = shareRun({
      id: "r2",
      pages: [
        { path: "/", files: TRANSCRIPTS, passes: LINES },
        { path: "/about", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
      ],
    });
    const input = inputOf([earlier, latest], { transcripts: storeOf() });
    const { pages, leftOut } = replayPagesOf(input, buildShareModel(input), BY_DEFAULT);

    expect(leftOut).toEqual([]);
    expect(pages.map(({ transcripts: _played, ...page }) => page)).toEqual([
      {
        key: ABOUT,
        url: "https://example.illinois.gov/about/",
        path: "/about",
        run: "r1",
        flags: 1,
      },
    ]);
  });

  it("marks a line only for a flag raised in its own pass", () => {
    const input = inputOf([neverReadRun()], { transcripts: storeOf() });
    const flagged = theOne(replayPagesOf(input, buildShareModel(input), only(FLAGGED)).pages);

    // The run raised its generic link in the read pass alone: the rule finds "click here" in the
    // Tab pass too, but that line raised no flag, so it has no mark.
    expect(flagged.flags).toBe(1);
    expect(flagged.transcripts.read?.map(({ n, marks }) => [n, marks])).toEqual([
      [1, []],
      [2, []],
      [3, ["click here"]],
      [4, []],
    ]);
    expect(flagged.transcripts.tab).toEqual([
      {
        n: 1,
        text: "Skip to main content, link",
        spoken: "Skip to main content, link",
        marks: [],
      },
      { n: 2, text: "click here, link", spoken: "click here, link", marks: [] },
    ]);
  });

  it("refuses page cards that aren't the standing's", () => {
    const input = inputOf([neverReadRun()], { transcripts: storeOf() });
    const cardsOf = (paths: string[]) =>
      buildShareModel(inputOf([shareRun({ id: "r2", pages: paths.map((at) => ({ path: at })) })]));
    const thrown = (act: () => unknown): unknown => {
      try {
        act();
      } catch (error) {
        return error;
      }
      throw new Error("It didn't throw.");
    };

    // A card of another page where the standing has /flagged, and one card short of /never.
    for (const [paths, key] of [
      [["/", "/elsewhere", "/never"], "https://example.illinois.gov/elsewhere"],
      [["/", "/flagged"], "https://example.illinois.gov/never"],
    ] as const) {
      const error = thrown(() => replayPagesOf(input, cardsOf([...paths]), EVERY_PAGE));
      expect(error).not.toBeInstanceOf(UsageError);
      expect(errorMessage(error)).toBe(`The page cards and the standing disagree at ${key}.`);
    }
  });
});

describe("transcriptsOf", () => {
  it("marks a line for a flag only in the pass that raised it", () => {
    // The same words in two passes, and flags as a record might have them: the unlabeled rule finds
    // "button" in both passes, but raised its flag in the Tab pass alone; the headings rule quotes
    // its first heading in the headings pass; and the read stopped at its step limit.
    const flags: FlagResult[] = [
      {
        rule: "unlabeled",
        pass: "tab",
        count: 1,
        found: [{ text: "button", count: 1 }],
        message: 'Unlabeled or poorly labeled items in the tab pass: "button" ×1.',
      },
      {
        rule: "headings",
        pass: "headings",
        message: "The first heading is level 2, not level 1.",
      },
      {
        rule: "read-not-finished",
        pass: "read",
        message:
          "The read pass stopped at its step cap (3 steps) instead of reaching the end of the page.",
      },
    ];
    const transcripts = transcriptsOf(
      {
        read: {
          steps: [
            step(1, "nextLine", "heading, level 2, Resources"),
            step(2, "nextLine", "button"),
            step(3, "nextLine", "Text"),
          ],
          stopReason: "step-cap",
        },
        headings: {
          steps: [
            step(1, "nextHeading", "heading, level 2, Resources"),
            step(2, "nextHeading", "no next heading"),
          ],
          stopReason: "no-next-heading",
        },
        tab: {
          steps: [
            step(1, "nextFocusable", "button", true),
            step(2, "nextFocusable", "Address and search bar, edit", false),
          ],
          stopReason: "left-document",
        },
      },
      flags,
      DEFAULT_CONFIG.flags,
    );

    expect(transcripts).toEqual({
      read: [
        {
          n: 1,
          text: "heading, level 2, Resources",
          spoken: "heading, level 2, Resources",
          marks: [],
        },
        { n: 2, text: "button", spoken: "button", marks: [] },
        { n: 3, text: "Text", spoken: "Text", marks: ["read-not-finished"] },
      ],
      headings: [
        {
          n: 1,
          text: "heading, level 2, Resources",
          spoken: "heading, level 2, Resources",
          marks: ["headings"],
        },
      ],
      tab: [{ n: 1, text: "button", spoken: "button", marks: ["button"] }],
    });
  });

  it("shows each line as its transcript writes it, and says it without its label", () => {
    // D6: Ctrl+Home's line with nothing said, a line NVDA said over two lines, and a silent line,
    // which the voice passes without a word. Ctrl+End's line 1, and the last line's repeat, are
    // left out. The passes not taken have no transcript.
    const transcripts = transcriptsOf(
      {
        read: {
          steps: [
            step(1, "toBottom", "End"),
            step(2, "toTop", ""),
            step(3, "nextLine", "Grants,\n  apply now"),
            step(4, "nextLine", "  "),
            step(5, "nextLine", "End"),
            step(6, "nextLine", "End"),
          ],
          stopReason: "end-reached",
        },
      },
      [],
      DEFAULT_CONFIG.flags,
    );

    expect(transcripts).toEqual({
      read: [
        { n: 2, text: "[to top] [no speech]", spoken: "", marks: [] },
        { n: 3, text: "Grants, apply now", spoken: "Grants, apply now", marks: [] },
        { n: 4, text: "[no speech]", spoken: "", marks: [] },
        { n: 5, text: "End", spoken: "End", marks: [] },
      ],
    });
  });

  // Ruling R8: a quote that stands for a place is marked there, not wherever its words come again.
  it("marks the last line of a read that stopped short, not the same words before it", () => {
    // Each "Read more" link is marked with what the generic-link-text rule found, wherever it was
    // said; only the line the read stopped on is marked as where it stopped.
    expect(PLACE_FLAGS.map((flag) => `${flag.rule}/${flag.pass}`)).toEqual([
      "generic-link-text/read",
      "read-not-finished/read",
      "headings/headings",
      "tab-before-main/tab",
    ]);
    expect(placeLines().read).toEqual([
      { n: 2, text: "[to top] Welcome", spoken: "Welcome", marks: [] },
      { n: 3, text: "link, Read more", spoken: "link, Read more", marks: ["read more"] },
      { n: 4, text: "Text", spoken: "Text", marks: [] },
      { n: 5, text: "link, Read more", spoken: "link, Read more", marks: ["read more"] },
      {
        n: 6,
        text: "link, Read more",
        spoken: "link, Read more",
        marks: ["read more", "read-not-finished"],
      },
    ]);
  });

  it("marks the first heading, not a later heading with the same words", () => {
    expect(markedLines(placeLines().headings)).toEqual([[1, ["headings"]]]);
    expect(placeLines().headings?.map((line) => line.spoken)).toEqual([
      "heading, level 2, News",
      "heading, level 3, Grants",
      "heading, level 2, News",
    ]);
  });

  it("marks the first 3 stops before the main content where they were, not again after it", () => {
    // Five stops before the main content (1 to 5) say four things, so the flag's three quotes are
    // stops 1, 2, and 4. Stop 3 says what stop 1 did. The footer's stops 7 and 8 say what stops 2
    // and 1 did.
    expect(markedLines(placeLines().tab)).toEqual([
      [1, ["tab-before-main"]],
      [2, ["tab-before-main"]],
      [4, ["tab-before-main"]],
    ]);
    expect(placeLines().tab?.map((line) => line.spoken)).toEqual([
      "Home, link",
      "About, link",
      "Home, link",
      "Contact, link",
      "Search, link",
      "Apply, link",
      "About, link",
      "Home, link",
    ]);
  });
});

describe("flagQuotedSteps", () => {
  it("gives where a flag's quotes were said, for a rule whose quotes stand for a place", () => {
    const at = (rule: string) => flagQuotedSteps(PLACES, placeFlag(rule));
    expect(at("read-not-finished")).toEqual([6]);
    expect(at("headings")).toEqual([1]);
    expect(at("tab-before-main")).toEqual([1, 2, 4]);

    // The lines at those steps are the lines flagQuotes quotes, in the same order.
    for (const rule of ["read-not-finished", "headings", "tab-before-main"]) {
      const flag = placeFlag(rule);
      const steps = PLACES[flag.pass!]?.steps ?? [];
      const said = (at(rule) ?? []).map((n) =>
        normalizeSpeech(steps.find((each) => each.n === n)?.spoken ?? ""),
      );
      expect(said, rule).toEqual(flagQuotes(PLACES, PLACE_RULES, flag));
    }

    // None for a pass it isn't given.
    expect(flagQuotedSteps({}, placeFlag("headings"))).toEqual([]);
  });

  it("gives nothing for a rule whose quotes stand for their words", () => {
    const flag = (rule: string): FlagResult => ({ rule, pass: "read", message: "Something." });
    for (const rule of [
      "generic-link-text",
      "unlabeled",
      "repeated-phrase",
      "tab-no-stops",
      "pdf-links",
    ]) {
      expect(flagQuotedSteps(PLACES, flag(rule)), rule).toBeNull();
    }
  });
});
