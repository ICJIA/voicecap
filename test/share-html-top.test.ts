/**
 * The shareable page's top, its At a glance, and "How voicecap works", with the parts every section
 * draws with (folds, chips, the ring of the pages, and the spoken-line strip). The demo runs of 29
 * September 2026 (voicecap 0.4.1, in test/fixtures/share/) are the real case; runs built in memory
 * cover the rest.
 */
import { describe, expect, it } from "vitest";

import type { FlagResult } from "../src/model.js";
import { esc, plural } from "../src/report/html.js";
import { STEP_ICONS } from "../src/share/html/icons.js";
import {
  chip,
  count,
  fold,
  notRecorded,
  ring,
  scroll,
  strip,
  track,
  verdictLine,
  type RingPart,
} from "../src/share/html/parts.js";
import { renderGlance, renderHow, renderTop } from "../src/share/html/top.js";
import type { ShareInput } from "../src/share/load.js";
import { buildShareModel, type ShareModel } from "../src/share/model.js";
import type { Summary } from "../src/share/summary.js";
import { AXE_TEXT, HOW_LEAD, HOW_STEPS, WHEN_TO_RUN } from "../src/share/text.js";
import { SITE } from "./helpers/report-data.js";
import { shareRun } from "./helpers/share-data.js";
import { attributes, textOf } from "./helpers/share-html.js";
import {
  DEMO_ROOT,
  demoModel,
  homeModel,
  inputOf,
  LINES,
  storeOf,
  withoutTxt,
} from "./helpers/share-model.js";

const PAT = "Pat Lee";

/** Where a copy of the demo site runs on the tester's computer. */
const READ = "http://127.0.0.1:4848";

const GITHUB = "https://github.com/ICJIA/voicecap";
const NV_ACCESS = "https://www.nvaccess.org/";

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

/**
 * The demo site as voicecap read it on a copy on the tester's computer, named by its canonical
 * address, with a name set for it: Pat Lee's run of one page, begun at 14:02 on 29 September 2026.
 */
function copyModel(overrides: Partial<ShareInput> = {}): ShareModel {
  const run = shareRun({
    id: "2026-09-29_1402",
    site: READ,
    createdAt: "2026-09-29T14:02:00-05:00",
    sessions: [{ reviewer: PAT }],
    pages: [{ path: "/" }],
  });
  const input = inputOf([run], {
    readOrigin: READ,
    canonical: DEMO_ROOT,
    siteName: "The voicecap demo",
    ...overrides,
  });
  return buildShareModel(input);
}

/** The model with some of the summary's numbers changed. */
function withNumbers(model: ShareModel, numbers: Partial<Summary["numbers"]>): ShareModel {
  return {
    ...model,
    summary: { ...model.summary, numbers: { ...model.summary.numbers, ...numbers } },
  };
}

/** The model with its result changed: what the verdict, the ring's total, and two tiles go by. */
function withResult(model: ShareModel, result: Partial<ShareModel["result"]>): ShareModel {
  return { ...model, result: { ...model.result, ...result } };
}

/** One page, read by NVDA, that raised no flag: nothing needs attention, so there is no card. */
function cleanModel(): ShareModel {
  const run = shareRun({ id: "r1", pages: [{ path: "/", passes: { read: ["Welcome"] } }] });
  return buildShareModel(inputOf([run]));
}

/** One page read and one skipped: no card, but a page in scope that NVDA didn't read. */
function skippedModel(): ShareModel {
  const run = shareRun({
    id: "r1",
    pages: [
      { path: "/", passes: { read: ["Welcome"] } },
      { path: "/pdf", status: "skipped" },
    ],
  });
  return buildShareModel(inputOf([run]));
}

/** A run that counts, and lists no page: there is nothing in it to give a verdict on. */
function noPagesModel(): ShareModel {
  return buildShareModel(inputOf([shareRun({ id: "r1", pages: [] })]));
}

/** The three renderers' output, in the order the page has them. */
function pageOf(model: ShareModel): string {
  return [renderTop(model), renderGlance(model), renderHow(model)].join("\n");
}

/** What each of the tiles shows, and what a screen reader says of its big number. */
interface Tile {
  kind: string;
  /** The big number as it looks: "7/7", "12m 34s". */
  shown: string;
  /** The big number as a screen reader says it: "7 of 7", "12 minutes 34 seconds". */
  spoken: string;
  label: string;
}

function tilesOf(html: string): Tile[] {
  return html
    .split('<div class="tile ')
    .slice(1)
    .map((chunk) => {
      const found =
        /^(\w+)">\s*<span class="n">(.*)<\/span><span class="k">(.*?)<\/span><\/div>/s.exec(chunk);
      if (!found) throw new Error(`Not a tile: ${chunk.slice(0, 120)}`);
      const [, kind = "", big = "", label = ""] = found;
      return {
        kind,
        shown: textOf(big.replace(/<span class="sr">.*?<\/span>/gs, ""), ""),
        spoken: textOf(big.replace(/<(\w+) aria-hidden="true">.*?<\/\1>/gs, ""), ""),
        label: textOf(label),
      };
    });
}

describe("fold", () => {
  it("is a details whose summary line is its own words, with the body in an inside box", () => {
    expect(fold('<span class="what">Why</span>', "<p>Because.</p>")).toBe(
      '<details class="fold"><summary><span class="what">Why</span></summary><div class="inside"><p>Because.</p></div></details>',
    );
    expect(
      fold("<span>Run 1402</span>", "<p>Body</p>", {
        id: "run-1402",
        open: true,
        className: "problem",
      }),
    ).toBe(
      '<details class="fold problem" id="run-1402" open><summary><span>Run 1402</span></summary><div class="inside"><p>Body</p></div></details>',
    );
  });

  it("refuses a heading in the summary line, since some screen readers don't announce one", () => {
    const headings = [
      "<h1>Why</h1>",
      "<h2>Why</h2>",
      "<h3>Why</h3>",
      '<h6 class="what">Why</h6>',
      '<span role="heading" aria-level="3">Why</span>',
    ];
    for (const heading of headings) {
      expect(() => fold(heading, "<p>Body</p>")).toThrow(/summary line/);
    }
    // Not mistaken for a heading: a rule, and words about headings and their role.
    expect(fold("<span>The h2 and the header</span><hr>", "<p>Body</p>")).toContain("<summary>");
    expect(fold("<span>The role=heading attribute</span>", "<p>Body</p>")).toContain("<summary>");
  });

  it("refuses a section heading in the body, since those are never inside a fold", () => {
    expect(() => fold("<span>Why</span>", '<h2 id="a">Section</h2>')).toThrow(/h2/);
    expect(() => fold("<span>Why</span>", "<h1>Page</h1>")).toThrow(/h1/);
    // A part of a fold's own starts at level 3, and a transcript's "<h2>" text is escaped.
    expect(fold("<span>Why</span>", "<h3>Part</h3><p>&lt;h2&gt;</p>")).toContain("<h3>Part</h3>");
  });

  it("refuses a summary line with no words", () => {
    expect(() => fold("<span></span>", "<p>Body</p>")).toThrow(/words/);
    expect(() => fold("   ", "<p>Body</p>")).toThrow(/words/);
  });

  it("escapes its id and class names", () => {
    const html = fold("<span>Why</span>", "", {
      id: 'a"b',
      className: 'c"d',
      insideClassName: 'e"f',
    });

    expect(html).toContain('class="fold c&quot;d" id="a&quot;b"');
    expect(html).toContain('<div class="inside e&quot;f">');
  });

  it("can start hidden, for a fold a script shows once it has something to say", () => {
    expect(fold("<span>Every file checked</span>", "", { id: "fp-list", hidden: true })).toBe(
      '<details class="fold" id="fp-list" hidden><summary><span>Every file checked</span></summary><div class="inside"></div></details>',
    );
    expect(fold("<span>Why</span>", "")).not.toContain("hidden");
    expect(fold("<span>Why</span>", "", { hidden: false })).not.toContain("hidden");
  });

  it("can give its inside box more classes, as the mockup's run folds have", () => {
    expect(fold("<span>Run 1402</span>", "<p>Body</p>", { insideClassName: "run-inside" })).toBe(
      '<details class="fold"><summary><span>Run 1402</span></summary><div class="inside run-inside"><p>Body</p></div></details>',
    );
  });

  it("can name its file with data attributes, after its id, each value escaped, and refuses a name that isn't one", () => {
    expect(
      fold("<span>What axe found</span>", "", {
        id: "axe-home",
        data: { run: "r1", slug: 'a"b<c', file: "axe.json" },
      }),
    ).toBe(
      '<details class="fold" id="axe-home" data-run="r1" data-slug="a&quot;b&lt;c" data-file="axe.json"><summary><span>What axe found</span></summary><div class="inside"></div></details>',
    );
    for (const name of ["Run", "x y", 'run" onclick="a', "", "1st"]) {
      expect(() => fold("<span>Why</span>", "", { data: { [name]: "v" } }), name).toThrow(
        /^Not a data attribute's name/,
      );
    }
  });
});

