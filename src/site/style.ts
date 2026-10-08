/**
 * The website's one style block: the shareable page's design, in the same dark theme, with the same
 * light one when the reader switches. It begins with the theme's rules (THEME_CSS, shared with the
 * shareable page), then takes that page's rules for visible keyboard focus, the skip link, text only
 * a screen reader gets, and what a script shows, as they are. The page's fonts go ahead of it, in
 * the same block (see ../share/fonts.ts).
 *
 * It is the page's only styling: the page sets no `style` attribute, since a Content Security
 * Policy that hashes this block allows nothing else. Beyond those rules:
 * - the bar is `position: sticky` from 40em wide, which is 640 pixels at the browser's own text size
 *   of 16. An em in a media query is that size, so for a reader who has made it larger the bar
 *   sticks only from a wider window, where it fits on one line, or, with text more than twice the
 *   default size, has the theme button on a second line, which is still shorter than the room kept
 *   clear for it up to two and a half times the default size, the most the tests try. Narrower, it
 *   scrolls with the page, so it never covers half a phone's screen, or grows taller than the room
 *   kept clear for it. Where it sticks, `scroll-padding-top` keeps whatever has focus, or a link
 *   points to, below it;
 * - the link of the page the reader is on in the bar (`aria-current="page"`, which the trust page's
 *   bar has on its own link) is bold and underlined more heavily than the other links, which the
 *   browser underlines too, so it is told apart by more than its color;
 * - a name or a fingerprint is one word, longer than any box, so the text it can be in breaks it
 *   where it must (`overflow-wrap: anywhere`), rather than run out of its box or the window;
 * - each view's heading, and each site's name, has a picture before it in the accent color, and a
 *   count beside a heading is a chip; a site's link to the site itself ends its heading's line, or
 *   goes under it where there's no room (from 0.13.1);
 * - a site's current report is a panel, headed by its line under what it is, with its two links as
 *   buttons, in the shareable page's colors for its button (`.fp-button`), which wrap onto a line of
 *   their own where there's no room. Its verdict is a pill tinted with the verdict's color, and how
 *   many pages NVDA read is a bar in the same color (the shareable page's `track`), with its words
 *   beside it, or under it on a narrow window;
 * - the fold of files has the shareable page's look for a fold: a marker, which a screen reader
 *   doesn't read (`content: "▸" / ""`), turned when it's open;
 * - the files of a report are a grid whose columns are no wider than their own box
 *   (`minmax(min(300px, 100%), 1fr)`), so nothing runs past a window 320 pixels wide, where WCAG's
 *   reflow rule is measured;
 * - on a screen, a page shorter than the window ends at its bottom, so the footer sits there: the
 *   body is a column at least as tall as the window, and the main part grows, keeping its measure.
 *   In print the page is laid out as it was.
 */
import { THEME_CSS } from "../share/html/style.js";

