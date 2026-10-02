/**
 * The shareable page's "Every page", "What the flags found", and "Appendix: every transcript". The
 * demo runs of 29 September 2026 (voicecap 0.4.1, in test/fixtures/share/) are the real case; runs
 * built in memory, with their transcripts held in memory too, cover the rest. The tests are on the
 * markup: it is the mockup's, so its classes and its order are the contract.
 */
import { describe, expect, it } from "vitest";

import type { FlagResult, PassName, RunJson } from "../src/model.js";
import { esc, idFragment } from "../src/report/html.js";
import { renderAppendix, renderFlags, renderPages } from "../src/share/html/pages.js";
import type { ShareInput } from "../src/share/load.js";
import { buildShareModel, type PageCard, type ShareModel } from "../src/share/model.js";
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
  storeOf,
  TRANSCRIPTS,
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

const LINK_FLAG: FlagResult = {
  rule: "generic-link-text",
  pass: "read",
  count: 1,
  found: [{ text: "click here", count: 1 }],
  message: 'Generic link text announced 1 time in the read pass: "click here" ×1.',
};

const HEADINGS_FLAG: FlagResult = {
  rule: "headings",
  pass: "headings",
  message: "The first heading is level 2, not level 1.",
};

/** A flag that has no line of NVDA's to quote: Tab reached nothing. */
const NO_STOPS_FLAG: FlagResult = {
  rule: "tab-no-stops",
  pass: "tab",
  message: "Tab reached no focusable elements on the page.",
};