describe("chip", () => {
  it("says its meaning in words, in the colors of its kind", () => {
    expect(chip("ok", "Reviewed, no issues")).toBe(
      '<span class="chip c-ok">Reviewed, no issues</span>',
    );
    expect(chip("quiet", "No flags")).toBe('<span class="chip c-quiet">No flags</span>');
  });

  it("escapes its words, and keeps its kind to a class name", () => {
    expect(chip("warn", "<b>&</b>")).toBe(
      '<span class="chip c-warn">&lt;b&gt;&amp;&lt;/b&gt;</span>',
    );
    expect(chip('ok" onclick="x', "Yes")).not.toMatch(/onclick=/);
  });

  it("is never a color alone", () => {
    expect(() => chip("ok", "")).toThrow(/words/);
    expect(() => chip("bad", "   ")).toThrow(/words/);
  });
});

describe("notRecorded", () => {
  it("says what wasn't recorded, always in those words", () => {
    expect(notRecorded("Not recorded: this run used voicecap 0.4.1.")).toBe(
      '<p class="not-recorded">Not recorded: this run used voicecap 0.4.1.</p>',
    );
    // Words that don't say it get it said for them, so a gap never reads as a pass.
    expect(notRecorded("no screenshot was taken before 0.6.0.")).toBe(
      '<p class="not-recorded">Not recorded: no screenshot was taken before 0.6.0.</p>',
    );
    expect(notRecorded("a <b> line")).toContain("a &lt;b&gt; line");
  });

  it("keeps a line that says it after what it's about, so the words aren't said twice", () => {
    expect(notRecorded("The step and the key: not recorded: this run used voicecap 0.4.1.")).toBe(
      '<p class="not-recorded">The step and the key: not recorded: this run used voicecap 0.4.1.</p>',
    );
  });
});

describe("scroll", () => {
  it("is a box a keyboard can reach and a screen reader names, with its contents as they are", () => {
    expect(scroll("Changes, table", "<table></table>")).toBe(
      '<div class="scroll" tabindex="0" role="region" aria-label="Changes, table"><table></table></div>',
    );
  });

  it("escapes its name", () => {
    expect(scroll('a "b" <c>', "")).toContain('aria-label="a &quot;b&quot; &lt;c&gt;"');
  });
});

describe("verdictLine", () => {
  it("sets the first sentence in bold, and the rest as it is", () => {
    expect(verdictLine("Two problems. Neither came back. It was fine.")).toBe(
      '<p class="prob-verdict"><b>Two problems.</b> Neither came back. It was fine.</p>',
    );
    expect(verdictLine("All the same!")).toBe('<p class="prob-verdict"><b>All the same!</b></p>');
  });

  it("doesn't end the sentence at a version number, and bolds a line with no end whole", () => {
    expect(verdictLine("Run on voicecap 0.4.1 failed. It came back.")).toBe(
      '<p class="prob-verdict"><b>Run on voicecap 0.4.1 failed.</b> It came back.</p>',
    );
    expect(verdictLine("No full stop here")).toBe(
      '<p class="prob-verdict"><b>No full stop here</b></p>',
    );
  });

  it("escapes what it's given", () => {
    expect(verdictLine("<i>One</i>. <b>Two</b>")).toBe(
      '<p class="prob-verdict"><b>&lt;i&gt;One&lt;/i&gt;.</b> &lt;b&gt;Two&lt;/b&gt;</p>',
    );
  });
});

describe("count", () => {
  it("writes a number, and only a number, whatever it's given", () => {
    // A record's field that should be a number, but holds markup, never reaches the page as markup.
    const markup = "<b>7</b>" as unknown as number;

    expect(count(markup)).toBe("NaN");
    expect(plural(markup, "page")).toBe("NaN pages");
  });

  it("writes a number the same on any computer, with its thousands set apart", () => {
    expect([0, 7, 204, 1204, 1_234_567].map(count)).toEqual([
      "0",
      "7",
      "204",
      "1,204",
      "1,234,567",
    ]);
  });
});

