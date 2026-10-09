/**
 * The website's one style block, its own, in the look of the audit tool, audit.icjia.app: a
 * near-black page with its main part in one centered column; a small, spaced-out line in capitals
 * (the kicker) over a very heavy headline, then a quieter lead; cards with thin borders and rounded
 * corners; a line between the parts of a page; and big numbers in a fixed-width font. The shared
 * reports keep their own look (../share/html/style.ts), and this style takes nothing from it but
 * four of its rules, copied: visible keyboard focus (in the website's link color), the skip link,
 * text only a screen reader gets, and what the script shows (`[hidden]`).
 *
 * It is the page's only styling: the page sets no `style` attribute, since a Content Security
 * Policy that hashes this block allows nothing else. It embeds no font either, so the page loads
 * nothing and its policy allows no font at all. Each rule's reason:
 * - the colors are the audit tool's, as tokens: dark first, light when the reader picks it
 *   (`data-theme="light"` on the root), and light in print, where the theme button is left out.
 *   Each of `--good`, `--warn`, `--bad`, and `--act` has a tint of 12% (`--good-tint`), made from
 *   it on the root, so it follows the theme. The light colors are the audit tool's own, which its
 *   makers darkened until each passed 4.5 to 1 against its own tint, so a color sits only on its
 *   own tint, as in a pill, and a link never sits on one: the light theme's blue is under 4.5 to 1
 *   on a tint. axe checks every page in both themes;
 * - the words are in the system's own fonts, as the audit tool's are (`--sans`), and big numbers,
 *   fingerprints, and commands in its fixed-width one (`--mono`). Body text is 1.0625rem, 17
 *   pixels at the browser's own size; a lead `clamp(1rem, 2vw, 1.1875rem)`, in the quieter color,
 *   at most 64 characters a line; a page's h1 `clamp(2.125rem, 6vw, 3.875rem)`, and a part's h2
 *   `clamp(1.625rem, 4.2vw, 2.5rem)`, both at weight 900, which is Segoe UI Black on Windows;
 * - a kicker is 0.8125rem, at weight 700, spaced out (0.14em), in the quieter color, and in
 *   capitals set by the style: it's written in ordinary case, so a screen reader reads words, not
 *   letters. The words that matter in it are in `--act`. The style's capitals are small capitals
 *   (`font-variant-caps: all-small-caps`), which are only how the letters are drawn, so a screen
 *   reader gets the words as they're written. `text-transform: uppercase` would change the words
 *   themselves: Chromium hands a screen reader the text it makes, so a verdict would reach it as
 *   "1 PROBLEM NEEDS ATTENTION, ON 32 PAGES". The parts in capitals are the audit tool's short
 *   labels, none of which holds a digit: a kicker, a law's tag, and a table's header row. A small
 *   capital is about as tall as a lowercase letter (Windows draws it from a capital, at 70% of
 *   its size, and a Mac's fonts have real ones about as tall), so each of the three is drawn at
 *   the caps scale (`--caps-scale`, 1.4) times its spec's size, which makes its letters as tall
 *   as the spec's capitals, and its letter-spacing and its line height are divided by the scale,
 *   so its spacing and its box stay the spec's. A version's pill is digits, which small capitals
 *   leave as they are, at the spec's size. A verdict is a sentence, in ordinary case, and so is a
 *   label that's part of a heading;
 * - the bars run the window's width, with what's in them in a column of 72rem, and the main part is
 *   a column of 56rem (the audit tool's `max-w-6xl` and `max-w-4xl`). The gutter is 16 pixels on a
 *   phone and 24 from 40em, which is 640 pixels at the browser's own text size: an em in a media
 *   query is the reader's own size, so a reader who has made it larger gets the narrower layout in
 *   a wider window. Every width the style changes at is in em, for the same reason;
 * - the top bar scrolls with the page, as the audit tool's does: nothing on the page sticks, so no
 *   room is kept clear for it (the `scroll-padding-top` of 0.13.2 is gone), and nothing that has
 *   focus, or that a link points to, can be under it;
 * - the top bar is the audit tool's: the website's name at its left, at weight 600 in the
 *   headline's color, and the website's navigation at its right, which wraps under the name where
 *   there's no room. The links of both bars are in the quieter color, turning the headline's under
 *   the pointer. The link of the page the reader is on (`aria-current="page"`) is in the
 *   headline's color, bold, and underlined more heavily than the other links, which the browser
 *   underlines too, so it is told apart by more than its color. Its line is 0.15em thick, in
 *   proportion to the text as theirs is, so it stays the heavier at a larger size. On the front
 *   page, that link is the website's name, which is drawn as ever;
 * - the theme button is an icon in the quieter color, the sun in the dark theme and the moon in the
 *   light one, each shown by the root's `data-theme`, with a line around it under the pointer. A
 *   button's focus ring rounds its corners at 4 pixels: the theme button keeps its own 8;
 * - the bars' words, and a long version, break where they must at a large text size in a narrow
 *   window, so neither bar runs out of the window, and the bottom bar's links put their words under
 *   their icon where there's no room for both;
 * - a name or a fingerprint is one word, longer than any box, so the text it can be in breaks it
 *   where it must (`overflow-wrap: anywhere`), rather than run out of its box or the window;
 * - the parts, as the audit tool draws them:
 *   - a card has the panel behind it, a 1px border in the line's color, corners of 14 pixels, and
 *     22 by 20 pixels inside; a card's words are in `--text-2`, and a card in a card, or a table's
 *     header, is on `--panel-2`. The front page's banner is one;
 *   - a part of a page (`.part`) has 44 pixels above and below it, and a line between it and the
 *     part before;
 *   - a pill is small, at weight 700, in its color on its color's tint, with corners of 6 pixels:
 *     a version's in small capitals, a law's tag in small capitals at the caps scale, and a
 *     verdict in ordinary case;
 *   - a big number (`.n`) is at weight 900, in the fixed-width font with figures of one width, in a
 *     color of its own (`--good` unless it says), and sized to its card, not the window
 *     (`clamp(1.5rem, 17cqi, 2.375rem)` in a card that's a container, with
 *     `container-type: inline-size`), so a long number never runs out of its card;
 *   - a table's header row is small, in small capitals at the caps scale, in the quieter color, on
 *     `--panel-2`, and lines divide its rows. A table is in a box of its own (`.scroll`), which
 *     scrolls when the table is wider than the window, so the page itself is never wider than 320
 *     pixels; the page gives the box its focus and its name, and the style shows its focus as a
 *     link's;
 *   - a button, such as a report's "Open the report" or a site's "Visit the site", is an outline in
 *     the line's color, with words in the headline's on the panel;
 * - the front page: each view's heading is a card, with its picture in a circle (which only repeats
 *   the heading's words) and the heading, which stay on one line together, and how many it holds as
 *   a big number in `--good`, at the end of the line, or under them where there's no room. A count
 *   beside a smaller heading is a chip. A site's heading has its picture in a circle too, and its
 *   link to the site itself, a button, ends the line, or goes under it where there's no room;
 * - a site's current report is a card, headed by its line under what it is (a small, quieter
 *   label), with its two links as buttons, which wrap onto a line of their own where there's no
 *   room. Its verdict is a pill in the verdict's color, green as `--good`, amber as `--warn`, and
 *   red as `--bad`, in ordinary case, after a sign which a screen reader doesn't read
 *   (`content: "✓" / ""`), since the words say it; how many pages NVDA read is a bar in the same
 *   color (the shareable page's `track`), with its words beside it, or under it on a narrow window;
 * - the fold of files is a card whose line has a marker, which a screen reader doesn't read either,
 *   turned when it's open. The files of a report are a grid of cards in the card, whose columns are
 *   no wider than their own box (`minmax(min(300px, 100%), 1fr)`), so nothing runs past a window
 *   320 pixels wide, where WCAG's reflow rule is measured;
 * - on a screen, a page shorter than the window ends at its bottom, so the footer sits there: the
 *   body is a column at least as tall as the window, and the main part grows, keeping its measure.
 *   In print the page is laid out as it was;
 * - the trust page (./trust.ts) is headed as the audit tool's trust page: a kicker over the page's
 *   headline, in two lines, the second, on a line of its own, in `--good`; then the lead; the stamp,
 *   in the audit tool's amber box (a 2px line in `--warn` on `--warn-tint`), its label, small and
 *   bold, at its left, and the records' date, big and at weight 900, at its right, or under the
 *   label where there's no room; and four big numbers, in the audit tool's tiles' colors (`--good`,
 *   `--good`, `--act`, and `--warn`), each in a card with its line and its link, which ends the card
 *   so the links of a row line up. The cards are one a row on a phone, two from 36em, and four from
 *   60em, in columns that shrink to nothing. Each part after it has its kicker over a heavy heading;
 *   its points are cards, one under another; its cards are three a row where each has 17rem, and
 *   one a row on a phone, headed in `--good` as the audit tool's are, and a heading that links to
 *   its source is a link, in `--link`; a law's tag is a pill; and its newest five releases run down
 *   a line, each one's line as What's New's, its version a pill in `--good`, with a line of links
 *   after them. A big number that isn't recorded is a dash, in the quieter color;
 * - What's New (./whats-new.ts): its head is the trust page's block, a kicker over the heading and
 *   then the lead, with the heading's own margin left out of it; then a card for each release, one
 *   under another, 16 pixels apart. A card is the card (`.card`): its first line is the version's
 *   pill in `--good`, its day, and, on the version that built the website, "the current version" in
 *   the quieter color, the line the trust page gives each of its releases too; its headline is a
 *   smaller, heavy heading of the card's, in the headline's color; its points are a list in the
 *   card's words' color; and the link to its entry ends it, in bold, as a card's link does;
 * - Technical details (./technical.ts): its head is What's New's, with the version it's from under
 *   the lead, in the quieter color. "On this page" is a card of numbered links to its parts, in two
 *   columns where each has 17rem, and a part a link goes to keeps its kicker in view above its
 *   heading. A part's points are a list in the card's words' color, no wider than 72 characters,
 *   and a heading of the third level is set apart from what comes before it. How a run works is an
 *   ordered list of boxes, each a card with its number, which only repeats the list's own, drawn
 *   before it: three a row from 60em, two from 36em, and one under another on a phone, with an
 *   arrow after each box but the last, pointing on, or down on a phone. The arrows and the numbers
 *   are the style's, with no words for a screen reader (`content: "→" / ""`), so it hears the list.
 *   The transcripts home is a tree, a card of lists in lists along a line, each name in the
 *   fixed-width font, in the headline's color, with what it holds under it. A table's first cell
 *   names its row: in the words' size, bold, and in the headline's color, not in the header row's
 *   small capitals. A command or a name in a table keeps to one line, and each table has a width
 *   its columns can be read at, so on a phone it scrolls in its box. Related documents is a card of
 *   four cards, two a row where each has 19rem, each on the second panel, with a small label, its
 *   title, a link, in --link and underlined, as every card's title that's a link is, and a line in
 *   the quieter one;
 * - the bottom bar has a line above it, then one row of six items, centered in the bars' column,
 *   small (0.875rem), in the quieter color, each link its icon and its words, as the audit tool's
 *   is. On a phone the row wraps, each of its rows centered. Its dividers are a thin line before
 *   each item but the first (`li + li`), drawn by the style alone, so a screen reader hears a list
 *   of six, and no dividers;
 * - the way back to the test results, which opens the trust page, What's New, and Technical
 *   details, is an arrow and its words, in the quieter color, as the audit tool's "Back" is;
 * - the front page's "On this page" is a row: its name, a kicker, then a link to each view, which
 *   wraps;
 * - the front page opens with its kicker over its heading, 18 pixels above it, as the website's
 *   other pages keep theirs, its names in `--act`. Under the lead, its What's New banner is a card,
 *   as the audit tool's: the newest release's version, a pill in `--good`, at its left, in a column
 *   no wider than 40% of the card, so a long version breaks in it; and beside it the kicker, the
 *   release's headline, in the card's words' color, and the day it was released with the link to
 *   every update, quieter and smaller.
 */
