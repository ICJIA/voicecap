/**
 * The shareable page's "Every page": a card for each page, with what NVDA said first on the page and
 * its full transcript folded in the card (the page has no appendix of transcripts). The demo runs of
 * 29 September 2026 (voicecap 0.4.1, in test/fixtures/share/) are the real case; runs built in
 * memory, with their transcripts held in memory too, cover the rest. The tests are on the markup:
 * it is the mockup's, so its classes and its order are the contract.
 */
import { describe, expect, it } from "vitest";

import type { FlagResult, PassName, RunJson } from "../src/model.js";
import { esc, idFragment } from "../src/report/html.js";
import { renderPages } from "../src/share/html/pages.js";
import type { ShareInput } from "../src/share/load.js";
import { buildShareModel, type PageCard, type ShareModel } from "../src/share/model.js";
import { TINY_RECORD } from "./helpers/jpeg.js";
import { failedAttempt, shareRun, type SharePageSpec } from "./helpers/share-data.js";
import {
  attributes,
  decode,
  foldsIn,
  scrollBoxes,
  summariesIn,
  textOf,
} from "./helpers/share-html.js";
import {
  demoModel,
  inputOf as inputWithoutTranscripts,
  LINES,
  LINK_FLAG,
  manyPages,
  picturesOf,
  storeOf,
  TRANSCRIPTS,
  type Lines,
} from "./helpers/share-model.js";

/** What the model is built from, for runs built in memory, with their transcripts held in memory. */
function inputOf(runs: RunJson[], overrides: Partial<ShareInput> = {}): ShareInput {
  return inputWithoutTranscripts(runs, { transcripts: storeOf(), ...overrides });
}

/** A page read in full, with its three transcripts, as the runs built here have them. */
function done(pagePath: string, extra: Partial<SharePageSpec> = {}): SharePageSpec {
  return { path: pagePath, title: `Page ${pagePath}`, files: TRANSCRIPTS, passes: LINES, ...extra };
}

/** The model of one run of these pages. */
function modelOf(pages: SharePageSpec[], overrides: Partial<ShareInput> = {}): ShareModel {
  return buildShareModel(inputOf([shareRun({ id: "r1", pages })], overrides));
}

/** A flag that has no line of NVDA's to quote: Tab reached nothing. */
const NO_STOPS_FLAG: FlagResult = {
  rule: "tab-no-stops",
  pass: "tab",
  message: "Tab reached no focusable elements on the page.",
};

/**
 * The line of a card's fold of its page's transcripts as a screen reader gets it, when the page has
 * all three: "The full transcript of /about/: read, headings, and Tab transcripts". A sighted
 * reader sees the same without "of /about/", which is set apart for a screen reader alone.
 */
const allThree = (path: string): string =>
  `The full transcript of ${path}: read, headings, and Tab transcripts`;

/** Pages whose read pass has fewer than the three lines a card shows first. */
const LESS = { two: { read: ["One", "Two"] }, one: { read: ["Only"] } } satisfies Record<
  string,
  Lines
>;

/** A site whose only run was a replay, so no run counts. */
function noRunModel(): ShareModel {
  return buildShareModel(inputOf([shareRun({ id: "r1", replayed: true, pages: [{ path: "/" }] })]));
}

/** The model with one card changed, for a state the records don't easily make. */
function withCard(model: ShareModel, index: number, patch: Partial<PageCard>): ShareModel {
  return {
    ...model,
    pages: model.pages.map((card, at) => (at === index ? { ...card, ...patch } : card)),
  };
}

/** The cards of the "Every page" section, each as its markup. */
function cardsIn(html: string): string[] {
  return html.split('<article class="card"').slice(1);
}

/**
 * The section split at its fold of the pages with nothing to note: what comes before it (the cards
 * in the open, each with its own transcript fold), and from the fold on. With no such fold, all of
 * it comes before.
 */
function splitAtQuietFold(html: string): [before: string, inside: string] {
  const at = html.indexOf('<div class="folds">');
  return at < 0 ? [html, ""] : [html.slice(0, at), html.slice(at)];
}

/** The lines of the section's folds of pages with nothing to note: none, or one. */
const quietLines = (html: string): string[] =>
  summariesIn(html).filter((line) => line.startsWith("The other"));

/**
 * The summary markup of each of the section's folds of a page's full transcript, in the markup's
 * order.
 */
const foldSummaries = (html: string): string[] =>
  [...html.matchAll(/<details class="fold tx-page"[^>]*><summary>(.*?)<\/summary>/gs)].map(
    ([, line = ""]) => line,
  );

/**
 * The lines of those folds, each as a screen reader gets it: the words set apart for it too, and no
 * space where a tag was.
 */
const foldLines = (html: string): string[] => foldSummaries(html).map((line) => textOf(line, ""));

/** The paths of a model's pages, in the page's order. */
const pathsOf = (model: ShareModel): string[] => model.pages.map(({ path }) => path);

/** A page's first lines as a card shows them, each as its text without the quotes it is set in. */
function firstLinesIn(card: string): string[] {
  const figure = /<figure class="heard-first">(.*?)<\/figure>/s.exec(card)?.[1] ?? "";
  return [...figure.matchAll(/<li>“(.*?)”<\/li>/g)].map(([, line = ""]) => decode(line));
}

