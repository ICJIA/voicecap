/**
 * Words and code, set in Markdown so that nothing a record or a website supplies can be Markdown.
 * The report for AI tools (./markdown.ts) says every word that isn't voicecap's own through one of
 * these:
 *
 * - `markdownText` and `markdownInline`: words outside a fence, on one line, with every character
 *   that could make Markdown escaped by a backslash;
 * - `inlineCode`: a short stretch of code or a name in the middle of a line, as it is;
 * - `fenced`: the lines of a transcript, a record, or a fix's code, as they are, in a block no line
 *   of them can end.
 *
 * What escaping guarantees: words that go through `markdownText` can't begin a block (a heading, a
 * quote, a list, a rule, a fence, a table, a reference) or make anything inline (code, emphasis,
 * strikethrough, a link or image, HTML or an angle-bracket link, an entity, math) in CommonMark or
 * in GitHub's Markdown. A plain web address in them stays words, which a viewer may link. And
 * nothing is lost: take away the backslashes that escape, and the words are the ones that went in,
 * but for their spaces, which are one each.
 *
 * Pure. It reads nothing, and imports nothing.
 */

/** Words on one line: each run of whitespace, line breaks and tabs among it, is one space. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The characters that make Markdown wherever they are in a line: a backslash (which would escape
 * what follows it), a backtick (code), `*` (emphasis), `[` and `]` (a link, an image, a reference),
 * `<` (HTML, a link in angle brackets), `|` (a table), `~` (strikethrough), and `$` (math, on
 * GitHub); an `_` (emphasis) that isn't inside a word; and an `&` that begins an entity (`&amp;`,
 * `&#35;`), which a viewer would turn into its character. `>` makes a quote only at the start of a
 * line, and is left to `escapeLeading`.
 *
 * An underscore between two letters or digits makes no emphasis in CommonMark or on GitHub, so a
 * run's id ("2026-10-06_1134") and a name such as `read_not_finished` are left as they are.
 */
const MARK = /[\\`*[\]<|~$]|_|&(?=#?[A-Za-z0-9]+;)/g;

/** Whether a character is a letter or a digit, which an underscore between two is no emphasis to. */
const isWord = (char: string): boolean => /^[\p{L}\p{N}]$/u.test(char);

/**
 * Words with the characters that make Markdown anywhere in a line escaped, and nothing else
 * changed: not a space, a line break, or the ends. For the pieces of a line that is put together
 * from words and Markdown of its own, which `markdownInline` would trim.
 */
export function escapeInline(text: string): string {
  return text.replace(MARK, (found, at: number) =>
    found === "_" && isWord(text.charAt(at - 1)) && isWord(text.charAt(at + 1))
      ? found
      : `\\${found}`,
  );
}

/**
 * Words with what would begin a block escaped, where they begin a line: `#` (a heading), `>` (a
 * quote), `-` and `+` (a list, or a rule), `=` (a heading's underline), and a number with a full stop
 * or a bracket after it (a list). The other characters that begin a block, a backtick, `~`, `|`,
 * `*`, `_`, `<`, and `[`, are escaped wherever they are (`escapeInline`).
 */
export function escapeLeading(text: string): string {
  return text.replace(
    /^(?:([#>+=-])|(\d{1,9})([.)]))/,
    (_found, mark: string | undefined, digits: string | undefined, stop: string | undefined) =>
      mark === undefined ? `${digits ?? ""}\\${stop ?? ""}` : `\\${mark}`,
  );
}

/**
 * Words for the middle of a line, such as after a label or a list's mark: on one line, with what
 * makes Markdown anywhere in a line escaped, and a hash at their end too, which a heading would take
 * for its closing mark ("Page #" is the heading "Page").
 */
export function markdownInline(text: string): string {
  return escapeInline(oneLine(text)).replace(/#+$/, (hashes) => hashes.replaceAll("#", "\\#"));
}

/**
 * Words that begin a paragraph or a list's item: `markdownInline`, with what would begin a block
 * escaped as well. Words that follow a label, or sit in a heading, can't begin a block, so the report
 * says those with `markdownInline`; where it can't be sure, it uses this one.
 */
export function markdownText(text: string): string {
  return escapeLeading(markdownInline(text));
}

/**
 * Code or a name in the middle of a line, as it is, between backticks: a stretch of backticks inside
 * it is no problem, since the delimiter is longer than any of them, with a space inside where a
 * backtick would touch it (which a viewer takes off again). It stays on one line: a line break in it
 * is a space, and so is the space at both ends that a viewer would take one of off.
 */
export function inlineCode(text: string): string {
  const code = text.replace(/\s*[\r\n]+\s*/g, " ");
  const longest = (code.match(/`+/g) ?? []).reduce((most, run) => Math.max(most, run.length), 0);
  const delimiter = "`".repeat(longest + 1);
  const touches = code.startsWith("`") || code.endsWith("`");
  const spaced = code.startsWith(" ") && code.endsWith(" ") && code.trim() !== "";
  const pad = touches || spaced || code === "" ? " " : "";
  return `${delimiter}${pad}${code}${pad}${delimiter}`;
}

/**
 * Lines as a fenced block of code, as they are: a transcript, a record, a fix's code. `info` says
 * what they are (text by default), for a viewer to show them by. The fence is longer than any run of
 * backticks in any line, whatever else is there (a fence of its own, a line break, a tilde, a hash),
 * so nothing the lines hold can end the block early: a closing fence is at least as long as the
 * opening one, and no line has a run of backticks that long.
 */
export function fenced(lines: readonly string[], info = "text"): string {
  const longest = lines.reduce(
    (most, line) =>
      (line.match(/`+/g) ?? []).reduce((further, run) => Math.max(further, run.length), most),
    0,
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return [`${fence}${info}`, ...lines, fence].join("\n");
}
