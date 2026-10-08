/**
 * The shareable page as one file: everything it shows, and everything it needs to show it, inside
 * it. So it can be emailed and opened anywhere, offline, and a Content Security Policy can allow
 * exactly what it holds (one style block and one script, by their hashes, and nothing else).
 *
 * In order: the head, with the page's one style block (the fonts, then SHARE_CSS); a skip link to
 * the main content; the header; `main`, with the sections in the design's order; the footer; and
 * last, the page's one script, its own (SHARE_SCRIPT) and then the fingerprint check's
 * (CHECK_SCRIPT). The check's data is a block of JSON in the evidence section, which never runs.
 */
import { esc } from "../../report/html.js";
import { CHECK_SCRIPT } from "../check.js";
import type { ShareModel } from "../model.js";
import { documentTitle } from "../words.js";
import { renderAttention } from "./attention.js";
import { SHARE_SCRIPT } from "./client.js";
import { renderDetails } from "./details.js";
import { renderFooter } from "./evidence.js";
import { renderPages } from "./pages.js";
import { SHARE_CSS } from "./style.js";
import { renderGlance, renderTop } from "./top.js";

/**
 * The sections inside `main`, in the design's order: At a glance, what needs attention (nothing,
 * with no card to name), every page (each card with what NVDA said first and the page's full
 * transcript, folded), and the details, which hold the rest (what changed, the problems, what the
 * results cover, the evidence, how voicecap works, and how it came to be). There is no appendix of
 * transcripts: each page's is in its card.
 */
const SECTIONS = [renderGlance, renderAttention, renderPages, renderDetails];

/**
 * The page, from the model. `fontCss` is the fonts' `@font-face` rules (fontFaceCss in
 * ../fonts.ts), which the page's style block holds ahead of its own styles. Pure.
 */
export function renderSharePage(model: ShareModel, assets: { fontCss: string }): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(documentTitle(model.header))}</title>`,
    `<style>\n${assets.fontCss}\n${SHARE_CSS}</style>`,
    "</head>",
    "<body>",
    '<a class="skip" href="#main">Skip to main content</a>',
    '<div class="wrap">',
    renderTop(model),
    '<main id="main">',
    ...SECTIONS.map((section) => section(model)).filter((html) => html !== ""),
    "</main>",
    renderFooter(model),
    "</div>",
    `<script>${SHARE_SCRIPT}${CHECK_SCRIPT}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