/** `total` pages read in full, the first `flagged` of them with flags. */
function manyPages(total: number, flagged: number): ShareModel {
  return modelOf(
    Array.from({ length: total }, (_, index) =>
      done(`/page-${index + 1}`, index < flagged ? { flags: [LINK_FLAG, HEADINGS_FLAG] } : {}),
    ),
  );
}

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

  it("shows a card as the mockup's: its path, result, flags, review, counts, time, strip, and link", async () => {
    const model = await demoModel();
    const html = renderPages(model);
    const cards = cardsIn(html);
    const flagged = cards[6] ?? "";

    expect(cards).toHaveLength(7);
    expect(model.pages[6]?.path).toBe("/common-mistakes/");
    // The mockup's seventh card, in its order: the heading, the chips, the four numbers, the strip, the link.
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
    expect(flagged).toContain(
      '<a class="more" href="#tx-common-mistakes-db8c98dbfa" aria-label="Transcripts and fingerprints for /common-mistakes/">Transcripts and fingerprints</a>',
    );
    // One bar for each line NVDA spoke in the read pass, as the strip's own words say.
    expect(flagged.match(/<rect /g)).toHaveLength(22);
    expect(flagged).toContain("Read pass: 22 lines over");
    // The order the mockup has: heading, chips, numbers, strip, link.
    const order = ["<h3>", 'class="chips"', 'class="passes"', 'class="strip-fig"', 'class="more"'];
    expect(order.map((part) => flagged.indexOf(part))).toEqual(
      order.map((part) => flagged.indexOf(part)).sort((a, b) => a - b),
    );

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
    expect(cardsIn(renderPages(model))[1]).not.toMatch(/Heard|Reviewed|Issue found/);
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

  it("shows the screenshot, or says it wasn't recorded", async () => {
    const model = await demoModel();
    const uri = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    const shot = withCard(model, 0, {
      screenshot: { dataUri: uri, alt: 'Screenshot of "/" as tested' },
    });
    const [card = ""] = cardsIn(renderPages(shot));

    // The mockup's picture: first in the card, sized for the layout, loaded when scrolled to.
    expect(card).toMatch(
      new RegExp(
        `^ id="pg-[^"]+">\\s*<img src="${uri}" alt="Screenshot of &quot;/&quot; as tested" width="640" height="480" loading="lazy">\\s*<div class="card-body">`,
      ),
    );
    expect(card).not.toContain("not-recorded");

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
    // The older run's counts, time, and strip, with the link to the transcripts it shows.
    expect(failed).toContain(
      "<dd>18 lines</dd></div><div><dt>Headings</dt><dd>4</dd></div><div><dt>Tab stops</dt><dd>3</dd></div><div><dt>Time</dt><dd>51.5 s</dd>",
    );
    expect(failed.match(/<rect /g)).toHaveLength(18);
    expect(failed).toContain('href="#tx-how-a-run-works-fd116f9328"');
    // The page read in the latest run says neither.
    expect(cards[0]).not.toContain("From run");
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
      'class="passes"',
      'class="strip-fig"',
      'class="more"',
    ];
    const places = parts.map((part) => card.indexOf(part));

    expect(places.every((place) => place >= 0)).toBe(true);
    // The picture's place first, as the mockup's picture is, then the card's words in this order.
    expect(places).toEqual([...places].sort((a, b) => a - b));
  });

  it("leaves out the strip and the link a page has nothing for", async () => {
    const model = await demoModel();
    const [bare = ""] = cardsIn(renderPages(withCard(model, 0, { strip: [] })));
    const [cut = ""] = cardsIn(
      renderPages({ ...model, appendix: model.appendix.filter(({ slug }) => slug !== "home") }),
    );

    // No lines, no strip: a strip of no lines would say "no lines" of a page that has some.
    expect(bare).not.toContain("strip-fig");
    expect(bare).toContain('<a class="more"');
    // A page with no transcripts in the appendix has nothing to link to.
    expect(cut).not.toContain('class="more"');
    expect(cut).toContain("strip-fig");
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
    const twelve = renderPages(manyPages(12, 2));
    const thirteen = renderPages(manyPages(13, 2));

    expect(cardsIn(twelve)).toHaveLength(12);
    expect(twelve).not.toContain("<details");
    expect(twelve).not.toContain("The other");

    // At 13, the 11 with nothing to note fold behind one line, closed, with their cards inside.
    expect(foldsIn(thirteen)).toHaveLength(1);
    expect(summariesIn(thirteen)).toEqual([
      "The other 11 pages: nothing to note, all read in full",
    ]);
    expect(thirteen).toContain(
      '<div class="folds"><details class="fold"><summary><span class="what">The other 11 pages:</span> <span class="sub">nothing to note, all read in full</span></summary>',
    );
    const [before = "", inside = ""] = thirteen.split("<details");
    expect(cardsIn(before)).toHaveLength(2);
    expect(cardsIn(inside)).toHaveLength(11);
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
    expect(summariesIn(renderPages(manyPages(13, 12)))).toEqual([
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
    const [before = "", inside = ""] = html.split("<details");

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
    expect(summariesIn(html)).toEqual(["The other 9 pages: nothing to note, all read in full"]);
    expect(cardsIn(inside).every((card) => card.includes("quiet-"))).toBe(true);
    // Their numbers are their places among all 13 pages.
    expect(
      [...before.matchAll(/<span class="num">(\d+)<\/span>/g)].map((found) => found[1]),
    ).toEqual(["4", "8", "9", "10"]);
  });

  it("folds nothing when every page needs attention, and everything when none does", () => {
    const flagged = renderPages(
      modelOf(
        Array.from({ length: 13 }, (_, index) => done(`/p-${index}`, { flags: [LINK_FLAG] })),
      ),
    );
    expect(flagged).not.toContain("<details");
    expect(cardsIn(flagged)).toHaveLength(13);

    const quiet = renderPages(manyPages(13, 0));
    expect(summariesIn(quiet)).toEqual(["The other 13 pages: nothing to note, all read in full"]);
    // No cards outside the fold: no empty box where they'd be.
    expect(cardsIn(quiet.split("<details")[0] ?? "")).toHaveLength(0);
    expect(quiet.split("<details")[0]).not.toContain('class="cards"');
  });

  it("links each card to its transcripts in the appendix", async () => {
    for (const model of [await demoModel(), manyPages(3, 1)]) {
      const pages = renderPages(model);
      const appendix = renderAppendix(model);
      const cards = cardsIn(pages);

      expect(cards).toHaveLength(model.pages.length);
      for (const [index, card] of model.pages.entries()) {
        const target = `tx-${idFragment(card.slug)}`;
        expect(cards[index]).toContain(`href="#${target}"`);
        // The link goes to a fold of the appendix, which opens when a link points to it.
        expect(appendix).toContain(`<details class="fold" id="${target}">`);
      }
    }
    // A page never transcribed has no transcripts to link to, and no fold of its own.
    const run = shareRun({
      id: "r1",
      pages: [
        done("/a"),
        { path: "/b", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
      ],
    });
    const model = buildShareModel(inputOf([run]));
    const [first = "", second = ""] = cardsIn(renderPages(model));
    expect(first).toContain(`href="#tx-${idFragment(model.pages[0]?.slug ?? "")}"`);
    expect(second).not.toContain("#tx-");
    expect(renderAppendix(model)).not.toContain(`tx-${idFragment(model.pages[1]?.slug ?? "")}`);
  });

  it("says in the first line how many pages were read, and how many weren't", async () => {
    const gist = (html: string) => /<p class="gist">(.*?)<\/p>/s.exec(html)?.[1];

    expect(gist(renderPages(await demoModel()))).toBe(
      "<b>7 pages: 6 read in full and 1 failed in the latest run.</b> For each page: its result, the person's review as far as the records show it, and what each pass captured.",
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

describe("renderFlags", () => {
  it("quotes NVDA's own words for each rule of a flagged page, as the mockup's table does", async () => {
    const model = await demoModel();
    const html = renderFlags(model);
    const [flagged] = model.flagged;

    expect(html).toMatch(/^<section aria-labelledby="find-h">\s*<h2 id="find-h">/);
    expect(html).toContain('<h2 id="find-h">What the flags found</h2>');
    expect(html).toContain(
      '<p class="gist"><b>1 page has flags, from 3 rules.</b> Flags point a person to pages worth a closer listen. Each quotes what NVDA actually said.</p>',
    );
    // One page: its fold is open, behind the line that names it, with its five flags and its rules.
    expect(html).toContain(
      '<div class="folds"><details class="fold" open><summary><span class="what">http://127.0.0.1:4848/common-mistakes/:</span> <span class="sub">5 flags</span> ' +
        '<span class="chips"><span class="chip c-warn">generic-link-text</span><span class="chip c-warn">unlabeled</span><span class="chip c-warn">headings</span></span></summary>',
    );
    expect(html).toContain(
      '<div class="scroll" tabindex="0" role="region" aria-label="Flags table, /common-mistakes/"><table class="plain"><caption class="sr">Flags on /common-mistakes/</caption>',
    );
    expect(textOf(/<thead>(.*?)<\/thead>/s.exec(html)?.[1] ?? "")).toBe(
      "Rule What NVDA showed NVDA said",
    );
    expect(html.match(/<th scope="col">/g)).toHaveLength(3);

    // A row for each rule: the rule as a chip, what it found, and the lines NVDA spoke, in the model's order.
    const rows = [
      ...html.matchAll(
        /<tr><th scope="row">(.*?)<\/th><td>(.*?)<\/td><td class="said">(.*?)<\/td><\/tr>/g,
      ),
    ];
    expect(flagged?.quotes).toHaveLength(3);
    expect(rows).toHaveLength(3);
    for (const [index, quote] of (flagged?.quotes ?? []).entries()) {
      const [, rule = "", found = "", said = ""] = rows[index] ?? [];
      expect(rule).toBe(`<span class="chip c-warn">${esc(quote.rule)}</span>`);
      expect(found).toBe(esc(quote.text));
      // Each line in quotes, and a pause between them for a screen reader.
      expect(said).toBe(
        quote.said.map((line) => `<code>“${esc(line)}”</code>`).join('<span class="sr">;</span> '),
      );
      expect(quote.said.length).toBeGreaterThan(0);
    }
    expect(rows.map((row) => textOf(row[3] ?? "", ""))).toEqual([
      "“To see how a run works,, link, click here, dot”; “To read about transcripts,, link, click here, dot”; “To learn about the report,, link, click here, dot”",
      "“button”; “main landmark. edit, blank”",
      "“main landmark, Common mistakes (on purpose), heading, level 2”",
    ]);
  });

  it("folds the flag quotes at 4 flagged pages, never at 3", () => {
    const three = renderFlags(manyPages(5, 3));
    const four = renderFlags(manyPages(5, 4));

    // At 3, no page's quotes are folded away: each is open.
    expect(foldsIn(three)).toHaveLength(3);
    expect(three.match(/<details class="fold" open>/g)).toHaveLength(3);

    // At 4, each is folded, closed, behind its page's name and its number of flags.
    expect(foldsIn(four)).toHaveLength(4);
    expect(four).not.toContain(" open>");
    expect(four.match(/<details class="fold">/g)).toHaveLength(4);
    expect(summariesIn(four)).toEqual(
      [1, 2, 3, 4].map(
        (n) => `https://example.illinois.gov/page-${n}: 2 flags generic-link-text headings`,
      ),
    );
    expect(four).toContain(
      '<summary><span class="what">https://example.illinois.gov/page-1:</span> <span class="sub">2 flags</span>',
    );
    // The quotes are still all there, a click away, and the unflagged page isn't.
    expect(four.match(/<table class="plain">/g)).toHaveLength(4);
    expect(four).not.toContain("page-5");
    expect(four).toContain("<b>4 pages have flags, from 2 rules.</b>");
    expect(three).toContain("<b>3 pages have flags, from 2 rules.</b>");
  });

  it("counts a page's flags in the singular, and its rules once each", () => {
    const html = renderFlags(modelOf([done("/a", { flags: [LINK_FLAG] })]));

    expect(html).toContain('<span class="sub">1 flag</span>');
    expect(html).toContain("<b>1 page has flags, from 1 rule.</b>");
    // The same rule in two passes is one row.
    const twice = renderFlags(
      modelOf([done("/a", { flags: [LINK_FLAG, { ...LINK_FLAG, pass: "tab" }] })]),
    );
    expect(twice).toContain('<span class="sub">2 flags</span>');
    expect(twice.match(/<tr><th scope="row">/g)).toHaveLength(1);
  });

  it("says what a rule found without a quote when it has no line to quote", () => {
    const model = modelOf([done("/a", { flags: [LINK_FLAG, NO_STOPS_FLAG] })]);
    const [flagged] = model.flagged;
    const html = renderFlags(model);
    const rows = [...html.matchAll(/<tr><th scope="row">.*?<\/tr>/g)].map((found) => found[0]);

    expect(flagged?.quotes.map((quote) => quote.said.length > 0)).toEqual([true, false]);
    expect(rows).toHaveLength(2);
    // Tab reaching nothing: its row says what the rule found, and that there is no line to quote.
    expect(rows[1]).toBe(
      '<tr><th scope="row"><span class="chip c-warn">tab-no-stops</span></th><td>Tab reaches nothing on the page.</td><td class="said"><span class="sub">No line to quote</span></td></tr>',
    );
    // Never an empty quote.
    expect(html).not.toContain("<code></code>");
    expect(html).not.toContain("“”");
  });

  it("escapes the names, rules, and words it quotes", () => {
    const custom: FlagResult = { rule: "<rule> & co", message: "It matched <b>this</b>." };
    const run = shareRun({
      id: "r1",
      pages: [done("/a", { label: '<Page> & "Co"', flags: [custom, LINK_FLAG] })],
    });
    const html = renderFlags(
      buildShareModel(
        inputOf([run], {
          transcripts: storeOf(() => ({
            ...LINES,
            read: ['To apply,, link, click here, dot <script>alert("x")</script> & more'],
          })),
        }),
      ),
    );

    expect(html).toContain('<span class="what">&lt;Page&gt; &amp; &quot;Co&quot;:</span>');
    expect(html).toContain('<span class="chip c-warn">&lt;rule&gt; &amp; co</span>');
    expect(html).toContain(
      "<code>“To apply,, link, click here, dot &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more”</code>",
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<rule>");
  });

  it("says which run a flagged page's transcripts are from, when it isn't the latest", async () => {
    const model = await demoModel();
    // The failed page, with flags as if its older transcripts had some.
    const how = model.pages[2];
    const older = {
      ...model,
      flagged: [
        {
          card: { ...(how as PageCard), flags: [HEADINGS_FLAG] },
          quotes: [{ rule: "headings", text: "Its first heading is level 2, not 1.", said: [] }],
        },
      ],
    };

    expect(renderFlags(older)).toContain(
      '<p class="sub">From run 2026-09-29_1315, on 29 September 2026</p>',
    );
    expect(renderFlags(model)).not.toContain("From run");
  });

  it("says no page has flags when none does", () => {
    const html = renderFlags(modelOf([done("/a"), done("/b")]));

    expect(html).toContain(
      '<p class="gist"><b>No page has flags.</b> Flags point a person to pages worth a closer listen; none was raised.</p>',
    );
    expect(html).not.toContain("<details");
    expect(html).not.toContain('class="folds"');

    // A page that couldn't be read has no flags to speak of: the pages that were read have none.
    const run = shareRun({
      id: "r1",
      pages: [
        done("/a"),
        { path: "/b", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
      ],
    });
    expect(renderFlags(buildShareModel(inputOf([run])))).toContain("<b>No page has flags.</b>");
  });

  it("says there are no flags to show when no page has transcripts", () => {
    const run = shareRun({
      id: "r1",
      pages: [{ path: "/a", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] }],
    });
    const none = renderFlags(buildShareModel(inputOf([run])));

    expect(none).toContain(
      '<p class="gist"><b>No page has transcripts yet.</b> There are no flags to show.</p>',
    );
    expect(none).toContain('<h2 id="find-h">What the flags found</h2>');
    expect(renderFlags(noRunModel())).toContain(
      '<p class="gist"><b>No live run counts yet.</b> There are no flags to show.</p>',
    );
  });
});

describe("renderAppendix", () => {
  it("folds each page's transcripts behind a line that says what's inside", async () => {
    const model = await demoModel();
    const html = renderAppendix(model);

    expect(html).toMatch(/^<section aria-labelledby="app-h">\s*<h2 id="app-h">/);
    expect(html).toContain('<h2 id="app-h">Appendix: every transcript</h2>');
    expect(html).toContain(
      `<p class="gist"><b>7 pages, 21 transcripts.</b> What NVDA said on each page, word for word, with each file's fingerprint. Open a page to read them.</p>`,
    );
    expect(html).toContain('<div class="appendix">');
    // One closed fold for each page, with the id its card links to, in the page's order.
    const folds = foldsIn(html);
    expect(folds).toHaveLength(7);
    expect(model.appendix.map(({ slug }) => slug)).toEqual(model.pages.map(({ slug }) => slug));
    expect(summariesIn(html)).toEqual(
      model.appendix.map(
        ({ name }, index) => `${index + 1} ${name}: read, headings, and Tab transcripts`,
      ),
    );
    expect(folds[0]).toContain(
      ' class="fold" id="tx-home"><summary><span class="num">1</span> <span class="what">http://127.0.0.1:4848/:</span> <span class="sub">read, headings, and Tab transcripts</span></summary>',
    );
    expect(html).not.toContain(" open>");
    // The page whose latest attempt failed shows the older run's transcripts, in its own place.
    expect(folds[2]).toContain('id="tx-how-a-run-works-fd116f9328"');
    expect(folds[2]).toContain(
      '<p class="fp">From run <code>2026-09-29_1315</code>, on 29 September 2026</p>',
    );
    expect(folds[0]).toContain('<p class="fp">From run <code>2026-09-29_1402</code></p>');
  });

  it("shows each transcript as the mockup does: its pass, size, fingerprint, and words, in a scroll box", async () => {
    const model = await demoModel();
    const [fold = ""] = foldsIn(renderAppendix(model));
    const [entry] = model.appendix;
    const sections = fold.split('<section class="tx"').slice(1);

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
        `<h3>${title} <span class="sr">transcript of /</span> <span class="sub">${lines}</span></h3>`,
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
      '<h3>Read <span class="sr">transcript of /</span> <span class="sub">18 lines</span></h3>',
    );
    expect(sections[0]).toContain("The whole file, its header included: 2,306 bytes, SHA-256");
    expect(sections[0]).toContain(
      "f30b29d0b01e47a5e2eb629251018fd09b8392197d46fc64277c574ebef365fe",
    );
    // The picture's place comes first, then the transcripts.
    expect(fold.indexOf('class="tx-grid"')).toBeLessThan(fold.indexOf('<section class="tx"'));
    // One h3 for each pass, and no h2 or h1 in a fold.
    expect(fold.match(/<h[1-6]>/g)).toEqual(["<h3>", "<h3>", "<h3>"]);
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
    const html = renderAppendix(model);
    const text = hostile.join("\n");

    // The box holds the transcript's text, escaped, and a browser would show it exactly as written.
    const [pre = ""] = /<pre>(.*?)<\/pre>/s.exec(html)?.slice(1) ?? [];
    expect(pre).toContain("&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(pre).toContain(
      "&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot; &#39;single&#39; &lt;!-- comment --&gt;",
    );
    expect(pre).toContain("&amp;lt;already escaped&amp;gt; &amp;amp;");
    expect(decode(pre)).toBe(text);
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
    const [pre = ""] = /<pre>(.*?)<\/pre>/s.exec(renderAppendix(model))?.slice(1) ?? [];

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

    for (const model of models) {
      const html = [renderPages(model), renderFlags(model), renderAppendix(model)].join("\n");
      const boxes = scrollBoxes(html);
      const tables = (html.match(/<table /g) ?? []).length;
      const transcripts = model.appendix.reduce((sum, page) => sum + page.files.length, 0);

      // A box for each table and each transcript.
      expect(boxes).toHaveLength(tables + transcripts);
      expect(boxes.length).toBeGreaterThan(transcripts);
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
  });

  it("names the passes a page's fold has, as many as it has", () => {
    const only = (pass: PassName[]) =>
      modelOf([done("/a", { files: pass.map((each) => `${each}.txt`) })]);
    const summary = (model: ShareModel) => summariesIn(renderAppendix(model))[0];

    expect(summary(only(["read", "headings", "tab"]))).toBe(
      "1 https://example.illinois.gov/a: read, headings, and Tab transcripts",
    );
    expect(summary(only(["read", "tab"]))).toBe(
      "1 https://example.illinois.gov/a: read and Tab transcripts",
    );
    expect(summary(only(["headings"]))).toBe(
      "1 https://example.illinois.gov/a: headings transcript",
    );
    expect(renderAppendix(only(["read"]))).toContain("<b>1 page, 1 transcript.</b>");
    // A page whose record lists no transcript says so, rather than offer an empty fold.
    const none = modelOf([done("/a", { files: [] })]);
    expect(summary(none)).toBe("1 https://example.illinois.gov/a: no transcripts");
    expect(renderAppendix(none)).toContain(
      "<p>This run's record lists no transcript files for the page.</p>",
    );
  });

  it("says in words which transcript couldn't be read, in its place", () => {
    const model = modelOf([done("/a")], {
      transcripts: storeOf(() => ({ read: LINES.read, headings: LINES.headings })),
    });
    const html = renderAppendix(model);
    const sections = html.split('<section class="tx"').slice(1);

    expect(model.appendix[0]?.unreadable).toEqual(["tab"]);
    expect(sections).toHaveLength(3);
    // In the Tab transcript's own place, under its own heading.
    expect(sections[2]).toContain(
      `<h3>Tab <span class="sr">transcript of /a</span></h3><p>This transcript was recorded, but its file couldn't be read here, so it isn't shown, and the fingerprint check leaves it out.</p>`,
    );
    expect(sections[2]).not.toContain("<pre>");
    expect(sections[2]).not.toContain("scroll");
    // The fold still says what the page has, and the first line says how many couldn't be read.
    expect(summariesIn(html)).toEqual([
      "1 https://example.illinois.gov/a: read, headings, and Tab transcripts",
    ]);
    expect(html).toContain(
      "<b>1 page, 2 transcripts.</b> What NVDA said on each page, word for word, with each file's fingerprint. Open a page to read them. 1 transcript couldn't be read, and says so under its page.",
    );
    // A page that can't be read at all is still a fold, with all three said.
    const gone = renderAppendix(modelOf([done("/a")], { transcripts: storeOf(() => ({})) }));
    expect(gone.match(/couldn't be read here/g)).toHaveLength(3);
    expect(gone).toContain("<b>1 page, no transcripts shown.</b>");
    expect(gone).toContain("3 transcripts couldn't be read, and each says so under its page.");
  });

  it("says a transcript with no lines has none, rather than show an empty box", () => {
    const model = modelOf([done("/a")], {
      transcripts: storeOf(() => ({ read: LINES.read, headings: [], tab: LINES.tab })),
    });
    const sections = renderAppendix(model).split('<section class="tx"').slice(1);

    expect(sections[1]).toContain(
      '<h3>Headings <span class="sr">transcript of /a</span> <span class="sub">0 lines</span></h3>',
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
    const [first = ""] = renderAppendix(model).split('<section class="tx"').slice(1);

    expect(first).toContain(
      '<h3>Read <span class="sr">transcript of /a</span> <span class="sub">1 line</span></h3>',
    );
  });

  it("names no run for the transcripts of the latest run when the model has none", async () => {
    const model = await demoModel();
    const bare = renderAppendix({ ...model, evidence: [] });

    // The page that failed still says the older run its transcripts are from; the others say none.
    expect(bare.match(/class="fp">From run/g)).toHaveLength(1);
    expect(bare).toContain('<p class="fp">From run <code>2026-09-29_1315</code>');
    expect(renderAppendix(model).match(/class="fp">From run/g)).toHaveLength(7);
    // Nothing stands in for the line: the first page's transcripts start its column.
    expect(foldsIn(bare)[0]).toContain(
      '<div><section class="tx" data-run="2026-09-29_1402" data-slug="home" data-file="read.txt"><h3>Read',
    );
  });

  it("shows the page's screenshot, or says it wasn't recorded", async () => {
    const model = await demoModel();
    const [unrecorded = ""] = foldsIn(renderAppendix(model));
    const uri = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    const [shot = ""] = foldsIn(
      renderAppendix(
        withCard(model, 0, { screenshot: { dataUri: uri, alt: "Screenshot of / as tested" } }),
      ),
    );

    // First in the fold, ahead of the transcripts, as the mockup has it.
    expect(shot).toContain(
      `<div class="tx-grid"><img src="${uri}" alt="Screenshot of / as tested" width="640" height="480" loading="lazy">`,
    );
    expect(unrecorded).toContain(
      '<div class="tx-grid"><div role="group" aria-label="Screenshot"><p class="not-recorded">Not recorded: this run used voicecap 0.4.1.</p></div>',
    );
    expect(unrecorded).not.toContain("<img");
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
    const html = renderAppendix(model);

    // The page that has transcripts is the second page, and its fold says so.
    expect(summariesIn(html)).toEqual(["2 The <read> page: read, headings, and Tab transcripts"]);
    expect(html).toContain(
      '<span class="num">2</span> <span class="what">The &lt;read&gt; page:</span>',
    );
    expect(html).toContain('aria-label="Read transcript, /read"');
    expect(html).not.toContain("The <read>");
  });

  it("says there is nothing to show when no page has transcripts", () => {
    const run = shareRun({
      id: "r1",
      pages: [{ path: "/a", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] }],
    });
    const html = renderAppendix(buildShareModel(inputOf([run])));

    expect(html).toContain('<h2 id="app-h">Appendix: every transcript</h2>');
    expect(html).toContain(
      '<p class="gist"><b>No transcripts to show.</b> No page has been read in full yet.</p>',
    );
    expect(html).not.toContain("<details");
    expect(html).not.toContain('class="appendix"');
    expect(renderAppendix(noRunModel())).toContain(
      '<p class="gist"><b>No live run counts yet.</b> There are no transcripts to show.</p>',
    );
  });
});

describe("the three sections together", () => {
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

  /** Each model, with its three sections as one string, in the order the page has them. */
  const models = async (): Promise<[string, ShareModel][]> => [
    ["the demo's", await demoModel()],
    ["thirteen pages", manyPages(13, 5)],
    ["no counted run", noRunModel()],
    ["odd words", oddModel()],
  ];

  const sectionsOf = (model: ShareModel): string =>
    [renderPages(model), renderFlags(model), renderAppendix(model)].join("\n");

  it("never sets a style attribute, loads nothing, and links only within the page", async () => {
    for (const [name, model] of await models()) {
      const html = sectionsOf(model);

      expect(html, name).not.toMatch(/\sstyle\s*=/i);
      expect(html, name).not.toMatch(/<(?:script|style|link|iframe)[\s>]/i);
      expect(html, name).not.toMatch(/\ssrc\s*=/i);
      for (const href of attributes(html, "href"))
        expect(href.startsWith("#"), `${name}: ${href}`).toBe(true);
    }
  });

  it("gives every id once, and every link a place to go", async () => {
    for (const [name, model] of await models()) {
      const html = sectionsOf(model);
      const ids = attributes(html, "id");

      expect(new Set(ids).size, name).toBe(ids.length);
      for (const href of attributes(html, "href")) {
        expect(ids, `${name}: ${href}`).toContain(href.slice(1));
      }
      // Every page with a card has its id, and the section ids the contents link to.
      expect(ids, name).toEqual(expect.arrayContaining(["pages-h", "find-h", "app-h"]));
      for (const card of model.pages) expect(ids, name).toContain(`pg-${idFragment(card.slug)}`);
    }
  });

  it("keeps every section's h2 outside every fold, and no heading in a summary line", async () => {
    for (const [name, model] of await models()) {
      for (const html of [renderPages(model), renderFlags(model), renderAppendix(model)]) {
        // Each section has one h2, before any fold.
        expect(html.match(/<h2[ >]/g), name).toHaveLength(1);
        expect(html.indexOf("<h2"), name).toBeLessThan(
          html.includes("<details") ? html.indexOf("<details") : Infinity,
        );
        // The parts of a section start at h3.
        expect(html, name).not.toMatch(/<h[14-6][ >]/);
        for (const found of html.matchAll(/<summary>(.*?)<\/summary>/gs)) {
          expect(found[1], name).not.toMatch(/<h[1-6][\s>]|role="?heading/);
        }
      }
    }
  });

  it("says a chip's meaning in words, never by color alone", async () => {
    for (const [name, model] of await models()) {
      const html = sectionsOf(model);
      const chips = [...html.matchAll(/<span class="chip c-(\w+)">(.*?)<\/span>/g)];

      for (const [, kind, words] of chips) {
        expect(["ok", "warn", "bad", "quiet"], name).toContain(kind);
        expect(textOf(words ?? ""), name).not.toBe("");
      }
    }
  });

  it("is made of the model's own words, escaped, and nothing from the mockup's sample data", async () => {
    for (const [name, model] of await models()) {
      const html = sectionsOf(model);

      expect(html, name).not.toContain('class="mock"');
      expect(html, name).not.toContain("sample:");
    }
    // A page's own words can't make markup: not its address, label, or title.
    const html = sectionsOf(oddModel());
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<i>");
    expect(html).toContain("Title: &lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  /** Markup, a quote, and an ampersand: wherever a record's words are shown, they're only text. */
  const MARKUP = `<x y="1">&'</x>`;
  const marked = (field: string): string => `${MARKUP}${field}`;

  /**
   * A model with every word a record can supply (the model's strings, in a card, a flag, the pages
   * no longer listed, and the appendix) made of markup, each marked with the field it's in.
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
          path: marked("path"),
          title: marked("title"),
          statusText: marked("status"),
          reviewChips: [marked("review")],
          manual: [{ at: marked("at"), reviewer: marked("reviewer") }],
          screenshot: { dataUri: marked("uri"), alt: marked("alt") },
          failure: marked("failure"),
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
      flagged: [
        {
          card: home,
          quotes: [
            { rule: marked("rule"), text: marked("text"), said: [marked("said")] },
            { rule: marked("rule2"), text: marked("text2"), said: [] },
          ],
        },
        {
          card: failed,
          quotes: [{ rule: marked("rule3"), text: marked("text3"), said: [marked("said3")] }],
        },
      ],
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
          name: marked("entry"),
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
          name: marked("entry2"),
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
    const html = sectionsOf(markupModel());
    const fields = [
      ...["name", "path", "title", "status", "review", "at", "reviewer", "uri", "alt", "failure"],
      ...["run", "date", "untitled", "shot", "flag", "flag2", "rule", "text", "said", "rule2"],
      ...["text2", "rule3", "text3", "said3", "gone", "url", "lastRun", "lastStatus", "entry"],
      ...["words", "sha", "entry2", "words2", "sha2", "latest"],
      ...["fileRun", "fileSlug", "fileRun2", "fileSlug2"],
    ];

    // None of it is markup, and every word of it is shown, escaped, somewhere.
    expect(html.match(/.{0,30}<x.{0,30}/g) ?? []).toEqual([]);
    for (const field of fields) expect(html, field).toContain(esc(marked(field)));
  });
});
