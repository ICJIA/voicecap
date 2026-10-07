/**
 * The Word copy's "What needs attention", as blocks (./blocks.ts): the same cards as the page's
 * (../html/attention.ts), from the same words (`attentionWords`, ../attention-words.ts, and the
 * labels in `ATTENTION_TEXT`), so the two can't say different things.
 *
 * It says its heading and the line under it, then a card for each problem: a heading 2 with its
 * number and title, how many pages and times, where on its pages NVDA said it (each place's lead,
 * and each line it said there, in the fixed-width font, after the key the pass pressed), the likely
 * cause and why it matters, each fix (what to change, its code in the fixed-width font, a line for
 * each line of it, and what NVDA should say then), the path forward, and its pages, as lists. With
 * no card there is no section at all, as on the page.
 *
 * It folds nothing: every page of every card is listed, and there are no links, since the Word
 * copy's sections follow one another. A card's parts are paragraphs, lists, and lines of code, never
 * a heading, so the document's headings are the section and its cards. Nothing here is escaped:
 * the document holds words, and the library sets each in a run of its own. Pure.
 */
import type { AttentionCard } from "../attention.js";
import { attentionWords, type AttentionWords } from "../attention-words.js";
import type { ShareModel } from "../model.js";
import { ATTENTION_TEXT } from "../text.js";
import { attentionGist } from "../words.js";
import { heading, list, mono, para, type Block } from "./blocks.js";

const { labels } = ATTENTION_TEXT;

/** A label in bold, then what it labels, in one paragraph: "Likely cause: …". */
const labelled = (label: string, words: string): Block =>
  para({ text: `${label}:`, bold: true }, ` ${words}`);

/** A label in bold, alone in its paragraph, before what it labels: "The path forward:". */
const labelOnly = (label: string): Block => para({ text: `${label}:`, bold: true });

/**
 * One place: its lead, then each line NVDA said there in the fixed-width font, one block with a line
 * for each, after the key the pass pressed and in curly quotes; or why its words aren't here.
 */
function placeBlocks(place: AttentionWords["places"][number]): Block[] {
  return [
    para(place.lead),
    ...(place.quotes.length === 0
      ? []
      : [mono(place.quotes.map(({ pass, line }) => `${pass}: “${line}”`))]),
    ...(place.unavailable === null ? [] : [para(place.unavailable)]),
  ];
}

/** One fix: what to change, its code in the fixed-width font, and what NVDA should say then. */
function fixBlocks(fix: AttentionWords["fixes"][number]): Block[] {
  return [
    para(fix.lead),
    mono(fix.code.split("\n")),
    ...(fix.after === null ? [] : [labelled(labels.after, fix.after)]),
  ];
}

/** A card: its heading and count, then each of its parts, as the page's card says them. */
function cardBlocks(card: AttentionCard, number: number): Block[] {
  const words = attentionWords(card);
  return [
    heading(2, `${number}. ${words.title}`),
    para(words.count),
    ...words.places.flatMap(placeBlocks),
    labelled(labels.cause, words.cause),
    labelled(labels.why, words.why),
    ...(words.fixes.length === 0 ? [] : [labelOnly(labels.fix), ...words.fixes.flatMap(fixBlocks)]),
    labelOnly(labels.path),
    list(words.path),
    labelOnly(card.pages.length === 1 ? labels.page : labels.pages),
    list(
      card.pages.map(({ name, detail }) =>
        detail === null || detail.trim() === "" ? name : `${name}: ${detail}`,
      ),
    ),
  ];
}

/**
 * "What needs attention": its heading, the line under it (`attentionGist`: how many problems and
 * what to do), and each card in full, in the cards' order.
 *
 * With no card it is nothing, as it is on the page, not a section that says so: At a glance's
 * verdict says that nothing needs attention (`verdictOf`).
 */
export function wordAttention(model: ShareModel): Block[] {
  if (model.attention.length === 0) return [];
  return [
    heading(1, ATTENTION_TEXT.title),
    para(...attentionGist(model)),
    ...model.attention.flatMap((card, index) => cardBlocks(card, index + 1)),
  ];
}
