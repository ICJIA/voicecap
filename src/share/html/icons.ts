/**
 * The pictures beside "How voicecap works"' six steps: the approved mockup's inline SVGs, one for
 * each icon name text.ts gives a step. text.ts keeps only the names, since it is prose for both
 * renderers; these are drawn for the page alone, and the Word copy will use its own images.
 *
 * Each picture follows the steps' order, whatever its name suggests: the fourth, "words", is a
 * shield with a check mark (the check on every key), and the sixth, "seal", a padlock. The icon
 * names are text.ts's, so a seventh name there is a type error here until it has a picture.
 *
 * A picture is hidden from screen readers (the step's title says it all), sized by attributes, and
 * drawn in the text's own color by attributes, so the page's one style block needs no rule for it
 * and no `style` attribute is ever set.
 */
import type { HOW_STEPS } from "../text.js";

/** A step's icon name, as text.ts gives it. */
type StepIcon = (typeof HOW_STEPS)[number]["icon"];

/** One picture on a 24 by 24 grid, outlined in the current color. */
function picture(shapes: string): string {
  return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes}</svg>`;
}

/** The six pictures, as inline SVG. */
export const STEP_ICONS: Record<StepIcon, string> = {
  // A page of lines: every page on the list.
  list: picture(
    '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  ),
  // A speaker: the real screen reader.
  reader: picture(
    '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  ),
  // A keyboard: three ways through each page, by key.
  three: picture(
    '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  ),
  // A shield with a check mark: every word, and a check on every key.
  words: picture(
    '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
  ),
  // Headphones: a person hears NVDA at work, reads the transcripts, and fixes.
  person: picture(
    '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
  ),
  // A padlock: a sealed record.
  seal: picture(
    '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  ),
};
