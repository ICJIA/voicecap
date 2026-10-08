/**
 * The replay's session, `voicecap review --replay`, from the first page to the last. For each
 * page, the computer's voice reads the page's saved transcripts aloud (player.ts), and the person
 * decides. Each decision is recorded at once, through addReview, against the run whose
 * transcripts played (C3). The live report is written again once, at the end, and only when a
 * decision was recorded (D8). It's still the person's review: the session plays what NVDA said,
 * and the person hears it, reads it, and decides.
 *
 * The voice says the session's own lines too, each as it's shown, so a person who follows by ear
 * alone, with their own NVDA muted, can (Ruling R10): the keys, once; each page's line; the
 * question, and the note's prompt; a short line once each answer is taken; and, after the last
 * page, how many decisions were recorded, with a reminder to turn NVDA's speech back on when it was
 * running. A key pressed while one is said stops it, and does what it does there. NVDA's two lines
 * are only shown, since NVDA reads them, and so is an error, since the voice may be what failed.
 *
 * It writes nothing else. The person's own NVDA is only ever asked about (`nvdaRunning`): never
 * stopped, started, or changed. The keys are left open at the end, for whoever opened them to
 * close.
 *
 * A key meant for one thing never acts on the next. Before NVDA's two lines, before the keys' line,
 * and before each page, the keys already waiting are taken and dropped, and so is every key pressed
 * in the half second after an answer, when a page follows, or after the Enter that goes on from
 * NVDA's two lines: an Enter pressed after a digit, out of habit, or pressed twice while nothing is
 * heard yet, would otherwise end the next page before it was heard, and one typed while the voice
 * started would pass the wait for Enter before the person had read why it waits.
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
import { UsageError, errorMessage } from "../util/errors.js";
import type { Logger, OutputStream } from "../util/log.js";
import { BACK, readNote, type Key, type KeySource } from "./keys.js";
import { replayPagesOf, type ReplayPage } from "./pages.js";
import { playPage, sayLine } from "./player.js";
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
   * How long after an answer, or after the Enter at NVDA's two lines, the keys pressed are taken
   * and dropped, before the next page starts, in milliseconds: SETTLE_MS, unless a test says
   * otherwise.
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
 * How long after an answer, or after the Enter at NVDA's two lines, the keys pressed are dropped,
 * before the next page starts. Many press Enter after a digit, and at a normal speed it comes once
 * the answer is recorded, which takes tens of milliseconds; and a person whose NVDA is muted hears
 * nothing after their Enter until the voice starts, so may press it again. The next page's player
 * would take either as "decide".
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

/** Whether a key answers the question, so it stops the voice saying it: 1 to 4 (D3). */
const answers = (key: Key): boolean => key.name === "char" && DECISIONS.has(key.char);

/** A session under way: what it works with, and what it has done so far. */
interface Hearing {
  out: OutputStream;
  keys: KeySource;
  voice: Voice;
  /** The voice's speed, in words a minute: --rate's, then as the person changes it with + and −. */
  rate: number;
  /** How many decisions were recorded. */
  decisions: number;
  /** NVDA was running, and the person went on from its two lines, having muted or quit it. */
  nvdaMuted: boolean;
  /**
   * Ctrl+C, or the keys' end, stopped one of the session's own lines without waiting for it to end
   * (Ruling R6): the voice may still be saying it.
   */
  cutShort: boolean;
}

