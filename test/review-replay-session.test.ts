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
import {
  answering,
  fakeVoice,
  keyQueue,
  sayingEach,
  untilSaying,
  type Answer,
} from "./helpers/replay.js";
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
 * only counted, not written. The next page follows an answer with no wait (`settleMs: 0`): a
 * test's keys come only when the session asks, so none comes during it. `options` and `deps`
 * change any of them.
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
      settleMs: 0,
      ...given.options,
    },
    { out, keys, logger, startVoice, nvdaRunning, writeReport, ...given.deps },
  );
  return { session, out, keys, voice, logger, startVoice, nvdaRunning, writeReport };
}

/**
 * `voice`, with `pressed` pressed as it starts saying `line` the first time: so they come while that
 * line is said, as a person presses keys mid-page.
 */
function pressingAt(
  voice: FakeVoice,
  line: string,
  keys: KeyQueue,
  ...pressed: (Key | string)[]
): Voice {
  let pressing = true;
  return {
    say: (text, wpm) => {
      if (pressing && text === line) {
        pressing = false;
        keys.push(...pressed);
      }
      return voice.say(text, wpm);
    },
    stop: () => voice.stop(),
    close: () => voice.close(),
  };
}

/** What `voice` said, line by line. */
const saidBy = (voice: FakeVoice): string[] => voice.said.map(({ text }) => text);

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
    // When the report is written, nothing is being said, and the count isn't shown or said yet.
    writeReport.mockImplementation(() => {
      expect(voice.speaking).toBe(false);
      expect(out.text()).not.toContain("Recorded 2 decisions.");
      expect(saidBy(voice)).not.toContain("Recorded 2 decisions.");
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
      "Recorded: reviewed, no issues.",
      "Page 2 of 3: /about (no flags)",
      REPLAY_TEXT.question,
      "Note (Enter for none): Bad",
      "Recorded: issue found.",
      "Page 3 of 3: /resources (5 flags)",
      REPLAY_TEXT.question,
      "Skipped.",
      "Recorded 2 decisions.",
    ]);
    expect(lastLines(out.text(), 1)).toEqual(["Recorded 2 decisions."]);
  });

  // With NVDA muted, a person who follows by ear alone hears only the voice (Ruling R10).
  it("says its own lines too, as it shows them, and its last lines after the last page", async () => {
    const at = await countedHome();
    /** What the voice says of a session that plays /about, and records "issue", with "Ok". */
    const heard = [
      REPLAY_TEXT.keysSpoken,
      "Page 1 of 1: /about (no flags)",
      "Read transcript, 3 lines:",
      "heading, level 1, About us",
      "We are an example.",
      "© 2026 Example Agency",
      REPLAY_TEXT.questionSpoken,
      REPLAY_TEXT.note,
      "Recorded: issue found.",
      "Recorded 1 decision.",
    ];
    const answer: Answer = ["2", "O", "k", ENTER];

    const { session, out, voice } = replay(at, [answer], { options: { page: "/about" } });
    await expect(session).resolves.toEqual({ decisions: 1, outcome: "done" });
    expect(saidBy(voice)).toEqual(heard);
    expect(voice.said.filter(({ wpm }) => wpm !== 180)).toEqual([]);
    // Each is shown too, and the voice is closed after the last.
    expect(sessionLines(out.text())).toEqual([
      REPLAY_TEXT.keys,
      "Page 1 of 1: /about (no flags)",
      REPLAY_TEXT.question,
      "Note (Enter for none): Ok",
      "Recorded: issue found.",
      "Recorded 1 decision.",
    ]);
    expect(voice.closed).toBe(true);

    // With NVDA running at the start: its two lines are only shown, since NVDA reads them, and the
    // last lines turn NVDA back over to the person.
    const running = replay(at, [[ENTER], answer], {
      options: { page: "/about" },
      deps: { nvdaRunning: () => Promise.resolve(true) },
    });
    await expect(running.session).resolves.toEqual({ decisions: 1, outcome: "done" });
    expect(saidBy(running.voice)).toEqual([...heard, REPLAY_TEXT.nvdaBack]);
    expect(sessionLines(running.out.text())).toEqual([
      ...REPLAY_TEXT.nvda,
      REPLAY_TEXT.keys,
      "Page 1 of 1: /about (no flags)",
      REPLAY_TEXT.question,
      "Note (Enter for none): Ok",
      "Recorded: issue found.",
      "Recorded 1 decision.",
      REPLAY_TEXT.nvdaBack,
    ]);
  });

  it("answers with a digit pressed while the question is said, and stops it", async () => {
    const at = await countedHome();
    const keys = keyQueue();
    const voice = fakeVoice();
    // Nothing is pressed when the question shows: the person waits for it to be said.
    const { session } = replay(at, [() => {}], { keys, voice, options: { page: "/about" } });
    await untilSaying(voice, REPLAY_TEXT.questionSpoken);
    keys.push("1");
    await nextTurn();
    await sayingEach(voice, session);
    await expect(session).resolves.toEqual({ decisions: 1, outcome: "done" });
    expect(voice.stops).toBe(1);
    const said = saidBy(voice);
    expect(said.slice(said.indexOf(REPLAY_TEXT.questionSpoken))).toEqual([
      REPLAY_TEXT.questionSpoken,
      "Recorded: reviewed, no issues.",
      "Recorded 1 decision.",
    ]);
    const { pages } = await readReviews(at.siteDir);
    expect(pages[ABOUT]).toMatchObject([{ status: "reviewed", reviewer: "Pat Reviewer" }]);
  });

  it("stops one of its own lines for a key, which then does what it does there", async () => {
    const at = await countedHome();
    const keys = keyQueue();
    const voice = fakeVoice();
    const { session } = replay(at, [() => {}], { keys, voice });
    const title = "Page 1 of 1: /resources (5 flags)";

    // The keys' line: a key stops it, and is dropped, as the keys before a page are.
    await untilSaying(voice, REPLAY_TEXT.keysSpoken);
    keys.push("x");
    await nextTurn();
    expect(voice.stops).toBe(1);
    await untilSaying(voice, title);
    expect(saidBy(voice)).toEqual([REPLAY_TEXT.keysSpoken, title]);
    // The page's line: N stops it, and goes to the page's next flagged line, said next.
    keys.push("n");
    await nextTurn();
    expect(voice.stops).toBe(2);
    expect(saidBy(voice).at(-1)).toBe("link, Read more");
    // Enter decides; at the question, Enter answers nothing: it's left out, and the question goes
    // on. A digit stops it, and answers.
    keys.push(ENTER);
    await nextTurn();
    expect(saidBy(voice).at(-1)).toBe(REPLAY_TEXT.questionSpoken);
    keys.push(ENTER);
    await nextTurn();
    expect(voice.stops).toBe(3);
    expect(voice.speaking).toBe(true);
    keys.push("4");
    await nextTurn();
    expect(voice.stops).toBe(4);
    // The line after the answer: a key stops it, and then the count is said.
    expect(saidBy(voice).at(-1)).toBe("Skipped.");
    keys.push(RIGHT);
    await nextTurn();
    expect(voice.stops).toBe(5);
    expect(saidBy(voice).at(-1)).toBe("Recorded no decisions.");
    // Ctrl+C stops the last lines, and the session is done all the same: every page was decided.
    keys.push(CTRL_C);
    await expect(session).resolves.toEqual({ decisions: 0, outcome: "done" });
    expect(voice.stops).toBe(6);
    expect(voice.closed).toBe(true);
    expect(saidBy(voice)).toEqual([
      REPLAY_TEXT.keysSpoken,
      title,
      "link, Read more",
      REPLAY_TEXT.questionSpoken,
      "Skipped.",
      "Recorded no decisions.",
    ]);
  });

  it("only shows its last lines when the session ends before its last page is decided", async () => {
    const at = await countedHome();
    const { session, out, voice } = replay(at, [[ENTER], [CTRL_C]], {
      deps: { nvdaRunning: () => Promise.resolve(true) },
    });
    await expect(session).resolves.toEqual({ decisions: 0, outcome: "quit" });
    expect(lastLines(out.text(), 2)).toEqual(["Recorded no decisions.", REPLAY_TEXT.nvdaBack]);
    expect(saidBy(voice)).not.toContain("Recorded no decisions.");
    expect(saidBy(voice)).not.toContain(REPLAY_TEXT.nvdaBack);
    expect(voice.closed).toBe(true);
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
    expect(lastLines(out.text(), 2)).toEqual(["Skipped.", "Recorded no decisions."]);
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
      "Skipped.",
      "Recorded no decisions.",
      REPLAY_TEXT.nvdaBack,
    ]);
    // NVDA's two lines aren't said: NVDA reads them.
    for (const line of REPLAY_TEXT.nvda) expect(saidBy(running.voice)).not.toContain(line);

    // When NVDA isn't running, or the check can't tell, the session starts at once, and there's
    // no NVDA to turn back on at the end.
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
      expect(out.text(), what).not.toContain(REPLAY_TEXT.nvdaBack);
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
    const failing: Voice = {
      say: (text, wpm) => {
        if (text === "heading, level 1, About us") voice.fail(stopped);
        return voice.say(text, wpm);
      },
      stop: () => voice.stop(),
      close: () => voice.close(),
    };
    const { session, out, writeReport } = replay(at, [["1"]], {
      options: { all: true },
      keys,
      voice,
      deps: { startVoice: () => Promise.resolve(failing) },
    });
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
     * Each way out: what the person does, the voice the session is given (the fake itself unless
     * it says otherwise), whether NVDA is running, and how the session ends. A way that ends the
     * session leaves keys after it that a session going on would take: "1" would record a
     * decision, so it can't go unseen.
     */
    const ways: {
      way: string;
      answers: (keys: KeyQueue, voice: FakeVoice) => Answer[];
      says?: (keys: KeyQueue, voice: FakeVoice) => Voice;
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
        // Pressed as the page's second line is said, so the player takes it.
        says: (keys, voice) => pressingAt(voice, "link, Read more", keys, CTRL_C),
        answers: () => [["1"]],
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
    for (const { way, answers, says, nvda = false, ends } of ways) {
      const keys = keyQueue();
      const voice = fakeVoice({ auto: true });
      const started = says?.(keys, voice) ?? voice;
      const { session, out } = replay(at, answers(keys, voice), {
        keys,
        voice,
        deps: {
          startVoice: () => Promise.resolve(started),
          nvdaRunning: () => Promise.resolve(nvda),
        },
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
      "Skipped.",
      "Page 2 of 2: /resources (5 flags)",
      REPLAY_TEXT.question,
      "Skipped.",
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
    const voice = fakeVoice({ auto: true });
    // + while page 1's first line is said: 20 words a minute faster, from there on.
    const first = "link, Skip to main content";
    const pressing = pressingAt(voice, first, keys, "+");
    const { session } = replay(at, [["4"], ["4"], ["4"]], {
      options: { all: true, rate: 240 },
      keys,
      voice,
      deps: { startVoice: () => Promise.resolve(pressing) },
    });
    await expect(session).resolves.toEqual({ decisions: 0, outcome: "done" });
    const at240 = saidBy(voice).indexOf(first);
    // Everything before it, the session's own lines included, at the session's speed.
    expect(voice.said.slice(0, at240 + 1).map(({ wpm }) => wpm)).toEqual(
      voice.said.slice(0, at240 + 1).map(() => 240),
    );
    // Then the new speed, said at it, and the line again, at it, and everything after.
    const after = voice.said.slice(at240 + 1);
    expect(after.slice(0, 2)).toEqual([
      { text: "Speed: 260 words a minute.", wpm: 260 },
      { text: first, wpm: 260 },
    ]);
    expect(after.map(({ wpm }) => wpm)).toEqual(after.map(() => 260));
    // /resources' last line, on page 3.
    expect(voice.said).toContainEqual({ text: "End", wpm: 260 });
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

/**
 * A key meant for one thing never acts on the next: the keys already waiting are dropped before
 * NVDA's two lines, before the keys' line, and before each page, and so is every key pressed just
 * after an answer, before the next page, or just after the Enter at NVDA's two lines. A Ctrl+C, or
 * the keys ending, among them still ends the session.
 */
describe("replayReview's dropped keys", () => {
  it("drops a key left from an answer, so the next page plays to its end", async () => {
    const at = await countedHome();
    // 1, then Enter, as many press at a numbered prompt.
    const { session, out, voice } = replay(at, [["1", ENTER], ["4"], ["4"]], {
      options: { all: true },
    });
    await expect(session).resolves.toEqual({ decisions: 1, outcome: "done" });
    // /about's every line was shown and said, to its last, before its question.
    const about = out.text().split("Page 2 of 3: /about (no flags)\n")[1];
    expect(about?.slice(0, about.indexOf(REPLAY_TEXT.question))).toBe(
      [
        "Read transcript, 3 lines:",
        "   2  [to top] heading, level 1, About us",
        "   3  We are an example.",
        "   4  © 2026 Example Agency",
        "",
      ].join("\n"),
    );
    expect(voice.said.map(({ text }) => text)).toContain("© 2026 Example Agency");
    expect(voice.stops).toBe(0);
  });

  it("drops a second Enter at NVDA's two lines, so page 1 plays to its end", async () => {
    const at = await countedHome();
    const keys = keyQueue();
    const voice = fakeVoice();
    let pressedAgain = (): void => {};
    const again = new Promise<void>((resolve) => {
      pressedAgain = resolve;
    });
    // Enter, and Enter again a moment later: with NVDA muted, nothing is heard yet, which invites a
    // second press. Its timer is set before the wait after the first Enter begins, so it ends first.
    const running = replay(
      at,
      [
        () => {
          keys.push(ENTER);
          setTimeout(() => {
            keys.push(ENTER);
            pressedAgain();
          }, 10);
        },
        ["4"],
      ],
      {
        keys,
        voice,
        options: { settleMs: 50 },
        deps: { nvdaRunning: () => Promise.resolve(true) },
      },
    );
    await again;
    // From here, the voice says each line to its end.
    await sayingEach(voice, running.session);
    await expect(running.session).resolves.toEqual({ decisions: 0, outcome: "done" });
    // /resources' last line was said, and no line was stopped.
    expect(voice.said.map(({ text }) => text)).toContain("End");
    expect(voice.stops).toBe(0);

    // A Ctrl+C in that wait ends the session there.
    const ending = keyQueue();
    const quit = replay(at, [[ENTER, CTRL_C], ["1"]], {
      keys: ending,
      options: { settleMs: 60_000 },
      deps: { nvdaRunning: () => Promise.resolve(true) },
    });
    await expect(quit.session).resolves.toEqual({ decisions: 0, outcome: "quit" });
    expect(quit.voice.said).toEqual([]);
  });

  it("ends on a Ctrl+C pressed just after an answer, keeping the decision", async () => {
    const at = await countedHome();
    const { session, out, writeReport } = replay(at, [["1", CTRL_C]], { options: { all: true } });
    await expect(session).resolves.toEqual({ decisions: 1, outcome: "quit" });
    expect(writeReport).toHaveBeenCalledTimes(1);
    expect(out.text()).not.toContain("Page 2 of 3");
    expect(lastLines(out.text(), 2)).toEqual([REPLAY_TEXT.question, "Recorded 1 decision."]);

    // After the last page, no page is left for a key to act on, so the session doesn't wait for
    // one: it's done. The Ctrl+C stopped the line after the answer, which may still be ending, so
    // the last lines are only shown.
    const last = replay(at, [["4", CTRL_C]], { options: { page: "/about", settleMs: 60_000 } });
    await expect(last.session).resolves.toEqual({ decisions: 0, outcome: "done" });
    expect(saidBy(last.voice).at(-1)).toBe("Skipped.");
    expect(lastLines(last.out.text(), 2)).toEqual(["Skipped.", "Recorded no decisions."]);
  });

  it("takes and drops every key pressed just after an answer, before the next page", async () => {
    const at = await countedHome();
    // Watched, not replaced: the timers run as they would.
    const timers = vi.spyOn(globalThis, "setTimeout");
    const cleared = vi.spyOn(globalThis, "clearTimeout");
    try {
      // After a decision, and after Skip.
      const answers: [answer: string, decisions: number, recorded: string][] = [
        ["1", 1, "Recorded 1 decision."],
        ["4", 0, "Recorded no decisions."],
      ];
      for (const [answer, decisions, recorded] of answers) {
        timers.mockClear();
        cleared.mockClear();
        const keys = keyQueue();
        // A wait longer than any test, so only a key can end it.
        const { session, out, voice } = replay(at, [[answer]], {
          options: { all: true, settleMs: 60_000 },
          keys,
        });
        // The wait has begun once its timer is set.
        const wait = (): number => timers.mock.calls.findIndex(([, ms]) => ms === 60_000);
        await vi.waitFor(() => expect(wait()).not.toBe(-1), { timeout: 10_000 });
        const said = voice.said.length;
        // An Enter after the digit, and any other key: each is taken, and dropped.
        keys.push(ENTER, "x", RIGHT, "2");
        await expect(soon(session), answer).resolves.toBe("still waiting");
        await expect(soon(keys.waiting()), answer).resolves.toBe("still waiting");
        expect(out.text(), answer).not.toContain("Page 2 of 3");
        expect(voice.said, answer).toHaveLength(said);
        // Ctrl+C ends the session at once, without the rest of the wait, keeping any decision.
        keys.push(CTRL_C);
        await expect(session, answer).resolves.toEqual({ decisions, outcome: "quit" });
        expect(lastLines(out.text(), 2), answer).toEqual([REPLAY_TEXT.question, recorded]);
        // The wait's timer was cleared, so it doesn't hold voicecap open once the session ends.
        expect(cleared, answer).toHaveBeenCalledWith(timers.mock.results[wait()]?.value);
      }
    } finally {
      timers.mockRestore();
      cleared.mockRestore();
    }
  });

  it("waits half a second after an answer, by default, before the next page", async () => {
    const at = await countedHome();
    const keys = keyQueue();
    let answered = 0;
    let asked = 0;
    const { session } = replay(
      at,
      [
        () => {
          answered = performance.now();
          keys.push("1");
        },
        () => {
          asked = performance.now();
          keys.push(CTRL_C);
        },
      ],
      { options: { all: true, settleMs: undefined }, keys },
    );
    await expect(session).resolves.toEqual({ decisions: 1, outcome: "quit" });
    // From page 1's answer to page 2's question: the wait, with addReview before it, and page 2
    // said at once.
    expect(asked - answered).toBeGreaterThanOrEqual(490);
  });

  it("drops the keys pressed before it asks, so none passes the NVDA wait or ends page 1 unheard", async () => {
    const at = await countedHome();
    // Typed while the voice started: an Enter among them.
    const keys = keyQueue();
    keys.push("1", ENTER);
    let warned = (): void => {};
    const warning = new Promise<void>((resolve) => {
      warned = resolve;
    });
    const running = replay(at, [() => warned(), ["4"]], {
      keys,
      deps: { nvdaRunning: () => Promise.resolve(true) },
    });
    const first = await Promise.race([
      warning.then(() => "warned" as const),
      running.session.then(() => "ended" as const),
    ]);
    expect(first).toBe("warned");
    // It waits for an Enter pressed after NVDA's two lines: those before were taken, and dropped.
    await expect(soon(running.session)).resolves.toBe("still waiting");
    await expect(soon(keys.waiting())).resolves.toBe("still waiting");
    expect(running.voice.said).toEqual([]);
    keys.push(ENTER);
    await expect(running.session).resolves.toEqual({ decisions: 0, outcome: "done" });

    // With NVDA not running, the same keys neither cut the keys' line short nor end page 1 before
    // it's heard.
    const early = keyQueue();
    early.push("1", ENTER);
    const { session, voice } = replay(at, [["4"]], { keys: early });
    await expect(session).resolves.toEqual({ decisions: 0, outcome: "done" });
    // /resources' last line: the page was said to its end, with no line stopped.
    expect(saidBy(voice)).toContain(REPLAY_TEXT.keysSpoken);
    expect(voice.said).toContainEqual({ text: "End", wpm: 180 });
    expect(voice.stops).toBe(0);
  });

  it("quits on a Ctrl+C, or the keys' end, among the keys it drops", async () => {
    const at = await countedHome();
    /**
     * Each: the keys pressed before the session asks anything, and what it shows before it ends.
     */
    const ways: { way: string; press: (keys: KeyQueue) => void; nvda: boolean; shows: string[] }[] =
      [
        {
          way: "Ctrl+C before NVDA's lines",
          press: (keys) => keys.push("x", CTRL_C, ENTER),
          nvda: true,
          shows: [],
        },
        {
          way: "Ctrl+C before the keys' line",
          press: (keys) => keys.push("x", CTRL_C),
          nvda: false,
          shows: [],
        },
        {
          way: "the keys' end before the keys' line",
          press: (keys) => keys.end(),
          nvda: false,
          shows: [],
        },
      ];
    for (const { way, press, nvda, shows } of ways) {
      const keys = keyQueue();
      press(keys);
      // Were the session to go on, these answers would record a decision.
      const answers: Answer[] = nvda ? [[ENTER], ["1"]] : [["1"]];
      const { session, out, voice } = replay(at, answers, {
        keys,
        deps: { nvdaRunning: () => Promise.resolve(nvda) },
      });
      await expect(session, way).resolves.toEqual({ decisions: 0, outcome: "quit" });
      expect(sessionLines(out.text()), way).toEqual([...shows, "Recorded no decisions."]);
      expect(voice.said, way).toEqual([]);
      expect(voice.closed, way).toBe(true);
    }
  });
});
