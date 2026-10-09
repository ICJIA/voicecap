/**
 * What the Markdown and the JSON of the report for AI tools say alike, so that the two can't differ:
 * the steps of a transcript (`stepsOf`), and the words of a record where it names the library that
 * drives the screen reader (`ownWords`). Pure.
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
import type { AppendixFile } from "../model.js";
import { AI_TEXT, HOW_TEXT } from "../text.js";

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
