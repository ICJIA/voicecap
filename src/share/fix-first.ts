/**
 * "Fix these first": the problems at the top of At a glance, under the verdict, so a reader sees
 * each one and its fix without scrolling to "What needs attention". It's the cards' own words
 * (`attentionWords`), cut to what fits there: each problem's title and count, the first thing NVDA
 * said of it, and its first fix's words and code, with a link to its card for the pages and the
 * rest. The page, its Word copy, and the report for AI tools all write it from here, so they say
 * the same thing.
 */
import type { AttentionCard } from "./attention.js";
import { attentionWords } from "./attention-words.js";

/** At most this many problems in the box: the cards on the most pages, which come first. */
export const MOST_FIX_FIRST = 3;

/** One problem in the box. */
export interface FixFirstItem {
  /** Its card's id ("need-1"), which a link to the card goes to. */
  id: string;
  title: string;
  /** How many pages, and how many times: "7 pages, 28 times". */
  count: string;
  /** The first line NVDA said of it, after the key the pass pressed; null when no line is here. */
  said: { pass: string; line: string } | null;
  /** Its first fix: what to change, and the code; null for a problem with no fix in the code. */
  fix: { lead: string; code: string } | null;
  /** Its first step, for a problem with no fix in the code (a page that wasn't read, say). */
  step: string | null;
  /** How many pages it's on, so its link can say "the page" or "the pages". */
  pages: number;
}

/** The box: up to MOST_FIX_FIRST problems, and how many more are under "What needs attention". */
export interface FixFirst {
  items: FixFirstItem[];
  more: number;
}

/** The box for these cards, in their order; null when there's none, and nothing needs attention. */
export function fixFirstOf(cards: readonly AttentionCard[]): FixFirst | null {
  if (cards.length === 0) return null;
  const items = cards.slice(0, MOST_FIX_FIRST).map((card): FixFirstItem => {
    const words = attentionWords(card);
    const said = words.places.flatMap((place) => place.quotes)[0] ?? null;
    const [fix] = words.fixes;
    return {
      id: card.id,
      title: words.title,
      count: words.count,
      said,
      fix: fix === undefined ? null : { lead: fix.lead, code: fix.code },
      step: fix === undefined ? (words.path[0] ?? null) : null,
      pages: card.pages.length,
    };
  });
  return { items, more: Math.max(0, cards.length - MOST_FIX_FIRST) };
}
