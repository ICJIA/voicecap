/**
 * Reading the shareable page's markup in a test: what a reader gets of some HTML as text, an
 * attribute's values, the folds and the text of their summary lines, and the scroll boxes.
 */
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

/** Entities decoded, and nothing else: what a browser shows of some escaped text. */
export function decode(html: string): string {
  return html.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

/**
 * HTML as a reader gets it as text: each tag replaced by `glue`, entities decoded, spaces
 * collapsed.
 */
export function textOf(html: string, glue = " "): string {
  return decode(html.replace(/<[^>]*>/g, glue))
    .replace(/\s+/g, " ")
    .trim();
}

/** Every attribute value of a name in some HTML. */
export function attributes(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, "g"))].map((found) => found[1] ?? "");
}

/** The folds of a section, each as its markup from `<details` on. */
export function foldsIn(html: string): string[] {
  return html.split("<details").slice(1);
}

/** The text of each fold's summary line. */
export function summariesIn(html: string): string[] {
  return [...html.matchAll(/<summary>(.*?)<\/summary>/gs)].map((found) => textOf(found[1] ?? ""));
}

/** The scroll boxes' opening tags. */
export function scrollBoxes(html: string): string[] {
  return html.match(/<div class="scroll"[^>]*>/g) ?? [];
}