export const SITE_CSS = `${THEME_CSS}
body { margin: 0; background: var(--bg); color: var(--fg); font: 0.9375rem/1.55 var(--body); }
a { color: var(--accent); } a:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 4px; }
.skip { position: absolute; left: -9999px; } .skip:focus { left: 16px; top: 16px; background: var(--panel); padding: 8px 12px; z-index: 5; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
/* Only the hidden attribute shows or hides what the script does: the theme button. */
[hidden] { display: none !important; }
h1, h2, h3, h4 { font-family: var(--display); text-wrap: balance; letter-spacing: 0.005em; }
h1 { font-size: clamp(2.2rem, 6vw, 3.4rem); line-height: 1.04; font-weight: 700; margin: 0 0 14px; }
h2 { font-size: 1.6rem; font-weight: 600; margin: 0; }
h3 { font-size: 1.12rem; font-weight: 600; margin: 0; }
h4 { font-size: 1rem; font-weight: 600; margin: 0; }
p { margin: 0; }
code { font-family: var(--mono); font-size: 0.86em; overflow-wrap: anywhere; }
/* A name is a whole address, a host or a file's name, and a fingerprint is one long word: break them where they must, rather than run out of the box or the window. */
main :where(h1, h2, h3, h4, p, li, a, span, code), footer :where(p, a) { overflow-wrap: anywhere; }
/* the bar: the views, the trust page, and the theme button */
.bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 20px; padding-block: 0.5rem; background: var(--panel); border-bottom: 1px solid var(--line); }
.bar nav { display: flex; flex-wrap: wrap; gap: 0 22px; }
.bar nav a { display: inline-block; padding: 0.25rem 0.125rem; font-weight: 500; }
/* the page the reader is on: bold, and underlined more heavily than the other links, which the browser underlines too, so it is told apart by more than its color */
.bar nav a[aria-current="page"] { font-weight: 700; text-decoration: underline; text-decoration-thickness: 2px; }
.theme { border: 1px solid var(--line); background: var(--panel-2); color: var(--fg); border-radius: 999px; padding: 6px 14px; font: 500 0.82rem var(--body); cursor: pointer; }
/* In view while the page scrolls, from 40em wide: 640 pixels at the default text size, and wider as the reader's text gets larger, so it is one line where it sticks (two, with text more than twice the default size, and still shorter than the room kept clear for it up to two and a half times). What has focus, or what a link points to, is kept below it. */
@media (min-width: 40em) {
  .bar { position: sticky; top: 0; z-index: 3; }
  html { scroll-padding-top: 5rem; }
}
/* the page */
main { box-sizing: border-box; max-width: 1120px; margin-inline: auto; padding: 36px 16px 56px; }
/* The bar and the footer reach across the window, and their words start where the main part's do. */
.bar, footer { padding-inline: max(16px, calc(50% - 544px)); }
.lead { font-size: 1.08rem; color: var(--muted); max-width: 68ch; margin-bottom: 52px; }
.view { display: grid; gap: 14px; margin-bottom: 56px; }
.view > * { min-width: 0; }
.view > p { color: var(--muted); max-width: 68ch; }
/* a view's head, as a banner tinted in the accent color: its title row, a big picture in a circle (which only repeats the heading's words) and the heading, which stay on one line together; and, at the end of the line, or under them where there's no room, how many it holds, as a big number with its word after it */
.view-head { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 28px; padding: 20px 24px; border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line)); border-left: 6px solid var(--accent); border-radius: 18px; background: color-mix(in srgb, var(--accent) 9%, var(--panel)); }
.view-head > .title { display: flex; align-items: center; gap: 16px; min-width: 0; }
.view-head h2 { min-width: 0; font-size: clamp(1.9rem, 5vw, 2.75rem); font-weight: 700; line-height: 1.05; }
.view-head > .title > .icon { flex: none; box-sizing: content-box; width: 2rem; height: 2rem; padding: 0.8rem; border-radius: 50%; background: color-mix(in srgb, var(--accent) 22%, var(--panel)); color: var(--accent); }
.view-head > .count { margin-left: auto; display: inline-flex; align-items: baseline; gap: 8px; border: 0; border-radius: 0; background: none; padding: 0; color: var(--muted); font: 600 1.05rem var(--body); }
.view-head > .count b { color: var(--fg); font: 700 clamp(2.2rem, 6vw, 3rem)/1 var(--display); font-variant-numeric: tabular-nums; }
/* how many there are beside a smaller heading: a chip */
.count { display: inline-block; border: 1px solid var(--line); background: var(--panel-2); color: var(--fg); border-radius: 999px; padding: 2px 10px; font: 600 0.82rem/1.4 var(--body); font-variant-numeric: tabular-nums; }
.site { display: grid; gap: 12px; margin-top: 22px; }
.site > * { min-width: 0; }
/* a line between one site and the next */
.site + .site { border-top: 1px solid var(--line); padding-top: 26px; }
/* a site's head: its title row, its picture in a circle and its name, big, which stay on one line together; and the link to the site itself, as a button, at the end of the line, or under them where there's no room */
.site-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; }
.site-head > .title { display: flex; align-items: center; gap: 12px; min-width: 0; }
.site-head h3 { min-width: 0; font-size: clamp(1.45rem, 4vw, 1.9rem); font-weight: 700; line-height: 1.1; }
.site-head > .title > .icon { flex: none; box-sizing: content-box; width: 1.4rem; height: 1.4rem; padding: 0.55rem; border-radius: 50%; background: color-mix(in srgb, var(--accent) 18%, var(--panel)); color: var(--accent); }
.visit { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; border: 1px solid color-mix(in srgb, var(--accent) 60%, var(--line)); background: color-mix(in srgb, var(--accent) 16%, var(--panel)); color: var(--fg); border-radius: 999px; padding: 8px 18px; font-weight: 600; text-decoration: none; }
.visit:hover { background: color-mix(in srgb, var(--accent) 28%, var(--panel)); }
.visit > .icon { flex: none; width: 1.05rem; height: 1.05rem; color: var(--accent); }
/* a site's current report: its line, under what it is; who prepared it; and the two links a reader came for */
.report { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px 18px; display: grid; gap: 10px; align-content: start; }
.report > * { min-width: 0; }
.report > h3, .report > h4 { font-size: 1.3rem; }
.label { display: block; color: var(--muted); font: 600 0.8rem var(--body); letter-spacing: 0.04em; margin-bottom: 2px; }
.report > .by { color: var(--muted); }
/* what its copies say of the site: the verdict's headline as a pill, in words, after a sign that only repeats them, in the theme's green, amber, or red, which a screen reader doesn't read */
.verdict { display: flex; justify-self: start; gap: 8px; align-items: baseline; font-weight: 600; font-size: 1.02rem; padding: 4px 14px; border: 1px solid var(--line); border-radius: 14px; background: var(--panel-2); }
.verdict::before { flex: none; font-size: 1.1em; }
.verdict.ok { border-color: color-mix(in srgb, var(--ok) 50%, var(--line)); background: color-mix(in srgb, var(--ok) 12%, var(--panel)); }
.verdict.warn { border-color: color-mix(in srgb, var(--warn) 50%, var(--line)); background: color-mix(in srgb, var(--warn) 12%, var(--panel)); }
.verdict.bad { border-color: color-mix(in srgb, var(--bad) 50%, var(--line)); background: color-mix(in srgb, var(--bad) 12%, var(--panel)); }
.verdict.ok::before { content: "✓"; content: "✓" / ""; color: var(--ok); }
.verdict.warn::before { content: "⚠"; content: "⚠" / ""; color: var(--warn); }
.verdict.bad::before { content: "⚠"; content: "⚠" / ""; color: var(--bad); }
/* how many pages NVDA read: a bar in the verdict's color, which only repeats the words beside it, and which wraps above them where there's no room */
.reading { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
.reading > .track { flex: none; width: min(16rem, 100%); height: 10px; background: var(--line); border-radius: 5px; overflow: hidden; }
.reading .c-ok { color: var(--ok); } .reading .c-warn { color: var(--warn); } .reading .c-bad { color: var(--bad); }
.reading > p { min-width: 0; font-variant-numeric: tabular-nums; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
.action { border: 1px solid color-mix(in srgb, var(--accent) 60%, var(--line)); background: color-mix(in srgb, var(--accent) 16%, var(--panel)); color: var(--fg); border-radius: 10px; padding: 9px 16px; font-weight: 600; text-decoration: none; }
.action:hover { background: color-mix(in srgb, var(--accent) 28%, var(--panel)); }
/* a site's earlier reports, a line each, under their heading and how many they are */
.sub-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 6px; }
.sub-head > h4 { min-width: 0; font-size: 0.95rem; color: var(--muted); }
.earlier { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.earlier time { font-weight: 600; }
.sep { color: var(--muted); margin-inline: 0.3em; }
/* the fold of every report's files, for whoever checks a copy: a report's line, then its files */
details.fold { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; }
details.fold > summary { list-style: none; cursor: pointer; padding: 10px 16px; font-weight: 600; }
details.fold > summary::-webkit-details-marker { display: none; }
details.fold > summary::before { content: "▸"; content: "▸" / ""; display: inline-block; margin-right: 8px; color: var(--muted); transition: transform 0.15s; }
details.fold[open] > summary::before { transform: rotate(90deg); }
details.fold > .inside { padding: 0 16px 16px; display: grid; gap: 18px; }
.shared { display: grid; gap: 8px; }
.shared > * { min-width: 0; }
.when { color: var(--muted); }
.when time { color: var(--fg); font-weight: 600; }
.files { list-style: none; margin: 4px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 8px; }
.files li { background: var(--panel-2); border-radius: 10px; padding: 10px 12px; display: grid; gap: 2px; align-content: start; min-width: 0; }
.files a { justify-self: start; font-weight: 500; }
.kind { color: var(--muted); font-size: 0.82rem; }
.meta { display: grid; gap: 2px; color: var(--muted); font-size: 0.84rem; }
.meta code { color: var(--fg); }
.gone { border-left: 3px solid var(--warn); padding-left: 10px; }
.quiet { color: var(--muted); font-style: italic; }
/* every report, by date */
.dates { margin: 0; padding-left: 1.6em; display: grid; gap: 12px; }
.dates li { padding-left: 4px; }
.dates time { font-weight: 600; }
/* how to check a file */
.note { color: var(--muted); max-width: 72ch; margin-bottom: 12px; }
footer { color: var(--muted); font-size: 0.84rem; border-top: 1px solid var(--line); padding-block: 18px 40px; display: grid; gap: 6px; }
/* A line of the footer is no longer to read than a note's: 80 characters of its smaller text are as wide as the notes' 72. */
footer > * { min-width: 0; max-width: 80ch; }
/* On screen, a page shorter than the window ends at its bottom: the main part grows, keeping its measure, so the footer sits there. */
@media screen {
  body { min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; }
  main { flex: 1 0 auto; width: 100%; }
}
`;
