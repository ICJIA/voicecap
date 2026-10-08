/**
 * Which pages `voicecap review --replay` plays, and the lines it plays of each. Pure: it works from
 * what loadShareInput (../share/load.ts) read, and the model buildShareModel made of it.
 *
 * - **Which pages (D2):** by default, the pages a card of What needs attention names, among those
 *   NVDA read: the ring's "Read, with problems", worked out as the ring works it out. With `all`,
 *   every page; with `page`, that one. A page plays from its shown transcripts, the ones the
 *   shareable page shows, so a decision on it is recorded against their run (C3).
 * - **Its lines (D6):** each pass plays the steps the flag rules read (contentSteps), so the read
 *   pass starts at Ctrl+Home's line, leaves out Ctrl+End's, and says its last line once. Each line
 *   keeps its number in the TXT transcript, and is shown as the transcript writes it.
 * - **Its marks (D5):** what the rule found, for the rules that find items; the rule's id, for the
 *   others. The lines are found by the rules' own matching, as What needs attention finds the lines
 *   it quotes (flagItemLines and flagQuotes). A rule whose quote stands for a place on the page
 *   (flagQuotedSteps) marks that place alone, not the same words said elsewhere (Ruling R8).
 */
import {
  contentSteps,
  flagItemLines,
  flagQuotedSteps,
  flagQuotes,
  type FlagRules,
  type PagePasses,
} from "../flags/evaluate.js";
import { PASS_NAMES, type FlagResult, type PassName, type StepRecord } from "../model.js";
import { normalizeSpeech } from "../passes/steps.js";
import { shownPasses, type PageCard } from "../share/cards.js";
import type { ShareInput } from "../share/load.js";
import { namedByAttention, type ShareModel } from "../share/model.js";
import { standingOf, type PageStanding } from "../share/standing.js";
import { stepLine } from "../transcripts/format.js";
import { UsageError } from "../util/errors.js";
import type { PlayLine, Transcripts } from "./player.js";

/** A page to play, with what the session says of it and records a decision against. */
export interface ReplayPage {
  /** Its key, which its review entries are filed under. */
  key: string;
  /** Its address as the shown run recorded it. */
  url: string;
  /** Its address without the site's, as its card shows it: "/biographies/". */
  path: string;
  /** The shown run's id: the run whose transcripts play, which a decision is recorded against. */
  run: string;
  /** How many flags the shown record has, as its card counts them (see ShareInput.runs). */
  flags: number;
  transcripts: Transcripts;
}

/** Which pages to play: the page a key names, every page, or, with neither, the default (D2). */
export interface ReplayChoice {
  /** A page's key. */
  page: string | null;
  all: boolean;
}

/** What's said when the page asked for can't be heard. */
const CANT_HEAR = {
  notInScope: (key: string): string =>
    `${key} isn't one of the pages in scope, so there's no transcript of it to hear.`,
  neverRead: (key: string): string => `No run that counts has transcripts for ${key} yet.`,
  unreadable: (path: string): string => `The read transcript of ${path} can't be read here.`,
};

/** The rules whose mark is what they found on the line, not their id (D5). */
const ITEM_RULES: ReadonlySet<string> = new Set(["generic-link-text", "unlabeled"]);

/**
 * A page's transcripts to play: each pass of `passes`, as the lines of its content steps (D6),
 * each with what it says (normalizeSpeech: "" for a step with no speech), and its marks, each once:
 * - first, what a rule that finds items found on the line, when that rule raised a flag in the
 *   line's pass (flagItemLines);
 * - then, the id of each other flag's rule, in the order of `flags`, when the flag quotes the line
 *   in its pass (see quotesOf).
 *
 * `rules` are the rules `flags` were computed with, whose matching finds the lines.
 */