describe("renderPages", () => {
  it("has a card for every page in scope, and lists the pages no longer listed", () => {
    const earlier = shareRun({
      id: "r1",
      createdAt: "2026-09-25T10:00:00-05:00",
      pages: [done("/"), done("/gone", { label: "Old news" }), done("/moved")],
    });
    const latest = shareRun({
      id: "r2",
      pages: [done("/"), done("/about", { label: "About us" }), done("/contact")],
    });
    const model = buildShareModel(inputOf([earlier, latest]));
    const html = renderPages(model);

    expect(html).toMatch(/^<section id="pages" aria-labelledby="pages-h">\s*<h2 id="pages-h">/);
    expect(html).toContain('<h2 id="pages-h">Every page</h2>');
    expect(html).toMatch(/<\/section>$/);

    // One card for each page of the latest run, in its order, each with its own id.
    const cards = cardsIn(html);
    expect(cards).toHaveLength(3);
    expect(model.pages.map((card) => card.path)).toEqual(["/", "/about", "/contact"]);
    for (const [index, card] of model.pages.entries()) {
      expect(cards[index]).toContain(` id="pg-${idFragment(card.slug)}">`);
      expect(cards[index]).toContain(`<span class="num">${index + 1}</span>`);
    }
    // A page is its path, or the name the page list gave it, with its path beside it.
    expect(cards[0]).toContain('<h3><span class="num">1</span> /</h3>');
    expect(cards[1]).toContain(
      '<h3><span class="num">2</span> About us <span class="sub">/about</span></h3>',
    );
    expect(cards[2]).toContain('<h3><span class="num">3</span> /contact</h3>');

    // The pages the earlier run had and the latest list doesn't, in a small table of their own.
    expect(model.noLongerListed.map((page) => page.lastRun)).toEqual(["r1", "r1"]);
    expect(html).toContain('<div class="cards"><article class="card" id="pg-');
    expect(html).toContain('<div class="panel"><h3>No longer listed</h3>');
    const table = html.slice(html.indexOf("<h3>No longer listed</h3>"));
    // Its table is in a box a keyboard can scroll, named for the table.
    expect(table).toContain(
      '<div class="scroll" tabindex="0" role="region" aria-label="Pages no longer listed, table"><table class="plain"><caption class="sr">Pages no longer listed',
    );
    expect(textOf(/<thead>(.*?)<\/thead>/s.exec(table)?.[1] ?? "")).toBe(
      "Page Last run that had it What it recorded",
    );
    const rows = [
      ...table.matchAll(/<tr><th scope="row">(.*?)<\/th><td>(.*?)<\/td><td>(.*?)<\/td><\/tr>/g),
    ];
    expect(rows.map(([, page, run, result]) => [textOf(page ?? ""), run, result])).toEqual([
      ["Old news https://example.illinois.gov/gone", "r1", "Transcribed"],
      ["https://example.illinois.gov/moved", "r1", "Transcribed"],
    ]);
    // The no longer listed come after every card.
    expect(html.lastIndexOf('<article class="card"')).toBeLessThan(
      html.indexOf("<h3>No longer listed</h3>"),
    );

    // Nothing is no longer listed: no table.
    expect(renderPages(modelOf([done("/")]))).not.toContain("No longer listed");
  });

  it("shows a card as the mockup's: its path, result, flags, review, counts, time, strip, and transcript", async () => {
    const model = await demoModel();
    const html = renderPages(model);
    const cards = cardsIn(html);
    const flagged = cards[6] ?? "";

    expect(cards).toHaveLength(7);
    expect(model.pages[6]?.path).toBe("/common-mistakes/");
    // The mockup's seventh card, in its order: the heading, the chips, the four numbers, the strip,
    // and the full transcript, folded where the card's link to the appendix was.
    expect(flagged).toContain('<h3><span class="num">7</span> /common-mistakes/</h3>');
    expect(flagged).toContain(
      '<div class="chips"><span class="chip c-ok">Transcribed</span><span class="sr">Flags raised: </span>' +
        '<span class="chip c-warn">generic-link-text</span><span class="chip c-warn">unlabeled</span>' +
        '<span class="chip c-warn">headings</span></div>',
    );
    expect(flagged).toContain(
      '<dl class="passes"><div><dt>Read</dt><dd>22 lines</dd></div><div><dt>Headings</dt><dd>4</dd></div>' +
        "<div><dt>Tab stops</dt><dd>7</dd></div><div><dt>Time</dt><dd>1 min 2 s</dd></div></dl>",
    );
    expect(flagged).toContain('<figure class="strip-fig"><svg class="strip"');
    expect(flagged).toContain(
      "</svg><figcaption>Read pass: one bar per line NVDA spoke, as wide as it took</figcaption></figure>",
    );
    expect(flagged).toContain('<details class="fold tx-page" id="tx-common-mistakes-db8c98dbfa">');
    // The card links to nothing: its transcript is in the card, not in an appendix to go to.
    expect(flagged).not.toContain("<a ");
    expect(flagged).not.toContain("Transcripts and fingerprints");
    // One bar for each line NVDA spoke in the read pass, as the strip's own words say.
    expect(flagged.match(/<rect /g)).toHaveLength(22);
    expect(flagged).toContain("Read pass: 22 lines over");
    // The order: heading, chips, the first lines, numbers, strip, transcript.
    const order = [
      "<h3>",
      'class="chips"',
      'class="heard-first"',
      'class="passes"',
      'class="strip-fig"',
      'class="fold tx-page"',
    ];
    expect(order.map((part) => flagged.indexOf(part))).toEqual(
      order.map((part) => flagged.indexOf(part)).sort((a, b) => a - b),
    );
    expect(order.every((part) => flagged.includes(part))).toBe(true);

    // The first card: 18 lines, 2 headings, 8 Tab stops, and 55.1 s, with no flags.
    expect(cards[0]).toContain(
      '<span class="chip c-ok">Transcribed</span><span class="chip c-quiet">No flags</span></div>',
    );
    expect(cards[0]).toContain("<dd>18 lines</dd>");
    expect(cards[0]).toContain("<dt>Time</dt><dd>55.1 s</dd>");
  });

  it("says the result in words: a flag is a chip of its own, and 'No flags' is never said twice", async () => {
    const model = await demoModel();
    const cards = cardsIn(renderPages(model));

    for (const [index, card] of model.pages.entries()) {
      const html = cards[index] ?? "";
      const chips = [...html.matchAll(/<span class="chip c-(\w+)">(.*?)<\/span>/g)];
      // Every chip has words, and the result is one chip of its own.
      expect(chips.length).toBeGreaterThan(0);
      for (const [, , words] of chips) expect(textOf(words ?? "")).not.toBe("");
      expect(chips[0]?.[2]).toBe(card.statusText);
      // A page with transcripts and no flags says so in one chip, never also in its result.
      const saidNoFlags = chips.filter(([, , words]) => /no flags/i.test(words ?? ""));
      expect(saidNoFlags, card.path).toHaveLength(card.flags.length === 0 ? 1 : 0);
    }
    // The failed page with older transcripts is red in words, and still has no flags.
    const failed = cards[2] ?? "";
    expect(failed).toContain(
      '<span class="chip c-bad">Failed in run 2026-09-29_1402 · transcribed in run 2026-09-29_1315</span>' +
        '<span class="chip c-quiet">No flags</span>',
    );
    expect(failed).not.toContain("Transcribed</span>");
  });

  it("colors each result by its kind, and says a page with no transcripts has no flags to speak of", () => {
    const earlier = shareRun({
      id: "r1",
      createdAt: "2026-09-25T10:00:00-05:00",
      pages: [done("/a"), done("/b"), done("/c")],
    });
    const latest = shareRun({
      id: "r2",
      pages: [
        done("/a", { flags: [LINK_FLAG] }),
        { path: "/b", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
        { path: "/c", status: "skipped" },
        { path: "/new", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
        { path: "/new-skipped", status: "skipped" },
      ],
    });
    const model = buildShareModel(inputOf([earlier, latest]));
    const cards = cardsIn(renderPages(model));
    const firstChip = (card: string | undefined) =>
      /<span class="chip c-(\w+)">(.*?)<\/span>/.exec(card ?? "")?.slice(1, 3);

    expect(model.pages.map((card) => card.status)).toEqual([
      "flags",
      "failed",
      "skipped",
      "never",
      "skipped",
    ]);
    expect(cards.map(firstChip)).toEqual([
      ["ok", "Transcribed"],
      ["bad", "Failed in run r2 · transcribed in run r1"],
      ["warn", "Skipped in run r2 · transcribed in run r1"],
      ["bad", "Failed in run r2 · never transcribed"],
      ["bad", "Skipped in run r2 · never transcribed"],
    ]);
    // A page with no transcripts says no more of its flags than it has: it has no flags chip.
    expect(cards[3]).not.toMatch(/No flags|Flags raised/);
    expect(cards[4]).not.toMatch(/No flags|Flags raised/);
    expect(cards[3]).not.toContain('class="passes"');
    expect(cards[3]).not.toContain('class="strip-fig"');
    // A flagged page has a chip for each rule that raised a flag, once, in the order they were raised.
    expect(cards[0]).toContain(
      '<span class="sr">Flags raised: </span><span class="chip c-warn">generic-link-text</span></div>',
    );
  });

  it("shows the person's review as chips, leading with what they did", async () => {
    const model = withCard(await demoModel(), 0, {
      reviewChips: [
        "Heard live by Pat Lee",
        "Reviewed, no issues",
        "Issue found",
        "Fixed",
        "Changed since review",
        "Sam Roe heard part of this session",
      ],
    });
    const [card = ""] = cardsIn(renderPages(model));

    expect(card).toContain(
      '<span class="chip c-quiet">No flags</span>' +
        '<span class="chip c-ok">Heard live by Pat Lee</span>' +
        '<span class="chip c-ok">Reviewed, no issues</span>' +
        '<span class="chip c-warn">Issue found</span>' +
        '<span class="chip c-ok">Fixed</span>' +
        '<span class="chip c-warn">Changed since review</span>' +
        '<span class="chip c-quiet">Sam Roe heard part of this session</span></div>',
    );
    // A page nobody has reviewed has no review chip: nothing says what a person hasn't done.
    const chips = /<div class="chips">(.*?)<\/div>/s.exec(cardsIn(renderPages(model))[1] ?? "");
    expect(chips?.[1]).toEqual(expect.any(String));
    expect(chips?.[1]).not.toMatch(/Heard|Reviewed|Issue found/);
  });

  it("keeps part of a session quiet when no name was recorded, too", async () => {
    const model = withCard(await demoModel(), 0, { reviewChips: ["Heard part of this session"] });
    const [card = ""] = cardsIn(renderPages(model));

    expect(card).toContain('<span class="chip c-quiet">Heard part of this session</span>');
  });

  it("marks a card whose flags are as its run recorded them, not the current rules'", async () => {
    const model = await demoModel();
    const [card = ""] = cardsIn(renderPages(withCard(model, 0, { flagsAsRecorded: true })));
    const [plain = ""] = cardsIn(renderPages(model));

    expect(card).toContain('<span class="chip c-quiet">Flags as recorded</span>');
    expect(plain).not.toContain("Flags as recorded");
  });

  it("says a pass wasn't read, never 0, and a time that wasn't recorded", async () => {
    const model = await demoModel();
    const partial = renderPages(
      withCard(model, 0, {
        counts: { read: 1, headings: null, tab: null },
        timeMs: { notRecorded: "Not recorded: this run used voicecap 0.4.1." },
      }),
    );
    const [card = ""] = cardsIn(partial);

    expect(card).toContain(
      '<dl class="passes"><div><dt>Read</dt><dd>1 line</dd></div><div><dt>Headings</dt><dd>Not read</dd></div>' +
        "<div><dt>Tab stops</dt><dd>Not read</dd></div><div><dt>Time</dt><dd>Not recorded: this run used voicecap 0.4.1.</dd></div></dl>",
    );
    expect(card).not.toContain("<dd>0</dd>");
    // Any pass can be the one that wasn't read: the read pass, too.
    const [unread = ""] = cardsIn(
      renderPages(withCard(model, 0, { counts: { read: null, headings: 2, tab: 3 } })),
    );
    expect(unread).toContain(
      '<dl class="passes"><div><dt>Read</dt><dd>Not read</dd></div><div><dt>Headings</dt><dd>2</dd></div><div><dt>Tab stops</dt><dd>3</dd></div>',
    );
    expect(unread).not.toMatch(/<dd>0/);
    // A pass that read nothing is 0: a pass that wasn't read isn't.
    expect(
      cardsIn(renderPages(withCard(model, 0, { counts: { read: 0, headings: 0, tab: 0 } })))[0],
    ).toContain("<dd>0 lines</dd></div><div><dt>Headings</dt><dd>0</dd>");
  });

  it("writes how long a page took as the mockup does", async () => {
    const model = await demoModel();
    const times: [number, string][] = [
      [0, "0.0 s"],
      [850, "0.9 s"],
      [55_114, "55.1 s"],
      [59_940, "59.9 s"],
      [59_960, "1 min 0 s"],
      [61_931, "1 min 2 s"],
      // The seconds are the remainder, and the minutes the whole ones: never rounded up.
      [95_000, "1 min 35 s"],
      [185_000, "3 min 5 s"],
    ];

    for (const [timeMs, words] of times) {
      const [card = ""] = cardsIn(renderPages(withCard(model, 0, { timeMs })));
      expect(card, words).toContain(`<dt>Time</dt><dd>${words}</dd>`);
    }
  });

  it("shows a page's title, and says when it wasn't recorded", async () => {
    const model = await demoModel();
    const title = (patch: Partial<PageCard>, index = 0) =>
      cardsIn(renderPages(withCard(model, index, patch)))[index] ?? "";

    // Under the heading, before the chips.
    const titled = title({ title: "Grants | Example Agency" });
    expect(titled).toMatch(
      /<\/h3>\s*<p class="sub">Title: Grants \| Example Agency<\/p>\s*<div class="chips">/,
    );
    expect(title({ title: '<b>"Home"</b> & more' })).toContain(
      '<p class="sub">Title: &lt;b&gt;&quot;Home&quot;&lt;/b&gt; &amp; more</p>',
    );
    // A run from before voicecap recorded titles says so, in the model's own words.
    expect(cardsIn(renderPages(model))[0]).toContain(
      '<p class="sub">Title: Not recorded: this run used voicecap 0.4.1.</p>',
    );
    // A page with no title, or never loaded, has no title line.
    expect(title({ title: null })).not.toContain("Title:");
    expect(title({ title: "  " })).not.toContain("Title:");
  });

  it("shows the screenshot at the size its record gives, or says it wasn't recorded", async () => {
    const model = await demoModel();
    const uri = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    const alt = 'The page "/" as it loaded, before NVDA read it';
    const shot = (width: number, height: number) =>
      withCard(model, 0, { screenshot: { dataUri: uri, alt, width, height } });
    const [card = ""] = cardsIn(renderPages(shot(632, 419)));

    // The mockup's picture: first in the card, laid out at the size it was recorded at (a little
    // less than 480 high, since the window's own bar takes some of it), loaded when scrolled to, and
    // naming its page and file for the page's fingerprint check.
    expect(card).toMatch(
      new RegExp(
        `^ id="pg-[^"]+">\\s*<img src="${uri}" alt="The page &quot;/&quot; as it loaded, before NVDA read it" width="632" height="419" loading="lazy" data-slug="home" data-file="screenshot.jpg">\\s*<div class="card-body">`,
      ),
    );
    expect(card).not.toContain("not-recorded");
    // Each picture has the size its own record gives, never one the page fixes for every picture.
    const [taller = ""] = cardsIn(renderPages(shot(640, 480)));
    expect(taller).toContain('width="640" height="480"');
    expect(card).not.toContain('width="640"');

    // Not recorded: the line in the picture's place, named for a screen reader.
    const [unrecorded = ""] = cardsIn(renderPages(model));
    expect(unrecorded).not.toContain("<img");
    expect(unrecorded).toContain(
      '<div role="group" aria-label="Screenshot"><p class="not-recorded">Not recorded: this run used voicecap 0.4.1.</p></div>',
    );
  });

  it("shows a failed page's failure beside its older transcripts, and the run they come from", async () => {
    const model = await demoModel();
    const cards = cardsIn(renderPages(model));
    const failed = cards[2] ?? "";

    expect(model.pages[2]).toMatchObject({ path: "/how-a-run-works/", status: "failed" });
    expect(failed).toContain("<p>During the headings pass, another window took the screen.</p>");
    expect(failed).toContain('<p class="sub">From run 2026-09-29_1315, on 29 September 2026</p>');
    // The older run's counts, time, and strip, with the transcripts it shows folded in the card.
    expect(failed).toContain(
      "<dd>18 lines</dd></div><div><dt>Headings</dt><dd>4</dd></div><div><dt>Tab stops</dt><dd>3</dd></div><div><dt>Time</dt><dd>51.5 s</dd>",
    );
    expect(failed.match(/<rect /g)).toHaveLength(18);
    expect(failed).toContain('id="tx-how-a-run-works-fd116f9328"');
    // The page read in the latest run says neither: no line of its own for where its transcripts
    // are from (its fold names its run, the latest, as every fold does).
    expect(cards[0]).not.toContain('<p class="sub">From run');
    expect(cards[0]).not.toContain("<p>");

    // A failure in the model's words is escaped.
    const odd = renderPages(withCard(model, 2, { failure: "It said <b>no</b> & left." }));
    expect(odd).toContain("<p>It said &lt;b&gt;no&lt;/b&gt; &amp; left.</p>");
  });

  it("lists the manual NVDA sessions on a page", async () => {
    const model = await demoModel();
    const [card = ""] = cardsIn(
      renderPages(
        withCard(model, 0, {
          manual: [
            { at: "25 September 2026", reviewer: "Sam <Roe>" },
            { at: "26 September 2026", reviewer: null },
          ],
        }),
      ),
    );

    expect(card).toContain(
      '<p class="sub">Manual NVDA session, 25 September 2026, by Sam &lt;Roe&gt;</p>',
    );
    expect(card).toContain('<p class="sub">Manual NVDA session, 26 September 2026</p>');
    expect(cardsIn(renderPages(model))[0]).not.toContain("Manual NVDA session");
  });

  it("puts a card's parts in the mockup's order, with what the mockup had no place for between", async () => {
    // A failed page with older transcripts, a title, a review, and a manual session: every part.
    const model = withCard(await demoModel(), 2, {
      title: "Grants | Example Agency",
      reviewChips: ["Issue found"],
      manual: [{ at: "25 September 2026", reviewer: "Sam Roe" }],
    });
    const [, , card = ""] = cardsIn(renderPages(model));
    const parts = [
      'class="not-recorded"',
      "<h3>",
      "Title: Grants",
      'class="chips"',
      "<p>During the headings pass",
      "From run 2026-09-29_1315",
      "Manual NVDA session",
      'class="heard-first"',
      'class="passes"',
      'class="strip-fig"',
      'class="fold tx-page"',
    ];
    const places = parts.map((part) => card.indexOf(part));

    expect(places.every((place) => place >= 0)).toBe(true);
    // The picture's place first, as the mockup's picture is, then the card's words in this order:
    // what the mockup had no place for, what NVDA said first, the numbers, the strip, and last
    // the page's full transcript.
    expect(places).toEqual([...places].sort((a, b) => a - b));
  });

  it("leaves out the strip, and the first lines and the fold, a page has nothing for", async () => {
    const model = await demoModel();
    const [bare = ""] = cardsIn(renderPages(withCard(model, 0, { strip: [], heardFirst: [] })));
    const [cut = ""] = cardsIn(
      renderPages({ ...model, appendix: model.appendix.filter(({ slug }) => slug !== "home") }),
    );

    // No lines, no strip: a strip of no lines would say "no lines" of a page that has some. And no
    // first lines: a label with nothing under it would say less than nothing.
    expect(bare).not.toContain("strip-fig");
    expect(bare).not.toContain("heard-first");
    expect(bare).not.toContain("Heard first");
    expect(bare).toContain('class="fold tx-page"');
    // A page with no entry in the appendix has no transcripts to fold, and keeps the rest.
    expect(cut).not.toContain("tx-page");
    expect(cut).not.toContain("<details");
    expect(cut).toContain("strip-fig");
    expect(cut).toContain('class="heard-first"');
  });

  it("names a page by its label, and escapes every name and path", () => {
    const model = modelOf([
      done("/a b", { label: '<i>"Grants"</i> & Co', title: "T" }),
      done("/x?y=1&z=<2>"),
    ]);
    const html = renderPages(model);

    expect(html).toContain(
      '<h3><span class="num">1</span> &lt;i&gt;&quot;Grants&quot;&lt;/i&gt; &amp; Co <span class="sub">/a%20b</span></h3>',
    );
    expect(html).toContain(`<span class="num">2</span> ${esc(model.pages[1]?.path)}</h3>`);
    expect(html).not.toContain("<i>");
    expect(html).not.toContain("<2>");
  });

  it("names a page by its label whatever the label looks like, and by its path when it has none", () => {
    // A page list can give a page a label that is an address: it's still the page's label.
    const model = modelOf([
      done("/about", { label: "https://example.illinois.gov/about-us" }),
      done("/contact", { label: "  " }),
    ]);
    const [labeled = "", blank = ""] = cardsIn(renderPages(model));

    expect(model.pages.map((card) => card.labeled)).toEqual([true, false]);
    expect(labeled).toContain(
      '<h3><span class="num">1</span> https://example.illinois.gov/about-us <span class="sub">/about</span></h3>',
    );
    expect(blank).toContain('<h3><span class="num">2</span> /contact</h3>');
  });

  it("folds the pages with nothing to note at 13 pages, never at 12", () => {
    const twelveOf = manyPages(12, 2);
    const thirteenOf = manyPages(13, 2);
    const twelve = renderPages(twelveOf);
    const thirteen = renderPages(thirteenOf);

    // At 12, every card is in the open, each with a fold of its own transcript and no other.
    expect(cardsIn(twelve)).toHaveLength(12);
    expect(quietLines(twelve)).toEqual([]);
    expect(twelve).not.toContain('<div class="folds">');
    expect(foldLines(twelve)).toEqual(pathsOf(twelveOf).map(allThree));

    // At 13, the 11 with nothing to note fold behind one line, closed, with their cards inside, and
    // each card still holds its own fold: 13 transcripts, and the one fold around 11 of them.
    expect(quietLines(thirteen)).toEqual(["The other 11 pages: nothing to note, all read in full"]);
    expect(foldsIn(thirteen)).toHaveLength(1 + 13);
    expect(thirteen).toContain(
      '<div class="folds"><details class="fold"><summary><span class="what">The other 11 pages:</span> <span class="sub">nothing to note, all read in full</span></summary>',
    );
    const [before, inside] = splitAtQuietFold(thirteen);
    expect(cardsIn(before)).toHaveLength(2);
    expect(cardsIn(inside)).toHaveLength(11);
    expect(foldLines(before)).toEqual(pathsOf(thirteenOf).slice(0, 2).map(allThree));
    expect(quietLines(inside)).toEqual(["The other 11 pages: nothing to note, all read in full"]);
    expect(foldLines(inside)).toEqual(pathsOf(thirteenOf).slice(2).map(allThree));
    // The cards keep their numbers, in the page's order, wherever they are.
    expect(
      [...before.matchAll(/<span class="num">(\d+)<\/span>/g)].map((found) => found[1]),
    ).toEqual(["1", "2"]);
    expect(
      [...inside.matchAll(/<span class="num">(\d+)<\/span>/g)].map((found) => found[1]),
    ).toEqual(["3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"]);
    // The section's own heading is outside the fold.
    expect(thirteen.indexOf('<h2 id="pages-h">')).toBeLessThan(thirteen.indexOf("<details"));

    // One page to fold is "the other page".
    expect(quietLines(renderPages(manyPages(13, 12)))).toEqual([
      "The other page: nothing to note, all read in full",
    ]);
  });

  it("always shows the pages that need attention", () => {
    const earlier = shareRun({
      id: "r1",
      createdAt: "2026-09-25T10:00:00-05:00",
      pages: [done("/failed"), done("/skipped")],
    });
    const quiet = Array.from({ length: 9 }, (_, index) => done(`/quiet-${index + 1}`));
    const latest = shareRun({
      id: "r2",
      pages: [
        ...quiet.slice(0, 3),
        done("/flagged", { flags: [NO_STOPS_FLAG] }),
        ...quiet.slice(3, 6),
        { path: "/failed", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
        { path: "/skipped", status: "skipped" },
        { path: "/never", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
        ...quiet.slice(6),
      ],
    });
    const model = buildShareModel(inputOf([earlier, latest]));
    const html = renderPages(model);
    const [before, inside] = splitAtQuietFold(html);

    expect(model.pages).toHaveLength(13);
    expect(model.pages.filter((card) => card.needsAttention).map((card) => card.path)).toEqual([
      "/flagged",
      "/failed",
      "/skipped",
      "/never",
    ]);
    // Flagged, failed with older transcripts, skipped, and never transcribed: all shown, in page order.
    const shown = cardsIn(before).map(
      (card) => /<span class="num">\d+<\/span> (\S+)</.exec(card)?.[1],
    );
    expect(shown).toEqual(["/flagged", "/failed", "/skipped", "/never"]);
    expect(quietLines(html)).toEqual(["The other 9 pages: nothing to note, all read in full"]);
    expect(cardsIn(inside).every((card) => card.includes("quiet-"))).toBe(true);
    // Their numbers are their places among all 13 pages.
    expect(
      [...before.matchAll(/<span class="num">(\d+)<\/span>/g)].map((found) => found[1]),
    ).toEqual(["4", "8", "9", "10"]);
    // Three of the four have transcripts to fold (the failed and the skipped page show the older
    // run's); the page that was never transcribed has none.
    expect(foldLines(before)).toEqual(["/flagged", "/failed", "/skipped"].map(allThree));
  });

  it("folds nothing when every page needs attention, and everything when none does", () => {
    const flagged = renderPages(
      modelOf(
        Array.from({ length: 13 }, (_, index) => done(`/p-${index}`, { flags: [LINK_FLAG] })),
      ),
    );
    expect(quietLines(flagged)).toEqual([]);
    expect(flagged).not.toContain('<div class="folds">');
    expect(cardsIn(flagged)).toHaveLength(13);

    const quiet = renderPages(manyPages(13, 0));
    expect(quietLines(quiet)).toEqual(["The other 13 pages: nothing to note, all read in full"]);
    // No cards outside the fold: no empty box where they'd be.
    const [outside = ""] = splitAtQuietFold(quiet);
    expect(cardsIn(outside)).toHaveLength(0);
    expect(outside).not.toContain('class="cards"');
  });

  it("shows each page's first lines, word for word", async () => {
    const model = await demoModel();
    const cards = cardsIn(renderPages(model));
    const [home = ""] = cards;

    // The home page's first three lines: under a label that says what they are, in a list a screen
    // reader counts, each in curly quotes, in the order NVDA said them.
    expect(model.pages[0]?.heardFirst).toEqual([
      "banner landmark, voicecap demo",
      "Tour, navigation landmark, list, with 1 item, link, Next: Before you start",
      "out of list, main landmark, heading, level 1, Welcome to the voicecap demo",
    ]);
    expect(home).toContain(
      '<figure class="heard-first"><figcaption>Heard first</figcaption><ol class="said-list" role="list">' +
        "<li>“banner landmark, voicecap demo”</li>" +
        "<li>“Tour, navigation landmark, list, with 1 item, link, Next: Before you start”</li>" +
        "<li>“out of list, main landmark, heading, level 1, Welcome to the voicecap demo”</li>" +
        "</ol></figure>",
    );
    // Every page of the demo has its own, as its card's model gives them, and one list each.
    for (const [index, card] of model.pages.entries()) {
      expect(card.heardFirst, card.path).toHaveLength(3);
      expect(firstLinesIn(cards[index] ?? ""), card.path).toEqual(card.heardFirst);
      expect(cards[index]?.match(/<figure class="heard-first">/g), card.path).toHaveLength(1);
    }

    // A page with fewer lines shows what it has: two, and one.
    const few = modelOf([done("/two"), done("/one")], {
      transcripts: storeOf((slug) => (slug.startsWith("two") ? LESS.two : LESS.one)),
    });
    const [two = "", one = ""] = cardsIn(renderPages(few));
    expect(firstLinesIn(two)).toEqual(LESS.two.read);
    expect(firstLinesIn(one)).toEqual(LESS.one.read);
  });

  it("escapes a first line", async () => {
    const model = withCard(await demoModel(), 0, { heardFirst: ['link, <b> & "x"'] });
    const [home = ""] = cardsIn(renderPages(model));

    // The words NVDA said are text on the page, never taken for markup.
    expect(home).toContain(
      '<figure class="heard-first"><figcaption>Heard first</figcaption><ol class="said-list" role="list">' +
        "<li>“link, &lt;b&gt; &amp; &quot;x&quot;”</li></ol></figure>",
    );
    expect(home).not.toContain("<b>");
    expect(firstLinesIn(home)).toEqual(['link, <b> & "x"']);
  });

  it("folds each page's full transcript into its card", async () => {
    const model = await demoModel();
    const html = renderPages(model);
    const cards = cardsIn(html);

    expect(cards).toHaveLength(7);
    expect(model.appendix.map(({ slug }) => slug)).toEqual(model.pages.map(({ slug }) => slug));
    for (const [index, card] of model.pages.entries()) {
      const markup = cards[index] ?? "";
      const id = `tx-${idFragment(card.slug)}`;
      const sections = markup.split('<section class="tx"').slice(1);

      // The card holds its page's fold: closed, with the id its page's transcripts are known by,
      // and a line that says what's inside, as many transcripts as there are.
      expect(markup, card.path).toContain(` id="pg-${idFragment(card.slug)}">`);
      expect(markup, card.path).toContain(`<details class="fold tx-page" id="${id}"><summary>`);
      expect(markup, card.path).not.toContain(" open>");
      expect(foldLines(markup), card.path).toEqual([allThree(card.path)]);
      expect(markup, card.path).toContain(
        `<summary><span class="what">The full transcript<span class="sr"> of ${esc(card.path)}</span>:</span> <span class="sub">read, headings, and Tab transcripts</span></summary>`,
      );
      // Its three transcripts keep the names the fingerprint check finds them by, and a heading
      // each, one level under the card's own.
      expect(sections, card.path).toHaveLength(3);
      for (const [at, file] of (model.appendix[index]?.files ?? []).entries()) {
        expect(sections[at], card.path).toMatch(
          new RegExp(
            `^ data-run="${file.run}" data-slug="${file.slug}" data-file="${file.name}"><h4>`,
          ),
        );
      }
      expect(markup.match(/<h[1-6]>/g), card.path).toEqual(["<h3>", "<h4>", "<h4>", "<h4>"]);
    }
    // The page's words are in its cards and nowhere else: 7 folds, and 21 transcripts in them.
    expect(foldsIn(html)).toHaveLength(7);
    expect(html.match(/<section class="tx"/g)).toHaveLength(21);

    // A picture is on its card once, and never in the fold: one img[data-file] for each page with a
    // screenshot, whether the page was read or not.
    const run = shareRun({
      id: "r1",
      voicecapVersion: "0.11.0",
      pages: [
        done("/read", { screenshot: TINY_RECORD }),
        done("/also", { screenshot: TINY_RECORD }),
        {
          path: "/never",
          status: "failed",
          failedAttempts: [failedAttempt({ n: 1 })],
          screenshot: TINY_RECORD,
        },
      ],
    });
    const shots = buildShareModel(inputOf([run], { screenshots: picturesOf([run]) }));
    const uri = shots.pages.map(({ screenshot }) =>
      "dataUri" in screenshot ? screenshot.dataUri : "",
    );
    const withPictures = renderPages(shots);

    expect(uri.every((address) => address.startsWith("data:image/jpeg;base64,"))).toBe(true);
    expect(withPictures.match(/<img\b[^>]*\sdata-file="screenshot\.jpg"/g)).toHaveLength(3);
    expect(cardsIn(withPictures).map((card) => attributes(card, "src"))).toEqual([
      [uri[0]],
      [uri[1]],
      [uri[2]],
    ]);
    // Two of the pages have a fold; their pictures are above it.
    expect(foldsIn(withPictures)).toHaveLength(2);
    for (const fold of foldsIn(withPictures)) {
      expect(fold.split("</details>")[0]).not.toContain("<img");
    }
  });

  it("names each page's fold of its transcripts by its page for a screen reader, and looks the same to everyone else", () => {
    const model = manyPages(13, 2);
    const html = renderPages(model);
    const cards = cardsIn(html);
    const heard: string[] = [];

    // 13 pages: two cards in the open, and 11 in the fold of the quiet pages, each with a fold of
    // its own.
    expect(cards).toHaveLength(13);
    for (const markup of cards) {
      const slug = /^ id="pg-([^"]+)"/.exec(markup)?.[1];
      const card = model.pages.find((each) => idFragment(each.slug) === slug);
      const lines = foldLines(markup);

      // The fold in a card says which page it is of, by the card's own path as a screen reader gets
      // it (the path ends at the colon, so "/page-1" isn't taken for "/page-10").
      expect(card, slug).toBeDefined();
      expect(lines, slug).toHaveLength(1);
      expect(lines[0], slug).toContain(` of ${card?.path}:`);
      heard.push(...lines);
    }
    // So no two are alike.
    expect(new Set(heard).size).toBe(13);

    // Sighted, every fold says the same line as before: the words that name the page are set apart
    // for a screen reader (sr), and what is left is the line every card shows.
    const seen = foldSummaries(html).map((line) =>
      textOf(line.replace(/<span class="sr">.*?<\/span>/g, ""), ""),
    );
    expect(seen).toEqual(
      Array.from({ length: 13 }, () => "The full transcript: read, headings, and Tab transcripts"),
    );
  });

  it("has no first lines and no transcript fold for a page never read", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        done("/read"),
        { path: "/failed", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
        { path: "/skipped", status: "skipped" },
      ],
    });
    const model = buildShareModel(inputOf([run]));
    const [read = "", ...unread] = cardsIn(renderPages(model));

    // The ring counts the two as not read, and neither one's card has the lines or the fold.
    expect(model.ring.notRead).toBe(2);
    expect(model.pages.map((card) => card.heardFirst.length)).toEqual([3, 0, 0]);
    expect(unread).toHaveLength(2);
    for (const card of unread) {
      expect(card).not.toContain("heard-first");
      expect(card).not.toContain("Heard first");
      expect(card).not.toContain("tx-page");
      expect(card).not.toContain("The full transcript");
      expect(card).not.toContain("<details");
      expect(card).not.toContain("<section");
    }
    // The page that was read has both.
    expect(read).toContain('class="heard-first"');
    expect(read).toContain('class="fold tx-page"');
  });

  it("says in the first line how many pages were read, and how many weren't", async () => {
    const gist = (html: string) => /<p class="gist">(.*?)<\/p>/s.exec(html)?.[1];

    expect(gist(renderPages(await demoModel()))).toBe(
      "<b>7 pages: 6 read in full and 1 failed in the latest run.</b> For each page: its result, the person&#39;s review as far as the records show it, and what each pass captured.",
    );
    expect(gist(renderPages(manyPages(3, 1)))).toContain("<b>3 pages, all read in full.</b>");
    expect(gist(renderPages(manyPages(1, 0)))).toContain("<b>1 page, read in full.</b>");
    // Each kind of result, counted once: /b failed after being read earlier, /c and /d were
    // skipped (only /c was read earlier), and /e failed without ever being read.
    const earlier = shareRun({
      id: "r1",
      createdAt: "2026-09-25T10:00:00-05:00",
      pages: [done("/b"), done("/c")],
    });
    const mixed = shareRun({
      id: "r2",
      pages: [
        done("/a"),
        { path: "/b", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
        { path: "/c", status: "skipped" },
        { path: "/d", status: "skipped" },
        { path: "/e", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
      ],
    });
    expect(gist(renderPages(buildShareModel(inputOf([earlier, mixed]))))).toContain(
      "<b>5 pages: 1 read in full, 1 failed in the latest run, 2 skipped in the latest run, and 1 never transcribed.</b>",
    );
  });

  it("never counts a page whose read stopped before its end as read in full", () => {
    const gist = (html: string) => /<p class="gist">(.*?)<\/p>/s.exec(html)?.[1];
    const model = modelOf([
      done("/a"),
      done("/b", { stopped: { read: "step-cap" } }),
      done("/c", { stopped: { read: "repeat-limit" } }),
    ]);
    const html = renderPages(model);

    expect(gist(html)).toContain(
      "<b>3 pages: 1 read in full and 2 transcribed but not in full.</b>",
    );
    expect(gist(renderPages(modelOf([done("/b", { stopped: { read: "step-cap" } })])))).toContain(
      "<b>1 page: 1 transcribed but not in full.</b>",
    );
    // Each such card says why in its first chip, amber, as something to note.
    const [, second = ""] = cardsIn(html);
    expect(second).toContain(
      '<div class="chips"><span class="chip c-warn">Transcribed; its read stopped at the step limit</span>',
    );
  });

  it("says there are no pages when no run counts, and still names its section", () => {
    const html = renderPages(noRunModel());

    expect(html).toContain('<h2 id="pages-h">Every page</h2>');
    expect(html).toContain(
      '<p class="gist"><b>No live run counts yet.</b> There are no pages to show.</p>',
    );
    expect(html).not.toContain("<article");
    expect(html).not.toContain("No longer listed");
  });

  it("says when the latest run listed no pages", () => {
    const run = shareRun({ id: "r1", pages: [] });
    const html = renderPages(buildShareModel(inputOf([run])));

    expect(html).toContain('<p class="gist"><b>The latest run listed no pages.</b></p>');
    expect(html).not.toContain("<article");
  });
});

describe("a card's full transcript", () => {
  it("shows each transcript as the mockup does: its pass, size, fingerprint, and words, in a scroll box", async () => {
    const model = await demoModel();
    const [home = ""] = cardsIn(renderPages(model));
    const [entry] = model.appendix;
    const sections = home.split('<section class="tx"').slice(1);

    expect(sections).toHaveLength(3);
    for (const [index, file] of (entry?.files ?? []).entries()) {
      const title = ["Read", "Headings", "Tab"][index];
      // Each names its file, for the fingerprint check to compare the text shown with it.
      expect([file.run, file.slug]).toEqual(["2026-09-29_1402", "home"]);
      expect(sections[index]).toMatch(
        new RegExp(`^ data-run="${file.run}" data-slug="${file.slug}" data-file="${file.name}">`),
      );
      const lines = file.lines === 1 ? "1 line" : `${file.lines} lines`;
      const bytes = file.bytes.toLocaleString("en-US");
      // The heading names the page too, for a reader going from heading to heading, who would
      // otherwise hear "Read", "Headings", and "Tab" for every page alike.
      expect(sections[index]).toContain(
        `<h4>${title} <span class="sr">transcript of /</span> <span class="sub">${lines}</span></h4>`,
      );
      // The size and the fingerprint are the whole file's, from the run's record: its header too.
      expect(sections[index]).toContain(
        `<p class="fp">The whole file, its header included: ${bytes} bytes, SHA-256 <code>${file.sha256}</code></p>`,
      );
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      // The words, as the TXT has them, in a box that scrolls and a screen reader can reach.
      expect(sections[index]).toContain(
        `<div class="scroll" tabindex="0" role="region" aria-label="${title} transcript, /"><pre>${esc(file.text)}</pre></div></section>`,
      );
    }
    expect(sections[0]).toContain(
      '<h4>Read <span class="sr">transcript of /</span> <span class="sub">18 lines</span></h4>',
    );
    expect(sections[0]).toContain("The whole file, its header included: 2,306 bytes, SHA-256");
    expect(sections[0]).toContain(
      "f30b29d0b01e47a5e2eb629251018fd09b8392197d46fc64277c574ebef365fe",
    );
    // The run the transcripts are from comes first in the fold, then the transcripts.
    expect(home.indexOf('<p class="fp">From run')).toBeGreaterThan(home.indexOf("<summary>"));
    expect(home.indexOf('<p class="fp">From run')).toBeLessThan(
      home.indexOf('<section class="tx"'),
    );
    // One h4 for each pass, under the card's own h3, and no h2 or h1 in a fold.
    expect(home.match(/<h[1-6]>/g)).toEqual(["<h3>", "<h4>", "<h4>", "<h4>"]);
  });

  it("shows a transcript's </script> and <b> as text", () => {
    const hostile = [
      "</script><script>alert(1)</script>",
      "<b>bold</b> & \"quoted\" 'single' <!-- comment -->",
      "&lt;already escaped&gt; &amp;",
      "<img src=x onerror=alert(1)>",
    ];
    const model = modelOf([done("/a")], {
      transcripts: storeOf(() => ({ read: hostile, headings: hostile.slice(0, 1), tab: ["<b>"] })),
    });
    const html = renderPages(model);
    const text = hostile.join("\n");

    // The box holds the transcript's text, escaped, and a browser would show it exactly as written.
    const [pre = ""] = /<pre>(.*?)<\/pre>/s.exec(html)?.slice(1) ?? [];
    expect(pre).toContain("&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(pre).toContain(
      "&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot; &#39;single&#39; &lt;!-- comment --&gt;",
    );
    expect(pre).toContain("&amp;lt;already escaped&amp;gt; &amp;amp;");
    expect(decode(pre)).toBe(text);
    // The first lines are the same words, shown as text too.
    expect(html).toContain("<li>“&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;”</li>");
    expect(firstLinesIn(html)).toEqual(hostile.slice(0, 3));
    // Nothing in the page is made of it.
    expect(html).not.toContain("</script>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<!--");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror=alert(1)>");
    expect(html.match(/<b>/g)).toHaveLength(1);
  });

  it("keeps a transcript's leading blank line, which a browser would drop after <pre>", () => {
    const model = modelOf([done("/a")], {
      transcripts: storeOf(() => ({ read: ["", "first", "last"] })),
    });
    const [pre = ""] = /<pre>(.*?)<\/pre>/s.exec(renderPages(model))?.slice(1) ?? [];

    // A browser drops the first newline after <pre>, so a blank first line needs one more.
    expect(pre).toBe("\n\nfirst\nlast");
  });

  it("gives every scroll box a name and a Tab stop", async () => {
    const earlier = shareRun({
      id: "r1",
      createdAt: "2026-09-25T10:00:00-05:00",
      pages: [done("/gone"), done("/a")],
    });
    const latest = shareRun({
      id: "r2",
      pages: [done("/a", { flags: [LINK_FLAG] }), done("/b", { flags: [NO_STOPS_FLAG] })],
    });
    const models = [await demoModel(), buildShareModel(inputOf([earlier, latest]))];
    const tableCounts: number[] = [];

    for (const model of models) {
      const html = renderPages(model);
      const boxes = scrollBoxes(html);
      const tables = (html.match(/<table /g) ?? []).length;
      const transcripts = model.appendix.reduce((sum, page) => sum + page.files.length, 0);
      tableCounts.push(tables);

      // A box for each table and each transcript.
      expect(boxes).toHaveLength(tables + transcripts);
      expect(transcripts).toBeGreaterThan(0);
      for (const box of boxes) {
        expect(box).toMatch(/ tabindex="0"/);
        expect(box).toMatch(/ role="region"/);
        expect(box).toMatch(/ aria-label="[^"]+"/);
      }
      // Each name is its own, so a screen reader's list of landmarks tells them apart.
      const names = attributes(boxes.join(""), "aria-label");
      expect(new Set(names).size).toBe(names.length);
      // Each transcript's words are only ever in one.
      expect(html.match(/<pre>/g)).toHaveLength(transcripts);
      expect(html.match(/<div class="scroll"[^>]*><pre>/g)).toHaveLength(transcripts);
    }
    // The pages no longer listed are a table in a box of their own, which the second model has, so
    // this is no count of boxes that hold no table.
    expect(tableCounts).toEqual([0, 1]);
  });

  it("names the passes a page's fold has, as many as it has", () => {
    const only = (pass: PassName[]) =>
      modelOf([done("/a", { files: pass.map((each) => `${each}.txt`) })]);
    const summary = (model: ShareModel) => foldLines(renderPages(model))[0];

    expect(summary(only(["read", "headings", "tab"]))).toBe(allThree("/a"));
    expect(summary(only(["read", "tab"]))).toBe(
      "The full transcript of /a: read and Tab transcripts",
    );
    expect(summary(only(["headings"]))).toBe("The full transcript of /a: headings transcript");
    // A page whose record lists no transcript says so, rather than offer an empty fold.
    const none = modelOf([done("/a", { files: [] })]);
    expect(summary(none)).toBe("The full transcript of /a: no transcripts");
    expect(renderPages(none)).toContain(
      "<p>This run&#39;s record lists no transcript files for the page.</p>",
    );
  });

  it("keeps a transcript it can't read in the fold, said in words", () => {
    const model = modelOf([done("/a")], {
      transcripts: storeOf(() => ({ read: LINES.read, headings: LINES.headings })),
    });
    const html = renderPages(model);
    const sections = html.split('<section class="tx"').slice(1);

    expect(model.appendix[0]?.unreadable).toEqual(["tab"]);
    expect(sections).toHaveLength(3);
    // In the Tab transcript's own place, under its own heading.
    expect(sections[2]).toContain(
      `<h4>Tab <span class="sr">transcript of /a</span></h4><p>This transcript was recorded, but its file couldn&#39;t be read here, so it isn&#39;t shown, and the fingerprint check leaves it out.</p>`,
    );
    expect(sections[2]).not.toContain("<pre>");
    expect(sections[2]).not.toContain("scroll");
    // The fold still says what the page has.
    expect(foldLines(html)).toEqual([allThree("/a")]);
    // A page whose read transcript can't be read has its fold, all three said, and no first lines:
    // there is nothing to quote.
    const gone = renderPages(modelOf([done("/a")], { transcripts: storeOf(() => ({})) }));
    expect(gone.match(/couldn&#39;t be read here/g)).toHaveLength(3);
    expect(foldLines(gone)).toEqual([allThree("/a")]);
    expect(gone).not.toContain("heard-first");
    expect(gone).not.toContain("Heard first");
  });

  it("says a transcript with no lines has none, rather than show an empty box", () => {
    const model = modelOf([done("/a")], {
      transcripts: storeOf(() => ({ read: LINES.read, headings: [], tab: LINES.tab })),
    });
    const sections = renderPages(model).split('<section class="tx"').slice(1);

    expect(sections[1]).toContain(
      '<h4>Headings <span class="sr">transcript of /a</span> <span class="sub">0 lines</span></h4>',
    );
    expect(sections[1]).toContain("The whole file, its header included: 1 byte, SHA-256");
    expect(sections[1]).toContain('<p class="sub">This transcript has no lines.</p>');
    expect(sections[1]).not.toContain("<pre>");
    expect(sections[0]).toContain("<pre>");
  });

  it("counts a transcript of one line in the singular", () => {
    const model = modelOf([done("/a")], {
      transcripts: storeOf(() => ({
        read: ["Only line"],
        headings: LINES.headings,
        tab: LINES.tab,
      })),
    });
    const [first = ""] = renderPages(model).split('<section class="tx"').slice(1);

    expect(first).toContain(
      '<h4>Read <span class="sr">transcript of /a</span> <span class="sub">1 line</span></h4>',
    );
  });

  it("names the run the transcripts are from, and none for the latest run when the model has none", async () => {
    const model = await demoModel();
    const html = renderPages(model);
    const bare = renderPages({ ...model, evidence: [] });
    const cards = cardsIn(html);

    // Run 1402 failed /how-a-run-works/, so its fold is run 1315's, dated; the others are the latest.
    expect(cards[2]).toContain(
      '<p class="fp">From run <code>2026-09-29_1315</code>, on 29 September 2026</p>',
    );
    expect(cards[0]).toContain('<p class="fp">From run <code>2026-09-29_1402</code></p>');
    expect(html.match(/class="fp">From run/g)).toHaveLength(7);
    // With no latest run to name, the page that failed still says the older run it is from.
    expect(bare.match(/class="fp">From run/g)).toHaveLength(1);
    expect(bare).toContain('<p class="fp">From run <code>2026-09-29_1315</code>');
    // Nothing stands in for the line: the first page's transcripts start its fold's inside.
    expect(foldsIn(bare)[0]).toContain(
      '<div class="inside"><section class="tx" data-run="2026-09-29_1402" data-slug="home" data-file="read.txt"><h4>Read',
    );
  });

  it("numbers each page as its card does, and names each box by its path", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        { path: "/never", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
        done("/read", { label: "The <read> page" }),
      ],
    });
    const model = buildShareModel(inputOf([run]));
    const html = renderPages(model);
    const [never = "", read = ""] = cardsIn(html);

    // The page that has transcripts is the second page: its fold is in its card, which has its number.
    expect(read).toContain(
      '<h3><span class="num">2</span> The &lt;read&gt; page <span class="sub">/read</span></h3>',
    );
    expect(read).toContain(`id="tx-${idFragment(model.pages[1]?.slug ?? "")}"`);
    expect(never).not.toContain("<details");
    expect(html).toContain('aria-label="Read transcript, /read"');
    expect(html).not.toContain("The <read>");
  });
});