export const SITE_CSS = `:root {
  --bg: #0a0a0a; --panel: #111111; --panel-2: #141414; --line: #222222;
  --heading: #ffffff; --text: #f5f5f5; --text-2: #d4d4d4; --muted: #a3a3a3; --link: #60a5fa;
  --good: #34d399; --warn: #fbbf24; --bad: #f87171; --act: #67e8f9;
  --good-tint: color-mix(in srgb, var(--good) 12%, transparent); --warn-tint: color-mix(in srgb, var(--warn) 12%, transparent);
  --bad-tint: color-mix(in srgb, var(--bad) 12%, transparent); --act-tint: color-mix(in srgb, var(--act) 12%, transparent);
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "Cascadia Mono", Consolas, "SF Mono", Menlo, monospace;
  /* A small capital is about as tall as a lowercase letter, Windows' drawn ones and a Mac's real ones alike: a short label in small capitals is drawn this many times its size, to stand as tall as a capital at that size, with its spacing and its line divided by it. */
  --caps-scale: 1.4;
  color-scheme: dark;
}
:root[data-theme="light"] {
  --bg: #f9fafb; --panel: #ffffff; --panel-2: #f3f4f6; --line: #e5e7eb;
  --heading: #111827; --text: #1f2937; --text-2: #374151; --muted: #4b5563; --link: #2563eb;
  --good: #196549; --warn: #705510; --bad: #8b3f3f; --act: #2c626a;
  color-scheme: light;
}
@media print { :root { --bg: #f9fafb; --panel: #ffffff; --panel-2: #f3f4f6; --line: #e5e7eb; --heading: #111827; --text: #1f2937; --text-2: #374151; --muted: #4b5563; --link: #2563eb; --good: #196549; --warn: #705510; --bad: #8b3f3f; --act: #2c626a; color-scheme: light; } .theme { display: none; } }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--sans); font-size: 1.0625rem; line-height: 1.55; }
a { color: var(--link); } a:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--link); outline-offset: 3px; border-radius: 4px; }
.skip { position: absolute; left: -9999px; } .skip:focus { left: 16px; top: 16px; background: var(--panel); padding: 8px 12px; z-index: 5; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
/* Only the hidden attribute shows or hides what the script does: the theme button. */
[hidden] { display: none !important; }
/* the type: heavy headlines, in the headline's color, and the fixed-width font for commands and fingerprints */
h1, h2, h3, h4 { margin: 0; color: var(--heading); text-wrap: balance; }
h1 { font-size: clamp(2.125rem, 6vw, 3.875rem); line-height: 1.05; font-weight: 900; margin-bottom: 18px; }
h2 { font-size: clamp(1.625rem, 4.2vw, 2.5rem); line-height: 1.1; font-weight: 900; }
h3 { font-size: 1.1875rem; line-height: 1.25; font-weight: 800; }
h4 { font-size: 1.0625rem; line-height: 1.3; font-weight: 700; }
/* A page's h1 may have a second line, on a line of its own, in the color of what's good, as the trust page's does. */
h1 .good { color: var(--good); display: block; }
p { margin: 0; }
code { font-family: var(--mono); font-size: 0.88em; overflow-wrap: anywhere; }
/* A name is a whole address, a host or a file's name, and a fingerprint is one long word: break them where they must, rather than run out of the box or the window. So do the bars' words, at a large text size in a narrow window, and a long version. */
main :where(h1, h2, h3, h4, p, li, a, span, code), .bar a, footer li { overflow-wrap: anywhere; }
/* a kicker: a few words that say what follows, small, bold, spaced out, and in small capitals, which leave its words as they're written for a screen reader, in lines of an even length where it wraps; the words that matter in it are in --act. Its capitals are as tall as the spec's 0.8125rem capitals, at the caps scale, with the spec's spacing of 0.14em and line of 1.4 kept. */
.kicker { font-size: calc(0.8125rem * var(--caps-scale)); font-weight: 700; line-height: calc(1.4 / var(--caps-scale)); letter-spacing: calc(0.14em / var(--caps-scale)); font-variant-caps: all-small-caps; color: var(--muted); text-wrap: balance; }
.kicker .act { color: var(--act); }
/* a lead: quieter than the words, and no more than 64 characters a line */
.lead { font-size: clamp(1rem, 2vw, 1.1875rem); color: var(--muted); max-width: 64ch; }
/* the top bar, as the audit tool's: the website's name at its left, a link to the front page, and the website's navigation at its right, its three pages and the theme button, which wraps under the name where there's no room; a line under it, scrolling with the page */
.bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 24px; padding-block: 14px; border-bottom: 1px solid var(--line); }
.bar .name { color: var(--heading); font-size: 1.125rem; font-weight: 600; line-height: 1.3; text-decoration: none; }
.bar .name:hover { text-decoration: underline; }
.bar nav { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 22px; }
.bar nav a { display: inline-block; padding-block: 4px; color: var(--muted); font-size: 0.9375rem; font-weight: 400; }
/* a link of either bar, and the way back, turns the headline's color under the pointer */
.bar nav a:hover, footer a:hover, .back:hover { color: var(--heading); }
/* the page the reader is on, in either bar: in the headline's color, bold, and underlined more heavily than the other links, which the browser underlines too, so it is told apart by more than its color; the line is in proportion to the text, as the browser's own is. On the front page, it's the website's name, which is drawn as ever. */
.bar nav a[aria-current="page"], footer a[aria-current="page"] { color: var(--heading); font-weight: 700; text-decoration: underline; text-decoration-thickness: 0.15em; }
/* the theme button: an icon, in the quieter color, turning the headline's under the pointer, with a line around it then, and 32 pixels square at the browser's own text size. It shows the sun in the dark theme and the moon in the light one; its words are its label. Its focus keeps its corners. */
.theme { padding: 6px; border: 1px solid transparent; border-radius: 8px; background: none; color: var(--muted); line-height: 0; cursor: pointer; }
.theme:hover { color: var(--heading); border-color: var(--line); }
.theme:focus-visible { border-radius: 8px; }
.theme .icon { display: block; width: 1.25rem; height: 1.25rem; }
.theme .moon { display: none; }
:root[data-theme="light"] .theme .sun { display: none; }
:root[data-theme="light"] .theme .moon { display: block; }
/* the page: the main part in a column of 56rem, and what's in the bars and the footer in one of 72rem, each across the window's middle, with a gutter of 16 pixels, and 24 from 40em */
main { box-sizing: border-box; width: 100%; max-width: calc(56rem + 32px); margin-inline: auto; padding: 48px 16px 64px; }
.bar, footer { padding-inline: max(16px, calc(50% - 36rem)); }
@media (min-width: 40em) {
  main { max-width: calc(56rem + 48px); padding-inline: 24px; }
  .bar, footer { padding-inline: max(24px, calc(50% - 36rem)); }
}
main > .lead { margin-bottom: 8px; }
/* a card: the panel behind it, a thin line around it, round corners, and 22 by 20 pixels inside; its words in --text-2. The front page's banner is one. */
.card, .news { display: grid; gap: 10px; align-content: start; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 22px 20px; }
.card > *, .news > * { min-width: 0; }
/* a pill: small, bold, in its color on its color's tint, with corners of 6 pixels: a version, a law's tag, and a verdict (below) */
.pill, .verdict, .tag { display: inline-flex; justify-self: start; align-items: baseline; gap: 6px; padding: 3px 10px; border-radius: 6px; font-weight: 700; }
/* A version's pill is digits, which small capitals leave as they are, at the spec's size. A verdict is a sentence, in ordinary case: in capitals it reads worse, and its digits would stand above small-cap letters. */
.pill, .verdict { font-size: 0.8125rem; line-height: 1.4; letter-spacing: 0.06em; }
.pill { font-variant-caps: all-small-caps; }
/* a law's tag, a short label: in small capitals as tall as the spec's 0.8125rem capitals, at the caps scale, with the spec's spacing of 0.06em and line of 1.4 kept. Its text's box is taller than that line (Segoe UI's is 1.33 times its size, 25 pixels here), and the tag has a color of its own behind it, so it's 4 pixels inside above and below, a pixel more than a pill: the text's box stays on the tag's color, where axe can tell what each letter is drawn on. */
.tag { font-size: calc(0.8125rem * var(--caps-scale)); line-height: calc(1.4 / var(--caps-scale)); letter-spacing: calc(0.06em / var(--caps-scale)); font-variant-caps: all-small-caps; padding-block: 4px; }
.pill.good, .verdict.ok { color: var(--good); background: var(--good-tint); }
.pill.warn, .verdict.warn { color: var(--warn); background: var(--warn-tint); }
.pill.bad, .verdict.bad { color: var(--bad); background: var(--bad-tint); }
.pill.act, .tag { color: var(--act); background: var(--act-tint); }
/* a big number: heavy, in the fixed-width font with figures of one width, in a color of its own, and sized to its card (a container), so a long number never runs out of it */
.n { margin: 0; font-family: var(--mono); font-weight: 900; font-size: clamp(1.5rem, 17cqi, 2.375rem); line-height: 1.1; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; color: var(--good); }
.n.good { color: var(--good); } .n.warn { color: var(--warn); } .n.bad { color: var(--bad); } .n.act { color: var(--act); }
/* a table, in a box of its own that scrolls when the table is wider than the window: the page gives the box its focus and its name. Its header row is small, in small capitals as tall as the spec's 0.75rem capitals, at the caps scale, with the spec's spacing of 0.08em and the body's line of 1.55 kept, and quieter, on the second panel, and lines divide its rows. */
.scroll { overflow-x: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; }
.scroll:focus-visible { outline: 2px solid var(--link); outline-offset: 3px; }
table { width: 100%; border-collapse: collapse; font-size: 0.9375rem; }
th, td { padding: 10px 14px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); }
th { font-size: calc(0.75rem * var(--caps-scale)); font-weight: 700; line-height: calc(1.55 / var(--caps-scale)); letter-spacing: calc(0.08em / var(--caps-scale)); font-variant-caps: all-small-caps; color: var(--muted); background: var(--panel-2); }
td { color: var(--text-2); }
tbody tr:last-child > * { border-bottom: 0; }
/* a button: an outline in the line's color, with words in the headline's on the panel */
.action, .visit { border: 1px solid var(--line); color: var(--heading); background: var(--panel); border-radius: 8px; padding: 8px 16px; font-weight: 600; text-decoration: none; }
.action:hover, .visit:hover { border-color: var(--muted); background: var(--panel-2); }
/* Its focus keeps its corners. */
.action:focus-visible, .visit:focus-visible { border-radius: 8px; }
/* the views */
.view { display: grid; gap: 16px; margin-top: 48px; }
.view > * { min-width: 0; }
.view > p { color: var(--muted); max-width: 64ch; }
/* a view's head, as a card: its title row, a picture in a circle (which only repeats the heading's words) and the heading, which stay on one line together; and, at the end of the line, or under them where there's no room, how many it holds, as a big number in --good with its word after it */
.view-head { container-type: inline-size; display: flex; flex-wrap: wrap; align-items: center; gap: 12px 28px; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 22px 20px; }
.view-head > .title { display: flex; align-items: center; gap: 16px; min-width: 0; }
.view-head h2 { min-width: 0; }
.view-head > .title > .icon { flex: none; box-sizing: content-box; width: 1.75rem; height: 1.75rem; padding: 0.75rem; border-radius: 50%; background: var(--act-tint); color: var(--act); }
.view-head > .count { margin-left: auto; display: inline-flex; align-items: baseline; gap: 8px; border: 0; border-radius: 0; background: none; padding: 0; color: var(--muted); font-family: var(--sans); font-size: 1rem; font-weight: 600; }
.view-head > .count b { color: var(--good); font-family: var(--mono); font-weight: 900; font-size: clamp(1.5rem, 17cqi, 2.375rem); line-height: 1; font-variant-numeric: tabular-nums; }
/* how many there are beside a smaller heading: a chip */
.count { display: inline-block; border: 1px solid var(--line); background: var(--panel-2); color: var(--text-2); border-radius: 6px; padding: 1px 8px; font-family: var(--mono); font-size: 0.8125rem; font-weight: 700; line-height: 1.4; font-variant-numeric: tabular-nums; }
.site { display: grid; gap: 14px; margin-top: 8px; }
.site > * { min-width: 0; }
/* a line between one site and the next */
.site + .site { border-top: 1px solid var(--line); padding-top: 28px; margin-top: 14px; }
/* a site's head: its title row, its picture in a circle and its name, big and heavy, which stay on one line together; and the link to the site itself, as a button, at the end of the line, or under them where there's no room */
.site-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; }
.site-head > .title { display: flex; align-items: center; gap: 12px; min-width: 0; }
.site-head h3 { min-width: 0; font-size: clamp(1.375rem, 3.6vw, 1.75rem); font-weight: 900; line-height: 1.15; }
.site-head > .title > .icon { flex: none; box-sizing: content-box; width: 1.25rem; height: 1.25rem; padding: 0.5rem; border-radius: 50%; background: var(--act-tint); color: var(--act); }
.visit { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; }
.visit > .icon { flex: none; width: 1rem; height: 1rem; color: var(--muted); }
/* a site's current report, as a card: its line, under what it is; its verdict and how many pages NVDA read; who prepared it; and the two links a reader came for */
.report { display: grid; gap: 12px; align-content: start; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 22px 20px; }
.report > * { min-width: 0; }
.report > h3, .report > h4 { font-size: 1.25rem; font-weight: 800; }
/* what a report's heading says it is: small, bold, and quieter, in ordinary case, as the rest of its heading is */
.label { display: block; margin-bottom: 2px; color: var(--muted); font-size: 0.875rem; font-weight: 700; }
.report > .by { color: var(--muted); }
/* the verdict, a pill in its color (above), in ordinary case, after a sign that only repeats its words, which a screen reader doesn't read */
.verdict::before { flex: none; }
.verdict.ok::before { content: "✓"; content: "✓" / ""; }
.verdict.warn::before { content: "⚠"; content: "⚠" / ""; }
.verdict.bad::before { content: "⚠"; content: "⚠" / ""; }
/* how many pages NVDA read: a bar in the verdict's color, which only repeats the words beside it, and which wraps above them where there's no room */
.reading { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
.reading > .track { flex: none; width: min(16rem, 100%); height: 10px; background: var(--line); border-radius: 5px; overflow: hidden; }
.reading .c-ok { color: var(--good); }
.reading .c-warn { color: var(--warn); }
.reading .c-bad { color: var(--bad); }
.reading > p { min-width: 0; color: var(--text-2); font-variant-numeric: tabular-nums; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
/* a site's earlier reports, a line each, under their heading, small and quieter, as a report's label is, and how many they are */
.sub-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 4px; }
.sub-head > h4 { min-width: 0; color: var(--muted); font-size: 0.875rem; font-weight: 700; }
.earlier { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; color: var(--text-2); }
.earlier time { color: var(--text); font-weight: 600; }
.sep { color: var(--muted); margin-inline: 0.3em; }
/* the fold of every report's files, for whoever checks a copy, as a card: a report's line, then its files */
details.fold { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; }
details.fold > summary { list-style: none; cursor: pointer; padding: 14px 20px; color: var(--heading); font-weight: 700; }
details.fold > summary::-webkit-details-marker { display: none; }
details.fold > summary::before { content: "▸"; content: "▸" / ""; display: inline-block; margin-right: 10px; color: var(--muted); transition: transform 0.15s; }
details.fold[open] > summary::before { transform: rotate(90deg); }
details.fold > .inside { padding: 0 20px 20px; display: grid; gap: 18px; }
.shared { display: grid; gap: 8px; }
.shared > * { min-width: 0; }
.when { color: var(--muted); }
.when time { color: var(--text); font-weight: 600; }
/* a report's files: cards in the card, on the second panel */
.files { list-style: none; margin: 4px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 8px; }
.files li { background: var(--panel-2); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; display: grid; gap: 2px; align-content: start; min-width: 0; }
.files a { justify-self: start; font-weight: 600; }
.kind { color: var(--muted); font-size: 0.8125rem; }
.meta { display: grid; gap: 2px; color: var(--muted); font-size: 0.8125rem; }
.meta code { color: var(--text); }
.gone { border-left: 3px solid var(--warn); padding-left: 10px; }
.quiet { color: var(--muted); font-style: italic; }
/* every report, by date */
.dates { margin: 0; padding-left: 1.6em; display: grid; gap: 12px; color: var(--text-2); }
.dates li { padding-left: 4px; }
.dates time { color: var(--text); font-weight: 600; }
/* how to check a file */
.note { color: var(--muted); max-width: 72ch; margin-top: 16px; }
.view + .note { margin-top: 48px; }
/* the head of a page that has no card for it, as the audit tool's pages are headed: a kicker over the page's heading, then its lead, 18 pixels apart, with the heading's own margin left out, since the block spaces it. The trust page's goes on with the stamp and its four big numbers, and Technical details' with the version it's from */
.hero { display: grid; gap: 18px; padding-bottom: 44px; }
.hero > * { min-width: 0; }
.hero > h1 { margin: 0; }
.hero > .lead, .part > .lead { margin: 0; }
/* the stamp, in the audit tool's amber box: a 2px line in --warn round it, on --warn-tint, in --warn, as wide as the page's column; at its left, its label, which says where the counts come from, small and bold, in ordinary case, since it holds digits; and at its right, the records' date, big and at weight 900, which goes under the label where there's no room for both */
.stamp { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 24px; padding: 16px 20px; border: 2px solid var(--warn); border-radius: 14px; background: var(--warn-tint); color: var(--warn); font-variant-numeric: tabular-nums; }
.stamp > .source { flex: 1 1 16rem; max-width: 30rem; font-size: 0.875rem; font-weight: 700; line-height: 1.45; }
.stamp > .date { font-size: clamp(1.375rem, 3.2vw, 1.875rem); font-weight: 900; line-height: 1.15; }
/* four big numbers: one a row on a phone, two from 36em, and four from 60em, in columns that shrink to nothing, so none runs past its box */
.tiles { list-style: none; margin: 8px 0 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
@media (min-width: 36em) { .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (min-width: 60em) { .tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
/* a big number's card, a container its number is sized to: the number, its line, and its link, which ends the card, so that the links of a row of cards line up */
.tile { container-type: inline-size; display: grid; grid-template-rows: auto 1fr auto; gap: 10px; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 22px 20px; }
.tile > * { min-width: 0; }
.tile > .n { text-align: center; }
.n > .of { font-size: 0.5em; font-weight: 700; color: var(--muted); }
/* a number that isn't recorded is a dash, quieter than a number */
.n.none { color: var(--muted); }
.tile > .k { color: var(--text-2); font-size: 0.9375rem; }
.tile > a { justify-self: start; margin-top: 4px; font-weight: 700; }
/* a part of a page: 44 pixels above and below it, a line between it and the part before, and its kicker over a heavy heading, then what it says */
.part { display: grid; gap: 16px; padding-block: 44px; border-top: 1px solid var(--line); }
.part > * { min-width: 0; }
.part > .kicker { margin-bottom: -6px; }
/* a part's points, one under another, each a card, with the link to where it's shown after its words */
.points { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.points > li { display: grid; gap: 8px; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 18px 20px; }
.points > li > * { min-width: 0; }
.points > li > p { color: var(--text-2); }
.points > li > a { justify-self: start; font-weight: 700; }
/* cards: three a row where each has 17rem, fewer where they don't, and one a row on a phone; each headed in --good, as the audit tool's are. A heading that links to its source is a link, in --link and underlined, as the spec's colors have every link. */
.cards { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(17rem, 100%), 1fr)); gap: 12px; }
.card > h3 { color: var(--good); font-weight: 900; }
/* a card's words, but its tag, which is a pill in its own color */
.card > p:not(.tag) { color: var(--text-2); }
.card > a { justify-self: start; font-weight: 700; }
/* the trust page's newest five releases, each one's line, as What's New's cards have theirs (below), then its headline, along a line down the side; and after them a line of links, bold */
.releases { list-style: none; margin: 0; padding: 0; display: grid; gap: 16px; }
.releases > li { display: grid; gap: 6px; padding-left: 18px; border-left: 2px solid var(--line); }
.releases > li > * { min-width: 0; }
.more > a { font-weight: 700; }
/* What's New: a card for each release, one under another, the newest first. A card's first line is its version, in a pill, its day, quieter, and, on the version that built the website, that it's the current one; then its headline, its points as a list, and the link to its entry, which ends the card. A release's line on the trust page is the same. */
.updates { list-style: none; margin: 0; padding: 0; display: grid; gap: 16px; }
.update-line, .releases .on { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; font-size: 0.9375rem; font-variant-numeric: tabular-nums; }
.update-line time, .releases .on time { color: var(--muted); }
.update-line .current { color: var(--muted); font-weight: 700; }
.update > h2 { font-size: 1.3125rem; font-weight: 800; line-height: 1.25; }
.update > ul { list-style: disc; margin: 0; padding-left: 1.25rem; color: var(--text-2); }
.update > ul > li + li { margin-top: 6px; }
/* Technical details: the version it's from, quieter, under the lead; "On this page", a card of numbered links, two columns where each has 17rem, with room under it */
.version-line { color: var(--muted); font-variant-numeric: tabular-nums; }
.toc { margin-bottom: 44px; }
.toc ol { margin: 0; padding-left: 1.75em; columns: 17rem 2; column-gap: 40px; }
.toc li { break-inside: avoid; padding-block: 3px; }
/* a card's kicker keeps the kicker's quieter color, where a card's words are --text-2 */
.card > p.kicker { color: var(--muted); }
/* a part a link of "On this page" goes to keeps its kicker in view above its heading; a heading of the third level is set apart from what comes before it; a part's paragraphs and points are in the card's words' color, no wider than 72 characters */
.part > h2[id] { scroll-margin-top: 44px; }
.part > h3 { margin-top: 12px; }
.part > p:not([class]) { color: var(--text-2); max-width: 72ch; }
.list { margin: 0; padding-left: 1.25rem; color: var(--text-2); max-width: 72ch; }
.list > li + li { margin-top: 8px; }
/* how a run works: an ordered list of boxes, each a card with its number before it, which only repeats the list's own; one under another on a phone, with an arrow down after each but the last; two a row from 36em, and three from 60em, with an arrow on after each but the last, and the last as wide as the others. The arrows and the numbers have no words for a screen reader, which hears the list. */
.flow { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; counter-reset: step; }
.flow > li { display: flex; flex-direction: column; min-width: 0; counter-increment: step; }
.flow > li > .box { flex: 1 1 auto; gap: 6px; padding: 16px 18px; }
.flow > li > .box::before { content: counter(step); content: counter(step) / ""; font-family: var(--mono); font-size: 0.9375rem; font-weight: 900; color: var(--act); }
.card.box > p.step-title { color: var(--heading); font-weight: 700; }
.flow > li:not(:last-child)::after { content: "↓"; content: "↓" / ""; align-self: center; padding-top: 6px; color: var(--muted); font-size: 1.25rem; line-height: 1; }
@media (min-width: 36em) {
  .flow { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 0; }
  .flow > li { flex-direction: row; }
  .flow > li:not(:last-child)::after { content: "→"; content: "→" / ""; flex: none; width: 28px; padding-top: 0; text-align: center; }
  .flow > li:last-child { padding-right: 28px; }
}
@media (min-width: 60em) { .flow { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
/* the transcripts home, as a tree: a card of lists in lists, along a line down the side, each name in the fixed-width font and the headline's color, with what it holds under it */
.tree { list-style: none; margin: 0; }
.tree ul { list-style: none; margin: 8px 0 0; padding-left: 18px; border-left: 2px solid var(--line); display: grid; gap: 10px; }
.tree li { min-width: 0; }
.tree li > code { color: var(--heading); font-weight: 700; }
.tree li > p { color: var(--text-2); }
/* a table's first cell names its row: in the words' size, bold, and in the headline's color, not in the header row's small capitals. A command or a name in a table keeps to one line, and a word to itself, and each table has a width its columns can be read at, so on a phone it scrolls in its box. */
tbody th { font-size: inherit; font-weight: 700; line-height: inherit; letter-spacing: normal; font-variant-caps: normal; color: var(--heading); background: none; }
.scroll :where(th, td) :where(a, code) { overflow-wrap: normal; }
.scroll :where(th, td) code { white-space: nowrap; }
table.commands, table.defaults, table.rules { min-width: 32rem; }
table.passes { min-width: 40rem; }
table.toolchain { min-width: 48rem; }
/* related documents: a card of four cards, two a row where each has 19rem, each on the second panel, with its small label, its title, a link, in --link and underlined, as every card's title that's a link is, and a line in the quieter one */
.related-cards { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(19rem, 100%), 1fr)); gap: 12px; }
.related-cards > .card { gap: 4px; padding: 16px 18px; border-radius: 10px; background: var(--panel-2); }
.related-cards > .card > .kicker { font-size: calc(0.75rem * var(--caps-scale)); }
.related-cards > .card > h3 { color: var(--heading); font-size: 1.0625rem; font-weight: 700; }
.related-cards > .card > p:not(.kicker) { color: var(--muted); font-size: 0.9375rem; }
/* the bottom bar, as the audit tool's: a line above it, then one row of six items, small, quieter, and centered, which wraps on a phone, each row centered. A thin line comes before each item but the first, drawn by the style alone, so a screen reader hears a list of six. A link is its icon and its words, which go under the icon where there's no room for both, and the version is plain text. */
footer { border-top: 1px solid var(--line); padding-block: 22px 32px; color: var(--muted); font-size: 0.875rem; }
footer ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; justify-content: center; row-gap: 10px; }
footer li { min-width: 0; padding-inline: 14px; }
footer li + li { border-left: 1px solid var(--line); }
footer a { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 2px 7px; color: var(--muted); }
footer .icon { flex: none; width: 1.125em; height: 1.125em; }
/* the way back to the test results, which opens the website's other pages: an arrow, then its words, in the quieter color, with room under it */
.back { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; width: fit-content; margin-bottom: 28px; color: var(--muted); font-size: 0.9375rem; }
.back > .icon { flex: none; width: 1.125rem; height: 1.125rem; }
/* the front page's "On this page": its name, a kicker, then a row of links to the views, which wraps */
.jump { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 20px; margin-top: 24px; }
.jump > ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 20px; }
/* the front page's kicker, over its heading, as far from it as the website's other pages keep theirs */
main > .kicker { margin-bottom: 18px; }
/* the front page's What's New banner, a card, as the audit tool's: the newest release's version, a pill in --good, at its left, and beside it the kicker, the release's headline, and the day it was released with the link to every update, quieter and smaller. The pill's column is no wider than 40% of the card, so a long version breaks in it, and the words' column shrinks to nothing, so nothing runs out of the window. */
.news { grid-template-columns: fit-content(40%) minmax(0, 1fr); grid-template-areas: "pill kicker" "pill headline" "pill released"; gap: 4px 16px; margin-top: 28px; }
.news > .pill { grid-area: pill; align-self: start; }
.news > .kicker { grid-area: kicker; }
.news > .headline { grid-area: headline; color: var(--text-2); }
.news > .released { grid-area: released; color: var(--muted); font-size: 0.875rem; font-variant-numeric: tabular-nums; }
/* The link to every update stays whole on a line where it fits, and wraps inside it where it doesn't, at a large text size: a box of its own in the line, not text that never breaks. It's the line's last: a box before the dot would let the line break between them, and the dot start the next line. */
.news > .released > a { display: inline-block; }
/* On screen, a page shorter than the window ends at its bottom: the main part grows, keeping its measure, so the footer sits there. */
@media screen {
  body { min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; }
  main { flex: 1 0 auto; }
}
`;
