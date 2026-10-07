/**
 * "The details, for reviewers and auditors": the one section that gathers how the test was run, what
 * it covered, and the evidence behind it. Its parts are the sections that follow one another on the
 * page (what changed, the problems, what the results cover, the evidence, how voicecap works, and
 * how it came to be), each now a heading one level down (`demoted`), and the five that were the
 * summary's panels and bars (the `…Part` renderers in top.ts), each with a heading of its own. The
 * demo runs of 29 September 2026 (voicecap 0.4.1, in test/fixtures/share/) are the real case; runs
 * built in memory cover the rest.
 */
import { describe, expect, it } from "vitest";

import type { FlagResult } from "../src/model.js";
import { esc } from "../src/report/html.js";
import { renderDetails } from "../src/share/html/details.js";
import { demoted, fold } from "../src/share/html/parts.js";
import {
  completePart,
  renderHow,
  reviewPart,
  rulesPart,
  todoPart,
  whenHowPart,
} from "../src/share/html/top.js";
import type { CheckData } from "../src/share/check.js";
import { buildShareModel, type ShareModel } from "../src/share/model.js";
import type { Summary } from "../src/share/summary.js";
import { DETAILS_TEXT } from "../src/share/text.js";
import { shareRun } from "./helpers/share-data.js";
import { attributes, textOf } from "./helpers/share-html.js";
import { demoModel, inputOf, loggedModel, storeOf, TRANSCRIPTS } from "./helpers/share-model.js";

const PAT = "Pat Lee";

/** The ids of the details' parts, in the order the spec sets them out. */
const PARTS = [
  "todo-h",
  "complete-h",
  "whenhow-h",
  "chg-h",
  "prob-h",
  "lim-h",
  "rules-h",
  "review-h",
  "ev-h",
  "how-h",
  "story-h",
];

/** The five parts that were the summary's panels and bars, which a site with no counted run lacks. */
const FROM_THE_SUMMARY = ["todo-h", "complete-h", "whenhow-h", "rules-h", "review-h"];

/** A flag voicecap raises for two "click here" links in the read pass. */
const LINK_FLAG: FlagResult = {
  rule: "generic-link-text",
  pass: "read",
  count: 2,
  found: [{ text: "click here", count: 2 }],
  message: 'Generic link text announced 2 times in the read pass: "click here" ×2.',
};

/**
 * A site with one person's run of three pages, all heard live, one with flags, over an hour and
 * five minutes: every number in it differs from the demo's.
 */
function richModel(): ShareModel {
  const run = shareRun({
    id: "2026-09-29_0900",
    createdAt: "2026-09-29T09:00:00-05:00",
    sessions: [
      {
        reviewer: PAT,
        listener: "all",
        startedAt: "2026-09-29T09:00:00-05:00",
        endedAt: "2026-09-29T10:05:03-05:00",
      },
    ],
    pages: [
      { path: "/", title: "Example Agency", passes: { read: ["a", "b", "c"] } },
      {
        path: "/grants",
        label: "Grants",
        flags: [LINK_FLAG],
        passes: { read: ["a", "b", "c", "d", "e", "f", "g"], tab: ["a", "b", "c", "d"] },
      },
      { path: "/about", label: "About us", passes: { read: ["a", "b"] } },
    ],
  });
  return buildShareModel(inputOf([run]));
}

/** A site whose only run was a replay, so no run counts. */
function noRunModel(): ShareModel {
  const replay = shareRun({ id: "r1", replayed: true, pages: [{ path: "/" }] });
  return buildShareModel(inputOf([replay]));
}

/** The model with its summary's human review as `review` gives it. */
function withReview(model: ShareModel, review: Summary["bars"]["review"]): ShareModel {
  const bars = { ...model.summary.bars, review };
  return { ...model, summary: { ...model.summary, bars } };
}

/** Each heading in some markup, in order: its level, and its id when it has one. */
function headingsIn(html: string): { level: number; id: string | null }[] {
  return [...html.matchAll(/<h([1-6])\b([^>]*)>/g)].map(([, level = "", rest = ""]) => ({
    level: Number(level),
    id: /\bid="([^"]*)"/.exec(rest)?.[1] ?? null,
  }));
}

