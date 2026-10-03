/**
 * A line of the shareable report, as both of its copies say it: pieces of plain words, some of
 * them in bold, in the fixed-width font, or linked out. A line holds no markup, and nothing in it is
 * escaped: the page escapes each piece as it draws it (`lineHtml`, in html/parts.ts), and the Word
 * copy sets each in a run of its own.
 */

/** A piece of a line: plain words, or words in bold, in the fixed-width font, or linked out. */
export type Inline = string | { text: string; bold?: true; mono?: true; href?: string };

/** A line of the report, as both copies say it: no markup, and nothing escaped. */
export type Line = Inline[];

/** The line's words alone. */
export function lineText(line: Line): string {
  return line.map((piece) => (typeof piece === "string" ? piece : piece.text)).join("");
}

/** A `<b>` or a `<code>` and its words, which hold no tag or entity. */
const TAGGED = /<(b|code)>([^<>&]*)<\/\1>/g;

/**
 * Fixed markup of `<b>` and `<code>` only, as the timeline's cells have it, as a line. The words
 * are the line's as they are: a cell holds no entity, since the page inserts it as it is.
 */
export function lineOfMarkup(markup: string): Line {
  const line: Line = [];
  let from = 0;
  for (const found of markup.matchAll(TAGGED)) {
    const [tagged, tag, text = ""] = found;
    if (found.index > from) line.push(markup.slice(from, found.index));
    if (text !== "") line.push(tag === "b" ? { text, bold: true } : { text, mono: true });
    from = found.index + tagged.length;
  }
  if (from < markup.length) line.push(markup.slice(from));
  return line;
}

/** A sentence's end: a ".", "!", or "?" that a space or the end of the text follows. */
const SENTENCE_END = /[.!?](?=\s|$)/;

/**
 * A text with its first sentence in bold, and the rest as it is. A sentence ends at a ".", "!", or
 * "?" that a space or the end follows, so a version number in it ("0.4.1") never ends it; a text
 * with no such end is bold whole.
 */
export function firstSentenceBold(text: string): Line {
  const end = SENTENCE_END.exec(text);
  const cut = end === null ? text.length : end.index + 1;
  const rest = text.slice(cut).trim();
  return [{ text: text.slice(0, cut), bold: true }, ...(rest === "" ? [] : [` ${rest}`])];
}
