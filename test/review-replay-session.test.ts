/**
 * The replay's session (src/review-replay/session.ts): each page in turn, the question after it,
 * each decision recorded through addReview against the run whose transcripts played (C3), and the
 * live report written once at the end, only when a decision was recorded (D8).
 *
 * Each session runs on a home with the scripted site's counted run (homeWithCountedRun), whose
 * pages are / and /about, with no flags, and /resources, with 5: so by default only /resources
 * plays. It runs from a folder of its own, so it finds the home only as it's told to. The person
 * answers only when the session asks (answering), and the voice says each line at once, so a page
 * plays to its end and the question follows.
 */
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";

import { afterAll, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { RunJson } from "../src/model.js";
import type { Key } from "../src/review-replay/keys.js";
import {
  replayReview,
  type ReplayDeps,
  type ReplayOptions,
  type ReplayResult,
} from "../src/review-replay/session.js";
import { REPLAY_TEXT } from "../src/review-replay/text.js";
import type { Voice } from "../src/review-replay/voice.js";
import { addReview } from "../src/reviews/review.js";
import { readReviews } from "../src/reviews/store.js";
import { runAudit } from "../src/run/audit.js";
import type { LiveReportOptions } from "../src/run/live-report.js";
import { pageDir, runDir, runJsonPath } from "../src/run/paths.js";
import { listRuns } from "../src/run/store.js";
import { EnvironmentError, UsageError, errorMessage } from "../src/util/errors.js";
import { createMemoryLogger } from "../src/util/log.js";
import { answering, fakeVoice, keyQueue, type Answer } from "./helpers/replay.js";
import {
  homeWithCountedRun,
  options as runOptions,
  outDir,
  setup,
  SITE,
} from "./helpers/run-site.js";

/** The scripted site's pages, by their keys. */
const HOME_PAGE = "https://example.illinois.gov/";
const ABOUT = "https://example.illinois.gov/about";
const RESOURCES = "https://example.illinois.gov/resources";

const ENTER: Key = { name: "enter" };
const SPACE: Key = { name: "space" };
const RIGHT: Key = { name: "right" };
const CTRL_C: Key = { name: "ctrl-c" };

type KeyQueue = ReturnType<typeof keyQueue>;
type FakeVoice = ReturnType<typeof fakeVoice>;

/** Each folder made here, taken away at the end. */
const folders: string[] = [];

afterAll(async () => {
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
});

/** Where a session runs: its current folder, and the transcripts home it's given. */
interface Place {
  cwd: string;
  home: string;
}

/** A home with the scripted site's counted run. */
interface CountedHome extends Place {
  /** The folder that holds the home and the site's page list, which runs are made in. */
  dir: string;
  siteDir: string;
  /** The counted run's record. */
  run: RunJson;
}

/**
 * A folder of its own in `dir`, for a session to run from. The home isn't where a session there
 * would look for it by default, so the session finds it only as it's told to.
 */
async function elsewhere(dir: string): Promise<string> {
  const cwd = path.join(dir, "elsewhere");
  await mkdir(cwd);
  return cwd;
}

/** A home with the scripted site's counted run, in a folder taken away at the end. */
async function countedHome(): Promise<CountedHome> {
  const dir = await setup();
  folders.push(dir);
  const { siteDir, run } = await homeWithCountedRun(dir);
  const home = path.join(dir, "transcripts");
  return { dir, cwd: await elsewhere(dir), home, siteDir, run: run.run };
}

/** A page's file in the counted run, by the page's key: "read.json". */
function pageFile(at: CountedHome, key: string, file: string): string {
  const page = at.run.pages.find((record) => record.key === key);
  if (page === undefined) throw new Error(`The counted run has no ${key}.`);
  return path.join(pageDir(at.siteDir, at.run.id, page.slug), file);
}

/**
 * A session at `at`, by Pat Reviewer, at 180 words a minute, with a person who gives `answers`
 * (see answering), a voice that says each line at once, NVDA not running, and a report that's
 * only counted, not written. `options` and `deps` change any of them.
 */
function replay(
  at: Place,
  answers: readonly Answer[],
  given: {
    options?: Partial<ReplayOptions>;
    keys?: KeyQueue;
    voice?: FakeVoice;
    deps?: Partial<ReplayDeps>;
  } = {},
) {
  const keys = given.keys ?? keyQueue();
  const voice = given.voice ?? fakeVoice({ auto: true });
  const out = answering(keys, answers);
  const logger = createMemoryLogger();
  const startVoice = vi.fn((): Promise<Voice> => Promise.resolve(voice));
  const nvdaRunning = vi.fn(() => Promise.resolve(false));
  const writeReport = vi.fn((_options: LiveReportOptions) => Promise.resolve(null));
  const session: Promise<ReplayResult> = replayReview(
    {
      page: null,
      all: false,
      rate: 180,
      reviewer: "Pat Reviewer",
      site: null,
      out: at.home,
      cwd: at.cwd,
      // Never the transcripts home or reviewer name of whoever runs the tests.
      env: {},
      ...given.options,
    },
    { out, keys, logger, startVoice, nvdaRunning, writeReport, ...given.deps },
  );
  return { session, out, keys, voice, logger, startVoice, nvdaRunning, writeReport };
}

/** A line the player shows: a transcript's name as it starts playing, or a line as it's read. */
const PLAYED = /^(?:[ \d]{3}\d {2}|(?:Read|Headings|Tab) transcript, \d+ lines?:$)/;

/** The lines the session shows, without the lines the player shows of each page. */
const sessionLines = (screen: string): string[] =>
  screen.split("\n").filter((line) => line !== "" && !PLAYED.test(line));

/** The last `count` lines of a screen, which ends each line it shows, the last included. */
function lastLines(screen: string, count: number): string[] {
  expect(screen.endsWith("\n")).toBe(true);
  return screen.split("\n").slice(-count - 1, -1);
}

/** Every file under `folder`, by its path there, with its SHA-256: to tell whether any changed. */
async function filesIn(folder: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    const sha256 = createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
    files.set(path.relative(folder, file), sha256);
  }
  return files;
}

