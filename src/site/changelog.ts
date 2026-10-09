/**
 * voicecap's CHANGELOG, as the website reads it: each release it records, with its date, its
 * headline, and its items, and the address of a release's entry on GitHub. The facts the pages state
 * of voicecap (./facts.ts) hold these releases, and What's New (./whats-new.ts) draws a card for
 * each. The CHANGELOG ships with the package, and the build reads it each time, so a new release
 * appears on its own, once a build runs with it.
 *
 * A release is a heading written `## [x.y.z] - YYYY-MM-DD`, of a day the calendar has. Any other
 * heading is no release, whether it's `## [Unreleased]`, a version with no date, or one with
 * something after the date, and the lines under it belong to no release: whatever heading comes next
 * ends a release.
 *
 * What a release gives:
 *
 *   - its headline: the first line under its heading that isn't blank or a heading, in plain words
 *     (see `headlineOf`);
 *   - its items, from the entry's bullets at its first two levels: the words that begin each one,
 *     as plain text with each code span set apart (see `itemOf`), other than the headline's own
 *     line, which is no item.
 *
 * Nothing here reads a clock, the network, or the computer: the same text gives the same releases.
 * ./facts.ts runs this module, which imports nothing but types, so a copy of the two stands alone
 * in a package of its own, as the tests lay one out.
 */
import type { ReleaseItem, VoicecapRelease } from "./facts.js";

/**
 * voicecap's CHANGELOG, as GitHub shows it: where each release's entry is linked to, and where the
 * bottom bar of every page of the website links (see ./frame.ts).
 */
export const CHANGELOG_URL = "https://github.com/ICJIA/voicecap/blob/main/CHANGELOG.md";

/** A release's heading in the CHANGELOG: `## [0.13.1] - 2026-10-08`. */
const RELEASE_HEADING = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/;

/** A line that starts with bold words, with the bullet's mark before them or not. */
const BOLD_FIRST = /^(?:[-*+]\s+)?\*\*(.+?)\*\*/;

/** A bullet's mark, and the space after it. */
const BULLET = /^[-*+]\s+/;

/**
 * A bullet of an entry's first two levels, and its words: up to two spaces before the mark, which
 * is `-`, `*`, or `+`, and then a space. A bullet that is three spaces in, or four, or tabbed in,
 * is the third level or deeper, which counts for nothing.
 */
const ITEM_LINE = /^ {0,2}[-*+]\s+(.*)$/s;

/** Bold words at the start of a bullet's words. */
const BOLD_START = /^\*\*(.+?)\*\*/s;

/** What may close bold words as a bullet's own: a period, a comma, or a colon. */
const CLOSING_MARK = /[.,:]$/;

/** A link, `[text](url)`. */
const LINK = /\[([^\]]*)\]\([^)]*\)/g;

/**
 * A code span: words between two backticks, which pair off from the left. A backtick with none to
 * pair with, such as the last of three, is no code span, and neither is a pair with nothing between.
 */
const CODE_SPAN = /`([^`]+)`/g;

/**
 * Whether `text` is a day the calendar has, written YYYY-MM-DD, so that a page never names
 * "2026-13-45". The day is made from its numbers and written out again: a month or a day the
 * calendar lacks comes back as another day (the 30th of February as the 2nd of March), and a day
 * it has comes back as the same text. A day of the years 0000 to 0099 comes back as another too,
 * since Date.UTC takes a year below 100 for one in the 1900s, so those years are refused as well:
 * no release of voicecap is dated in them. ./facts.ts takes the first commit's day by it as well.
 */
export function isDate(text: string): boolean {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (found === null) return false;
  const [year, month, day] = [Number(found[1]), Number(found[2]), Number(found[3])];
  return new Date(Date.UTC(year, month - 1, day)).toISOString().startsWith(text);
}

/** Markdown's words as plain text: a link is its words, and a code span has no marks. */
function plain(markdown: string): string {
  return markdown.replace(LINK, "$1").replace(/`/g, "");
}

/**
 * A release's headline, from the first line of its entry (the first that isn't blank or a heading):
 *
 *   - Of a line that starts with bold words, as a bullet does (`- **The page says more.** The
 *     README…`), it's the bold words, less a "," or "." that ends them.
 *   - Of any other, it's the words up to the first ": " or ". ", or all of them. A bullet's mark is
 *     not one of the words.
 *
 * In both, backticks are removed, and a link, `[text](url)`, is its text.
 */
function headlineOf(line: string): string {
  const text = line.trim();
  const bold = BOLD_FIRST.exec(text)?.[1];
  if (bold !== undefined) return plain(bold.replace(/[.,]$/, "")).trim();
  const words = plain(text.replace(BULLET, ""));
  const ends = [words.indexOf(": "), words.indexOf(". ")].filter((end) => end >= 0);
  return words.slice(0, Math.min(words.length, ...ends)).trim();
}

/** `words` in pieces: its words as they are, and each balanced pair of backticks' words as code. */
function piecesOf(words: string): ReleaseItem {
  const pieces: ReleaseItem = [];
  let from = 0;
  for (const found of words.matchAll(CODE_SPAN)) {
    const [span = "", code = ""] = found;
    if (found.index > from) pieces.push(words.slice(from, found.index));
    pieces.push({ code });
    from = found.index + span.length;
  }
  if (from < words.length) pieces.push(words.slice(from));
  return pieces;
}

