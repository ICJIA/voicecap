/**
 * The replay's session, `voicecap review --replay`, from the first page to the last. For each
 * page, the computer's voice reads the page's saved transcripts aloud (player.ts), and the person
 * decides. Each decision is recorded at once, through addReview, against the run whose
 * transcripts played (C3). The live report is written again once, at the end, and only when a
 * decision was recorded (D8). It's still the person's review: the session plays what NVDA said,
 * and the person hears it, reads it, and decides.
 *
 * It writes nothing else. The person's own NVDA is only ever asked about (`nvdaRunning`): never
 * stopped, started, or changed. The keys are left open at the end, for whoever opened them to
 * close.
 *
 * A key meant for one thing never acts on the next. Before NVDA's two lines, and before each
 * page, the keys already waiting are taken and dropped, and so is every key pressed in the half
 * second after an answer, when a page follows: an Enter pressed after a digit, out of habit, would
 * otherwise end the next page before it was heard, and one typed while the voice started would
 * pass the wait for Enter before the person had read why it waits.
 *
 * The usage errors it stops with sit here, where they're thrown, as pages.ts keeps its own.
 */
import { setImmediate as nextTurn } from "node:timers/promises";

import { loadConfig } from "../config/load.js";
import type { ReviewStatus } from "../model.js";
import { resolvePageArgument } from "../pages/page-argument.js";
import { addReview } from "../reviews/review.js";
import { resolveReviewer } from "../reviews/reviewer.js";
import { regenerateLiveReport, type LiveReportOptions } from "../run/live-report.js";
import { resolveHome } from "../run/paths.js";
import { chooseSiteDir } from "../run/site-dir.js";
import { listRuns } from "../run/store.js";
import { loadShareInput } from "../share/load.js";
import { buildShareModel } from "../share/model.js";
import { UsageError } from "../util/errors.js";
import type { Logger, OutputStream } from "../util/log.js";
import { readNote, type KeySource } from "./keys.js";
import { replayPagesOf } from "./pages.js";
import { playPage } from "./player.js";
import { REPLAY_TEXT } from "./text.js";
import type { Voice } from "./voice.js";

/** What `voicecap review --replay` was asked for. */
export interface ReplayOptions {
  /**
   * --page: a full URL or a root-relative path, the one page to hear. Null for the default pages,
   * or every page with `all`.
   */
  page: string | null;
  /** --all: every page with transcripts. */
  all: boolean;
  /** --rate: the voice's speed as the session starts, in words a minute. */
  rate: number;
  /** --reviewer. Null for VOICECAP_REVIEWER, then git config user.name, then the config's. */
  reviewer: string | null;
  /** --site: the site's address, or its canonical address (see chooseSiteDir). */
  site: string | null;
  /** --out: the transcripts home. Default: VOICECAP_TRANSCRIPTS, else "transcripts". */
  out?: string;
  cwd: string;
  /** Where VOICECAP_TRANSCRIPTS and VOICECAP_REVIEWER are read from. */
  env: NodeJS.ProcessEnv;
  /**
   * How long after an answer the keys pressed are taken and dropped, before the next page starts,
   * in milliseconds: SETTLE_MS, unless a test says otherwise.
   */
  settleMs?: number;
}

/** What the session works with: the terminal, the person's keys, the voice, and the checks. */
export interface ReplayDeps {
  /** The terminal, where the session shows each line, and asks. */
  out: OutputStream;
  /** The person's keys. The session reads them, and leaves closing them to whoever opened them. */
  keys: KeySource;
  logger: Logger;
  /** Starts the computer's voice. The session closes it, however it ends. */
  startVoice: () => Promise<Voice>;
  /**
   * Whether the person's own NVDA is running. It only asks. It rejects when it can't tell, and the
   * session then starts all the same.
   */
  nvdaRunning: () => Promise<boolean>;
  /** Writes the site's live report again. Default: regenerateLiveReport. */
  writeReport?: (options: LiveReportOptions) => Promise<unknown>;
}

export interface ReplayResult {
  /** How many decisions were recorded. */
  decisions: number;
  /**
   * "quit" when the person ended the session (Ctrl+C, or the keys ending) before its last page was
   * decided.
   */
  outcome: "done" | "quit";
}