describe("the cards together", () => {
  /** A page whose address, label, and title are all markup, and one that was never read. */
  const oddModel = (): ShareModel =>
    modelOf([
      done("/a?b=<c>&d='e'", {
        label: '<i>"A"</i>',
        title: "</title><script>alert(1)</script>",
        flags: [LINK_FLAG, NO_STOPS_FLAG],
      }),
      { path: "/b", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
    ]);

  /** Each model, to draw the section from. */
  const models = async (): Promise<[string, ShareModel][]> => [
    ["the demo's", await demoModel()],
    ["thirteen pages", manyPages(13, 5)],
    ["no counted run", noRunModel()],
    ["odd words", oddModel()],
  ];

  it("never sets a style attribute, loads nothing, and has no link", async () => {
    for (const [name, model] of await models()) {
      const html = renderPages(model);

      expect(html, name).not.toMatch(/\sstyle\s*=/i);
      expect(html, name).not.toMatch(/<(?:script|style|link|iframe)[\s>]/i);
      expect(html, name).not.toMatch(/\ssrc\s*=/i);
      // A card links to nothing: its transcripts are in the card, and an address is what opens them.
      expect(attributes(html, "href"), name).toEqual([]);
    }
  });

  it("gives every id once, and no link to a place that isn't there", async () => {
    for (const [name, model] of await models()) {
      const html = renderPages(model);
      const ids = attributes(html, "id");

      expect(new Set(ids).size, name).toBe(ids.length);
      // The section has no link, so none can go nowhere.
      expect(attributes(html, "href"), name).toEqual([]);
      // The section's id, each page's card, and each page's fold of its transcript. The folds are
      // in the markup's order, which isn't the page's when the fold of the quiet pages puts the
      // cards in the open first, so the two lists are compared sorted.
      expect(ids, name).toContain("pages-h");
      for (const card of model.pages) expect(ids, name).toContain(`pg-${idFragment(card.slug)}`);
      expect(ids.filter((id) => id.startsWith("tx-")).sort(), name).toEqual(
        model.appendix.map(({ slug }) => `tx-${idFragment(slug)}`).sort(),
      );
    }
  });

  it("keeps the section's h2 outside every fold, and no heading in a summary line", async () => {
    for (const [name, model] of await models()) {
      const html = renderPages(model);

      // One h2, before any fold.
      expect(html.match(/<h2[ >]/g), name).toHaveLength(1);
      expect(html.indexOf("<h2"), name).toBeLessThan(
        html.includes("<details") ? html.indexOf("<details") : Infinity,
      );
      // A card's page is an h3, and each transcript in its fold an h4, one for every transcript.
      expect(html, name).not.toMatch(/<h[156][ >]/);
      expect(html.match(/<h4>/g)?.length ?? 0, name).toBe(
        html.match(/<section class="tx"/g)?.length ?? 0,
      );
      // Headings go down a level at a time from the page's h1, so no transcript's is under
      // anything but a card's.
      const levels = [...html.matchAll(/<h([1-6])[ >]/g)].map(([, level]) => Number(level));
      levels.forEach((level, index) => {
        const step = level - (levels[index - 1] ?? 1);
        expect(step, `${name}: heading ${index + 1}`).toBeLessThanOrEqual(1);
      });
      for (const found of html.matchAll(/<summary>(.*?)<\/summary>/gs)) {
        expect(found[1], name).not.toMatch(/<h[1-6][\s>]|role="?heading/);
      }
    }
  });

  it("says a chip's meaning in words, never by color alone", async () => {
    for (const [name, model] of await models()) {
      const html = renderPages(model);
      const chips = [...html.matchAll(/<span class="chip c-(\w+)">(.*?)<\/span>/g)];

      for (const [, kind, words] of chips) {
        expect(["ok", "warn", "bad", "quiet"], name).toContain(kind);
        expect(textOf(words ?? ""), name).not.toBe("");
      }
    }
  });

  it("is made of the model's own words, escaped, and nothing from the mockup's sample data", async () => {
    for (const [name, model] of await models()) {
      const html = renderPages(model);

      expect(html, name).not.toContain('class="mock"');
      expect(html, name).not.toContain("sample:");
    }
    // A page's own words can't make markup: not its address, label, or title.
    const html = renderPages(oddModel());
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<i>");
    expect(html).toContain("Title: &lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  /** Markup, a quote, and an ampersand: wherever a record's words are shown, they're only text. */
  const MARKUP = `<x y="1">&'</x>`;
  const marked = (field: string): string => `${MARKUP}${field}`;

  /**
   * A model with every word a record can supply (the model's strings, in a card, a flag, the pages
   * no longer listed, and a card's transcripts) made of markup, each marked with the field it's in.
   */
  function markupModel(): ShareModel {
    const earlier = shareRun({
      id: "r1",
      createdAt: "2026-09-25T10:00:00-05:00",
      pages: [done("/gone"), done("/failed", { flags: [LINK_FLAG] })],
    });
    const latest = shareRun({
      id: "r2",
      pages: [
        done("/", { flags: [LINK_FLAG, NO_STOPS_FLAG] }),
        { path: "/failed", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
      ],
    });
    const model = buildShareModel(inputOf([earlier, latest]));
    const [evidence, ...earlierEvidence] = model.evidence;
    const [home, failed] = model.pages.map((card, index): PageCard => {
      if (index === 0) {
        return {
          ...card,
          name: marked("name"),
          // A page with a label of its own is headed by it, with its path beside it.
          labeled: true,
          path: marked("path"),
          title: marked("title"),
          statusText: marked("status"),
          reviewChips: [marked("review")],
          manual: [{ at: marked("at"), reviewer: marked("reviewer") }],
          screenshot: { dataUri: marked("uri"), alt: marked("alt"), width: 632, height: 419 },
          failure: marked("failure"),
          heardFirst: [marked("first")],
          flags: [{ rule: marked("flag"), message: "m" }],
        };
      }
      return {
        ...card,
        from: { run: marked("run"), date: marked("date") },
        title: { notRecorded: marked("untitled") },
        screenshot: { notRecorded: marked("shot") },
        flags: [{ rule: marked("flag2"), message: "m" }],
      };
    });
    if (!home || !failed || !evidence) throw new Error("The fixture lost a page or a run.");
    return {
      ...model,
      pages: [home, failed],
      noLongerListed: [
        {
          name: marked("gone"),
          url: marked("url"),
          lastRun: marked("lastRun"),
          lastStatus: marked("lastStatus"),
        },
      ],
      appendix: [
        {
          slug: home.slug,
          name: home.name,
          files: [
            {
              pass: "read",
              run: marked("fileRun"),
              slug: marked("fileSlug"),
              name: "read.txt",
              text: marked("words"),
              lines: 1,
              bytes: 9,
              sha256: marked("sha"),
            },
          ],
          unreadable: ["tab"],
        },
        {
          slug: failed.slug,
          name: failed.name,
          files: [
            {
              pass: "headings",
              run: marked("fileRun2"),
              slug: marked("fileSlug2"),
              name: "headings.txt",
              text: marked("words2"),
              lines: 1,
              bytes: 9,
              sha256: marked("sha2"),
            },
          ],
          unreadable: [],
        },
      ],
      evidence: [
        { ...evidence, run: { ...evidence.run, id: marked("latest") } },
        ...earlierEvidence,
      ],
    };
  }

  it("makes text of every word a record supplies, wherever it's shown", () => {
    const html = renderPages(markupModel());
    const fields = [
      ...["name", "path", "title", "status", "review", "at", "reviewer", "uri", "alt", "failure"],
      ...["first", "run", "date", "untitled", "shot", "flag", "flag2", "gone", "url", "lastRun"],
      ...["lastStatus", "words", "sha", "words2", "sha2", "latest"],
      ...["fileRun", "fileSlug", "fileRun2", "fileSlug2"],
    ];

    // None of it is markup, and every word of it is shown, escaped, somewhere.
    expect(html.match(/.{0,30}<x.{0,30}/g) ?? []).toEqual([]);
    for (const field of fields) expect(html, field).toContain(esc(marked(field)));
  });
});