/**
 * `pieces`, cut where their words first say ": " or ". ", and no later. A code span never holds the
 * cut, since its words are a command or a name and not a sentence: `` `site: x` `` goes on.
 */
function upToFirstEnd(pieces: ReleaseItem): ReleaseItem {
  const kept: ReleaseItem = [];
  for (const piece of pieces) {
    if (typeof piece !== "string") {
      kept.push(piece);
      continue;
    }
    const ends = [piece.indexOf(": "), piece.indexOf(". ")].filter((end) => end >= 0);
    if (ends.length > 0) {
      kept.push(piece.slice(0, Math.min(...ends)));
      break;
    }
    kept.push(piece);
  }
  return kept;
}

/**
 * `pieces` with no space at the start of the first or the end of the last, when they're words, and
 * no piece of words left empty.
 */
function trimmed(pieces: ReleaseItem): ReleaseItem {
  const tidy = [...pieces];
  const first = tidy[0];
  if (typeof first === "string") tidy[0] = first.trimStart();
  const last = tidy[tidy.length - 1];
  if (typeof last === "string") tidy[tidy.length - 1] = last.trimEnd();
  return tidy.filter((piece) => piece !== "");
}

/**
 * The item a line of an entry gives, or null when it gives none: a line that isn't a bullet of the
 * first two levels (see ITEM_LINE), or a bullet with no words.
 *
 *   - Of a bullet that starts with bold words, it's those words, less a "." or "," or ":" that
 *     ends them, as the bullet's heading is.
 *   - Of any other bullet, it's its words up to the first ": " or ". ", or all of them.
 *
 * It's in pieces: its words as they are, and each balanced pair of backticks' words as a code span.
 * A link, `[text](url)`, is its text. Nothing else is read as Markdown: a mark that isn't one of
 * these is a plain character, an unbalanced backtick too. The words aren't escaped, since they're
 * not markup: whatever draws them does.
 */
function itemOf(line: string): ReleaseItem | null {
  const rest = ITEM_LINE.exec(line)?.[1];
  if (rest === undefined) return null;
  const bold = BOLD_START.exec(rest)?.[1];
  const words = (bold === undefined ? rest : bold.replace(CLOSING_MARK, "")).replace(LINK, "$1");
  const pieces = bold === undefined ? upToFirstEnd(piecesOf(words)) : piecesOf(words);
  const item = trimmed(pieces);
  return item.length === 0 ? null : item;
}

/**
 * Each release the CHANGELOG records, in the file's order (the newest first), with its date, its
 * headline, and its items. A release is a heading written `## [x.y.z] - YYYY-MM-DD`, of a day the
 * calendar has. Any other heading is no release and is skipped, whether it's `## [Unreleased]`, a
 * version with no date, or one with something after the date. Whatever heading comes next ends a
 * release, so what's under a heading that isn't a release is no release's first line or item, and
 * a release with nothing under its heading has an empty headline and no items.
 *
 * The headline is the first line under the heading that isn't blank or a heading, as `headlineOf`
 * words it. The items are every other line of the entry that `itemOf` gives one: the bullets at
 * its first two levels, whatever part of the entry (`### Added`, `### Changed`) they're in. The
 * headline's own line is no item, whether it's a bullet or a paragraph.
 */
export function parseChangelog(text: string): VoicecapRelease[] {
  const releases: VoicecapRelease[] = [];
  // The release whose entry is being read, and whether its first line is still to come.
  let release: VoicecapRelease | undefined;
  let looking = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      const [, version, date] = RELEASE_HEADING.exec(line) ?? [];
      release =
        version !== undefined && date !== undefined && isDate(date)
          ? { version, date, headline: "", items: [] }
          : undefined;
      if (release !== undefined) releases.push(release);
      looking = true;
    } else if (release !== undefined) {
      if (looking && line.trim() !== "" && !line.startsWith("### ")) {
        release.headline = headlineOf(line);
        looking = false;
      } else {
        const item = itemOf(line);
        if (item !== null) release.items.push(item);
      }
    }
  }
  return releases;
}

/**
 * The address of a release's entry in voicecap's CHANGELOG on GitHub: the CHANGELOG, and the anchor
 * GitHub gives its heading, `## [0.13.1] - 2026-10-08`. GitHub makes an anchor of a heading's text,
 * `[0.13.1] - 2026-10-08`, in three steps: it's written in lower case, every character that isn't
 * a letter, a digit, a space, or a hyphen is dropped, and each space becomes a hyphen. That makes
 * `0131---2026-10-08`: the brackets and the dots go, the spaces round the dash become hyphens, and
 * the dash stays. Nothing else is left in it, whatever the version holds.
 */
export function changelogHref({ version, date }: { version: string; date: string }): string {
  const anchor = `[${version}] - ${date}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N} -]/gu, "")
    .replaceAll(" ", "-");
  return `${CHANGELOG_URL}#${anchor}`;
}
