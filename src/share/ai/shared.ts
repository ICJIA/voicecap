/**
 * What the Markdown and the JSON of the report for AI tools say alike, so that the two can't differ:
 * the steps of a transcript (`stepsOf`), the words of a record where it names the library that
 * drives the screen reader (`ownWords`), a page's result as sentences (`resultOf`), and a phrase
 * of the page's as a sentence of its own (`asSentence`). Pure.
 *
 * The steps are each step's number, the key pressed, and what NVDA said. The Markdown puts one on
 * each line of a transcript's block, and the JSON gives each as data. They are worked out from the
 * model's own copy of a transcript (`AppendixFile.text`): the lines of its TXT, a step to a line, so
 * line N is step N (the transcript writes `[no speech]` for a step where NVDA said nothing, to keep
 * it so). A pass presses one key all through: the key it is named for (`HOW_TEXT.ways`). But the
 * read pass first sets itself up with two steps of other keys, Ctrl+End to find the page's last line
 * and Ctrl+Home to return to the top, and the transcript labels those two lines ("[to bottom] …",
 * "[to top] …"). The label says the key, so it is taken off the words, once each, and only where
 * those steps are: at the start of the read pass. Words that begin like a label anywhere else are
 * what NVDA said, and are never cut.
 */
import type { AppendixFile, PageCard } from "../model.js";
import { AI_TEXT, HOW_TEXT } from "../text.js";
import { fromRun, sentence } from "../words.js";

/** One step of a pass: its place in it, the key pressed, and what NVDA said, word for word. */
export interface Step {
  /** From 1: the transcript's line N is step N. */
  n: number;
  /** The key, as a person knows it: "Down Arrow", "H", "Tab", "Ctrl+End", or "Ctrl+Home". */
  key: string;
  said: string;
}

/** The label a transcript writes before a step that isn't its pass's own key: "[to bottom] …". */
const LABEL = /^\[([^\]]*)\] /;

/** The steps of a transcript, in order. None for a transcript with no lines. */
export function stepsOf(file: Pick<AppendixFile, "pass" | "text" | "lines">): Step[] {
  if (file.lines === 0) return [];
  const used = new Set<string>();
  // Only the read pass has steps of other keys, and they come first.
  let setUp = file.pass === "read";
  return file.text.split("\n").map((line, at) => {
    const label = setUp ? (LABEL.exec(line)?.[1] ?? "") : "";
    const key =
      Object.hasOwn(AI_TEXT.setupKeys, label) && !used.has(label)
        ? AI_TEXT.setupKeys[label]
        : undefined;
    if (key === undefined) {
      setUp = false;
      return { n: at + 1, key: HOW_TEXT.ways[file.pass].key, said: line };
    }
    used.add(label);
    return { n: at + 1, key, said: line.slice(`[${label}] `.length) };
  });
}

/**
 * Words as a run's record has them, where the record may name the library that drives the screen
 * reader (a row of the test environment, an error it recorded, a stack, a tool that changed between
 * runs): the files for AI tools name no library, and say `AI_TEXT.driver` where a record does. Only
 * what voicecap and its runs wrote goes through it; what a website said, in a transcript or a
 * title, is never changed.
 */
export const ownWords = (words: string): string => words.replace(/guidepup/gi, AI_TEXT.driver);

/**
 * What a page's record says of how it ended and where its transcripts come from, as sentences: its
 * status, its failure when it has one, and the run its transcripts are from when that isn't the
 * latest. A page's status and its failure are what its run recorded, so they go through `ownWords`.
 */
export function resultOf(card: PageCard): string {
  const from = fromRun(card);
  return [
    sentence(ownWords(card.statusText)),
    ...(card.failure === null ? [] : [sentence(ownWords(card.failure))]),
    ...(from === null ? [] : [sentence(from)]),
  ].join(" ");
}

/** Words with a capital and a full stop, when they have none: a phrase of the page's as a sentence of its own. */
export const asSentence = (words: string): string =>
  sentence(`${words.charAt(0).toUpperCase()}${words.slice(1)}`);
