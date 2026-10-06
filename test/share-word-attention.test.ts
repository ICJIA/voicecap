/**
 * "What needs attention" in the Word copy: the same cards as the page, as blocks. Each card is a
 * heading with its count under it, then where NVDA said it, the likely cause, why it matters, the
 * fix in the code, the path forward, and the pages: nothing is folded, so every page is listed.
 * i2i's logo (v3--i2i.netlify.app) is the real case, made as the model is made from its run; the
 * demo's runs and pages built here cover the rest. The blocks are plain data, so most of these
 * tests read them as they are; two open the .docx they become.
 */
import { XMLValidator } from "fast-xml-parser";
import { beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { attentionCards } from "../src/share/attention.js";
import { attentionWords } from "../src/share/attention-words.js";
import { renderWordCopy } from "../src/share/docx.js";
import { buildShareModel, type ShareModel } from "../src/share/model.js";
import { ATTENTION_TEXT } from "../src/share/text.js";
import { attentionGist, noAttentionLine } from "../src/share/words.js";
import { heading, list, mono, para, wordsOf, type Block } from "../src/share/word/blocks.js";
import { wordAttention } from "../src/share/word/attention.js";
import { paragraphsOf, unzipDocx } from "./helpers/docx.js";
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
import { DEMO_ROOT, demoModel, inputOf } from "./helpers/share-model.js";
import { outlineOf } from "./helpers/word.js";

/** The generic phrases the default rules list, each of which makes a card of its own. */
const PHRASES = ["click here", "read more", "learn more", "here", "more", "more info", "details"];

/** A label in bold, as a paragraph begins with it: "Likely cause:". */
const labelled = (label: string, words: string) =>
  para({ text: `${label}:`, bold: true }, ` ${words}`);

/** The blocks of one card, from its heading to the end of its pages. */
function cardOf(blocks: Block[], title: string): Block[] {
  const start = blocks.findIndex((block) => block.kind === "heading" && block.text === title);
  if (start === -1) throw new Error(`No card "${title}".`);
  const next = blocks.findIndex((block, at) => at > start && block.kind === "heading");
  return blocks.slice(start, next === -1 ? undefined : next);
}

/** What the .docx of a model says in the section: its paragraphs, from its heading 1 to the next. */
async function sectionOf(model: ShareModel): Promise<{ style: string; text: string }[]> {
  const parts = await unzipDocx(await renderWordCopy(model));
  const paragraphs = paragraphsOf(parts.document);
  const start = paragraphs.findIndex(
    ({ style, text }) => style === "Heading1" && text === "What needs attention",
  );
  const end = paragraphs.findIndex(({ style }, at) => at > start && style === "Heading1");
  expect(XMLValidator.validate(parts.document)).toBe(true);
  return paragraphs.slice(start, end);
}

describe("wordAttention", () => {
  let i2i: ShareModel;
  let blocks: Block[];

  beforeAll(() => {
    i2i = i2iModel();
    blocks = wordAttention(i2i);
  });

  it("opens with its heading and the line under it", () => {
    expect(blocks.slice(0, 2)).toEqual([
      heading(1, "What needs attention"),
      para(...attentionGist(i2i)),
    ]);
    expect(wordsOf(blocks.slice(0, 2))[1]).toBe(
      "1 problem, on 32 pages. Fix each one and run voicecap again, or check it and record that in voicecap review, until nothing is left.",
    );
  });

  it("makes i2i's logo a heading 2 of its number and title, with how many pages and times under it", () => {
    const title =
      '1. The graphic "i 2i Logo" is read as "Unlabeled graphic": its alt text is too generic for Chrome';

    expect(outlineOf(blocks)).toEqual(["1 What needs attention", `2 ${title}`]);
    expect(blocks[2]).toEqual(heading(2, title));
    expect(blocks[3]).toEqual(para("32 pages, 65 times"));
    // A card begins with a heading 2 that begins with its number, the logo's with "1. The graphic".
    expect(blocks.filter((block) => block.kind === "heading" && block.level === 2)).toHaveLength(1);
  });

  it("says each of i2i's cards' parts, as the page does, in the same order", () => {
    const [logo] = i2i.attention;
    if (logo === undefined) throw new Error("i2i has no card.");
    const words = attentionWords(logo);
    const [first, second] = words.fixes;
    if (first === undefined || second === undefined) throw new Error("i2i's card lost a fix.");
    const pages = logo.pages.map((page) => page.name);

    expect(blocks.slice(4)).toEqual([
      // Where NVDA said it, and what it said in each pass.
      para("In the header, on 32 pages"),
      mono([`Down Arrow: “${HOME_READ_HEADER}”`, `Tab: “${HOME_TAB}”`]),
      para("In the main content, on 1 page"),
      mono([`Down Arrow: “${HOME_READ_MAIN}”`]),
      labelled("Likely cause", words.cause),
      labelled("Why it matters", words.why),
      para({ text: "The fix in the code:", bold: true }),
      para(first.lead),
      mono(['<img src="…" alt="">']),
      labelled("What NVDA should say then", '"INSTITUTE 2 INNOVATE, link"'),
      para(second.lead),
      mono(['<img src="…" alt="Institute 2 Innovate">']),
      labelled("What NVDA should say then", '"graphic, Institute 2 Innovate"'),
      para({ text: "The path forward:", bold: true }),
      list(words.path),
      para({ text: "The pages:", bold: true }),
      list(pages),
    ]);
    expect(words.path).toHaveLength(4);
    // Nothing is folded: every one of the 32 pages is in the list.
    expect(pages).toHaveLength(32);
    expect(pages.slice(0, 2)).toEqual(["Home", "Biography 1"]);
  });

  it("sets the code and what NVDA said in the fixed-width font, a line for each line of it", () => {
    const pages = [
      pageFrom("a", passesOf({ headings: [] })),
      pageFrom("b", passesOf({ read: ["Welcome", "Footer"] }, "step-cap"), {
        card: { readStopped: "step-cap" },
      }),
    ];
    const cards = attentionCards(pages, DEFAULT_CONFIG.flags);
    const model = withCards(i2i, cards);
    const copy = wordAttention(model);
    const heads = cards.map((card, at) => `${at + 1}. ${attentionWords(card).title}`);
    const [noHeadings, stopped] = heads.map((title) => cardOf(copy, title));

    expect(cards.map(({ kind }) => kind)).toEqual(["first-heading", "read-stopped"]);
    // Two lines of code, two lines of the block: split where the code's lines end.
    expect(noHeadings).toContainEqual(
      mono(["<h1>Grant opportunities</h1>", "<h2>How to apply</h2>"]),
    );
    // A line NVDA said, after the key it was said at, in curly quotes.
    expect(stopped).toContainEqual(mono(["Down Arrow: “Footer”"]));
    expect(stopped?.filter((block) => block.kind === "mono")).toHaveLength(1);
  });

  it("has no fix for a card that has none, and says why a place has no words of NVDA's", () => {
    const pages = [
      pageFrom("a", passesOf({ read: ["Welcome", "Footer"] }, "step-cap"), {
        card: { readStopped: "step-cap" },
      }),
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
    const cards = attentionCards(pages, DEFAULT_CONFIG.flags);
    const copy = wordAttention(withCards(i2i, cards));
    const [stopped, recorded] = cards.map((card, at) =>
      cardOf(copy, `${at + 1}. ${attentionWords(card).title}`),
    );

    expect(cards.map(({ kind }) => kind)).toEqual(["read-stopped", "recorded"]);
    expect(wordsOf(stopped ?? [])).not.toContain("The fix in the code:");
    expect(wordsOf(recorded ?? [])).not.toContain("The fix in the code:");
    expect(recorded?.some((block) => block.kind === "mono")).toBe(false);
    // The place says it in a paragraph of its own, beside its lead.
    expect(recorded).toContainEqual(
      para("NVDA's words aren't available here: this page's transcripts couldn't be read."),
    );
  });

  it("leaves out what NVDA should say then for a fix that has no words for it", () => {
    const [card] = attentionCards(
      [pageFrom("a", passesOf({ tab: ["Unlabeled image"] }))],
      DEFAULT_CONFIG.flags,
    );
    if (card === undefined) throw new Error("No card.");
    const copy = cardOf(wordAttention(withCards(i2i, [card])), `1. ${attentionWords(card).title}`);

    expect(card.kind).toBe("unnamed");
    expect(wordsOf(copy).join("\n")).not.toContain("What NVDA should say then");
    expect(copy).toContainEqual(mono(['<div role="…" aria-label="What it is">…</div>']));
  });

  it("says why a page wasn't read, and an issue's note, after the page's name, and nothing after a name with none", () => {
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
    const cards = attentionCards(pages, DEFAULT_CONFIG.flags);
    const copy = wordAttention(withCards(i2i, cards));
    const lists = cards.map((card, at) =>
      cardOf(copy, `${at + 1}. ${attentionWords(card).title}`).filter(
        (block) => block.kind === "list",
      ),
    );

    expect(cards.map(({ kind }) => kind)).toEqual(["unread", "issue", "issue", "issue"]);
    expect(lists[0]?.at(-1)).toEqual(
      list(["Page a: During the headings pass, another window took the screen."]),
    );
    expect(lists[1]?.at(-1)).toEqual(list(["Page b: The search box has no name."]));
    expect(lists[2]?.at(-1)).toEqual(list(["Page c"]));
    expect(lists[3]?.at(-1)).toEqual(list(["Page d"]));
  });

  it("lists every page of every card, never folded, however many there are", () => {
    const model = linkModel(PHRASES.slice(0, 6));
    const copy = wordAttention(model);

    // Six cards, each a heading 2: nothing is behind a line that counts them.
    expect(outlineOf(copy).filter((line) => line.startsWith("2 "))).toHaveLength(6);
    const [first] = model.attention;
    if (first === undefined) throw new Error("The model has no card.");
    const four = cardOf(copy, `1. ${attentionWords(first).title}`);
    expect(four.at(-1)).toEqual(list(["Page A", "Page B", "Page C", "Page D"]));
    expect(four.at(-2)).toEqual(para({ text: "The pages:", bold: true }));
  });

  it("sets its headings in order: an h1, then an h2 for each card, and nothing between", async () => {
    for (const model of [i2i, linkModel(PHRASES), await demoModel(), withCards(i2i, [])]) {
      const levels = wordAttention(model).flatMap((block) =>
        block.kind === "heading" ? [block.level] : [],
      );

      expect(levels[0]).toBe(1);
      expect(levels.slice(1).every((level) => level === 2)).toBe(true);
      expect(levels).toHaveLength(1 + model.attention.length);
    }
  });

  it("holds the words as they are: markup in what NVDA said, a note, or a name is plain", () => {
    const said = 'link, <b> & "x"';
    const pages = [
      pageFrom("a", passesOf({ read: ["Welcome", said] }, "step-cap"), {
        card: { readStopped: "step-cap", name: 'A <i>page</i> & "co"' },
      }),
      pageFrom("b", passesOf({ read: ["Welcome"] }), {
        review: reviewed("issue", { note: "<script>alert(1)</script>" }),
        card: { name: "<img src=x>" },
      }),
    ];
    const words = wordsOf(
      wordAttention(withCards(i2i, attentionCards(pages, DEFAULT_CONFIG.flags))),
    );

    expect(words).toContain(`Down Arrow: “${said}”`);
    expect(words).toContain("Likely cause: <script>alert(1)</script>");
    expect(words).toContain("<img src=x>: <script>alert(1)</script>");
    expect(words).toContain('A <i>page</i> & "co"');
    // Nothing is escaped: the document holds words, and the library sets each in a run of its own.
    for (const line of words) expect(line).not.toMatch(/&(?:lt|gt|amp|quot|#39);/);
  });

  it("makes a Word document of it: a heading 2 for each card, the code and what NVDA said in the fixed-width style, and the lists as lists", async () => {
    const section = await sectionOf(i2i);
    const styled = (style: string) => section.filter((each) => each.style === style);

    expect(styled("Heading2").map(({ text }) => text)).toEqual([
      '1. The graphic "i 2i Logo" is read as "Unlabeled graphic": its alt text is too generic for Chrome',
    ]);
    // A block of fixed-width lines is one paragraph, with a line break after each line.
    expect(styled("Mono").map(({ text }) => text)).toEqual([
      `Down Arrow: “${HOME_READ_HEADER}”\nTab: “${HOME_TAB}”`,
      `Down Arrow: “${HOME_READ_MAIN}”`,
      '<img src="…" alt="">',
      '<img src="…" alt="Institute 2 Innovate">',
    ]);
    // The path's 4 steps, then each of the 32 pages.
    expect(styled("ListParagraph")).toHaveLength(4 + 32);
    expect(section.at(-1)?.text).toBe("Biography 31");
  });

  it("keeps the markup in what NVDA said, a note, and a page's name in the Word document, as words", async () => {
    const said = 'link, <b> & "x"';
    const pages = [
      pageFrom("a", passesOf({ read: ["Welcome", said] }, "step-cap"), {
        card: { readStopped: "step-cap", name: 'A <i>page</i> & "co"' },
      }),
      pageFrom("b", passesOf({ read: ["Welcome"] }), {
        review: reviewed("issue", { note: "<script>alert(1)</script>" }),
        card: { name: "<img src=x>" },
      }),
    ];
    const section = await sectionOf(withCards(i2i, attentionCards(pages, DEFAULT_CONFIG.flags)));
    const words = section.map(({ text }) => text);

    expect(words).toContain(`Down Arrow: “${said}”`);
    expect(words).toContain("Likely cause: <script>alert(1)</script>");
    expect(words).toContain("<img src=x>: <script>alert(1)</script>");
    expect(words).toContain('A <i>page</i> & "co"');
    expect(words).toContain("2. An issue found in review: <img src=x>");
  });

  it("says every word a card has, as the same words the page has", async () => {
    for (const model of [i2i, linkModel(PHRASES), await demoModel()]) {
      const said = wordsOf(wordAttention(model)).join("\n");

      expect(model.attention.length).toBeGreaterThan(0);
      for (const card of model.attention) {
        const words = attentionWords(card);
        for (const text of [
          words.title,
          words.count,
          words.cause,
          words.why,
          ...words.path,
          ...words.places.map((place) => place.lead),
          ...words.fixes.flatMap((fix) => [fix.lead, ...fix.code.split("\n")]),
          ...card.pages.map((page) => page.name),
        ]) {
          expect(said, `${card.id}: ${text}`).toContain(text);
        }
      }
    }
  });

  it("says the line for no problem when no card is left, as the summary does, with no card and no list", () => {
    const clean = withCards(i2i, []);
    const copy = wordAttention(clean);

    expect(copy).toEqual([heading(1, "What needs attention"), para(...attentionGist(clean))]);
    expect(wordsOf(copy)[1]).toBe(ATTENTION_TEXT.none);
    expect(wordsOf(copy)[1]).toBe(noAttentionLine(clean.summary.attention));
  });

  it("says nothing needs attention on the pages read, and how many were skipped, when some were", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        { path: "/", passes: { read: ["Welcome"] } },
        { path: "/pdf", status: "skipped" },
      ],
    });
    const model = buildShareModel(inputOf([run]));

    expect(model.attention).toEqual([]);
    expect(wordsOf(wordAttention(model))[1]).toBe(
      "Nothing needs attention on the pages read: every flag was fixed or checked by a person. 1 page was skipped, not read.",
    );
  });

  it("says nothing was counted, and never that nothing needs attention, when no run counts", () => {
    const model = buildShareModel(
      inputOf([shareRun({ id: "r1", replayed: true, pages: [{ path: "/" }] })]),
    );
    const copy = wordAttention(model);

    expect(outlineOf(copy)).toEqual(["1 What needs attention"]);
    expect(wordsOf(copy)).toEqual([
      "What needs attention",
      "No live run counts yet. There are no problems to show.",
    ]);
  });

  it("names each page by its canonical address, never by the address voicecap read", async () => {
    const words = wordsOf(wordAttention(await demoModel(DEMO_ROOT)));

    expect(words).toContain(`${DEMO_ROOT}common-mistakes/`);
    expect(words).toContain(
      `${DEMO_ROOT}how-a-run-works/: During the headings pass, another window took the screen.`,
    );
    expect(words.join("\n")).not.toMatch(/127\.0\.0\.1|localhost/i);
  });

  it("never calls voicecap automated, never says listened, and never names a library", async () => {
    for (const model of [i2i, linkModel(PHRASES), await demoModel(), withCards(i2i, [])]) {
      const said = wordsOf(wordAttention(model)).join("\n");

      expect(said).not.toMatch(/automated|listen|guidepup/i);
    }
  });

  it("has no table, since a card's parts are paragraphs, lists, and lines of code", async () => {
    for (const model of [i2i, await demoModel()]) {
      const kinds = new Set(wordAttention(model).map(({ kind }) => kind));

      expect([...kinds].sort()).toEqual(["heading", "list", "mono", "para"]);
    }
  });
});