/** The ids of the headings at level 3: the parts, and nothing below them. */
const partsIn = (html: string): string[] =>
  headingsIn(html).flatMap(({ level, id }) => (level === 3 && id !== null ? [id] : []));

/** How many folds the point `at` in some markup is inside. */
function foldsAround(html: string, at: number): number {
  const before = html.slice(0, at);
  return (
    (before.match(/<details[\s>]/g)?.length ?? 0) - (before.match(/<\/details>/g)?.length ?? 0)
  );
}

/** A part's markup: from its section's start to the section's end. */
function partOf(html: string, id: string): string {
  const found = new RegExp(`<section aria-labelledby="${id}">[\\s\\S]*?</section>`).exec(html);
  if (found === null) throw new Error(`The details have no part ${id}.`);
  return found[0];
}

describe("demoted", () => {
  it("sets every heading one level down, its closing tag too, and keeps its attributes and words", () => {
    expect(demoted('<h2 id="a">A</h2><h5>B</h5>')).toBe('<h3 id="a">A</h3><h6>B</h6>');
    expect(demoted('<h1 class="x">One</h1><h3>Three &amp; more</h3><h4 id="y">Four</h4>')).toBe(
      '<h2 class="x">One</h2><h4>Three &amp; more</h4><h5 id="y">Four</h5>',
    );
  });

  it("moves an opening tag whatever white space follows its name, and a heading with no attributes", () => {
    expect(demoted('<h2\nid="a" class="b">A</h2>')).toBe('<h3\nid="a" class="b">A</h3>');
    expect(demoted('<h3\tclass="c">C</h3>')).toBe('<h4\tclass="c">C</h4>');
    expect(demoted("<h2>A</h2>\n<h2>B</h2>")).toBe("<h3>A</h3>\n<h3>B</h3>");
  });

  it("leaves alone what only looks like a heading: other tags, and the words of a page", () => {
    // A heading in a transcript or a card's code is escaped text: a "<" in text is "&lt;".
    const same =
      '<header><hr><th scope="col">h2</th><span class="h2">&lt;h2&gt;A&lt;/h2&gt;</span><h2-x>x</h2-x></header>';

    expect(demoted(same)).toBe(same);
    expect(demoted("<p>&lt;h2&gt; and &lt;/h2&gt;, and an &lt;h5 id=&quot;x&quot;&gt;</p>")).toBe(
      "<p>&lt;h2&gt; and &lt;/h2&gt;, and an &lt;h5 id=&quot;x&quot;&gt;</p>",
    );
    expect(demoted("")).toBe("");
    expect(demoted("<p>No heading here.</p>")).toBe("<p>No heading here.</p>");
  });

  it("refuses a heading that can't go below h6, whatever else is in the markup", () => {
    const refusal = new Error("A heading can't go below h6.");

    expect(() => demoted("<h6>x</h6>")).toThrow(refusal);
    expect(() => demoted('<h2>a</h2><p>b</p><h6 id="c">c</h6>')).toThrow(refusal);
    expect(() => demoted('<h6\nclass="c">x</h6>')).toThrow(refusal);
  });

  it("moves what is inside a fold too, since a fold is built before it is moved", () => {
    const section = (level: 2 | 3) =>
      `<section><h${level} id="s">S</h${level}>${fold("<span>Why</span>", `<h${level + 1}>Part</h${level + 1}><p>&lt;h2&gt;</p>`)}</section>`;

    expect(demoted(section(2))).toBe(section(3));
  });
});

