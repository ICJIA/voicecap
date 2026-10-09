/**
 * Words and code, set in Markdown so that nothing a record or a website supplies can be Markdown.
 * The report for AI tools (./markdown.ts) says every word that isn't voicecap's own through one of
 * these:
 *
 * - `markdownText` and `markdownInline`: words outside a fence, on one line, with every character
 *   that could make Markdown escaped by a backslash;
 * - `markdownSentence`: the same for a sentence of voicecap's own that holds the addresses of the
 *   site's pages, which it sets in code, where they read as they are;
 * - `inlineCode`: a short stretch of code or a name in the middle of a line, as it is;
 * - `fenced`: the lines of a transcript, a record, or a fix's code, as they are, in a block no line
 *   of them can end.
 *
 * What escaping guarantees: words that go through `markdownText` can't begin a block (a heading, a
 * quote, a list, a rule, a fence, a table, a reference) or make anything inline (code, emphasis,
 * strikethrough, a link or image, HTML or an angle-bracket link, an entity, math) in CommonMark or
 * in GitHub's Markdown. And nothing is lost: take away the backslashes that escape, and the words
 * are the ones that went in, but for their spaces, which are one each.
 *
 * A plain web address would undo the rest, so it can't be left in the words. GitHub's Markdown
 * (and markdown-it, with its links on) finds an `http://`, `https://`, `ftp://`, or `www.` address
 * in the raw text, and takes it to the next space or `<`, backslashes and all: an address followed
 * by `\<img …>` hands the `<` back as live HTML, and one followed by `*:` hands back emphasis. So
 * the colon of every `://` and the dot of every `www.` is escaped, and no address is found. A viewer
 * that links the text it has after the escapes are taken off may still link the address; that link
 * goes to the words and leaves what was escaped as it was. An address voicecap wrote itself (the
 * site's, a page's) is set in code instead (`inlineCode`, `markdownSentence`), where it reads clean
 * and needs no escape. Bare domain names (`example.com`) are never found by GitHub's Markdown, and
 * a viewer that links them takes nothing with it.
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
 * GitHub); an `_` (emphasis) that isn't inside a word; an `&` that begins an entity (`&amp;`,
 * `&#35;`), which a viewer would turn into its character; and the two marks of a plain web address:
 * the colon of a `://`, and the dot of a `www.` (in any case) that doesn't follow a letter or a
 * digit, which would take the characters after it, backslashes among them, as part of the address.
 * `>` makes a quote only at the start of a line, and is left to `escapeLeading`.
 *
 * An underscore between two letters or digits makes no emphasis in CommonMark or on GitHub, so a
 * run's id ("2026-10-06_1134") and a name such as `read_not_finished` are left as they are.
 */
const MARK = /[\\`*[\]<|~$]|_|&(?=#?[A-Za-z0-9]+;)|:(?=\/\/)|(?<=(?<![\p{L}\p{N}])www)\./giu;

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
 * Words with a run of hashes at their end escaped, which a heading would take for its closing mark
 * ("Page #" is the heading "Page"). The pattern starts only where a run does, so a long run of
 * hashes is looked at once, not from each of its characters.
 */
function escapeTrailingHash(text: string): string {
  return text.replace(/(?<!#)#+$/, (hashes) => hashes.replaceAll("#", "\\#"));
}

/**
 * Words for the middle of a line, such as after a label or a list's mark: on one line, with what
 * makes Markdown anywhere in a line escaped, and a hash at their end too.
 */
export function markdownInline(text: string): string {
  return escapeTrailingHash(escapeInline(oneLine(text)));
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
 * The start of a plain web address of the kind voicecap writes for the site's pages, `http://` or
 * `https://`, and the characters after it up to a space or an angle bracket: where a viewer would
 * end it, and where an address in a sentence of ours does too.
 */
const ADDRESS = /\bhttps?:\/\/[^\s<>]+/giu;

/** What ends a sentence's clause after an address, or closes a bracket around it: not the address's. */
const AFTER_ADDRESS = ".,;:!?'\")]}";

/** An address without the marks that follow it in a sentence ("…/about/," is "…/about/"). */
function addressOf(found: string): string {
  let end = found.length;
  while (end > 0 && AFTER_ADDRESS.includes(found.charAt(end - 1))) end -= 1;
  return found.slice(0, end);
}

/**
 * Words of voicecap's own that may hold the addresses of the site's pages, with the characters that
 * make Markdown escaped (`escapeInline`) and each plain web address set in code, as it is, where it
 * reads clean (an escaped one reads `https\://…`), and nothing else changed. Whoever wrote an
 * address in them, a name a person gave a page included, it is set in code, which makes no link of
 * it.
 */
export function escapeSentence(text: string): string {
  let said = "";
  let from = 0;
  for (const found of text.matchAll(ADDRESS)) {
    const address = addressOf(found[0]);
    said += escapeInline(text.slice(from, found.index)) + inlineCode(address);
    from = found.index + address.length;
  }
  return said + escapeInline(text.slice(from));
}

/**
 * A sentence of voicecap's own that may hold the addresses of the site's pages ("Read the
 * transcripts of https://dvfr.illinois.gov/about/ again"), for the start of a paragraph or a list's
 * item: `markdownText`, with each plain web address in it set in code (`escapeSentence`).
 */
export function markdownSentence(text: string): string {
  return escapeLeading(escapeTrailingHash(escapeSentence(oneLine(text))));
}

/**
 * Code or a name in the middle of a line, as it is, between backticks: a stretch of backticks inside
 * it is no problem, since the delimiter is longer than any of them, with a space inside where a
 * backtick would touch it (which a viewer takes off again). It stays on one line: a run of spaces
 * that holds a line break is one space, and so is the space at both ends that a viewer would take
 * one of off.
 */
export function inlineCode(text: string): string {
  const code = text.replace(/\s+/g, (run) => (/[\r\n]/.test(run) ? " " : run));
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
