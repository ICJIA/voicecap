/**
 * "What needs attention", in the page's own markup and class names: its heading, the line under it,
 * and a card for each problem, which is a fold behind its title and how many pages and times it is.
 * A card says, in this order, where on its pages NVDA said it and what it said in each pass; its
 * likely cause; why it matters; the fix in the code, with what NVDA should say once it's made; the
 * path forward; and its pages, each linked to its card under "Every page". The cards start open
 * when there are 5 or fewer, and folded when there are more; a card's pages fold behind a line that
 * counts them when there are more than 3.
 *
 * What a card says comes from `attentionWords` (../attention-words.ts), the one place that words
 * it for both the page and the Word copy, and its labels from `ATTENTION_TEXT`. Everything goes
 * through `esc`: what NVDA said, a link's words, a page's name, and a reviewer's note are text,
 * whatever they hold, and so is a fix's code, which a block of code shows with its own line breaks.
 * No `style` attribute is set, and the only links go to the page's own cards under "Every page".
 *
 * A card's title is on its fold's line, never in a heading: the section's heading is the only one
 * here, and a card's parts are paragraphs and lists, which a heading of their own would only repeat
 * across every card.
 */
import { esc, idFragment } from "../../report/html.js";
import type { AttentionCard } from "../attention.js";
import { attentionWords, type AttentionWords } from "../attention-words.js";
import type { ShareModel } from "../model.js";
import { ATTENTION_TEXT } from "../text.js";
import { attentionGist } from "../words.js";
import { fold, lineHtml } from "./parts.js";

/** More cards than this, and each starts folded behind its title. */
const MOST_CARDS_OPEN = 5;

/** More pages on a card than this, and its pages fold behind a line that counts them. */
const MOST_PAGES_OPEN = 3;

const { labels } = ATTENTION_TEXT;

/** A label in bold, as a part of a card begins with it: "Likely cause:". */
const labelled = (label: string): string => `<b>${esc(label)}:</b>`;

/**
 * One place on the card's pages: where on them NVDA said it, then each line it said there, after the
 * key the pass pressed, in curly quotes. A place whose words aren't here says why instead.
 */
function placeOf(place: AttentionWords["places"][number]): string {
  const said = place.quotes.map(
    ({ pass, line }) =>
      `<p><span class="pass">${esc(pass)}:</span> <code>“${esc(line)}”</code></p>`,
  );
  const gap =
    place.unavailable === null ? [] : [`<p class="not-recorded">${esc(place.unavailable)}</p>`];
  return `<div class="place"><p>${esc(place.lead)}</p>${[...said, ...gap].join("")}</div>`;
}

/**
 * One fix: what to change, the code to change it with, in a block that keeps the code's lines, and,
 * when it has words for it, what NVDA should say once it's changed.
 */
function fixOf(fix: AttentionWords["fixes"][number]): string {
  const after = fix.after === null ? "" : `<p>${labelled(labels.after)} ${esc(fix.after)}</p>`;
  return `<div class="fix"><p>${esc(fix.lead)}</p><pre><code>${esc(fix.code)}</code></pre>${after}</div>`;
}

/**
 * A card's pages, each a link to its card under "Every page", with its reason or its note after a
 * colon when it has one. Up to 3 are in the open under their label, "The page" for one; more fold
 * behind a line that counts them, which is their label.
 */
function pagesOf(card: AttentionCard): string {
  const items = card.pages.map(({ slug, name, detail }) => {
    const link = `<a href="#pg-${idFragment(slug)}">${esc(name)}</a>`;
    return `<li>${detail === null || detail.trim() === "" ? link : `${link}: ${esc(detail)}`}</li>`;
  });
  const list = `<ul>${items.join("")}</ul>`;
  if (card.pages.length <= MOST_PAGES_OPEN) {
    const label = card.pages.length === 1 ? labels.page : labels.pages;
    return `<div class="part"><p>${labelled(label)}</p>${list}</div>`;
  }
  const summary = `<span class="what">${esc(ATTENTION_TEXT.pagesFold(card.pages.length))}</span>`;
  return fold(summary, list, { insideClassName: "on-pages" });
}

/**
 * A card as a fold: its line is its number, its title, and how many pages and times it is; opened,
 * it says each of its parts. The fold has the card's id, so the summary's link to the card opens it.
 */
function cardOf(card: AttentionCard, number: number, open: boolean): string {
  const words = attentionWords(card);
  const summary = `<span class="what">${number}. ${esc(words.title)}</span> <span class="sub">${esc(words.count)}</span>`;
  const fixes =
    words.fixes.length === 0
      ? []
      : [
          `<div class="part"><p>${labelled(labels.fix)}</p>${words.fixes.map(fixOf).join("")}</div>`,
        ];
  const steps = words.path.map((step) => `<li>${esc(step)}</li>`);
  const body = [
    ...words.places.map(placeOf),
    `<p>${labelled(labels.cause)} ${esc(words.cause)}</p>`,
    `<p>${labelled(labels.why)} ${esc(words.why)}</p>`,
    ...fixes,
    `<div class="part"><p>${labelled(labels.path)}</p><ol>${steps.join("")}</ol></div>`,
    pagesOf(card),
  ];
  return fold(summary, body.join(""), { id: card.id, open });
}

/**
 * "What needs attention": its heading, the line under it (`attentionGist`: how many problems and
 * what to do, or that none is left), and a card for each problem, in the cards' order. With 5 cards
 * or fewer each is open; with more, each is folded behind its title, which the summary's panel links
 * to, and opens.
 */
export function renderAttention(model: ShareModel): string {
  const open = model.attention.length <= MOST_CARDS_OPEN;
  const folds = model.attention.map((card, index) => cardOf(card, index + 1, open));
  const parts = [
    `<h2 id="need-h">${esc(ATTENTION_TEXT.title)}</h2>`,
    `<p class="gist">${lineHtml(attentionGist(model))}</p>`,
    ...(folds.length === 0 ? [] : [`<div class="folds">${folds.join("")}</div>`]),
  ];
  return `<section aria-labelledby="need-h">\n  ${parts.join("\n  ")}\n</section>`;
}