describe("renderDetails", () => {
  it("sets out the details in the spec's order, each part's heading at level 3", async () => {
    const html = renderDetails(await demoModel());

    expect(html).toMatch(/^<section id="details" aria-labelledby="details-h">/);
    expect(partsIn(html)).toEqual(PARTS);
    // Every h3 is a part: what is inside one is lower. The only h2 is the details' own.
    expect(html.match(/<h3[\s>]/g)).toHaveLength(PARTS.length);
    expect(html.match(/<h[12][\s>][^>]*>/g)).toEqual(['<h2 id="details-h">']);
    // Each part is a section named by its own heading, and so is the details.
    const sections = [...html.matchAll(/<section\b[^>]*\baria-labelledby="([^"]+)"/g)];
    expect(sections.map(([, id]) => id)).toEqual(["details-h", ...PARTS]);
    expect(html).not.toMatch(/\sstyle\s*=/i);
  });

  it("says what's here under its heading", async () => {
    const html = renderDetails(await demoModel());

    expect(html).toMatch(
      /<h2 id="details-h">The details, for reviewers and auditors<\/h2>\s*<p class="gist">How the test was run, what it covered, and the evidence behind it\.<\/p>/,
    );
    expect(DETAILS_TEXT).toEqual({
      title: "The details, for reviewers and auditors",
      gist: "How the test was run, what it covered, and the evidence behind it.",
      link: "The details",
    });
    // The line comes before the first part.
    expect(html.indexOf('class="gist"')).toBeLessThan(html.indexOf('id="todo-h"'));
  });

  it("keeps what's inside each part below it, so no heading skips a level", async () => {
    const models: [string, ShareModel][] = [
      ["the demo's", await demoModel()],
      ["a person's run", richModel()],
      // Two sessions, so each is named by a heading of its own, as deep as a heading goes here.
      ["a run with its event log", loggedModel()],
      ["no counted run", noRunModel()],
    ];

    for (const [name, model] of models) {
      const levels = headingsIn(renderDetails(model)).map(({ level }) => level);

      expect(levels[0], name).toBe(2);
      for (const [at, level] of levels.slice(1).entries()) {
        // Never back to the details' own level, never more than one lower than the heading before.
        expect(level, `${name}: heading ${at + 2}`).toBeGreaterThan(2);
        expect(level - (levels[at] ?? 0), `${name}: heading ${at + 2}`).toBeLessThanOrEqual(1);
      }
      expect(Math.max(...levels), name).toBeLessThanOrEqual(6);
    }
    // The deepest: a session's name, under a run's part, under the evidence, under the details.
    const logged = headingsIn(renderDetails(loggedModel())).map(({ level }) => level);
    expect(Math.max(...logged)).toBe(5);
  });

  it("keeps each moved section's id, so every link to one still lands", async () => {
    const html = renderDetails(await demoModel());
    const ids = attributes(html, "id");
    const targets = attributes(html, "href")
      .filter((href) => href.startsWith("#"))
      .map((href) => href.slice(1));

    for (const id of ["chg-h", "prob-h", "lim-h", "ev-h", "how-h", "story-h"]) {
      expect(
        ids.filter((each) => each === id),
        id,
      ).toHaveLength(1);
    }
    // The links the details make to each other (the problems, and what changed) are to what is there.
    expect(targets).toEqual(expect.arrayContaining(["prob-h", "chg-h"]));
    expect(targets.filter((target) => !ids.includes(target))).toEqual([]);
  });

  it("moves no heading a transcript says: the check's data carries its markup as it was, and the parts are as before", () => {
    // A transcript can say anything, an h6 and a closing script tag included. In the page it is
    // escaped text, and in the check's data every "<" is written as a unicode escape, so none is a
    // tag to move (and an h6 among them would otherwise make the details refuse to be made).
    const said = [
      "<h2>Not a heading</h2>",
      '<h6 id="x">nor this</h6>',
      "</script><h3>nor this</h3>",
    ];
    const siteOf = (lines: string[]): ShareModel => {
      const passes = { read: lines, headings: lines, tab: lines };
      const run = shareRun({ id: "r1", pages: [{ path: "/", files: TRANSCRIPTS, passes }] });
      return buildShareModel(inputOf([run], { transcripts: storeOf(() => passes) }));
    };
    const model = siteOf(said);

    const html = renderDetails(model);
    const data = /<script type="application\/json" id="fp-data">([\s\S]*?)<\/script>/.exec(html);
    const texts = (JSON.parse(data?.[1] ?? "null") as CheckData).files.map(({ text }) => text);

    expect(html).toContain("\\u003ch2>Not a heading\\u003c/h2>");
    expect(texts).toHaveLength(3);
    for (const text of texts) expect(text).toContain('<h6 id="x">nor this</h6>');
    expect(texts).toEqual(model.check.files.map(({ text }) => text));
    // The headings are those of a site whose transcripts say nothing of the kind.
    expect(headingsIn(html)).toEqual(headingsIn(renderDetails(siteOf(["Welcome"]))));
    expect(partsIn(html)).toEqual(PARTS);
  });

  it("folds How voicecap works' sample of what NVDA said, and leaves the six steps and the band open", async () => {
    const model = await demoModel();
    const how = partOf(renderDetails(model), "how-h");
    const sample = how.indexOf('<details class="fold heard-fold">');

    // One fold, with the sample's title on its line, which holds no heading.
    expect(how.match(/<details[\s>]/g)).toHaveLength(1);
    expect(how).toMatch(
      /<details class="fold heard-fold"><summary><span class="what">Heard on this site: http:\/\/127\.0\.0\.1:4848\/, three ways<\/span><\/summary>/,
    );
    // The three ways it was said are inside it, and the steps and the band are not.
    expect(foldsAround(how, how.indexOf('<div class="lanes">'))).toBe(1);
    expect(how.match(/<figure class="lane">/g)).toHaveLength(3);
    expect(foldsAround(how, how.indexOf('<ol class="flow"'))).toBe(0);
    expect(foldsAround(how, how.indexOf('<div class="when">'))).toBe(0);
    // The steps come first, then the sample, then the band on when to run.
    expect(how.indexOf('<ol class="flow"')).toBeLessThan(sample);
    expect(sample).toBeLessThan(how.indexOf('<div class="when">'));
    // And the fold's line is the model's own title for it.
    expect(textOf(/<summary>(.*?)<\/summary>/s.exec(how)?.[1] ?? "")).toBe(
      "Heard on this site: http://127.0.0.1:4848/, three ways",
    );
  });

  it("leaves out the summary's parts when no run counts, and keeps the rest", () => {
    const model = noRunModel();
    const html = renderDetails(model);

    expect(model.header.tested).toBeNull();
    for (const id of FROM_THE_SUMMARY) expect(html, id).not.toContain(`id="${id}"`);
    expect(partsIn(html)).toEqual(["chg-h", "prob-h", "lim-h", "ev-h", "how-h", "story-h"]);
    expect(html).toContain('<h2 id="details-h">The details, for reviewers and auditors</h2>');
    // With no home page to quote there is no sample to fold: it says so, in the open.
    expect(model.heard).toBeNull();
    expect(html).not.toContain("heard-fold");
    expect(html).toContain("Not recorded: no sample of the home page&#39;s lines is available.");
  });

  it("is one section, whatever the site", async () => {
    for (const model of [await demoModel(), richModel(), loggedModel(), noRunModel()]) {
      const html = renderDetails(model);

      expect(html.match(/<section id="details"/g)).toHaveLength(1);
      expect(html.trimEnd().endsWith("</section>")).toBe(true);
      expect(html.match(/<section[\s>]/g)).toHaveLength(html.match(/<\/section>/g)?.length ?? -1);
    }
  });
});

