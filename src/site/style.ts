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
 *   sticks only from a wider window, where it still fits on one line. Narrower, it scrolls with the
 *   page, so it never covers half a phone's screen, or grows taller than the room kept clear for
 *   it. Where it sticks, `scroll-padding-top` keeps whatever has focus, or a link points to, below
 *   it;
 * - a name or a fingerprint is one word, longer than any box, so the text it can be in breaks it
 *   where it must (`overflow-wrap: anywhere`), rather than run out of its box or the window;
 * - the files of a report are a grid whose columns are no wider than their own box
 *   (`minmax(min(300px, 100%), 1fr)`), so nothing runs past a window 320 pixels wide, where WCAG's
 *   reflow rule is measured.
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
/* the bar: the three views, and the theme button */
.bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 20px; padding-block: 0.5rem; background: var(--panel); border-bottom: 1px solid var(--line); }
.bar nav { display: flex; flex-wrap: wrap; gap: 0 22px; }
.bar nav a { display: inline-block; padding: 0.25rem 0.125rem; font-weight: 500; }
.theme { border: 1px solid var(--line); background: var(--panel-2); color: var(--fg); border-radius: 999px; padding: 6px 14px; font: 500 0.82rem var(--body); cursor: pointer; }
/* In view while the page scrolls, from 40em wide: 640 pixels at the default text size, and wider as the reader's text gets larger, so it is one line where it sticks. What has focus, or what a link points to, is kept below it. */
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
.site { display: grid; gap: 10px; margin-top: 14px; }
.site > * { min-width: 0; }
.site > h3 { font-size: 1.35rem; }
.count { color: var(--muted); font-size: 0.86rem; }
/* a report: when it was shared, who prepared it, and its files */
.report { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px 18px; display: grid; gap: 10px; align-content: start; }
.report > * { min-width: 0; }
.report > h3, .report > h4 { font-size: 1.05rem; }
.report > h3 + p, .report > h4 + p { color: var(--muted); }
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
footer > * { min-width: 0; }
`;