describe("ring", () => {
  /** The three parts of the ring of the pages, as At a glance gives them: one of each kind. */
  const partsOf = (ok: number, warn: number, bad: number): RingPart[] => [
    { label: "Read, no problems", value: ok, kind: "ok" },
    { label: "Read, with problems", value: warn, kind: "warn" },
    { label: "Not read", value: bad, kind: "bad" },
  ];

  /** Each arc the markup draws: its kind, its length, the gap after it, and where it starts. */
  function arcsOf(html: string) {
    const arc =
      /<circle class="ring-part (\w+)"[^>]*? stroke-dasharray="([\d.]+) ([\d.]+)" stroke-dashoffset="(-?[\d.]+)"\/>/g;
    return [...html.matchAll(arc)].map(([, kind = "", length, gap, start]) => ({
      kind,
      length: Number(length),
      gap: Number(gap),
      start: Number(start),
    }));
  }

  /** The legend's items: each one's kind, and what it says. */
  function legendOf(html: string): [string, string][] {
    const list =
      /<ul class="ring-legend" role="list" aria-label="[^"]*">(.*?)<\/ul>/s.exec(html)?.[1] ?? "";
    return [...list.matchAll(/<li class="(\w+)">(.*?)<\/li>/gs)].map(([, kind = "", item = ""]) => [
      kind,
      textOf(item, ""),
    ]);
  }

  it("draws one whole circle for a ring of one part", () => {
    const html = ring(partsOf(9, 0, 0), 9);

    // Every page is without a problem: the one arc is as long as the ring, with no gap in it.
    expect(html.match(/class="ring-part/g)).toHaveLength(1);
    expect(html).toContain('<circle class="ring-part ok"');
    expect(html).toContain('stroke-dasharray="301.59 0"');
    expect(arcsOf(html)).toEqual([{ kind: "ok", length: 301.59, gap: 0, start: 0 }]);
  });

  it("is a box a screen reader skips, with a circle turned to start at the top, and a legend apart from it", () => {
    const html = ring(partsOf(5, 2, 0), 7);
    const box = /^<div class="ring" aria-hidden="true">(.*?)<\/div>/s.exec(html)?.[1] ?? "";

    expect(html.startsWith('<div class="ring" aria-hidden="true"><svg viewBox="0 0 120 120"')).toBe(
      true,
    );
    // A track the whole way round, and every arc on the same circle: 48 from the middle, 16 wide.
    expect(box).toContain(
      '<circle class="ring-track" cx="60" cy="60" r="48" fill="none" stroke-width="16"/>',
    );
    for (const part of box.match(/<circle class="ring-part[^>]*>/g) ?? []) {
      expect(part).toContain('cx="60" cy="60" r="48" fill="none" stroke-width="16"');
    }
    // Turned a quarter turn back, so the first arc starts at the top rather than at three o'clock.
    expect(box).toContain('<g transform="rotate(-90 60 60)">');
    // The legend is what a screen reader gets, so it isn't inside the box that is hidden from it.
    expect(box).not.toContain("<ul");
    expect(html.indexOf("</div>")).toBeLessThan(html.indexOf('<ul class="ring-legend"'));
    expect(html.endsWith("</ul>")).toBe(true);
  });

  it("names its legend for a screen reader by the total with its unit, as the ring's middle shows them", () => {
    // A screen reader skips the ring, so it never gets the number in its middle: its list does, as
    // its name ("7 pages", then the three parts and their counts).
    expect(ring(partsOf(5, 2, 0), 7)).toContain(
      '<ul class="ring-legend" role="list" aria-label="7 pages">',
    );
    expect(ring(partsOf(1, 0, 0), 1)).toContain(
      '<ul class="ring-legend" role="list" aria-label="1 page">',
    );
    expect(ring(partsOf(1200, 4, 0), 1204)).toContain(
      '<ul class="ring-legend" role="list" aria-label="1,204 pages">',
    );
    expect(ring(partsOf(0, 0, 0), 0)).toContain('aria-label="0 pages"');
  });

  it("lays each part's arc after the one before it, as long as its share of the circle", () => {
    // 5 and 2 of 7: the circle is 301.59 round (2π × 48), so 215.42 and 86.17.
    expect(arcsOf(ring(partsOf(5, 2, 0), 7))).toEqual([
      { kind: "ok", length: 215.42, gap: 86.17, start: 0 },
      { kind: "warn", length: 86.17, gap: 215.42, start: -215.42 },
    ]);
    // Three parts, the third beginning where the first two end.
    expect(arcsOf(ring(partsOf(5, 2, 1), 8))).toEqual([
      { kind: "ok", length: 188.49, gap: 113.1, start: 0 },
      { kind: "warn", length: 75.4, gap: 226.19, start: -188.49 },
      { kind: "bad", length: 37.7, gap: 263.89, start: -263.89 },
    ]);
  });

  it("draws no arc for a part with no pages, and keeps its line in the legend with 0", () => {
    const html = ring(partsOf(0, 0, 3), 3);

    expect(arcsOf(html)).toEqual([{ kind: "bad", length: 301.59, gap: 0, start: 0 }]);
    expect(html.match(/class="ring-part/g)).toHaveLength(1);
    expect(legendOf(html)).toEqual([
      ["ok", "Read, no problems: 0"],
      ["warn", "Read, with problems: 0"],
      ["bad", "Not read: 3"],
    ]);
  });

  it("says each part in its legend, in words and with its count, those of no pages too", () => {
    const html = ring(partsOf(5, 2, 0), 7);

    expect(legendOf(html)).toEqual([
      ["ok", "Read, no problems: 5"],
      ["warn", "Read, with problems: 2"],
      ["bad", "Not read: 0"],
    ]);
    // The swatch is for the eye: the words and the count say it all, and each item is a list item.
    expect(
      html.match(/<li class="\w+"><span class="sw" aria-hidden="true"><\/span>/g),
    ).toHaveLength(3);
    expect(html).toContain(
      '<li class="warn"><span class="sw" aria-hidden="true"></span>Read, with problems: <b>2</b></li>',
    );
    // Counts as the page writes them everywhere: with their thousands set apart.
    expect(legendOf(ring(partsOf(1200, 4, 0), 1204)).at(0)).toEqual([
      "ok",
      "Read, no problems: 1,200",
    ]);
  });

  it("puts the number of pages in the middle, with its unit, in the singular for one", () => {
    expect(ring(partsOf(5, 2, 0), 7)).toContain(
      '</svg><span class="ring-n">7</span><span class="ring-k">pages</span></div>',
    );
    expect(ring(partsOf(1, 0, 0), 1)).toContain(
      '<span class="ring-n">1</span><span class="ring-k">page</span>',
    );
    expect(ring(partsOf(1200, 4, 0), 1204)).toContain('<span class="ring-n">1,204</span>');
  });

  it("draws no arc, and divides by nothing, for a ring of no pages", () => {
    const html = ring(partsOf(0, 0, 0), 0);

    expect(html).not.toContain("ring-part");
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(html).toContain('<span class="ring-n">0</span><span class="ring-k">pages</span>');
    expect(legendOf(html)).toHaveLength(3);
  });

  it("never draws an arc past the end of the ring, whatever the parts add up to", () => {
    // 8 and 8 of 10: the second is cut off where the ring ends, never wrapping on past the top.
    const [first, second, ...rest] = arcsOf(ring(partsOf(8, 8, 0), 10));

    expect(rest).toEqual([]);
    expect(first).toEqual({ kind: "ok", length: 241.27, gap: 60.32, start: 0 });
    expect(second).toEqual({ kind: "warn", length: 60.32, gap: 241.27, start: -241.27 });
  });

  it("escapes a part's words, keeps its kind to a class name, and sets no style attribute", () => {
    const html = ring(
      [{ label: '<i>x</i> & "y"', value: 1, kind: 'ok" onclick="x' as RingPart["kind"] }],
      1,
    );

    expect(html).toContain("&lt;i&gt;x&lt;/i&gt; &amp; &quot;y&quot;: <b>1</b>");
    expect(html).not.toContain("<i>");
    expect(html).not.toMatch(/onclick=/);
    expect(html).not.toMatch(/\sstyle=/);
  });
});

describe("track", () => {
  it("is a bar with no numbers of its own, hidden from screen readers, for a row that has them", () => {
    expect(track(3, 6, "warn")).toBe(
      '<svg class="track" width="100%" height="10" aria-hidden="true">' +
        '<rect class="c-warn" x="0" y="0" width="50%" height="100%" fill="currentColor"/></svg>',
    );
    expect(track(0, 6, "warn")).not.toContain("<rect");
    expect(track(5, 0, "warn")).not.toContain("<rect");
    expect(track(9, 6, "ok")).toContain('width="100%" height="100%"');
  });
});

describe("strip", () => {
  /** A line that took 1 s and has 100 characters, and one that took 3 s with 25. */
  const lines = [
    { ms: 1000, chars: 100 },
    { ms: 3000, chars: 25 },
  ];

  /** Each bar's geometry, in the SVG's own units. */
  function barsOf(html: string): { x: number; y: number; width: number; height: number }[] {
    const rect = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g;
    return [...html.matchAll(rect)].map(([, x, y, width, height]) => ({
      x: Number(x),
      y: Number(y),
      width: Number(width),
      height: Number(height),
    }));
  }

  it("sums its lines up for a screen reader, as an image with a name", () => {
    const html = strip(lines, "Read pass");

    expect(html).toContain('role="img"');
    expect(html).toContain(
      'aria-label="Read pass: 2 lines over 4.0 seconds; the longest took 3.0 seconds"',
    );
    expect(strip([{ ms: 1300, chars: 40 }], "Tab pass")).toContain(
      'aria-label="Tab pass: 1 line over 1.3 seconds; the longest took 1.3 seconds"',
    );
  });

  it("draws a bar for each line, as wide as it took and as tall as the root of its length", () => {
    const [first, second, ...rest] = barsOf(strip(lines, "Read pass"));

    expect(rest).toEqual([]);
    // Three times the time, three times the width.
    expect(first && second && second.width / first.width).toBeCloseTo(3, 1);
    // A quarter of the length, half the height. The tallest fills the height, with a margin above.
    expect(first?.height).toBe(30);
    expect(second?.height).toBe(15);
    // Every bar stands on the same line.
    expect(first && first.y + first.height).toBe(34);
    expect(second && second.y + second.height).toBe(34);
    // Side by side in the mockup's way: a gap of 0.8 between them, and half of it at each end.
    expect(first?.x).toBe(0.4);
    expect(first && second && second.x - (first.x + first.width)).toBeCloseTo(0.8, 5);
    expect(second && second.x + second.width).toBeCloseTo(299.6, 5);
  });

  it("fits every bar in the strip's width, side by side, however many lines there are", () => {
    for (const size of [1, 2, 18, 400]) {
      const many = Array.from({ length: size }, (_, index) => ({
        ms: 500 + index * 7,
        chars: 20 + index,
      }));
      const bars = barsOf(strip(many, "Read pass"));

      expect(bars).toHaveLength(size);
      const last = bars.at(-1);
      // Within the strip, to the rounding of each number.
      expect(last && last.x + last.width).toBeLessThanOrEqual(300.1);
      expect(bars[0]?.x).toBeGreaterThanOrEqual(0);
      for (const [index, each] of bars.entries()) {
        const next = bars[index + 1];
        if (next) expect(next.x).toBeGreaterThanOrEqual(each.x + each.width - 0.1);
      }
    }
  });

  it("still shows a line with no words, and gives lines with no time equal widths", () => {
    const silent = barsOf(
      strip(
        [
          { ms: 0, chars: 0 },
          { ms: 0, chars: 9 },
        ],
        "Read pass",
      ),
    );

    expect(silent[0]?.height).toBeGreaterThan(0);
    expect(silent[0]?.width).toBe(silent[1]?.width);
    expect(silent[0]?.width).toBeGreaterThan(0);
    // No line has any length at all: every bar is the least height.
    const empty = barsOf(strip([{ ms: 1000, chars: 0 }], "Read pass"));
    expect(empty[0]?.height).toBeGreaterThan(0);
  });

  it("says when there are no lines, and draws none", () => {
    const html = strip([], "Read pass");

    expect(html).toContain('aria-label="Read pass: no lines"');
    expect(html).not.toContain("<rect");
  });

  it("escapes its label, and is sized by attributes, never a style attribute", () => {
    const html = strip(lines, 'The "read" pass');

    expect(html).toContain('aria-label="The &quot;read&quot; pass: 2 lines');
    expect(html).toContain('class="strip"');
    expect(html).toContain('viewBox="0 0 300 36"');
    expect(html).toContain('width="300" height="36"');
    // The bars stretch to the width the page gives the strip, and keep their height.
    expect(html).toContain('preserveAspectRatio="none"');
    expect(html).not.toMatch(/\sstyle=/);
  });
});

describe("the step icons", () => {
  it("are one for each step's icon name, whatever the names suggest", () => {
    expect(Object.keys(STEP_ICONS).sort()).toEqual(HOW_STEPS.map((step) => step.icon).sort());
    expect(new Set(Object.values(STEP_ICONS)).size).toBe(6);
    // The mockup's pictures by step position: the fourth step, "words", is a shield with a check
    // mark, and the sixth, "seal", a padlock.
    const [list, reader, three, words, person, seal] = HOW_STEPS.map(
      (step) => STEP_ICONS[step.icon],
    );
    expect(list).toContain('<rect x="4" y="3" width="16" height="18" rx="2"/>');
    expect(reader).toContain("M4 9h4l5-4v14l-5-4H4z");
    expect(three).toContain('<rect x="2.5" y="6" width="19" height="12" rx="2"/>');
    expect(words).toContain("M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z");
    expect(words).toContain("M9 12l2 2 4-4");
    expect(person).toContain("M4 15v-3a8 8 0 0 1 16 0v3");
    expect(seal).toContain('<rect x="5" y="11" width="14" height="10" rx="2"/>');
  });

  it("are hidden from screen readers, sized and drawn by attributes, and set no style", () => {
    for (const svg of Object.values(STEP_ICONS)) {
      expect(svg).toMatch(/^<svg viewBox="0 0 24 24" width="24" height="24"/);
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).toContain('fill="none" stroke="currentColor"');
      expect(svg).not.toMatch(/\sstyle=/);
      expect(svg.endsWith("</svg>")).toBe(true);
    }
  });
});

describe("renderTop", () => {
  it("heads the page with the site's name, the date and time it was tested, and who made it", async () => {
    const html = renderTop(richModel());

    // The name of a site no canonical address names is the host voicecap read: its home page's
    // title ("Example Agency" here) doesn't head the page.
    expect(html).toContain("<h1>example.illinois.gov</h1>");
    expect(html).not.toContain("Example Agency");
    expect(html).toContain('<div class="eyebrow">Screen reader test results</div>');
    // Under the name, when the latest run began, as the run recorded it.
    expect(html).toContain('<p class="mast-tested">Tested 29 September 2026, 09:00</p>');
    expect(html).toContain(
      `<p class="mast-lead">How its pages read aloud with <a href="${NV_ACCESS}">NVDA</a>, a free screen reader, tested on 29 September 2026. voicecap took NVDA through every page, pressing its keys the way a person would. Every word shown here is what NVDA said.</p>`,
    );
    expect(html).toContain("<span>As of <b>30 September 2026</b></span>");
    expect(html).toContain(`<span>Prepared by <b>${PAT}</b></span>`);
    expect(html).toContain(`<span>Made with <a href="${GITHUB}">voicecap</a></span>`);
    // The site's address comes last, small. No canonical address names this site, so it's the one
    // voicecap read, as it was: words, with no link to a place a reader may not be able to open.
    expect(html).toContain(`<span class="addr">Site address ${SITE}</span>`);
    expect(html.indexOf("Prepared by")).toBeLessThan(html.indexOf("Site address"));
    expect(attributes(html, "href")).not.toContain(SITE);

    // The demo's runs name no canonical address: the host they read heads the page.
    expect(renderTop(await demoModel())).toContain("<h1>127.0.0.1:4848</h1>");
  });

  it("leads with the canonical name and the date and time it was tested", () => {
    const html = renderTop(copyModel());

    expect(html).toContain("<h1>voicecap.icjia.app</h1>");
    expect(html).toContain('<p class="mast-site">The voicecap demo</p>');
    expect(html).toContain('<p class="mast-tested">Tested 29 September 2026, 14:02</p>');
    // Top to bottom: the eyebrow, the name, the name set for the site, when it was tested, the
    // plain lines, who and when, and the site's address last.
    const order = [
      'class="eyebrow"',
      "<h1>",
      'class="mast-site"',
      'class="mast-tested"',
      'class="mast-lead"',
      "As of ",
      "Prepared by ",
      "Made with ",
      'class="addr"',
    ].map((marker) => html.indexOf(marker));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // The address is the canonical root, linked, small and last; the address voicecap read, which
    // was a copy on this computer, is nowhere in it.
    expect(html).toContain(
      `<span class="addr">Site address <a href="${DEMO_ROOT}">${DEMO_ROOT}</a></span>`,
    );
    expect(html.indexOf('class="addr"')).toBeGreaterThan(html.indexOf("Made with "));
    expect(html).not.toMatch(/127\.0\.0\.1|localhost/);
  });

  it("says the date and time as plain words in paragraphs under the name, which is the only heading", () => {
    const html = renderTop(copyModel());
    const words = (markup: string | undefined) => textOf(markup ?? "", "");
    const paragraph = (className: string) =>
      words(new RegExp(`<p class="${className}">(.*?)</p>`, "s").exec(html)?.[1]);
    const meta = /<div class="mast-meta">(.*?)<\/div>\s*<\/header>/s.exec(html)?.[1] ?? "";

    expect(words(/<h1>(.*?)<\/h1>/s.exec(html)?.[1])).toBe("voicecap.icjia.app");
    expect(paragraph("mast-site")).toBe("The voicecap demo");
    expect(paragraph("mast-tested")).toBe("Tested 29 September 2026, 14:02");
    expect(
      meta
        .split("</span>")
        .filter((span) => span !== "")
        .map(words),
    ).toEqual([
      "As of 30 September 2026",
      `Prepared by ${PAT}`,
      "Made with voicecap",
      `Site address ${DEMO_ROOT}`,
    ]);
    // The name is the page's one heading: what follows it is paragraphs, so the headings go down
    // from an h1 as they did.
    expect([...html.matchAll(/<h([1-6])[\s>]/g)].map(([, level]) => level)).toEqual(["1"]);
  });

  it("leaves out the line for the site's name when none is set, and the line for when it was tested when no run counts", () => {
    const plain = renderTop(copyModel({ siteName: null }));
    expect(plain).not.toContain("mast-site");
    expect(plain).toContain('<p class="mast-tested">');

    const none = renderTop(noRunModel());
    expect(none).not.toContain("mast-tested");
    expect(none).not.toContain("Tested ");
    expect(none).toContain("No live run counts yet");
  });

  it("has the two buttons, hidden until the page's script shows them, the theme's offering light", () => {
    const html = renderTop(richModel());

    // Each does nothing without the script, which shows it. The theme's words say what it
    // switches to, so it has no pressed state to contradict them.
    expect(html).toContain(
      '<button class="theme" id="open-all" type="button" hidden>Open every section</button>',
    );
    expect(html).toContain(
      '<button class="theme" id="theme-toggle" type="button" hidden>Light version</button>',
    );
    expect(html.match(/<button /g)).toHaveLength(2);
  });

  it("names the site as the headline, escaped", () => {
    const model = richModel();
    const html = renderTop({
      ...model,
      header: {
        ...model.header,
        name: '<Agency> & "Co"',
        site: "https://a.gov/?x=1&y=2",
        siteName: "<i>Co</i> & 'Sons'",
        testedAt: "29 <b> 2026, 09:00",
        asOf: "1 <b> 2026",
        tested: "29 <b> 2026",
      },
    });

    expect(html).toContain("<h1>&lt;Agency&gt; &amp; &quot;Co&quot;</h1>");
    expect(html).toContain('<p class="mast-site">&lt;i&gt;Co&lt;/i&gt; &amp; &#39;Sons&#39;</p>');
    expect(html).toContain('<p class="mast-tested">Tested 29 &lt;b&gt; 2026, 09:00</p>');
    expect(html).toContain("Site address https://a.gov/?x=1&amp;y=2");
    expect(html).toContain("<span>As of <b>1 &lt;b&gt; 2026</b></span>");
    expect(html).toContain("tested on 29 &lt;b&gt; 2026.");
    expect(html).not.toContain("<Agency>");
    expect(html).not.toContain("<i>");
  });

  it("escapes the address it links to, which is a canonical root", () => {
    const model = copyModel();
    const html = renderTop({
      ...model,
      header: { ...model.header, site: 'https://a.gov/"x"/?q=1&r=<2>' },
    });

    expect(html).toContain(
      '<a href="https://a.gov/&quot;x&quot;/?q=1&amp;r=&lt;2&gt;">https://a.gov/&quot;x&quot;/?q=1&amp;r=&lt;2&gt;</a>',
    );
    expect(attributes(html, "href")).toContain("https://a.gov/&quot;x&quot;/?q=1&amp;r=&lt;2&gt;");
  });

  it("links the address only when it is a web address, so no record can put a script in a link", () => {
    const model = copyModel();
    const withSite = (site: string) => renderTop({ ...model, header: { ...model.header, site } });

    for (const site of [
      "javascript:alert(1)",
      "data:text/html,<b>x</b>",
      "ftp://a.gov/",
      "a.gov/",
    ]) {
      const html = withSite(site);

      expect(attributes(html, "href"), site).toEqual([NV_ACCESS, GITHUB]);
      expect(html, site).toContain(`<span class="addr">Site address ${esc(site)}</span>`);
    }
    // A web address is linked, in either scheme.
    expect(attributes(withSite("http://a.gov/"), "href")).toContain("http://a.gov/");
    expect(attributes(withSite("HTTPS://a.gov/"), "href")).toContain("HTTPS://a.gov/");
  });

  it("leaves out Prepared by when no name was recorded", async () => {
    // The demo runs are from before voicecap recorded who ran a session.
    const html = renderTop(await demoModel());

    expect(html).not.toContain("Prepared by");
    expect(html).toContain("<span>As of <b>30 September 2026</b></span>");
    expect(html).toContain("<span>Made with");
  });

  it("escapes who prepared it", () => {
    const model = richModel();
    const html = renderTop({ ...model, header: { ...model.header, preparedBy: "<b>Pat</b>" } });

    expect(html).toContain("Prepared by <b>&lt;b&gt;Pat&lt;/b&gt;</b>");
  });

  it("dates runs that took more than a day as from one day to another", () => {
    const model = richModel();
    const within = renderTop({
      ...model,
      header: { ...model.header, tested: "29 to 30 September 2026" },
    });
    const across = renderTop({
      ...model,
      header: { ...model.header, tested: "30 September to 2 October 2026" },
    });

    expect(within).toContain(
      "a free screen reader, tested from 29 to 30 September 2026. voicecap took",
    );
    expect(across).toContain("tested from 30 September to 2 October 2026.");
  });

  it("says plainly that no run counts, rather than name a date", () => {
    const model = noRunModel();
    const html = renderTop(model);

    expect(model.header.tested).toBeNull();
    expect(html).toContain(
      `How its pages read aloud with <a href="${NV_ACCESS}">NVDA</a>, a free screen reader. No live run counts yet, so there&#39;s no test date.`,
    );
    expect(html).not.toContain("tested on");
    expect(html).not.toContain("tested from");
    // No run that counts took NVDA through any page, so it isn't said to have.
    expect(html).not.toContain("voicecap took");
    expect(html).toContain("voicecap takes NVDA through every page, pressing its keys");
    expect(html).toContain("<span>As of <b>30 September 2026</b></span>");
  });

  it("names a screen reader other than NVDA, and links only NVDA to its makers", () => {
    const model = richModel();
    const html = renderTop({ ...model, header: { ...model.header, screenReader: "VoiceOver" } });

    expect(html).toContain("How its pages read aloud with VoiceOver, a free screen reader");
    expect(html).toContain("voicecap took VoiceOver through every page");
    expect(html).toContain("is what VoiceOver said.");
    expect(html).not.toContain(NV_ACCESS);
  });
});

describe("renderGlance", () => {
  /** Where each link of the "On this page" list goes, by the id of the heading it names, and what it says. */
  function linksOf(html: string): [string, string][] {
    const nav = /<nav class="toc" aria-label="On this page">(.*?)<\/nav>/s.exec(html)?.[1] ?? "";
    return [...nav.matchAll(/<a href="#([\w-]+)">(.*?)<\/a>/g)].map(([, id = "", words = ""]) => [
      id,
      words,
    ]);
  }

  /** The verdict's class, which is its kind, and its words. */
  function verdictIn(html: string): [string, string] | undefined {
    const found = /<p class="verdict (\w+)">(.*?)<\/p>/s.exec(html);
    return found === null ? undefined : [found[1] ?? "", textOf(found[2] ?? "", "")];
  }

  it("is a section named by its h2, which comes before How voicecap works", async () => {
    const model = await demoModel();
    const html = pageOf(model);

    expect(renderGlance(model)).toMatch(
      /^<section class="glance" aria-labelledby="glance-h">\s*<h2 id="glance-h">At a glance<\/h2>[\s\S]*<\/section>$/,
    );
    const glance = html.indexOf('<h2 id="glance-h">At a glance</h2>');
    const how = html.indexOf('<h2 id="how-h">How voicecap works</h2>');
    expect(glance).toBeGreaterThan(-1);
    expect(how).toBeGreaterThan(glance);
    expect(html.match(/<h2[ >]/g)).toHaveLength(2);
    // Its panels and bars are parts of the details: At a glance has no heading but its own.
    expect(renderGlance(model).match(/<h[1-6][ >]/g)).toEqual(["<h2 "]);
  });

  it("opens with At a glance, in its order: the verdict, the result, the ring, the numbers, the method, and the links", async () => {
    const html = renderGlance(await demoModel());
    const order = [
      "<h2 ",
      '<p class="verdict warn">5 problems need attention, on 2 pages</p>',
      '<p class="lead">NVDA read all 7 pages.</p>',
      '<div class="ring-row">',
      '<div class="tiles">',
      '<p class="gist">A human review, sped up: voicecap presses NVDA&#39;s keys and moves from page to page; the person running it does the reading and the deciding.</p>',
      '<nav class="toc" aria-label="On this page">',
    ].map((marker) => html.indexOf(marker));

    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Each of the six is there once, in the section's own grid: none inside another.
    for (const part of ["verdict", "lead", "ring-row", "tiles", "gist", "toc"]) {
      expect(html.match(new RegExp(`class="${part}[ "]`, "g")), part).toHaveLength(1);
    }
  });

  it("says the verdict in words, with its kind as its class, and in no sign of its own", async () => {
    const demo = await demoModel();

    expect(verdictIn(renderGlance(cleanModel()))).toEqual(["ok", "Nothing needs attention"]);
    expect(verdictIn(renderGlance(demo))).toEqual([
      "warn",
      "5 problems need attention, on 2 pages",
    ]);
    expect(verdictIn(renderGlance(skippedModel()))).toEqual([
      "bad",
      "Nothing needs attention on the pages read",
    ]);
    // A page not read outranks the problems, which the headline still counts.
    expect(verdictIn(renderGlance(withResult(demo, { read: 6 })))).toEqual([
      "bad",
      "5 problems need attention, on 2 pages",
    ]);
    // The sign is drawn by the page's style, with no alternative text: in the markup, a sign is a
    // character that is no text, which axe's contrast check fails.
    for (const model of [cleanModel(), demo, skippedModel()]) {
      expect(renderGlance(model)).not.toMatch(/[✓⚠]/);
    }
  });

  it("goes by the result for what it says, so the verdict, the ring's middle, and the first tiles can't differ", async () => {
    const model = withResult(await demoModel(), {
      pages: 9,
      read: 9,
      problems: 1,
      problemPages: 1,
    });
    const html = renderGlance(model);

    expect(verdictIn(html)).toEqual(["warn", "1 problem needs attention, on 1 page"]);
    expect(html).toContain('<span class="ring-n">9</span><span class="ring-k">pages</span>');
    expect(tilesOf(html).map(({ shown, label }) => [shown, label])).toEqual([
      ["9/9", "pages read by NVDA"],
      ["1", "problem to fix"],
      ["204", "lines NVDA spoke"],
      ["12m 34s", "of NVDA time, across 2 runs"],
    ]);
  });

  it("draws the ring, with a legend that says each part in words", async () => {
    const html = renderGlance(await demoModel());
    const legend = [...html.matchAll(/<li class="\w+">(.*?)<\/li>/gs)].map(([, item = ""]) =>
      textOf(item, ""),
    );
    const at = (marker: string) => html.indexOf(marker);

    expect(legend).toEqual(["Read, no problems: 5", "Read, with problems: 2", "Not read: 0"]);
    // Five pages without a problem and two with: an arc each, and none for the page not read.
    expect(html.match(/class="ring-part ok"/g)).toHaveLength(1);
    expect(html.match(/class="ring-part warn"/g)).toHaveLength(1);
    expect(html.match(/class="ring-part bad"/g)).toBeNull();
    expect(html).toContain('<span class="ring-n">7</span><span class="ring-k">pages</span>');
    // The ring is for the eye, and the legend is the list a screen reader gets, in its row.
    expect(html).toContain('<div class="ring" aria-hidden="true">');
    expect(html).toContain('<ul class="ring-legend" role="list" aria-label="7 pages">');
    expect(at('<div class="ring-row">')).toBeLessThan(at('<div class="ring"'));
    expect(at('<div class="ring"')).toBeLessThan(at('<ul class="ring-legend"'));
    expect(at('<ul class="ring-legend"')).toBeLessThan(at('<div class="tiles">'));
  });

  it("names the legend by the number of pages in the ring's middle, so a screen reader gets it too", async () => {
    const demo = renderGlance(await demoModel());
    const clean = renderGlance(cleanModel());

    expect(demo).toContain('<span class="ring-n">7</span><span class="ring-k">pages</span>');
    expect(demo).toContain('<ul class="ring-legend" role="list" aria-label="7 pages">');
    expect(clean).toContain('<span class="ring-n">1</span><span class="ring-k">page</span>');
    expect(clean).toContain('<ul class="ring-legend" role="list" aria-label="1 page">');
  });

  it("takes the ring's three parts from the model, in the order Read with no problems, Read with problems, Not read", async () => {
    const model = {
      ...withResult(await demoModel(), { pages: 7, read: 4 }),
      ring: { noProblems: 3, needAttention: 1, notRead: 3 },
    };
    const html = renderGlance(model);

    expect([...html.matchAll(/class="ring-part (\w+)"/g)].map(([, kind]) => kind)).toEqual([
      "ok",
      "warn",
      "bad",
    ]);
    expect(
      [...html.matchAll(/<li class="(\w+)">(.*?)<\/li>/gs)].map(([, kind = "", item = ""]) => [
        kind,
        textOf(item, ""),
      ]),
    ).toEqual([
      ["ok", "Read, no problems: 3"],
      ["warn", "Read, with problems: 1"],
      ["bad", "Not read: 3"],
    ]);
  });

  it("draws one whole circle when every page has no problems", () => {
    const html = renderGlance(cleanModel());

    expect(html.match(/class="ring-part/g)).toHaveLength(1);
    expect(html).toContain('<circle class="ring-part ok"');
    expect(html).toContain('stroke-dasharray="301.59 0"');
    expect(html).toContain('<span class="ring-n">1</span><span class="ring-k">page</span>');
  });

  it("says it in four big numbers", async () => {
    const tiles = tilesOf(renderGlance(await demoModel()));

    expect(tiles.map(({ shown, label }) => [shown, label])).toEqual([
      ["7/7", "pages read by NVDA"],
      ["5", "problems to fix"],
      ["204", "lines NVDA spoke"],
      ["12m 34s", "of NVDA time, across 2 runs"],
    ]);
    // A screen reader says each fraction and each time in words.
    expect(tiles.map(({ spoken }) => spoken)).toEqual([
      "7 of 7",
      "5",
      "204",
      "12 minutes 34 seconds",
    ]);
  });

  it("has no tile for the pages a person heard NVDA read", () => {
    // The person heard NVDA on all three of these pages, and no tile says so: it is on each page's
    // chip, and in each run's evidence.
    const html = renderGlance(richModel());

    expect(tilesOf(html)).toHaveLength(4);
    expect(html).not.toContain("heard live by a person");
    expect(tilesOf(html).map(({ label }) => label)).not.toContain("heard live by a person");
  });

  it("shows four numbers that follow the model, in other numbers and in the singular", () => {
    const model = richModel();
    const tiles = tilesOf(renderGlance(model));

    expect(model.result).toEqual({ pages: 3, read: 3, problems: 1, problemPages: 1 });
    expect(model.summary.numbers.linesSpoken).toBe(16);
    expect(tiles.map(({ shown, label }) => [shown, label])).toEqual([
      ["3/3", "pages read by NVDA"],
      ["1", "problem to fix"],
      ["16", "lines NVDA spoke"],
      ["1h 5m", "of NVDA time, across 1 run"],
    ]);
    expect(tiles.at(-1)?.spoken).toBe("1 hour 5 minutes");
  });

  it("colors a tile by its result, and a tile's words never rest on color", async () => {
    const kinds = (model: ShareModel) => tilesOf(renderGlance(model)).map(({ kind }) => kind);

    // Complete is "ok", a problem to fix is "warn", a plain count is "quiet".
    expect(kinds(await demoModel())).toEqual(["ok", "warn", "quiet", "quiet"]);
    expect(kinds(cleanModel())).toEqual(["ok", "ok", "quiet", "quiet"]);
    expect(kinds(withResult(richModel(), { read: 2, problems: 0 }))).toEqual([
      "warn",
      "ok",
      "quiet",
      "quiet",
    ]);
  });

  it("says the pages read out of those in scope, so nothing looks complete that isn't", () => {
    const tiles = tilesOf(renderGlance(withResult(richModel(), { read: 2 })));

    expect(tiles[0]).toMatchObject({ kind: "warn", shown: "2/3", spoken: "2 of 3" });
  });

  it("words each tile in the singular for one", () => {
    const one = withNumbers(withResult(richModel(), { pages: 1, read: 1, problems: 1 }), {
      linesSpoken: 1,
    });
    const tiles = tilesOf(renderGlance(one));

    expect(tiles.map(({ label }) => label)).toEqual([
      "pages read by NVDA",
      "problem to fix",
      "line NVDA spoke",
      "of NVDA time, across 1 run",
    ]);
    expect(tiles.map(({ kind }) => kind)).toEqual(["ok", "warn", "quiet", "quiet"]);
    // And in the plural for a count that isn't one.
    expect(tilesOf(renderGlance(withResult(richModel(), { problems: 3 })))[1]?.label).toBe(
      "problems to fix",
    );
  });

  it("says a time of any length in words, with its units small", () => {
    const times: [number, string, string][] = [
      [850, "850ms", "850 milliseconds"],
      [1000, "1s", "1 second"],
      [12_000, "12s", "12 seconds"],
      [383_000, "6m 23s", "6 minutes 23 seconds"],
      [7_500_000, "2h 5m", "2 hours 5 minutes"],
      [183_600_000, "2d 3h", "2 days 3 hours"],
    ];

    for (const [ms, shown, spoken] of times) {
      const html = renderGlance(withNumbers(richModel(), { nvdaMs: ms }));
      const [time] = tilesOf(html).slice(-1);

      expect(time, shown).toMatchObject({ shown, spoken });
    }
    expect(renderGlance(withNumbers(richModel(), { nvdaMs: 383_000 }))).toContain(
      '<span aria-hidden="true">6<small>m</small> 23<small>s</small></span>',
    );
  });

  it("says how many sessions the NVDA time leaves out, having no recorded end", () => {
    const label = (sessionsWithoutEnd: number) =>
      tilesOf(renderGlance(withNumbers(richModel(), { sessionsWithoutEnd }))).at(-1)?.label;

    expect(label(0)).toBe("of NVDA time, across 1 run");
    expect(label(1)).toBe(
      "of NVDA time, across 1 run; 1 session without a recorded end isn't counted",
    );
    expect(label(2)).toBe(
      "of NVDA time, across 1 run; 2 sessions without a recorded end aren't counted",
    );
  });

  it("says 'On this page' once to a screen reader: the navigation's name, with the visible label hidden from it", async () => {
    for (const model of [await demoModel(), cleanModel(), noRunModel()]) {
      const html = renderGlance(model);
      const nav = /<nav class="toc"[^>]*>.*?<\/nav>/s.exec(html)?.[0] ?? "";

      // The landmark is named, which a screen reader says on reaching it. The words before the
      // links are for the eye: a screen reader that read them too would say it twice.
      expect(nav).toMatch(/^<nav class="toc" aria-label="On this page">/);
      expect(nav).toContain('<span class="sub" aria-hidden="true">On this page:</span>');
      // Outside what is hidden, the words are in the markup once: the name.
      const heard = nav.replace(/<span [^>]*aria-hidden="true">.*?<\/span>/g, "");
      expect(heard.match(/On this page/g)).toHaveLength(1);
    }
  });

  it("links to what's on the page, by the id of each section's h2, with the one on what needs attention only when there is a card", async () => {
    const html = renderGlance(await demoModel());

    expect(html).toContain('<span class="sub" aria-hidden="true">On this page:</span>');
    expect(linksOf(html)).toEqual([
      ["need-h", "What needs attention"],
      ["pages-h", "Every page"],
      ["details-h", "The details"],
    ]);
    // With no card, there's no section for the link to go to.
    for (const model of [cleanModel(), skippedModel(), noRunModel()]) {
      expect(model.attention).toEqual([]);
      expect(linksOf(renderGlance(model))).toEqual([
        ["pages-h", "Every page"],
        ["details-h", "The details"],
      ]);
    }
  });

  it("says only that no run counts, with no verdict, ring, or numbers, when none does", () => {
    const html = renderGlance(noRunModel());

    expect(html).toContain('<h2 id="glance-h">At a glance</h2>');
    expect(html).toContain(
      '<p class="lead">No live run counts yet: voicecap shows only completed, sealed runs with a real screen reader.</p>',
    );
    expect(html).toContain('<p class="gist">A human review, sped up:');
    // The way into the rest of the page stays.
    expect(html).toContain('<nav class="toc" aria-label="On this page">');
    expect(html).not.toContain('class="verdict');
    expect(html).not.toContain('class="ring');
    expect(html).not.toContain('class="tiles"');
    expect(html).not.toContain("<svg");
  });

  it("gives no verdict, ring, or numbers for a run that counts but lists no page, as the website's card gives none", () => {
    const model = noPagesModel();
    const html = renderGlance(model);

    // `verdictOf` says "Nothing needs attention" of no page, which no one read: it's not shown.
    expect(model.header.tested).not.toBeNull();
    expect(model.result.pages).toBe(0);
    expect(html).toContain('<p class="lead">');
    expect(html).toContain('<nav class="toc"');
    expect(html).not.toContain('class="verdict');
    expect(html).not.toContain('class="ring');
    expect(html).not.toContain('class="tiles"');
  });

  it("leaves its panels and bars to the details: it has none, with a run that counts or without", async () => {
    for (const model of [await demoModel(), richModel(), noRunModel()]) {
      const html = renderGlance(model);
      const counted = model.result.pages > 0;

      expect(html).not.toMatch(/class="(?:panels?|meters?)[\s"]/);
      expect(html).not.toMatch(/<(?:details|summary)[\s>]/);
      // The ring is its one picture, and its legend its one list.
      expect(html.match(/<svg[\s>]/g)?.length ?? 0).toBe(counted ? 1 : 0);
      expect(html.match(/<ul[\s>]/g)?.length ?? 0).toBe(counted ? 1 : 0);
    }
  });

  it("escapes the sentence it's given", () => {
    const model = richModel();
    const html = renderGlance({
      ...model,
      summary: { ...model.summary, sentence: 'A <b>bold</b> & "quoted" sentence.' },
    });

    expect(html).toContain("A &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot; sentence.");
    expect(html).not.toContain("<b>bold");
  });
});

describe("renderHow", () => {
  it("is a section named by its h2, opening with the lead, whose first words are bold", async () => {
    const html = renderHow(await demoModel());

    expect(html).toMatch(/^<section aria-labelledby="how-h">/);
    expect(html).toContain('<h2 id="how-h">How voicecap works</h2>');
    // The lead is the fixed text, with "The person running it reads the transcripts" in bold.
    expect(HOW_LEAD).toContain("The person running it reads the transcripts");
    expect(textOf(html.match(/<p class="gist">(.*?)<\/p>/s)?.[1] ?? "", "")).toBe(HOW_LEAD);
    // And escaped, as the rest of the page is: the start of the lead has an apostrophe in it.
    expect(html).toContain(`<p class="gist">${esc(HOW_LEAD.slice(0, 60))}`);
    expect(html).toContain(
      "<b>The person running it reads the transcripts</b> and fixes what they find",
    );
    expect(html.match(/<b>The person/g)).toHaveLength(1);
  });

  it("says, after the lead, that each page is checked with axe before NVDA reads it, as evidence beside the person's review", async () => {
    const html = renderHow(await demoModel());
    const lines = [...html.matchAll(/<p class="gist">(.*?)<\/p>/gs)].map(([, line = ""]) =>
      textOf(line, ""),
    );

    expect(lines).toEqual([HOW_LEAD, AXE_TEXT.how]);
    expect(html).toContain(`<p class="gist">${esc(AXE_TEXT.how)}</p>`);
    expect(html.indexOf(esc(AXE_TEXT.how))).toBeLessThan(html.indexOf('<ol class="flow"'));
  });

  it("lists the six steps in order, each with its picture, its title in an h3, and its words", async () => {
    const html = renderHow(await demoModel());
    const list = /<ol class="flow" role="list">(.*?)<\/ol>/s.exec(html)?.[1] ?? "";
    const items = list.split("<li>").slice(1);

    expect(items).toHaveLength(6);
    for (const [index, step] of HOW_STEPS.entries()) {
      const item = items[index] ?? "";
      expect(item).toContain(
        `<span class="ico" aria-hidden="true">${STEP_ICONS[step.icon]}</span>`,
      );
      expect(item).toContain(
        `<h3><span class="step-n">${index + 1}<span class="sr">.</span></span> ${esc(step.title)}</h3>`,
      );
      // Escaped: the fixed text has apostrophes, which read back the same either way, so it's the
      // markup that's compared.
      expect(item).toContain(`<p>${esc(step.text)}</p>`);
    }
  });

  it("gives the first lines of each pass on the home page, as NVDA said them, with how long each took", async () => {
    const model = await demoModel();
    // The sample is a fold: its title is the line, with no heading in it, and the lanes are inside.
    const [, line = "", heard = ""] =
      /<details class="fold heard-fold"><summary>(.*?)<\/summary><div class="inside">(.*?)<\/div><\/details>\s*<div class="when">/s.exec(
        renderHow(model),
      ) ?? [];

    expect(line).toBe(
      '<span class="what">Heard on this site: http://127.0.0.1:4848/, three ways</span>',
    );
    expect(heard).not.toMatch(/<h[1-6][\s>]/);
    const lanes = heard.split('<figure class="lane">').slice(1);
    expect(lanes).toHaveLength(3);
    expect(lanes.map((lane) => /<figcaption>(.*?)<\/figcaption>/.exec(lane)?.[1])).toEqual([
      "<kbd>Down Arrow</kbd> line by line",
      "<kbd>H</kbd> heading by heading",
      "<kbd>Tab</kbd> control by control",
    ]);
    expect(lanes[0]).toContain(
      '<ol class="said-list" role="list"><li><span>“banner landmark, voicecap demo”</span><span class="t">1.3 s</span></li>',
    );
    // Every line the model has, in order, in the lane of its pass.
    for (const [index, { lines }] of (model.heard?.passes ?? []).entries()) {
      const spoken = [
        ...(lanes[index] ?? "").matchAll(
          /<li><span>“(.*?)”<\/span><span class="t">(.*?)<\/span><\/li>/g,
        ),
      ];
      expect(spoken.map(([, text, took]) => [textOf(text ?? ""), took])).toEqual(
        lines.map(({ text, took }) => [text, took]),
      );
    }
    // What the times are, said once.
    expect(textOf(heard)).toContain("NVDA's own words");
  });

  it("says how many ways through the page it heard, and escapes what NVDA said", async () => {
    const model = await demoModel();
    const html = renderHow({
      ...model,
      heard: {
        page: "<i>Home</i> & more",
        passes: [{ pass: "tab", lines: [{ text: 'a <b> & "c"', took: "1.3 <s>" }] }],
      },
    });
    const twoWays = renderHow({
      ...model,
      heard: { page: "Home", passes: model.heard?.passes.slice(0, 2) ?? [] },
    });

    expect(html).toContain(
      '<summary><span class="what">Heard on this site: &lt;i&gt;Home&lt;/i&gt; &amp; more, one way</span></summary>',
    );
    expect(html).toContain(
      '<li><span>“a &lt;b&gt; &amp; &quot;c&quot;”</span><span class="t">1.3 &lt;s&gt;</span></li>',
    );
    expect(html.match(/<figure class="lane">/g)).toHaveLength(1);
    expect(html).toContain("<kbd>Tab</kbd> control by control");
    expect(html).not.toContain("Down Arrow");
    expect(twoWays).toContain(
      '<summary><span class="what">Heard on this site: Home, two ways</span></summary>',
    );
    expect(html).not.toContain("<i>Home");
  });

  // The sample follows the rule a card's Heard first follows: a pass is quoted only when its
  // transcript, the file the page shows, can be read here.
  it("quotes a pass only when its transcript can be read here, and counts the ways through the page by those", () => {
    const model = homeModel(withoutTxt(storeOf(), (_slug, pass) => pass === "headings"));
    const html = renderHow(model);

    expect(html).toContain(
      `<summary><span class="what">Heard on this site: ${SITE}, two ways</span></summary>`,
    );
    expect(
      [...html.matchAll(/<figcaption>(.*?)<\/figcaption>/g)].map(([, caption]) => caption),
    ).toEqual(["<kbd>Down Arrow</kbd> line by line", "<kbd>Tab</kbd> control by control"]);
    // Nothing of the pass whose transcript can't be read, though its steps can.
    expect(html).not.toContain("<kbd>H</kbd>");
    expect(html).not.toContain("no next heading");
    expect(html).toContain("click here, link");
  });

  it("says no sample is available when no pass's transcript can be read here", () => {
    const model = homeModel(withoutTxt(storeOf()));
    const html = renderHow(model);

    expect(model.heard).toBeNull();
    expect(html).toContain("<h3>Heard on this site</h3>");
    expect(html).toContain("Not recorded: no sample of the home page&#39;s lines is available.");
    expect(html).not.toContain('class="lanes"');
  });

  // A step where NVDA said nothing is the marker the transcript writes, a note and not words NVDA
  // said: a card's Heard first sets it bare, and so does the sample.
  it("sets a step where NVDA said nothing as the marker, with no quotes, as a card does", () => {
    const model = homeModel(
      storeOf(() => ({ ...LINES, read: ["banner landmark, Home", "", "heading, level 1, Home"] })),
    );
    const html = renderHow(model);
    const read = html.split('<figure class="lane">')[1] ?? "";

    expect(
      [...read.matchAll(/<li><span>(.*?)<\/span><span class="t">(.*?)<\/span><\/li>/g)].map(
        ([, said, took]) => [said, took],
      ),
    ).toEqual([
      ["“banner landmark, Home”", "1.2 s"],
      ["[no speech]", "1.2 s"],
      ["“heading, level 1, Home”", "1.2 s"],
    ]);
    expect(html).not.toContain("“[no speech]”");
  });

  it("says it wasn't recorded when no home page has transcripts to quote", () => {
    const model = noRunModel();
    const html = renderHow(model);

    expect(model.heard).toBeNull();
    expect(html).toContain("<h3>Heard on this site</h3>");
    expect(html).toContain(
      '<p class="not-recorded">Not recorded: no sample of the home page&#39;s lines is available.</p>',
    );
    expect(html).not.toContain('class="lanes"');
    // There is no sample to fold, so the gap is said in the open, never behind a click.
    expect(html).not.toMatch(/<(?:details|summary)[\s>]/);
    // The rest of the section is the same.
    expect(html).toContain('<ol class="flow" role="list">');
    expect(html).toContain('<div class="when">');
  });

  it("closes with when to run voicecap, as one passage, and its four stages with one marked", async () => {
    const html = renderHow(await demoModel());
    const when = /<div class="when">(.*?)<\/section>/s.exec(html)?.[1] ?? "";

    expect(when).toContain(
      '<h3 class="when-title">When to run voicecap: <span>before the site goes live.</span></h3>',
    );
    expect(textOf(when.match(/<h3 class="when-title">(.*?)<\/h3>/s)?.[1] ?? "", "")).toBe(
      WHEN_TO_RUN.headline,
    );
    expect(when).toContain(`<p class="when-lead">${esc(WHEN_TO_RUN.text)}</p>`);
    expect(when).toContain('<ol class="stages" role="list">');
    const stages = when.split("<li").slice(1);
    expect(stages).toHaveLength(WHEN_TO_RUN.stages.length);
    for (const [index, stage] of WHEN_TO_RUN.stages.entries()) {
      const item = stages[index] ?? "";
      expect(item).toContain(
        `<b>${esc(stage.title)}</b><span class="st">${esc(stage.text)}</span></li>`,
      );
      // Only the marked stage is set apart.
      expect(item.startsWith(stage.marked ? ' class="run">' : ">")).toBe(true);
    }
    expect(WHEN_TO_RUN.stages.filter((stage) => stage.marked)).toHaveLength(1);
  });
});

describe("the top, At a glance, and how voicecap works together", () => {
  /** Each model the three are tried on. */
  const models = async (): Promise<[string, ShareModel][]> => [
    ["the demo's", await demoModel()],
    ["a person's run", richModel()],
    ["a copy, named by its canonical address", copyModel()],
    ["no counted run", noRunModel()],
  ];

  it("never sets a style attribute, loads nothing, and links only where it should", async () => {
    for (const [name, model] of await models()) {
      const html = pageOf(model);
      // Where the site has a canonical address, its root is the one link to the site.
      const root = model.header.readFrom === null ? null : model.header.site;

      expect(html, name).not.toMatch(/\sstyle\s*=/i);
      expect(html, name).not.toMatch(/\ssrc\s*=/i);
      expect(html, name).not.toMatch(/<(?:script|style|link|img|iframe)[\s>]/i);
      for (const href of attributes(html, "href")) {
        const allowed =
          href.startsWith("#") || href === GITHUB || href === NV_ACCESS || href === root;
        expect(allowed, `${name}: ${href}`).toBe(true);
      }
    }
  });

  it("is open but for the sample of what NVDA said, its one fold, with no heading in its line", async () => {
    // The folds' own rules (no heading in a summary line, no section heading in a fold) are
    // tested on `fold`; these three sections are open at first, and use one: the sample, which a
    // site with no home page to quote has none of.
    for (const [name, model] of await models()) {
      const html = pageOf(model);
      const folds = model.heard === null ? 0 : 1;

      expect(html.match(/<details[\s>]/g)?.length ?? 0, name).toBe(folds);
      expect(html.match(/<summary>/g)?.length ?? 0, name).toBe(folds);
      for (const [, line = ""] of html.matchAll(/<summary>(.*?)<\/summary>/gs)) {
        expect(line, name).not.toMatch(/<h[1-6][\s>]/);
      }
    }
  });

  it("draws no picture a screen reader would meet: the steps' icons and the ring are all it has, and they're hidden", async () => {
    // A chip is never drawn here: the stages' words are in the fixed text, and `chip` itself
    // refuses a chip with no words. The bars moved to the details, with their numbers in text, and
    // the ring has its own in the legend beside it. A site where nothing counts has no ring.
    for (const [name, model] of await models()) {
      const html = pageOf(model);
      const rings = model.result.pages > 0 ? 1 : 0;
      // The ring's box is hidden from screen readers whole, so its picture needs no attribute of its own.
      const outside = html.replace(/<div class="ring" aria-hidden="true">.*?<\/div>/gs, "");
      const hidden = outside.match(/<svg [^>]*aria-hidden="true"/g)?.length ?? 0;

      expect(html.match(/<svg /g)?.length ?? 0, name).toBe(HOW_STEPS.length + rings);
      expect(outside.match(/<svg /g)?.length ?? 0, name).toBe(HOW_STEPS.length);
      expect(hidden, name).toBe(HOW_STEPS.length);
      expect(html, name).not.toContain('role="img"');
    }
  });

  it("sets its headings in order: an h1, then an h2 for each section, then h3 inside it", async () => {
    const html = pageOf(await demoModel());
    const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((found) => Number(found[1]));

    expect(levels[0]).toBe(1);
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    for (const [index, level] of levels.entries()) {
      if (index > 0) expect(level - (levels[index - 1] ?? 0)).toBeLessThanOrEqual(1);
    }
  });

  it("never calls voicecap automated", async () => {
    // Each piece of text on its own, as a sentence about voicecap would sit in one: the lead's
    // "automated checkers" are other tools, and follow the heading "How voicecap works".
    for (const [name, model] of await models()) {
      for (const piece of pageOf(model).split(/<[^>]*>/)) {
        expect(textOf(piece), name).not.toMatch(/voicecap[^.]*\bautomated\b/i);
      }
    }
  });
});
