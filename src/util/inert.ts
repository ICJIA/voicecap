/**
 * `text`, written so that a terminal shows it and does nothing else with it.
 *
 * voicecap prints words that aren't its own: a website's (a page's title, a sitemap's entries, a
 * server's reply), a record's, and what a screen reader said. A control character in them would
 * act on the terminal instead of being shown. An escape sequence can move the cursor, clear the
 * screen, set the window's title, or write over a line already shown; a carriage return takes the
 * cursor back to the start of its line; and an invisible formatting character can turn the words
 * around (a right-to-left override) or hide some between the ones that show.
 *
 * So each CR LF becomes a line feed, the way a line ends in what voicecap writes, and every other
 * control character (Unicode's Cc), invisible formatting character (Cf), and line or paragraph
 * separator (U+2028, U+2029) is written as an escape: `\u{1b}` for Escape, in lower-case hex, as
 * `shown` in share/walkthrough.ts writes one. A line feed and a tab stay, since they only lay the
 * words out.
 *
 * Each pattern looks at one character, or one CR LF, at a time, so the time grows with the text's
 * length and no more, whatever the text is.
 */
export function inertText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(
      /(?![\n\t])[\p{Cc}\p{Cf}\u{2028}\u{2029}]/gu,
      (character) => `\\u{${character.codePointAt(0)!.toString(16)}}`,
    );
}