export function transcriptsOf(
  passes: PagePasses,
  flags: FlagResult[],
  rules: FlagRules,
): Transcripts {
  const raised = new Set(flags.map((flag) => `${flag.rule}/${flag.pass}`));
  // What the item rules found on the lines that raised their flags, by pass and by what NVDA said.
  const found = new Map<PassName, Map<string, Set<string>>>();
  for (const line of flagItemLines(passes, rules)) {
    if (!raised.has(`${line.rule}/${line.pass}`)) continue;
    const said = found.get(line.pass) ?? new Map<string, Set<string>>();
    found.set(line.pass, said);
    said.set(line.spoken, (said.get(line.spoken) ?? new Set<string>()).add(line.item));
  }
  const others = flags
    .filter((flag) => !ITEM_RULES.has(flag.rule))
    .map((flag) => ({ flag, quotes: quotesOf(passes, rules, flag) }));

  const transcripts: Transcripts = {};
  for (const pass of PASS_NAMES) {
    const data = passes[pass];
    if (data === undefined) continue;
    transcripts[pass] = contentSteps(pass, data).map((step): PlayLine => {
      const spoken = normalizeSpeech(step.spoken);
      const marks = new Set([
        ...(found.get(pass)?.get(spoken) ?? []),
        ...others
          .filter(({ flag, quotes }) => flag.pass === pass && quotes(step, spoken))
          .map(({ flag }) => flag.rule),
      ]);
      return { n: step.n, text: stepLine(step, pass), spoken, marks: [...marks] };
    });
  }
  return transcripts;
}

/**
 * Whether a flag of a rule that finds no items quotes a line of its pass (D5), as the rule's quotes
 * mean it (Ruling R8):
 * - for a rule whose quotes stand for a place, at that place: the line's step is one of theirs
 *   (flagQuotedSteps: the first heading, the stops before the main content, the last line read,
 *   at most 3 a flag);
 * - for any other rule, wherever its words were said: the line says what it quotes (flagQuotes: a
 *   repeated phrase, a custom rule's matches).
 */
function quotesOf(
  passes: PagePasses,
  rules: FlagRules,
  flag: FlagResult,
): (step: StepRecord, spoken: string) => boolean {
  const steps = flagQuotedSteps(passes, flag);
  if (steps !== null) return (step) => steps.includes(step.n);
  const lines = flagQuotes(passes, rules, flag);
  return (_step, spoken) => lines.includes(spoken);
}

/**
 * The pages `choice` picks, each with its transcripts to play, and the paths of the pages it picks
 * that have none: no run that counts read the page, or its read pass can't be read here. Both are
 * in the latest run's page order, as the model's cards are.
 *
 * `model` is buildShareModel's of `input`: its cards pair with the standing's pages, one for one.
 * With `choice.page`, a page that can't be heard is refused, with why.
 */
export function replayPagesOf(
  input: ShareInput,
  model: ShareModel,
  choice: ReplayChoice,
): { pages: ReplayPage[]; leftOut: string[] } {
  const pairs = pairsOf(model.pages, standingOf(input.runs).pages);
  const { page: asked } = choice;
  if (asked !== null && !pairs.some(({ card }) => card.key === asked)) {
    throw new UsageError(CANT_HEAR.notInScope(asked));
  }
  const named = namedByAttention(model.attention);
  const picked = (card: PageCard): boolean => {
    if (asked !== null) return card.key === asked;
    return choice.all || (card.counts !== null && named.has(card.slug));
  };

  const pages: ReplayPage[] = [];
  const leftOut: string[] = [];
  for (const { card, page } of pairs) {
    if (!picked(card)) continue;
    // The page asked for is refused, with why; any other is left out, and named.
    const cantHear = (why: string): void => {
      if (asked !== null) throw new UsageError(why);
      leftOut.push(card.path);
    };
    const { shown } = page;
    if (shown === null) {
      cantHear(CANT_HEAR.neverRead(card.key));
      continue;
    }
    const passes = shownPasses(shown, input.transcripts);
    if (passes.read === undefined) {
      cantHear(CANT_HEAR.unreadable(card.path));
      continue;
    }
    pages.push({
      key: card.key,
      url: shown.page.url,
      path: card.path,
      run: shown.run.id,
      flags: shown.page.flags.length,
      transcripts: transcriptsOf(passes, shown.page.flags, input.flagRules),
    });
  }
  return { pages, leftOut };
}

/** Each card with the page of the standing it was made from: the same page, at the same place. */
function pairsOf(
  cards: PageCard[],
  standing: PageStanding[],
): { card: PageCard; page: PageStanding }[] {
  const disagree = (key: string) =>
    new Error(`The page cards and the standing disagree at ${key}.`);
  const pairs = cards.map((card, index) => {
    const page = standing[index];
    if (page?.key !== card.key) throw disagree(card.key);
    return { card, page };
  });
  const unpaired = standing[cards.length];
  if (unpaired !== undefined) throw disagree(unpaired.key);
  return pairs;
}
