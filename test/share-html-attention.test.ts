/**
 * "What needs attention" on the shareable page: a card for each problem, each folded behind its
 * title when there are more than 5, with what NVDA said and where, the likely cause, why it
 * matters, the fix in the code, what NVDA should say then, the path forward, and the pages, which
 * fold behind a line that counts them when there are more than 3. i2i's logo (v3--i2i.netlify.app)
 * is the real case, made as the model is made from its run; the demo's runs and pages built here
 * cover the rest. The tests are on the markup: its ids, its folds, and its order are the contract.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { esc, idFragment } from "../src/report/html.js";
import { attentionCards, type AttentionCard } from "../src/share/attention.js";
import { attentionWords } from "../src/share/attention-words.js";
import { renderAttention } from "../src/share/html/attention.js";
import { renderSharePage } from "../src/share/html/document.js";
import { renderSummary } from "../src/share/html/top.js";
import { buildShareModel, type ShareModel } from "../src/share/model.js";
import { ATTENTION_TEXT } from "../src/share/text.js";
import { noAttentionLine } from "../src/share/words.js";
import {
  HOME_READ_HEADER,
  HOME_READ_MAIN,
  HOME_TAB,
  i2iModel,
  linkModel,
  pageFrom,
  passesOf,
  reviewed,
  withCards,
} from "./helpers/share-attention.js";
import { shareRun } from "./helpers/share-data.js";
import { attributes, summariesIn, textOf } from "./helpers/share-html.js";
import { DEMO_ROOT, demoModel, inputOf } from "./helpers/share-model.js";

/** The generic phrases the default rules list, each of which makes a card of its own. */
const PHRASES = ["click here", "read more", "learn more", "here", "more", "more info", "details"];

/**
 * The fold with an id, as its markup from its `<details` to its own `</details>`, the folds inside
 * it among it.
 */
function foldOf(html: string, id: string): string {
  const start = html.indexOf(`<details class="fold" id="${id}"`);
  if (start === -1) throw new Error(`The markup has no fold ${id}.`);
  let depth = 0;
  for (const tag of html.slice(start).matchAll(/<details\b|<\/details>/g)) {
    depth += tag[0] === "</details>" ? -1 : 1;
    if (depth === 0) return html.slice(start, start + tag.index + tag[0].length);
  }
  throw new Error(`The fold ${id} is never closed.`);
}

/** The ids of the cards' folds, in page order. */
const cardIds = (html: string): string[] =>
  [...html.matchAll(/<details class="fold" id="(need-\d+)"/g)].map(([, id]) => id ?? "");

/** The ids of the cards' folds that start open. */
const openCards = (html: string): string[] =>
  [...html.matchAll(/<details class="fold" id="(need-\d+)" open>/g)].map(([, id]) => id ?? "");

/** The page's markup, with what its style and script elements hold left out. */
function markupOf(html: string): string {
  return html
    .replace(/(<style>)[\s\S]*?(<\/style>)/g, "$1$2")
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/g, "$1$2");
}

/** Words as a reader gets them: on one line, with each run of spaces one. */
const oneLine = (words: string): string => words.replace(/\s+/g, " ").trim();

/** Every string a card says, as `attentionWords` gives it. */
function wordsOf(card: AttentionCard): string[] {
  const words = attentionWords(card);
  return [
    words.title,
    words.count,
    ...words.places.flatMap((place) => [
      place.lead,
      ...place.quotes.flatMap(({ pass, line }) => [pass, line]),
      ...(place.unavailable === null ? [] : [place.unavailable]),
    ]),
    words.cause,
    words.why,
    ...words.fixes.flatMap((fix) => [
      fix.lead,
      fix.code,
      ...(fix.after === null ? [] : [fix.after]),
    ]),
    ...words.path,
    ...card.pages.flatMap((page) => [page.name, ...(page.detail ? [page.detail] : [])]),
  ];
}