describe("the details' parts that were the summary's panels and bars", () => {
  it("is each a section named by its h3, with its box under the heading", async () => {
    const model = await demoModel();
    const { summary } = model;

    expect(todoPart(summary)).toMatch(
      /^<section aria-labelledby="todo-h"><h3 id="todo-h">What&#39;s still to do<\/h3><div class="panel"><ul>.*<\/ul><\/div><\/section>$/s,
    );
    expect(completePart(model)).toMatch(
      /^<section aria-labelledby="complete-h"><h3 id="complete-h">How complete the test was<\/h3><div class="panel"><ul>.*<\/ul><\/div><\/section>$/s,
    );
    expect(whenHowPart(summary)).toMatch(
      /^<section aria-labelledby="whenhow-h"><h3 id="whenhow-h">When and how<\/h3><div class="panel"><ul>.*<\/ul><\/div><\/section>$/s,
    );
    expect(rulesPart(summary)).toMatch(
      /^<section aria-labelledby="rules-h"><h3 id="rules-h">Flags by rule <span class="sub">times each rule was raised, across pages and passes<\/span><\/h3><div class="meter">.*<\/div><\/section>$/s,
    );
    expect(reviewPart(summary)).toMatch(
      /^<section aria-labelledby="review-h"><h3 id="review-h">The human review <span class="sub">each out of its total<\/span><\/h3><div class="meter">.*<\/div><\/section>$/s,
    );
  });

  it("lists how complete the test was, with links to the problems and to what changed", async () => {
    const model = await demoModel();
    const html = completePart(model);
    const [pagesRead, problems, unexpected] = model.summary.complete;

    expect(html).toContain(
      '<h3 id="complete-h">How complete the test was</h3><div class="panel"><ul>',
    );
    expect(html).toContain(`<li>${esc(pagesRead)}</li>`);
    expect(html).toContain(`<li>${esc(problems)} <a href="#prob-h">What happened</a></li>`);
    expect(html).toContain(`<li>${esc(unexpected)}</li>`);
    // The run before: one line, after the rest, with its link.
    expect(model.summary.changesLine).toBe(
      "Since the last run on 29 September: every page read in full in both runs sounds the same.",
    );
    expect(html).toContain(
      '<li>Since the last run on 29 September: every page read in full in both runs sounds the same. <a href="#chg-h">What changed</a></li>',
    );
    expect(html.indexOf(esc(unexpected))).toBeLessThan(html.indexOf("Since the last run"));
  });

  it("leaves out the changes line when there's no run before", () => {
    const html = completePart(richModel());

    expect(html).not.toContain("Since the last run");
    expect(html).not.toContain(">What changed</a>");
  });

  it("lists what's still to do, and when and how it was run", async () => {
    const { summary } = await demoModel();

    expect(todoPart(summary)).toBe(
      '<section aria-labelledby="todo-h"><h3 id="todo-h">What&#39;s still to do</h3><div class="panel"><ul>' +
        "<li>http://127.0.0.1:4848/how-a-run-works/ couldn&#39;t be read in the latest run (another window took the screen). Its transcripts are from run 2026-09-29_1315. Read it again.</li>" +
        "<li>Take a closer listen to http://127.0.0.1:4848/common-mistakes/, where flags were raised, and record what you decide.</li></ul></div></section>",
    );
    expect(whenHowPart(summary)).toBe(
      '<section aria-labelledby="whenhow-h"><h3 id="whenhow-h">When and how</h3><div class="panel"><ul>' +
        "<li><b>Date</b>: 29 September 2026</li>" +
        "<li><b>Run by</b>: Not recorded: this run used voicecap 0.4.1.</li>" +
        "<li><b>Screen reader</b>: NVDA 2026.2</li>" +
        "<li><b>Browser</b>: Chrome 154.0.8037.58</li>" +
        "<li><b>Operating system</b>: Windows 11 Pro 25H2 (10.0.26200)</li></ul></div></section>",
    );
  });

  it("draws two bars, each part an h3 with its numbers in text", async () => {
    const { summary } = await demoModel();
    const rules = rulesPart(summary);
    const review = reviewPart(summary);

    // Flags by rule: each rule's count, as wide as it is against the most. Each flag counts once:
    // the links and the unnamed items were each raised in two passes, the headings in one.
    expect(textOf(rules)).toBe(
      "Flags by rule times each rule was raised, across pages and passes generic-link-text 2 unlabeled 2 headings 1",
    );
    expect(rules.match(/<rect class="c-warn" x="0" y="0" width="100%"/g)).toHaveLength(2);
    expect(rules).toContain('<rect class="c-warn" x="0" y="0" width="50%"');

    // The human review: each count out of its total, said in words to a screen reader. It has no
    // row for the pages a person heard NVDA read.
    expect(textOf(review.replace(/<span aria-hidden="true">.*?<\/span>/gs, ""))).toBe(
      "The human review each out of its total Transcripts reviewed 0 of 7 Issues fixed 0 of 0",
    );
    expect(review).not.toContain("Heard live");

    // Neither draws a picture a screen reader would meet: each row's track is decorative, since its
    // numbers are the text beside it.
    for (const html of [rules, review]) {
      const pictures = html.match(/<svg /g)?.length ?? 0;
      const hidden = html.match(/<svg [^>]*aria-hidden="true"/g)?.length ?? 0;

      expect(pictures).toBeGreaterThan(0);
      expect(hidden).toBe(pictures);
      expect(html).not.toContain('role="img"');
    }
  });

  it("gives the human review's numbers in text, and a screen reader each row once", () => {
    const review = reviewPart(withReview(richModel(), { reviewed: [3, 3], fixed: [0, 0] }).summary);

    // A complete row is "ok", and a row with no total has nothing to fill.
    expect(review).toContain('<span>Transcripts reviewed</span><svg class="track"');
    expect(review).toContain('<rect class="c-ok" x="0" y="0" width="100%"');
    expect(review).toContain(
      '<span class="c"><span aria-hidden="true">3/3</span><span class="sr">3 of 3</span></span>',
    );
    expect(review).toContain(
      '<span class="c"><span aria-hidden="true">0/0</span><span class="sr">0 of 0</span></span>',
    );
    // The rows' own tracks are decorative: their numbers are the text beside them.
    expect(
      review.match(/<svg class="track" width="100%" height="10" aria-hidden="true">/g),
    ).toHaveLength(2);
    expect(review).not.toContain('role="img"');
  });

  it("says no flags were raised, rather than draw an empty chart", () => {
    const run = shareRun({ id: "r1", pages: [{ path: "/" }] });
    const rules = rulesPart(buildShareModel(inputOf([run])).summary);

    expect(textOf(rules)).toBe(
      "Flags by rule times each rule was raised, across pages and passes No flags were raised.",
    );
    expect(rules).not.toContain("<svg");
  });

  it("colors a review row by whether it's complete", () => {
    const rowsOf = (review: Summary["bars"]["review"]) =>
      reviewPart(withReview(richModel(), review).summary).split('<div class="rule">').slice(1);
    const part = rowsOf({ reviewed: [1, 3], fixed: [0, 0] });
    const whole = rowsOf({ reviewed: [3, 3], fixed: [2, 2] });

    // Two rows, the pages reviewed and the issues fixed: a person's hearing NVDA has none.
    expect(part).toHaveLength(2);
    expect(part[0]).toContain('class="c-warn"');
    expect(part[0]).toContain('width="33.33%"');
    expect(part[1]).not.toContain("<rect");
    expect(whole[0]).toContain('class="c-ok"');
    expect(whole[1]).toContain('class="c-ok"');
  });

  it("escapes the lines it's given", () => {
    const model = richModel();
    const summary: Summary = {
      ...model.summary,
      todo: ["Fix <i>this</i>."],
      complete: ["Pages read: <3>."],
      whenHow: [{ label: "R&D", value: "<x>" }],
      bars: { ...model.summary.bars, flagsByRule: [{ rule: "<rule>", count: 2 }] },
    };
    const html = [
      todoPart(summary),
      completePart({ ...model, summary }),
      whenHowPart(summary),
      rulesPart(summary),
    ].join("");

    expect(html).toContain("<li>Fix &lt;i&gt;this&lt;/i&gt;.</li>");
    expect(html).toContain("<li>Pages read: &lt;3&gt;.</li>");
    expect(html).toContain("<li><b>R&amp;D</b>: &lt;x&gt;</li>");
    expect(html).toContain('<span class="mono">&lt;rule&gt;</span>');
    expect(html).not.toContain("<i>this");
  });

  it("is open: nothing in the five is folded, and no heading is in a summary line", async () => {
    const model = await demoModel();
    const { summary } = model;
    const html = [
      todoPart(summary),
      completePart(model),
      whenHowPart(summary),
      rulesPart(summary),
      reviewPart(summary),
    ].join("");

    expect(html).not.toMatch(/<(?:details|summary)[\s>]/);
    expect(html).not.toMatch(/\sstyle\s*=/i);
  });
});

describe("How voicecap works, in the details", () => {
  it("keeps its heading, its steps, and its band as they were, and folds only the sample", async () => {
    const model = await demoModel();
    const how = renderHow(model);
    const inDetails = partOf(renderDetails(model), "how-h");

    // The same markup, with every heading one level down.
    expect(inDetails).toBe(demoted(how));
    expect(inDetails).toContain('<h3 id="how-h">How voicecap works</h3>');
    expect(inDetails.match(/<h4[\s>]/g)).toHaveLength(7);
  });
});
