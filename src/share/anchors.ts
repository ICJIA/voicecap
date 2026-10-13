/**
 * The ids the shareable page and the voice page give the parts of a page's account, which an
 * address (a link, or the fragment of one) points to. Each is a prefix and the page's slug made safe
 * for an id, and each is made here, once, so that the page that draws a part and the page that links
 * to it can't come to name it differently:
 *
 * - `voice-…` is a page's section of the voice page, which the shareable page's card links to;
 * - `tx-…` is the fold of a page's full transcript on the shareable page, which the voice page's
 *   section links to, and which the shareable page's script opens when it's the address's fragment;
 * - `pg-…` is a page's card on the shareable page.
 *
 * It holds nothing else, so that both pages, and the model that tells a card where its section is,
 * can import it without importing each other.
 */
import { idFragment } from "../report/html.js";

/** The id of a page's section of the voice page: `voice-` and its slug. */
export function voiceAnchor(slug: string): string {
  return `voice-${idFragment(slug)}`;
}

/** The id of the fold of a page's full transcript on the shareable page: `tx-` and its slug. */
export function transcriptAnchor(slug: string): string {
  return `tx-${idFragment(slug)}`;
}

/** The id of a page's card on the shareable page: `pg-` and its slug. */
export function cardAnchor(slug: string): string {
  return `pg-${idFragment(slug)}`;
}