describe("renderAttention", () => {
  let i2i: ShareModel;

  beforeAll(() => {
    i2i = i2iModel();
  });

  it("is a section named by its heading, with the line under it, both before any fold", () => {
    const html = renderAttention(i2i);

    expect(html).toMatch(
      /^<section aria-labelledby="need-h">\s*<h2 id="need-h">What needs attention<\/h2>/,
    );
    expect(html).toMatch(/<\/section>$/);
    expect(html).toContain(`<p class="gist">${esc(ATTENTION_TEXT.gist(1, 32))}</p>`);
    expect(html).toContain('<p class="gist">1 problem, on 32 pages. ');
    // The heading is the section's only one, and it's outside every fold.
    expect(html.match(/<h2[ >]/g)).toHaveLength(1);
    expect(html.indexOf("<h2")).toBeLessThan(html.indexOf("<details"));
  });

  it("makes i2i's logo one card, open, with its number, its title, and its count on its line", () => {
    const html = renderAttention(i2i);
    const card = foldOf(html, "need-1");

    expect(i2i.attention.map(({ id }) => id)).toEqual(["need-1"]);
    expect(cardIds(html)).toEqual(["need-1"]);
    expect(openCards(html)).toEqual(["need-1"]);
    expect(card).toContain(
      '<summary><span class="what">1. The graphic &quot;i 2i Logo&quot; is read as &quot;Unlabeled graphic&quot;: its alt text is too generic for Chrome</span> <span class="sub">32 pages, 65 times</span></summary>',
    );
    // The card's line, and its pages' line inside it, each read as one line of words.
    expect(summariesIn(html)).toEqual([
      '1. The graphic "i 2i Logo" is read as "Unlabeled graphic": its alt text is too generic for Chrome 32 pages, 65 times',
      "The 32 pages",
    ]);
  });

  it("says what NVDA said and where, the cause, the reason, the fix, the path, and the pages, in that order", () => {
    const [logo] = i2i.attention;
    if (logo === undefined) throw new Error("i2i has no card.");
    const words = attentionWords(logo);
    const card = foldOf(renderAttention(i2i), "need-1");
    const [first, second] = words.fixes;

    const parts = [
      // Where NVDA said it, and what it said there, in each pass.
      '<div class="place"><p>In the header, on 32 pages</p>',
      `<p><span class="pass">Down Arrow:</span> <code>“${esc(HOME_READ_HEADER)}”</code></p>`,
      `<p><span class="pass">Tab:</span> <code>“${esc(HOME_TAB)}”</code></p>`,
      '<div class="place"><p>In the main content, on 1 page</p>',
      `<p><span class="pass">Down Arrow:</span> <code>“${esc(HOME_READ_MAIN)}”</code></p>`,
      `<p><b>Likely cause:</b> ${esc(words.cause)}</p>`,
      `<p><b>Why it matters:</b> ${esc(words.why)}</p>`,
      "<p><b>The fix in the code:</b></p>",
      `<div class="fix"><p>${esc(first?.lead ?? "")}</p>`,
      "<pre><code>&lt;img src=&quot;…&quot; alt=&quot;&quot;&gt;</code></pre>",
      "<p><b>What NVDA should say then:</b> &quot;INSTITUTE 2 INNOVATE, link&quot;</p>",
      `<div class="fix"><p>${esc(second?.lead ?? "")}</p>`,
      "<pre><code>&lt;img src=&quot;…&quot; alt=&quot;Institute 2 Innovate&quot;&gt;</code></pre>",
      "<p><b>What NVDA should say then:</b> &quot;graphic, Institute 2 Innovate&quot;</p>",
      "<p><b>The path forward:</b></p><ol><li>",
      '<summary><span class="what">The 32 pages</span></summary>',
    ];
    const at = parts.map((part) => card.indexOf(part));

    expect(parts.filter((_, index) => (at[index] ?? -1) < 0)).toEqual([]);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    // Each part, as many times as the card has it.
    expect(card.match(/<div class="place">/g)).toHaveLength(2);
    expect(card.match(/<div class="fix">/g)).toHaveLength(2);
    expect(card.match(/<pre>/g)).toHaveLength(2);
    expect(card.match(/<b>Likely cause:<\/b>/g)).toHaveLength(1);
  });

  it("gives the path forward as an ordered list, a line for each step", () => {
    const [logo] = i2i.attention;
    if (logo === undefined) throw new Error("i2i has no card.");
    const { path } = attentionWords(logo);
    const card = foldOf(renderAttention(i2i), "need-1");
    const list = /<p><b>The path forward:<\/b><\/p><ol>(.*?)<\/ol>/s.exec(card)?.[1] ?? "";

    expect(path).toHaveLength(4);
    expect([...list.matchAll(/<li>(.*?)<\/li>/gs)].map(([, step]) => step)).toEqual(
      path.map((step) => esc(step)),
    );
    expect(textOf(list)).toContain(
      "Fix it in the header, which every page shares: one change fixes it on all 32 pages.",
    );
    expect(textOf(list)).toContain(
      "Run voicecap again on one page (--page /), then on every page.",
    );
  });

  it("folds i2i's 32 pages behind a line that counts them, each a link to its card under Every page", () => {
    const card = foldOf(renderAttention(i2i), "need-1");
    const [, pages = ""] = card.split('<summary><span class="what">The 32 pages</span></summary>');
    const links = [...pages.matchAll(/<li><a href="(#pg-[^"]+)">(.*?)<\/a><\/li>/g)];

    // A closed fold of its own, inside the card's.
    expect(card).toContain('<details class="fold"><summary><span class="what">The 32 pages</span>');
    expect(card.match(/<details/g)).toHaveLength(2);
    // Each page in page order, linked to its card, by the name the card has for it.
    expect(links.map(([, href]) => href)).toEqual(
      i2i.pages.map(({ slug }) => `#pg-${idFragment(slug)}`),
    );
    expect(links.map(([, , name]) => name)).toEqual([
      "Home",
      ...Array.from({ length: 31 }, (_, at) => `Biography ${at + 1}`),
    ]);
    expect(pages.match(/<li>/g)).toHaveLength(32);
    // The fold's line is the pages' label: there is no second one above it.
    expect(card).not.toContain("<b>The pages:</b>");
  });

  it("counts the pages as a reader writes a number: 1,204 pages, with its comma", () => {
    const [logo] = i2i.attention;
    if (logo === undefined) throw new Error("i2i has no card.");
    const pages = Array.from({ length: 1204 }, (_, at) => ({
      slug: `p${at}`,
      name: `Page ${at}`,
      path: `/p${at}/`,
      detail: null,
    }));
    const html = renderAttention(withCards(i2i, [{ ...logo, pages }]));

    expect(html).toContain('<summary><span class="what">The 1,204 pages</span></summary>');
    expect(html).toContain("1,204 pages, 65 times");
  });

  it("shows a card's pages in the open when it is on 3, and folds them when it is on 4", () => {
    // "click here" is said on pages A to D, and "read more" on pages A to C.
    const html = renderAttention(linkModel(["click here", "read more"]));
    const four = foldOf(html, "need-1");
    const three = foldOf(html, "need-2");

    expect(textOf(four)).toContain("Page A Page B Page C Page D");
    expect(four.match(/<details/g)).toHaveLength(2);
    expect(four).toContain('<summary><span class="what">The 4 pages</span></summary>');
    expect(four).not.toContain("<b>The pages:</b>");

    expect(three.match(/<details/g)).toHaveLength(1);
    expect(three).not.toContain("The 3 pages");
    expect(three).toContain('<div class="part"><p><b>The pages:</b></p><ul>');
    expect(three.match(/<li><a href="#pg-/g)).toHaveLength(3);
    expect(textOf(/<b>The pages:<\/b>.*$/s.exec(three)?.[0] ?? "")).toBe(
      "The pages: Page A Page B Page C",
    );
  });

  it("says why a page wasn't read, and an issue's note, after the page's name, and says nothing after a name with none", () => {
    const pages = [
      pageFrom("a", null, {
        card: {
          status: "failed",
          failure: "During the headings pass, another window took the screen.",
        },
      }),
      pageFrom("b", passesOf({ read: ["Welcome"] }), {
        review: reviewed("issue", { note: "The search box has no name." }),
      }),
      pageFrom("c", passesOf({ read: ["Welcome"] }), { review: reviewed("issue") }),
      // A note of nothing but spaces says nothing either.
      pageFrom("d", passesOf({ read: ["Welcome"] }), { review: reviewed("issue", { note: "  " }) }),
    ];
    const model = withCards(i2i, attentionCards(pages, DEFAULT_CONFIG.flags));
    const html = renderAttention(model);

    expect(model.attention.map(({ kind }) => kind)).toEqual(["unread", "issue", "issue", "issue"]);
    expect(foldOf(html, "need-1")).toContain(
      '<li><a href="#pg-a">Page a</a>: During the headings pass, another window took the screen.</li>',
    );
    expect(foldOf(html, "need-2")).toContain(
      '<li><a href="#pg-b">Page b</a>: The search box has no name.</li>',
    );
    expect(foldOf(html, "need-3")).toContain('<li><a href="#pg-c">Page c</a></li>');
    expect(foldOf(html, "need-4")).toContain('<li><a href="#pg-d">Page d</a></li>');
    // Neither kind has a place on a page, so neither has a line of NVDA's to quote.
    expect(html).not.toContain('<div class="place">');
    expect(html).not.toContain("<code>“");
  });

  it("opens each card when there are 5 or fewer, and folds each when there are more", () => {
    const five = renderAttention(linkModel(PHRASES.slice(0, 5)));
    const six = renderAttention(linkModel(PHRASES.slice(0, 6)));

    expect(cardIds(five)).toEqual(["need-1", "need-2", "need-3", "need-4", "need-5"]);
    expect(openCards(five)).toEqual(cardIds(five));
    expect(cardIds(six)).toEqual(["need-1", "need-2", "need-3", "need-4", "need-5", "need-6"]);
    expect(openCards(six)).toEqual([]);
    expect(six).not.toContain(" open>");
    // The six are folded behind their titles, numbered, most pages first.
    const rest = "link text that doesn't say where it goes";
    expect(summariesIn(six).filter((line) => /^\d\. /.test(line))).toEqual([
      `1. Links read as "click here": ${rest} 4 pages, 4 times`,
      `2. Links read as "read more": ${rest} 3 pages, 3 times`,
      `3. Links read as "learn more": ${rest} 1 page, 1 time`,
      `4. Links read as "here": ${rest} 1 page, 1 time`,
      `5. Links read as "more": ${rest} 1 page, 1 time`,
      `6. Links read as "more info": ${rest} 1 page, 1 time`,
    ]);
  });

  it("folds every card of a site with 40 problems, and the summary's panel names 5 of them and counts 35", () => {
    const [logo] = i2i.attention;
    if (logo === undefined) throw new Error("i2i has no card.");
    const cards = Array.from({ length: 40 }, (_, at) => ({
      ...logo,
      id: `need-${at + 1}`,
      subject: `Logo ${at + 1}`,
    }));
    const model = withCards(i2i, cards);
    const html = renderAttention(model);
    const summary = renderSummary(model);

    expect(cardIds(html)).toEqual(cards.map(({ id }) => id));
    expect(openCards(html)).toEqual([]);
    expect(html).toContain(`<p class="gist">${esc(ATTENTION_TEXT.gist(40, 32))}</p>`);
    // The panel links its first 5 cards, each to the fold of its own, and the rest to the section.
    expect([...summary.matchAll(/<li><a href="#(need-\d+)">/g)].map(([, id]) => id)).toEqual(
      cards.slice(0, 5).map(({ id }) => id),
    );
    expect(summary).toContain(
      '<li><a href="#need-h">and 35 more, under What needs attention</a></li>',
    );
  });

  it("never makes a heading of a card, or puts one in a fold's line", async () => {
    for (const model of [i2i, linkModel(PHRASES), await demoModel()]) {
      const html = renderAttention(model);

      // Only the section's own heading: the cards have their titles on their folds' lines.
      expect(html.match(/<h[1-6]\b/g)).toEqual(["<h2"]);
      for (const [, line = ""] of html.matchAll(/<summary>(.*?)<\/summary>/gs)) {
        expect(line).not.toMatch(/<h[1-6]\b|role="?heading/);
      }
    }
  });

  it("has no fix for a card that has none, and no line of NVDA's for one whose words aren't here", () => {
    const pages = [
      // A read that stopped has no fix in the code, and quotes the last line it read.
      pageFrom("a", passesOf({ read: ["Welcome", "Footer"] }, "step-cap"), {
        card: { readStopped: "step-cap" },
      }),
      // A flag on a page whose transcripts couldn't be read here: a card of what the run recorded.
      pageFrom("b", null, {
        flags: [
          {
            rule: "unlabeled",
            pass: "read",
            count: 1,
            found: [{ text: "button", count: 1 }],
            message: "Unlabeled or poorly labeled items in the read pass: “button” ×1.",
          },
        ],
      }),
    ];
    const model = withCards(i2i, attentionCards(pages, DEFAULT_CONFIG.flags));
    const html = renderAttention(model);
    const stopped = foldOf(html, "need-1");
    const recorded = foldOf(html, "need-2");

    expect(model.attention.map(({ kind }) => kind)).toEqual(["read-stopped", "recorded"]);
    expect(stopped).not.toContain("The fix in the code");
    expect(stopped).not.toContain("<pre>");
    expect(stopped).toContain("<code>“Footer”</code>");
    expect(stopped).not.toContain("not-recorded");
    expect(recorded).not.toContain("The fix in the code");
    expect(recorded).not.toContain("<code>");
    // The place says why it has none, in words of its own, never as a quote with nothing in it.
    expect(recorded).toContain(
      '<p class="not-recorded">NVDA&#39;s words aren&#39;t available here: this page&#39;s transcripts couldn&#39;t be read.</p>',
    );
    expect(html).not.toContain("“”");
  });

  it("leaves out what NVDA should say then for a fix that has no words for it, and keeps the code's lines", () => {
    const pages = [
      // A control with no name: its fix has no words for NVDA to say.
      pageFrom("a", passesOf({ tab: ["Unlabeled image"] })),
      // A page with no headings: its fix is two lines of code.
      pageFrom("b", passesOf({ headings: [] })),
    ];
    const model = withCards(i2i, attentionCards(pages, DEFAULT_CONFIG.flags));
    const html = renderAttention(model);
    const unnamed = foldOf(html, "need-1");
    const noHeadings = foldOf(html, "need-2");

    expect(model.attention.map(({ kind, level }) => [kind, level])).toEqual([
      ["unnamed", null],
      ["first-heading", 0],
    ]);
    expect(unnamed).toContain(
      "<pre><code>&lt;div role=&quot;…&quot; aria-label=&quot;What it is&quot;&gt;…&lt;/div&gt;</code></pre>",
    );
    expect(unnamed).not.toContain("What NVDA should say then");
    // The code's own line break is kept, inside the one block.
    expect(noHeadings).toContain(
      "<pre><code>&lt;h1&gt;Grant opportunities&lt;/h1&gt;\n&lt;h2&gt;How to apply&lt;/h2&gt;</code></pre>",
    );
    expect(noHeadings).toContain(
      "<p><b>What NVDA should say then:</b> &quot;heading, level 1, Grant opportunities&quot;</p>",
    );
  });

  it("escapes what NVDA said, a reviewer's note, and each page's name, so none is markup", () => {
    const said = 'link, <b> & "x"';
    const pages = [
      // A read that stopped quotes the last line it read: NVDA's words, with markup in them.
      pageFrom("a", passesOf({ read: ["Welcome", said] }, "step-cap"), {
        card: { readStopped: "step-cap", name: 'A <i>page</i> & "co"' },
      }),
      pageFrom("b", passesOf({ read: ["Welcome"] }), {
        review: reviewed("issue", { note: "<script>alert(1)</script>" }),
        card: { name: "<img src=x>" },
      }),
    ];
    const model = withCards(i2i, attentionCards(pages, DEFAULT_CONFIG.flags));
    const html = renderAttention(model);
    const issue = foldOf(html, "need-2");

    expect(model.attention.map(({ kind }) => kind)).toEqual(["read-stopped", "issue"]);
    expect(html).toContain("<code>“link, &lt;b&gt; &amp; &quot;x&quot;”</code>");
    // The note is the card's cause, and the page's reason.
    expect(issue).toContain("<p><b>Likely cause:</b> &lt;script&gt;alert(1)&lt;/script&gt;</p>");
    expect(issue).toContain(
      '<li><a href="#pg-b">&lt;img src=x&gt;</a>: &lt;script&gt;alert(1)&lt;/script&gt;</li>',
    );
    expect(issue).toContain("An issue found in review: &lt;img src=x&gt;");
    expect(html).toContain('<a href="#pg-a">A &lt;i&gt;page&lt;/i&gt; &amp; &quot;co&quot;</a>');
    // None of it came out as a tag.
    for (const tag of ["<script", "<img", "<i>", "</i>", "<b> &"]) expect(html).not.toContain(tag);
  });

  it("escapes the <h1> a card's title and its fix say, which are words", () => {
    const pages = [pageFrom("a", passesOf({ headings: ["heading, level 2, Grants"] }))];
    const html = renderAttention(withCards(i2i, attentionCards(pages, DEFAULT_CONFIG.flags)));

    expect(html).toContain("likely a missing &lt;h1&gt;</span>");
    expect(html).toContain("Make the page&#39;s main title its &lt;h1&gt;:");
    expect(html).not.toContain("<h1");
  });

  it("says every word a card has, as the one source of the card's words gives them", async () => {
    for (const model of [i2i, linkModel(PHRASES), await demoModel()]) {
      const html = renderAttention(model);

      expect(model.attention.length).toBeGreaterThan(0);
      for (const card of model.attention) {
        const said = oneLine(textOf(foldOf(html, card.id)));
        for (const words of wordsOf(card))
          expect(said, `${card.id}: ${words}`).toContain(oneLine(words));
      }
    }
  });

  it("says the line for no problem when no card is left, as the summary's panel does", () => {
    const clean = withCards(i2i, []);
    const html = renderAttention(clean);

    expect(clean.attention).toEqual([]);
    expect(html).toContain(
      '<p class="gist">Nothing needs attention: every page was read, and every flag was fixed or checked by a person.</p>',
    );
    expect(html).toContain(`<p class="gist">${esc(noAttentionLine(clean.summary.attention))}</p>`);
    expect(textOf(renderSummary(clean))).toContain(noAttentionLine(clean.summary.attention));
    // No card, so no fold, and no box for the folds.
    expect(html).not.toContain("<details");
    expect(html).not.toContain('class="folds"');
  });

  it("says nothing needs attention on the pages read, and how many were skipped, as the panel does", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        { path: "/", passes: { read: ["Welcome"] } },
        { path: "/pdf", status: "skipped" },
        { path: "/map", status: "skipped" },
      ],
    });
    const model = buildShareModel(inputOf([run]));
    const html = renderAttention(model);
    const line =
      "Nothing needs attention on the pages read: every flag was fixed or checked by a person. 2 pages were skipped, not read.";

    expect(model.attention).toEqual([]);
    expect(model.summary.attention.skipped).toBe(2);
    expect(html).toContain(`<p class="gist">${line}</p>`);
    expect(html).not.toContain("every page was read");
    expect(textOf(renderSummary(model))).toContain(line);
  });

  it("says nothing was counted, and never that nothing needs attention, when no run counts", () => {
    const model = buildShareModel(
      inputOf([shareRun({ id: "r1", replayed: true, pages: [{ path: "/" }] })]),
    );
    const html = renderAttention(model);

    expect(model.header.tested).toBeNull();
    expect(html).toContain('<h2 id="need-h">What needs attention</h2>');
    expect(html).toContain(
      '<p class="gist"><b>No live run counts yet.</b> There are no problems to show.</p>',
    );
    expect(html).not.toContain("Nothing needs attention");
    expect(html).not.toContain("<details");
  });

  it("names each page by its canonical address, never by the address voicecap read", async () => {
    const html = renderAttention(await demoModel(DEMO_ROOT));

    expect(html).toContain(
      `<li><a href="#pg-common-mistakes-db8c98dbfa">${DEMO_ROOT}common-mistakes/</a></li>`,
    );
    expect(html).toContain(`${DEMO_ROOT}how-a-run-works/</a>: `);
    expect(html).not.toMatch(/127\.0\.0\.1|localhost/i);
  });

  it("sets no style, loads nothing, and links only to the page's own cards", () => {
    for (const model of [i2i, linkModel(PHRASES), withCards(i2i, [])]) {
      const html = renderAttention(model);

      // A tag with a style or a source: the words of a fix's code say <img src="…">, escaped.
      expect(html).not.toMatch(/<[^>]*\s(?:style|src)\s*=/i);
      expect(html).not.toMatch(/<(?:script|style|link|iframe|img)[\s>]/i);
      for (const href of attributes(html, "href")) expect(href).toMatch(/^#pg-[\w-]+$/);
    }
  });
});