/** Why there's nothing to hear, before anything is played. */
const NOTHING_TO_HEAR = {
  noRun: (siteDir: string): string =>
    `There's no run in ${siteDir} yet, so there's nothing to hear.`,
  noCountedRun:
    "No run here counts yet (a replayed, interrupted, or unsealed run doesn't count), so there are no transcripts to hear.",
};

/**
 * How long after an answer the keys pressed are dropped, before the next page starts. Many press
 * Enter after a digit, and at a normal speed it comes once the answer is recorded, which takes
 * tens of milliseconds: the next page's player would take it as "decide".
 */
const SETTLE_MS = 500;

/** What the person decided about a page, as the key they pressed says it. */
type Decision = Extract<ReviewStatus, "reviewed" | "issue" | "fixed"> | "skip";

/**
 * The answers to the question: 1 to 4, and no other key, Enter included (D3). Skip records
 * nothing.
 */
const DECISIONS: ReadonlyMap<string, Decision> = new Map([
  ["1", "reviewed"],
  ["2", "issue"],
  ["3", "fixed"],
  ["4", "skip"],
]);

/**
 * Plays each page `options` picks, asks after each one what the person decided, and records each
 * decision through addReview, with `regenerateReport: false` and the run whose transcripts played.
 * It gives how many decisions it recorded, and whether the person ended the session first.
 *
 * Everything is settled before the voice starts, and stops the session with a usage error when it
 * fails: the reviewer's name, the home, the site's folder, a run that counts, and the pages. With
 * no page to hear, it says so, and starts no voice. A voice that doesn't start ends the session
 * there. In each of those, nothing was asked, so nothing could be recorded, and there's no count
 * to give.
 *
 * Once the voice has started, every way out closes it, writes the live report once when a decision
 * was recorded, and says how many were: the last page, Ctrl+C or the keys ending (anywhere: while
 * a page plays, at the question, in a note, while it waits for Enter, or among the keys it drops),
 * and a failure, such as the voice stopping mid-page or addReview refusing, which then comes
 * through. A page whose note was cut short records nothing.
 */
export async function replayReview(
  options: ReplayOptions,
  deps: ReplayDeps,
): Promise<ReplayResult> {
  const { cwd, env } = options;
  const { out, keys, logger } = deps;
  const show = (text: string): void => {
    out.write(`${text}\n`);
  };

  // The config first, since the reviewer's name can come from it.
  const loaded = await loadConfig({ cwd });
  const { config } = loaded;
  const reviewer = resolveReviewer({
    option: options.reviewer,
    env,
    configReviewer: config.reviewer,
    cwd,
  });
  const home = resolveHome({ out: options.out, env, cwd });
  const siteDir = await chooseSiteDir({ home, site: options.site, page: options.page });
  if ((await listRuns(siteDir)).length === 0) {
    throw new UsageError(NOTHING_TO_HEAR.noRun(siteDir));
  }

  const input = await loadShareInput({ siteDir, config });
  const model = buildShareModel(input);
  if (model.header.tested === null) throw new UsageError(NOTHING_TO_HEAR.noCountedRun);
  const asked =
    options.page === null
      ? null
      : (await resolvePageArgument(options.page, siteDir, options.site)).key;
  const { pages, leftOut } = replayPagesOf(input, model, { page: asked, all: options.all });

  if (leftOut.length > 0) show(REPLAY_TEXT.leftOut(leftOut));
  if (pages.length === 0) {
    show(options.all ? REPLAY_TEXT.nothingAll : REPLAY_TEXT.nothingDefault);
    return { decisions: 0, outcome: "done" };
  }

  const voice = await deps.startVoice();
  let decisions = 0;
  try {
    // NVDA would read each line the session shows, over the voice, until it's muted or quit.
    if (await nvdaIsRunning(deps.nvdaRunning)) {
      // An Enter typed while the voice started mustn't pass the wait before the lines are read.
      if (!(await dropWaitingKeys(keys))) return { decisions, outcome: "quit" };
      for (const line of REPLAY_TEXT.nvda) show(line);
      if (!(await enterPressed(keys))) return { decisions, outcome: "quit" };
    }
    show(REPLAY_TEXT.keys);
    let { rate } = options;
    for (const [index, page] of pages.entries()) {
      // A key left from before, such as a second Enter, would end the page before it's heard.
      if (!(await dropWaitingKeys(keys))) return { decisions, outcome: "quit" };
      show(REPLAY_TEXT.page(index + 1, pages.length, page.path, page.flags));
      const played = await playPage({ transcripts: page.transcripts, rate, voice, keys, out });
      // The speed the person chose with + and − carries on to the next page.
      rate = played.rate;
      if (played.outcome === "quit") return { decisions, outcome: "quit" };

      show(REPLAY_TEXT.question);
      const decision = await decisionOf(keys);
      if (decision === null) return { decisions, outcome: "quit" };
      if (decision !== "skip") {
        let note: string | null = null;
        if (decision !== "reviewed") {
          out.write(REPLAY_TEXT.note);
          const typed = await readNote(keys, out);
          if (typed === null) {
            // The note's line is still open: it's ended, so the count has a line of its own.
            out.write("\n");
            return { decisions, outcome: "quit" };
          }
          // Enter alone is no note.
          note = typed === "" ? null : typed;
        }
        await addReview({
          page: page.url,
          status: decision,
          note,
          reviewer: reviewer.name,
          run: page.run,
          site: options.site,
          out: options.out,
          cwd,
          env,
          config: loaded,
          logger,
          regenerateReport: false,
        });
        decisions += 1;
      }
      // Keys pressed just after the answer, as an Enter after the digit, are dropped too, before
      // the next page. After the last, there's no page left for them to act on.
      const more = index + 1 < pages.length;
      if (more && !(await settle(keys, options.settleMs ?? SETTLE_MS))) {
        return { decisions, outcome: "quit" };
      }
    }
    return { decisions, outcome: "done" };
  } finally {
    // The voice first, so nothing is said while the report is written. A line still being said is
    // ended by close(), which doesn't wait for it.
    await voice.close();
    try {
      if (decisions > 0) {
        await (deps.writeReport ?? regenerateLiveReport)({ outDir: siteDir, config, logger });
      }
    } finally {
      show(REPLAY_TEXT.recorded(decisions));
    }
  }
}