/**
 * Plays each page `options` picks, asks after each one what the person decided, and records each
 * decision through addReview, with `regenerateReport: false` and the run whose transcripts played.
 * It gives how many decisions it recorded, and whether the person ended the session first.
 *
 * Everything is settled before the voice starts, and stops the session with a usage error when it
 * fails: the reviewer's name, the home, the site's folder, a run that counts, and the pages. With
 * no page to hear, it says so, and starts no voice. Otherwise it shows that the voice is starting,
 * which can take a few seconds. A voice that doesn't start ends the session there. In each of
 * those, nothing was asked, so nothing could be recorded, and there's no count to give.
 *
 * Once the voice has started, every way out closes it, writes the live report once when a decision
 * was recorded, and says how many were (endSession): the last page, Ctrl+C or the keys ending
 * (anywhere: while a page plays, at the question, in a note, while it waits for Enter, or among the
 * keys it drops), and a failure, such as the voice stopping mid-page or addReview refusing, which
 * then comes through. A page whose note was cut short records nothing.
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

  // Starting it can take a few seconds (Ruling R11).
  show(REPLAY_TEXT.starting);
  const voice = await deps.startVoice();
  const hearing: Hearing = {
    out,
    keys,
    voice,
    rate: options.rate,
    decisions: 0,
    nvdaMuted: false,
    cutShort: false,
  };
  /** How the session ended: unset when it failed. */
  let outcome: ReplayResult["outcome"] | undefined;
  try {
    outcome = await hearPages(hearing, pages, {
      nvdaRunning: deps.nvdaRunning,
      settleMs: options.settleMs ?? SETTLE_MS,
      record: async (page, status, note) => {
        await addReview({
          page: page.url,
          status,
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
      },
    });
    return { decisions: hearing.decisions, outcome };
  } finally {
    await endSession(hearing, outcome, {
      write: () => (deps.writeReport ?? regenerateLiveReport)({ outDir: siteDir, config, logger }),
      logger,
    });
  }
}

/**
 * Plays each page in turn, asks after each one what the person decided, and records the decision
 * (`record`). It gives "quit" when the person ends the session before its last page is decided.
 */
async function hearPages(
  hearing: Hearing,
  pages: readonly ReplayPage[],
  context: {
    nvdaRunning: () => Promise<boolean>;
    settleMs: number;
    record: (
      page: ReplayPage,
      status: Exclude<Decision, "skip">,
      note: string | null,
    ) => Promise<void>;
  },
): Promise<ReplayResult["outcome"]> {
  const { keys } = hearing;
  // NVDA would read each line the session shows, over the voice, until it's muted or quit. Its two
  // lines are only shown: NVDA reads them.
  if (await nvdaIsRunning(context.nvdaRunning)) {
    // An Enter typed while the voice started mustn't pass the wait before the lines are read.
    if (!(await dropWaitingKeys(keys))) return "quit";
    for (const line of REPLAY_TEXT.nvda) show(hearing, line);
    if (!(await enterPressed(keys))) return "quit";
    hearing.nvdaMuted = true;
    // With NVDA muted, nothing is heard until the voice starts, which invites a second Enter: it
    // would end page 1 before it was heard.
    if (!(await settle(keys, context.settleMs))) return "quit";
  }
  // Keys typed while the voice started would cut the keys' line short.
  if (!(await dropWaitingKeys(keys))) return "quit";
  // The keys, once. A key stops the line, and is dropped, as the keys before a page are.
  if (ends(await tell(hearing, REPLAY_TEXT.keys, { spoken: REPLAY_TEXT.keysSpoken }))) {
    return "quit";
  }
  for (const [index, page] of pages.entries()) {
    // A key left from before, such as a second Enter, would end the page before it's heard.
    if (!(await dropWaitingKeys(keys))) return "quit";
    const played = await playPage({
      transcripts: page.transcripts,
      rate: hearing.rate,
      voice: hearing.voice,
      keys,
      out: hearing.out,
      title: REPLAY_TEXT.page(index + 1, pages.length, page.path, page.flags),
    });
    // The speed the person chose with + and − carries on to the next page.
    hearing.rate = played.rate;
    if (played.outcome === "quit") return "quit";

    const answer = await ask(hearing);
    if (answer === null) return "quit";
    if (answer.decision !== "skip") {
      await context.record(page, answer.decision, answer.note);
      hearing.decisions += 1;
    }
    // Keys pressed just after the answer, as an Enter after the digit, are dropped too, before
    // the next page. After the last, there's no page left for them to act on.
    const more = index + 1 < pages.length;
    if (more && !(await settle(keys, context.settleMs))) return "quit";
    // Said once the keys pressed just after the answer are dropped, so an Enter pressed out of habit
    // doesn't cut it short. After the last page, the session is done, however it's stopped.
    const told = await tell(hearing, REPLAY_TEXT.answered[answer.decision]);
    if (more && ends(told)) return "quit";
  }
  return "done";
}

/**
 * Asks what the person decided about the page they heard, and says the question too (R10): a
 * digit, 1 to 4, stops it and answers, and no other key answers it, Enter included (D3). For 2 and
 * 3 it asks for a note, and says its prompt too: a key stops it, and is the note's first. Escape at
 * the note asks the question again, with nothing recorded, so a wrong digit can be taken back
 * (Ruling R11). Null when the person ends the session, a note cut short included.
 */
async function ask(hearing: Hearing): Promise<{ decision: Decision; note: string | null } | null> {
  const { out, keys } = hearing;
  for (;;) {
    const asked = await tell(hearing, REPLAY_TEXT.question, {
      spoken: REPLAY_TEXT.questionSpoken,
      stops: answers,
    });
    const decision = asked === "spoken" ? await decisionOf(keys) : decisionFrom(asked);
    if (decision === null) return null;
    if (decision === "reviewed" || decision === "skip") return { decision, note: null };

    out.write(REPLAY_TEXT.note);
    const prompted = await say(hearing, REPLAY_TEXT.note);
    const typed =
      prompted === null
        ? null
        : await readNote(keys, out, prompted === "spoken" ? undefined : prompted);
    if (typed === null) {
      // The note's line is still open: it's ended, so the count has a line of its own.
      out.write("\n");
      return null;
    }
    if (typed === BACK) continue;
    // Enter alone is no note.
    return { decision, note: typed === "" ? null : typed };
  }
}

/**
 * Ends the session, however it ended (`outcome`, unset when it failed): the voice closed, the live
 * report written once when a decision was recorded (D8), and how many were shown, with a reminder
 * to turn NVDA's speech back on when it was muted for the session.
 *
 * After the last page, nothing is being said, and the voice says those last lines too, once the
 * report is written (R10): a key stops the line it's pressed during, and Ctrl+C, or the keys' end,
 * the rest. Ended any other way, the voice is closed first: a line may still be being said, which
 * close() ends without waiting for it, so nothing is said while the report is written; and the last
 * lines are only shown, as an error is, since the voice may be what failed.
 *
 * A report that can't be written fails the session that went well. When the session had failed
 * already, its own error comes through, and the report's is only told (`logger`).
 */
async function endSession(
  hearing: Hearing,
  outcome: ReplayResult["outcome"] | undefined,
  report: { write: () => Promise<unknown>; logger: Logger },
): Promise<void> {
  const sayLast = outcome === "done" && !hearing.cutShort;
  const last = [
    REPLAY_TEXT.recorded(hearing.decisions),
    ...(hearing.nvdaMuted ? [REPLAY_TEXT.nvdaBack] : []),
  ];
  try {
    if (!sayLast) await hearing.voice.close();
    try {
      if (hearing.decisions > 0) await report.write();
    } catch (error) {
      if (outcome !== undefined) throw error;
      report.logger.warn(`The live report couldn't be written again: ${errorMessage(error)}`);
    } finally {
      for (const line of last) show(hearing, line);
    }
    if (!sayLast) return;
    for (const line of last) {
      if (ends(await say(hearing, line))) break;
    }
  } finally {
    // Safe to call twice: after the last lines, or when the report or the voice failed first.
    await hearing.voice.close();
  }
}

/** Shows one of the session's own lines. */
function show(hearing: Hearing, text: string): void {
  hearing.out.write(`${text}\n`);
}

/**
 * Says one of the session's own lines (R10), through sayLine, as a page's lines are said: a key it
 * `stops` for stops it (every key, by default), and so do Ctrl+C and the keys' end; any other key
 * is taken and left out, and the line goes on. It gives "spoken", or the key that stopped the line,
 * null for the keys' end.
 */
async function say(
  hearing: Hearing,
  text: string,
  stops?: (key: Key) => boolean,
): Promise<"spoken" | Key | null> {
  const { voice, keys, rate } = hearing;
  const heard = await sayLine({ voice, keys, text, rate, stops });
  if (ends(heard)) hearing.cutShort = true;
  return heard;
}

/**
 * Shows one of the session's own lines, and says it too, as `say` does. `spoken` is what the voice
 * says, for a line whose signs or spacing a voice reads badly.
 */
async function tell(
  hearing: Hearing,
  shown: string,
  options: { spoken?: string; stops?: (key: Key) => boolean } = {},
): Promise<"spoken" | Key | null> {
  show(hearing, shown);
  return say(hearing, options.spoken ?? shown, options.stops);
}

/** Whether what stopped a line ends the session: Ctrl+C, or the keys' end. */
function ends(heard: "spoken" | Key | null): boolean {
  return heard === null || (heard !== "spoken" && heard.name === "ctrl-c");
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

/** The answer a key that stopped the question gives: null for Ctrl+C, or the keys' end. */
function decisionFrom(key: Key | null): Decision | null {
  return key?.name === "char" ? (DECISIONS.get(key.char) ?? null) : null;
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