describe("the page with the section", () => {
  it("puts the section after the summary and before How voicecap works, with nothing of the flags found", () => {
    const page = renderSharePage(i2iModel(), { fontCss: "" });
    const markup = markupOf(page);
    const at = (id: string) => markup.indexOf(`<h2 id="${id}">`);

    expect(at("glance-h")).toBeGreaterThan(-1);
    expect(at("need-h")).toBeGreaterThan(at("glance-h"));
    expect(at("need-h")).toBeLessThan(at("how-h"));
    // A section of its own: the summary's has ended before it starts.
    expect(markup.indexOf("</section>", at("glance-h"))).toBeLessThan(at("need-h"));
    expect(page).not.toContain("What the flags found");
    expect(page).not.toContain("find-h");
  });

  it("links the summary's cards, and the contents, to parts of the section that are there", async () => {
    for (const model of [i2iModel(), await demoModel(), linkModel(PHRASES)]) {
      const markup = markupOf(renderSharePage(model, { fontCss: "" }));
      const ids = attributes(markup, "id");
      const summary = renderSummary(model);
      const cards = [...summary.matchAll(/<li><a href="#(need-\d+)">/g)].map(([, id]) => id);

      // The panel names the first 5 cards, each linked to its own.
      expect(cards).toEqual(model.summary.attention.cards.slice(0, 5).map(({ id }) => id));
      for (const id of [...cards, "need-h"]) expect(ids).toContain(id);
      // The contents lead to the section first, ahead of How voicecap works.
      expect(/<nav class="toc"[^>]*>.*?<a href="#([\w-]+)">/s.exec(summary)?.[1]).toBe("need-h");
      // The link to the rest, when the panel leaves some out, goes to the section's heading.
      if (model.attention.length > 5) expect(summary).toContain('<a href="#need-h">and ');
    }
  });

  it("gives each card a place under Every page to link to, and every id once", async () => {
    const model = await demoModel();
    const markup = markupOf(renderSharePage(model, { fontCss: "" }));
    const ids = attributes(markup, "id");

    expect(cardIds(markup)).toEqual(model.attention.map(({ id }) => id));
    for (const card of model.attention) {
      for (const { slug } of card.pages) expect(ids).toContain(`pg-${idFragment(slug)}`);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
});