/**
 * Whether the person's own NVDA is running, as far as `nvdaRunning` can tell: not, when it can't.
 */
async function nvdaIsRunning(nvdaRunning: () => Promise<boolean>): Promise<boolean> {
  try {
    return await nvdaRunning();
  } catch {
    return false;
  }
}

/**
 * Waits for Enter, and takes every other key in passing. False when the person ends the session.
 */
async function enterPressed(keys: KeySource): Promise<boolean> {
  for (;;) {
    const key = await keys.next();
    if (key === null || key.name === "ctrl-c") return false;
    if (key.name === "enter") return true;
  }
}

/**
 * The person's answer to the question: 1 to 4, taking every other key in passing (D3). Null when
 * they end the session.
 */
async function decisionOf(keys: KeySource): Promise<Decision | null> {
  for (;;) {
    const key = await keys.next();
    if (key === null || key.name === "ctrl-c") return null;
    const decision = key.name === "char" ? DECISIONS.get(key.char) : undefined;
    if (decision !== undefined) return decision;
  }
}

/**
 * Takes and drops the keys already waiting: pressed before, and not yet taken. False when the
 * person ended the session among them: Ctrl+C, or the keys ending.
 */
function dropWaitingKeys(keys: KeySource): Promise<boolean> {
  // A key waiting is taken at once, without a turn of the event loop, so every key waiting now is
  // taken before the next turn comes.
  return dropKeysUntil(keys, nextTurn());
}

/**
 * Takes and drops every key pressed for `ms` milliseconds. False, at once, when the person ends the
 * session among them: Ctrl+C, or the keys ending.
 */
async function settle(keys: KeySource, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const over = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    return await dropKeysUntil(keys, over);
  } finally {
    // Ended early by Ctrl+C, the wait leaves no timer behind.
    clearTimeout(timer);
  }
}

/**
 * Takes and drops each key that's waiting, or comes, until `until` resolves. False, at once, when
 * one of them is Ctrl+C, or the keys end.
 */
async function dropKeysUntil(keys: KeySource, until: Promise<unknown>): Promise<boolean> {
  const over = until.then(() => "over" as const);
  for (;;) {
    const first = await Promise.race([keys.waiting().then(() => "key" as const), over]);
    if (first === "over") return true;
    const key = await keys.next();
    if (key === null || key.name === "ctrl-c") return false;
  }
}
