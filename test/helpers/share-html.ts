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

/** The text of each row of a table's markup, its cells set apart by " | ". */
export function rowsOf(table: string): string[] {
  return [...table.matchAll(/<tr[ >].*?<\/tr>/gs)].map((row) =>
    [...row[0].matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/gs)]
      .map((cell) => textOf(cell[1] ?? "", ""))
      .join(" | "),
  );
}

/** The markup of the first table of a class in some HTML. */
export function tableOf(html: string, className: string): string {
  const found = new RegExp(`<table class="${className}">.*?</table>`, "s").exec(html);
  if (found === null) throw new Error(`No ${className} table`);
  return found[0];
}

/** What a `dl` says: each term, and what it's said to be. */
export function termsOf(html: string): [string, string][] {
  return [...html.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/gs)].map(
    ([, term = "", said = ""]): [string, string] => [textOf(term, ""), textOf(said, "")],
  );
}

/** The text of each item of each list in some markup. */
export function listsOf(html: string): string[][] {
  return [...html.matchAll(/<ul>(.*?)<\/ul>/gs)].map((list) =>
    [...(list[1] ?? "").matchAll(/<li>(.*?)<\/li>/gs)].map((item) => textOf(item[1] ?? "", "")),
  );
}
