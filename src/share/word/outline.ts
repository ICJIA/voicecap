/**
 * The whole Word copy as one outline of blocks (./blocks.ts), and the document's properties: the
 * sections the builders of this folder make, in the order the page has them, and what the .docx
 * says of itself. Pure; `renderWordCopy` (../docx.ts) makes the file.
 */
import type { WordProperties } from "../docx.js";
import type { ShareModel } from "../model.js";
import { WORD_TEXT } from "../text.js";
import { documentTitle } from "../words.js";
import type { Block } from "./blocks.js";
import { wordChanges } from "./changes.js";
import { wordCoverage, wordEvidence, wordFooter, wordStory } from "./evidence.js";
import { wordAppendix, wordFlags, wordPages } from "./pages.js";
import { wordProblems } from "./problems.js";
import { wordHow, wordSummary, wordTop } from "./top.js";

/**
 * The sections, in the page's order (html/document.ts): the top, then the sections inside the
 * page's `main` as the design orders them, then the footer. The footer has a heading of its own
 * here, which the page's has not (it is a landmark), so the outline has one level-1 heading more
 * than the page has sections.
 */
const SECTIONS: ((model: ShareModel) => Block[])[] = [
  wordTop,
  wordSummary,
  wordHow,
  wordPages,
  wordFlags,
  wordChanges,
  wordProblems,
  wordCoverage,
  wordEvidence,
  wordStory,
  wordAppendix,
  wordFooter,
];

/** The Word copy's blocks, from the model: every section of the page, in its order. */
export function wordOutline(model: ShareModel): Block[] {
  return SECTIONS.flatMap((section) => section(model));
}

/**
 * What the document says of itself: its title (the sentence the page's tab says), its author (who
 * prepared the report, or voicecap when the records name no one), and what each page's footer says
 * before its page number: the site's name and the date the report is as of.
 */
export function wordProperties(model: ShareModel): WordProperties {
  const { header } = model;
  return {
    title: documentTitle(header),
    author: header.preparedBy ?? WORD_TEXT.document.author,
    footer: WORD_TEXT.document.footer(header.name, header.asOf),
  };
}