/** What `promise` was refused with. The test fails when it wasn't. */
async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => expect.unreachable("It wasn't refused."),
    (error: unknown) => error,
  );
}

/**
 * What `promise` gives once everything already under way has run, or "still waiting" when it
 * hasn't settled by then.
 */
function soon<T>(promise: Promise<T>): Promise<T | "still waiting"> {
  return Promise.race([promise, nextTurn().then(() => "still waiting" as const)]);
}

describe("replayReview", () => {
  it("records each decision through addReview, against the run it played, and writes the report once", async () => {
    const at = await countedHome();
    const report = await readFile(path.join(at.siteDir, "report.html"), "utf8");
    const { session, out, voice, logger, writeReport } = replay(
      at,
      [["1"], ["2", "B", "a", "d", ENTER], ["4"]],
      { options: { all: true } },
    );
    // When the report is written, the voice has closed, and the count isn't said yet.
    writeReport.mockImplementation(() => {
      expect(voice.closed).toBe(true);
      expect(out.text()).not.toContain("Recorded");
      return Promise.resolve(null);
    });
    await expect(session).resolves.toEqual({ decisions: 2, outcome: "done" });

    const { pages } = await readReviews(at.siteDir);
    expect(pages[HOME_PAGE]).toMatchObject([
      { status: "reviewed", note: null, reviewer: "Pat Reviewer", run: at.run.id },
    ]);
    expect(pages[ABOUT]).toMatchObject([
      { status: "issue", note: "Bad", reviewer: "Pat Reviewer", run: at.run.id },
    ]);
    expect(pages[RESOURCES]).toBeUndefined();
    // addReview says what it recorded, each time.
    expect(logger.text("info")).toContain(
      `Recorded "issue" for ${ABOUT} by Pat Reviewer against run ${at.run.id}`,
    );

    expect(writeReport.mock.calls.map(([options]) => options.outDir)).toEqual([at.siteDir]);
    expect(writeReport.mock.calls[0]?.[0].logger).toBe(logger);
    // No decision wrote the report itself: only the session, once, at the end.
    expect(await readFile(path.join(at.siteDir, "report.html"), "utf8")).toBe(report);
    expect(voice.closed).toBe(true);
    expect(sessionLines(out.text())).toEqual([
      REPLAY_TEXT.keys,
      "Page 1 of 3: / (no flags)",
      REPLAY_TEXT.question,
      "Page 2 of 3: /about (no flags)",
      REPLAY_TEXT.question,
      "Note (Enter for none): Bad",
      "Page 3 of 3: /resources (5 flags)",
      REPLAY_TEXT.question,
      "Recorded 2 decisions.",
    ]);
    expect(lastLines(out.text(), 1)).toEqual(["Recorded 2 decisions."]);
  });

  it("answers the question only with 1 to 4", async () => {
    const at = await countedHome();
    // Enter, and every key but 1 to 4, answers nothing. For the note, Enter alone gives none.
    const { session } = replay(at, [[ENTER, "x", "0", "5", "3", ENTER]]);
    await expect(session).resolves.toEqual({ decisions: 1, outcome: "done" });
    const { pages } = await readReviews(at.siteDir);
    expect(Object.keys(pages)).toEqual([RESOURCES]);
    expect(pages[RESOURCES]).toMatchObject([
      { status: "fixed", note: null, reviewer: "Pat Reviewer", run: at.run.id },
    ]);
  });

  it("ends on Ctrl+C, keeping what was recorded", async () => {
    const at = await countedHome();
    const { session, out, voice, writeReport } = replay(at, [["1"], [CTRL_C]], {
      options: { all: true },
    });
    await expect(session).resolves.toEqual({ decisions: 1, outcome: "quit" });
    const { pages } = await readReviews(at.siteDir);
    expect(Object.keys(pages)).toEqual([HOME_PAGE]);
    expect(writeReport).toHaveBeenCalledTimes(1);
    expect(voice.closed).toBe(true);
    expect(out.text()).not.toContain("Page 3 of 3");
    expect(lastLines(out.text(), 2)).toEqual([REPLAY_TEXT.question, "Recorded 1 decision."]);
  });

  it("records nothing for a page whose note was cut short", async () => {
    const at = await countedHome();
    const before = await filesIn(at.home);
    const cut = replay(at, [["2", "x", CTRL_C]]);
    await expect(cut.session).resolves.toEqual({ decisions: 0, outcome: "quit" });
    expect(cut.writeReport).not.toHaveBeenCalled();
    // The note's line is ended, so the count has a line of its own.
    expect(lastLines(cut.out.text(), 2)).toEqual([
      "Note (Enter for none): x",
      "Recorded no decisions.",
    ]);

    // The keys ending during the note, as when the window closes, cut it short too.
    const keys = keyQueue();
    const ended = replay(
      at,
      [
        () => {
          keys.push("3", "x");
          keys.end();
        },
      ],
      { keys },
    );
    await expect(ended.session).resolves.toEqual({ decisions: 0, outcome: "quit" });
    expect(ended.writeReport).not.toHaveBeenCalled();

    expect(existsSync(path.join(at.siteDir, "reviews.json"))).toBe(false);
    expect(await filesIn(at.home)).toEqual(before);
  });

  it("writes nothing when nothing was decided", async () => {
    const at = await countedHome();
    const before = await filesIn(at.home);
    const { session, out, writeReport } = replay(at, [["4"], ["4"], ["4"]], {
      options: { all: true },
    });
    await expect(session).resolves.toEqual({ decisions: 0, outcome: "done" });
    expect(existsSync(path.join(at.siteDir, "reviews.json"))).toBe(false);
    expect(await filesIn(at.home)).toEqual(before);
    expect(writeReport).not.toHaveBeenCalled();
    expect(lastLines(out.text(), 2)).toEqual([REPLAY_TEXT.question, "Recorded no decisions."]);
  });

  it("waits for Enter while NVDA is running", async () => {
    const at = await countedHome();
    let warned = (): void => {};
    const warning = new Promise<void>((resolve) => {
      warned = resolve;
    });
    const keys = keyQueue();
    // At the two lines about NVDA, the person presses nothing yet; after the page, Skip.
    const running = replay(at, [() => warned(), ["4"]], {
      keys,
      deps: { nvdaRunning: () => Promise.resolve(true) },
    });
    // A session that ends before it says so fails here, rather than leave this test waiting.
    const first = await Promise.race([
      warning.then(() => "warned" as const),
      running.session.then(() => "ended" as const),
    ]);
    expect(first).toBe("warned");
    expect(running.out.text()).toBe(`${REPLAY_TEXT.nvda[0]}\n${REPLAY_TEXT.nvda[1]}\n`);
    // Any key but Enter leaves it waiting, with nothing said.
    keys.push("x", "1", SPACE, RIGHT);
    await expect(soon(running.session)).resolves.toBe("still waiting");
    // Each was taken, so none is left for the player.
    await expect(soon(keys.waiting())).resolves.toBe("still waiting");
    expect(running.voice.said).toEqual([]);
    expect(running.out.text()).not.toContain(REPLAY_TEXT.keys);
    keys.push(ENTER);
    await expect(running.session).resolves.toEqual({ decisions: 0, outcome: "done" });
    expect(running.voice.said).not.toEqual([]);
    expect(sessionLines(running.out.text())).toEqual([
      ...REPLAY_TEXT.nvda,
      REPLAY_TEXT.keys,
      "Page 1 of 1: /resources (5 flags)",
      REPLAY_TEXT.question,
      "Recorded no decisions.",
    ]);

    // When NVDA isn't running, or the check can't tell, the session starts at once.
    const checks: [string, () => Promise<boolean>][] = [
      ["not running", () => Promise.resolve(false)],
      ["can't tell", () => Promise.reject(new Error("The process list couldn't be read."))],
    ];
    for (const [what, check] of checks) {
      const nvdaRunning = vi.fn(check);
      const { session, out, voice } = replay(at, [["4"]], { deps: { nvdaRunning } });
      await expect(session, what).resolves.toEqual({ decisions: 0, outcome: "done" });
      expect(out.text(), what).not.toContain(REPLAY_TEXT.nvda[0]);
      expect(out.text(), what).not.toContain(REPLAY_TEXT.nvda[1]);
      expect(voice.said, what).not.toEqual([]);
      // It's asked once, and given nothing: it only asks.
      expect(nvdaRunning.mock.calls, what).toEqual([[]]);
    }

    // The session reaches NVDA only by asking whether it's running: nothing it's given stops,
    // starts, or changes it.
    expectTypeOf<keyof ReplayDeps>().toEqualTypeOf<
      "out" | "keys" | "logger" | "startVoice" | "nvdaRunning" | "writeReport"
    >();
    expectTypeOf<ReplayDeps["nvdaRunning"]>().toEqualTypeOf<() => Promise<boolean>>();
  });

  it("stops before anything is recorded when the voice doesn't start", async () => {
    const at = await countedHome();
    const before = await filesIn(at.home);
    const keys = keyQueue();
    keys.push("1");
    const failure = new EnvironmentError(
      "The computer's voice didn't start: no voice is installed.",
    );
    const { session, out, nvdaRunning, writeReport } = replay(at, [], {
      keys,
      deps: { startVoice: () => Promise.reject(failure) },
    });
    await expect(session).rejects.toBe(failure);
    expect(existsSync(path.join(at.siteDir, "reviews.json"))).toBe(false);
    expect(await filesIn(at.home)).toEqual(before);
    // No key was read: the one pressed is still waiting.
    await expect(soon(keys.next())).resolves.toEqual({ name: "char", char: "1" });
    expect(nvdaRunning).not.toHaveBeenCalled();
    expect(writeReport).not.toHaveBeenCalled();
    // Nothing was asked, so there's no count to give.
    expect(out.text()).toBe("");
  });

  it("ends, and says so, when the voice stops mid-page", async () => {
    const at = await countedHome();
    const keys = keyQueue();
    const voice = fakeVoice({ auto: true });
    const stopped = new EnvironmentError("The computer's voice stopped.");
    // Page 1 is reviewed; then the voice stops working, so page 2's first line fails.
    const { session, out, writeReport } = replay(
      at,
      [
        () => {
          keys.push("1");
          voice.fail(stopped);
        },
      ],
      { options: { all: true }, keys, voice },
    );
    await expect(session).rejects.toBe(stopped);
    const { pages } = await readReviews(at.siteDir);
    expect(Object.keys(pages)).toEqual([HOME_PAGE]);
    expect(pages[HOME_PAGE]).toMatchObject([{ status: "reviewed", reviewer: "Pat Reviewer" }]);
    expect(writeReport).toHaveBeenCalledTimes(1);
    expect(voice.closed).toBe(true);
    expect(out.text()).toContain("Page 2 of 3: /about (no flags)\n");
    expect(lastLines(out.text(), 1)).toEqual(["Recorded 1 decision."]);
  });

  it("closes the voice on every way out", async () => {
    const at = await countedHome();
    const gone = new EnvironmentError("The computer's voice stopped.");
    /**
     * Each way out: what the person does, whether NVDA is running, and how the session ends. A
     * way that ends the session leaves keys after it that a session going on would take: "1" would
     * record a decision, so it can't go unseen.
     */
    const ways: {
      way: string;
      answers: (keys: KeyQueue, voice: FakeVoice) => Answer[];
      nvda?: boolean;
      ends: ReplayResult | Error | RegExp;
    }[] = [
      { way: "the last page", answers: () => [["4"]], ends: { decisions: 0, outcome: "done" } },
      {
        way: "Ctrl+C at the question",
        answers: () => [[CTRL_C, "1"]],
        ends: { decisions: 0, outcome: "quit" },
      },
      {
        way: "Ctrl+C while a page plays",
        answers: (keys) => {
          keys.push(CTRL_C);
          return [["1"]];
        },
        ends: { decisions: 0, outcome: "quit" },
      },
      {
        way: "Ctrl+C while it waits for Enter",
        answers: () => [[CTRL_C, ENTER], ["1"]],
        nvda: true,
        ends: { decisions: 0, outcome: "quit" },
      },
      {
        way: "the keys ending at the question",
        answers: () => [],
        ends: { decisions: 0, outcome: "quit" },
      },
      {
        way: "the keys ending while it waits for Enter",
        answers: () => [],
        nvda: true,
        ends: { decisions: 0, outcome: "quit" },
      },
      {
        way: "the voice failing",
        answers: (_keys, voice) => {
          voice.fail(gone);
          return [];
        },
        ends: gone,
      },
      {
        way: "addReview throwing",
        // Damaged as test/reviews.test.ts's "never overwrites a damaged history" damages it.
        answers: (keys) => [
          () => {
            writeFileSync(path.join(at.siteDir, "reviews.json"), "{ this is not json");
            keys.push("1");
          },
        ],
        ends: /never overwrites review history/,
      },
    ];
    for (const { way, answers, nvda = false, ends } of ways) {
      const keys = keyQueue();
      const voice = fakeVoice({ auto: true });
      const { session, out } = replay(at, answers(keys, voice), {
        keys,
        voice,
        deps: { nvdaRunning: () => Promise.resolve(nvda) },
      });
      if (ends instanceof Error) await expect(session, way).rejects.toBe(ends);
      else if (ends instanceof RegExp) await expect(session, way).rejects.toThrow(ends);
      else await expect(session, way).resolves.toEqual(ends);
      expect(voice.closed, way).toBe(true);
      expect(lastLines(out.text(), 1), way).toEqual(["Recorded no decisions."]);
    }
  });

  it("says how many it recorded when the report can't be written", async () => {
    const at = await countedHome();
    const failure = new Error("report.html couldn't be written.");
    const { session, out, voice } = replay(at, [["1"]], {
      deps: { writeReport: () => Promise.reject(failure) },
    });
    await expect(session).rejects.toBe(failure);
    expect(voice.closed).toBe(true);
    expect(lastLines(out.text(), 1)).toEqual(["Recorded 1 decision."]);
    const { pages } = await readReviews(at.siteDir);
    expect(pages[RESOURCES]).toMatchObject([{ status: "reviewed", reviewer: "Pat Reviewer" }]);
  });

  it("says when there's nothing to hear", async () => {
    const at = await countedHome();
    await addReview({
      page: "/resources",
      status: "reviewed",
      reviewer: "Pat Reviewer",
      out: at.home,
      cwd: at.cwd,
      env: {},
      logger: createMemoryLogger(),
      regenerateReport: false,
    });
    const settled = replay(at, []);
    await expect(settled.session).resolves.toEqual({ decisions: 0, outcome: "done" });
    expect(settled.out.text()).toBe(`${REPLAY_TEXT.nothingDefault}\n`);
    expect(settled.startVoice).not.toHaveBeenCalled();
    expect(settled.nvdaRunning).not.toHaveBeenCalled();

    // With --all, once no page has transcripts to hear.
    for (const key of [HOME_PAGE, ABOUT, RESOURCES]) await rm(pageFile(at, key, "read.json"));
    const none = replay(at, [], { options: { all: true } });
    await expect(none.session).resolves.toEqual({ decisions: 0, outcome: "done" });
    expect(none.out.text()).toBe(
      `Left out, with no transcripts to hear: /, /about, /resources.\n${REPLAY_TEXT.nothingAll}\n`,
    );
    expect(none.startVoice).not.toHaveBeenCalled();
  });

  it("names the pages it leaves out", async () => {
    const at = await countedHome();
    await rm(pageFile(at, ABOUT, "read.json"));
    const { session, out } = replay(at, [["4"], ["4"]], { options: { all: true } });
    await expect(session).resolves.toEqual({ decisions: 0, outcome: "done" });
    expect(sessionLines(out.text())).toEqual([
      "Left out, with no transcripts to hear: /about.",
      REPLAY_TEXT.keys,
      "Page 1 of 2: / (no flags)",
      REPLAY_TEXT.question,
      "Page 2 of 2: /resources (5 flags)",
      REPLAY_TEXT.question,
      "Recorded no decisions.",
    ]);
  });

  it("records a decision against the run that played, not a later run that doesn't count", async () => {
    const at = await countedHome();
    // A replay of the counted run: newer, with transcripts of every page, but it doesn't count.
    // Without a run to record against, addReview would take this one.
    const replayed = await runAudit(
      runOptions(at.dir, undefined, { replayFrom: runDir(at.siteDir, at.run.id) }),
    );
    expect(replayed.run.replayed).toBe(true);
    expect(replayed.run.pages.find((page) => page.key === ABOUT)?.status).toBe("done");
    expect((await listRuns(at.siteDir)).map((run) => run.id)).toEqual([at.run.id, replayed.runId]);

    const { session, out } = replay(at, [["2", "O", "k", ENTER]], { options: { page: "/about" } });
    await expect(session).resolves.toEqual({ decisions: 1, outcome: "done" });
    expect(out.text()).toContain("Page 1 of 1: /about (no flags)\n");
    const { pages } = await readReviews(at.siteDir);
    expect(pages[ABOUT]).toMatchObject([{ status: "issue", note: "Ok", run: at.run.id }]);
  });

  it("plays at the session's speed, and keeps the person's speed for the next page", async () => {
    const at = await countedHome();
    const keys = keyQueue();
    // + while page 1's first line is said: 20 words a minute faster, from there on.
    keys.push("+");
    const { session, voice } = replay(at, [["4"], ["4"], ["4"]], {
      options: { all: true, rate: 240 },
      keys,
    });
    await expect(session).resolves.toEqual({ decisions: 0, outcome: "done" });
    const [first, again, ...rest] = voice.said;
    expect(first?.wpm).toBe(240);
    expect(again).toEqual({ text: first?.text, wpm: 260 });
    expect(rest.map(({ wpm }) => wpm)).toEqual(rest.map(() => 260));
    // /resources' last line, on page 3.
    expect(voice.said.at(-1)).toEqual({ text: "End", wpm: 260 });
  });

  it("finds the home as review does: --out, else VOICECAP_TRANSCRIPTS", async () => {
    const at = await countedHome();
    const { session } = replay(at, [["1"]], {
      options: { out: undefined, env: { VOICECAP_TRANSCRIPTS: at.home } },
    });
    await expect(session).resolves.toEqual({ decisions: 1, outcome: "done" });
    const { pages } = await readReviews(at.siteDir);
    expect(pages[RESOURCES]).toMatchObject([{ status: "reviewed", run: at.run.id }]);
  });

  it("writes the live report itself, unless it's given another way", async () => {
    const at = await countedHome();
    const report = path.join(at.siteDir, "report.html");
    expect(await readFile(report, "utf8")).not.toContain("Pat Reviewer");
    const { session } = replay(at, [["1"]], { deps: { writeReport: undefined } });
    await expect(session).resolves.toEqual({ decisions: 1, outcome: "done" });
    expect(await readFile(report, "utf8")).toContain("Pat Reviewer");
  });

  it("says why there's nothing to hear, before the voice starts", async () => {
    // A site with no run yet.
    const dir = await setup();
    folders.push(dir);
    const nowhere = replay({ cwd: await elsewhere(dir), home: path.join(dir, "transcripts") }, [], {
      options: { site: SITE },
    });
    const noRun = await refusalOf(nowhere.session);
    expect(noRun).toBeInstanceOf(UsageError);
    expect(errorMessage(noRun)).toBe(
      `There's no run in ${outDir(dir)} yet, so there's nothing to hear.`,
    );
    expect(nowhere.startVoice).not.toHaveBeenCalled();
    expect(nowhere.out.text()).toBe("");

    // A site whose only run doesn't count: its seal is gone.
    const at = await countedHome();
    const record = runJsonPath(at.siteDir, at.run.id);
    const { seal: _seal, ...unsealed } = JSON.parse(await readFile(record, "utf8")) as RunJson;
    await writeFile(record, JSON.stringify(unsealed));
    const uncounted = replay(at, []);
    const noCount = await refusalOf(uncounted.session);
    expect(noCount).toBeInstanceOf(UsageError);
    expect(errorMessage(noCount)).toBe(
      "No run here counts yet (a replayed, interrupted, or unsealed run doesn't count), so there are no transcripts to hear.",
    );
    expect(uncounted.startVoice).not.toHaveBeenCalled();
    expect(uncounted.out.text()).toBe("");
  });
});
