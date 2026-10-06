/**
 * The shareable page's top, its summary, and "How voicecap works", with the parts every section
 * draws with (folds, chips, bars, and the spoken-line strip). The demo runs of 29 September 2026
 * (voicecap 0.4.1, in test/fixtures/share/) are the real case; runs built in memory cover the rest.
 */
import { describe, expect, it } from "vitest";

import type { FlagResult } from "../src/model.js";
import { esc, plural } from "../src/report/html.js";
import { STEP_ICONS } from "../src/share/html/icons.js";
import {
  bar,
  chip,
  count,
  fold,
  notRecorded,
  scroll,
  strip,
  track,
  verdictLine,
} from "../src/share/html/parts.js";
import { renderHow, renderSummary, renderTop } from "../src/share/html/top.js";
import type { ShareInput } from "../src/share/load.js";
import { buildShareModel, type ShareModel } from "../src/share/model.js";
import type { Summary } from "../src/share/summary.js";
import { HOW_LEAD, HOW_STEPS, WHEN_TO_RUN } from "../src/share/text.js";
import { SITE } from "./helpers/report-data.js";
import { shareRun } from "./helpers/share-data.js";
import { attributes, textOf } from "./helpers/share-html.js";
import { DEMO_ROOT, demoModel, inputOf } from "./helpers/share-model.js";

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

/**
 * The model with its summary's problems as `cards` give them, each on a page of its own, and
 * `skipped` pages skipped and not read.
 */
function withCards(
  model: ShareModel,
  cards: { id: string; title: string }[],
  skipped = 0,
): ShareModel {
  const attention = { problems: cards.length, pages: cards.length, skipped, cards };
  return { ...model, summary: { ...model.summary, attention } };
}

/** The model with its summary's human review as `review` gives it. */
function withReview(model: ShareModel, review: Summary["bars"]["review"]): ShareModel {
  const bars = { ...model.summary.bars, review };
  return { ...model, summary: { ...model.summary, bars } };
}

/** `count` cards as the summary has them: "need-1" titled "Problem 1", and so on. */
const problemsOf = (count: number) =>
  Array.from({ length: count }, (_, at) => ({ id: `need-${at + 1}`, title: `Problem ${at + 1}` }));

/** The summary's panel on what needs attention: its markup, and the links in it, address and words. */
function attentionPanelOf(html: string): { panel: string; links: [string, string][] } {
  const panel = /<div class="panel[^"]*"><h3>What needs attention<\/h3>.*?<\/div>/s.exec(html)?.[0];
  if (panel === undefined) throw new Error("The summary has no panel on what needs attention.");
  const links = [...panel.matchAll(/<a href="([^"]*)">(.*?)<\/a>/g)].map(
    ([, href = "", words = ""]): [string, string] => [href, textOf(words, "")],
  );
  return { panel, links };
}

/** The three renderers' output, in the order the page has them. */
function pageOf(model: ShareModel): string {
  return [renderTop(model), renderSummary(model), renderHow(model)].join("\n");
}

/** What each of the five tiles shows, and what a screen reader says of its big number. */
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

/** The meters of the summary, as the HTML of each. */
function metersOf(html: string): string[] {
  const [meters = ""] = html.split('<nav class="toc"');
  return meters.split('<div class="meter">').slice(1);
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

describe("bar", () => {
  const results = [
    { label: "no flags", value: 6, kind: "ok" },
    { label: "flags", value: 1, kind: "warn" },
    { label: "never transcribed", value: 0, kind: "bad" },
  ];
  const caption = "6 pages without flags, 1 page with flags";

  it("is an SVG bar with a name, its segments as wide as their share, and its numbers in text beside it", () => {
    expect(bar(results, 7, caption)).toBe(
      `<svg class="bar" width="100%" height="14" role="img" aria-label="${caption}">` +
        '<rect class="c-ok" x="0" y="0" width="85.71%" height="100%" fill="currentColor"/>' +
        '<rect class="c-warn" x="85.71%" y="0" width="14.29%" height="100%" fill="currentColor"/>' +
        "</svg>" +
        '<div class="legend"><span class="l-ok"><b>6</b> no flags</span>' +
        '<span class="l-warn"><b>1</b> flags</span>' +
        '<span class="l-bad"><b>0</b> never transcribed</span></div>',
    );
  });

  it("leaves the rest of the track empty when the segments are part of the total", () => {
    const html = bar([{ label: "listened", value: 3, kind: "ok" }], 12, "3 of 12");

    expect(html).toContain('<rect class="c-ok" x="0" y="0" width="25%" height="100%"');
    expect(html.match(/<rect /g)).toHaveLength(1);
  });

  it("never draws past the end of the track", () => {
    const html = bar(
      [
        { label: "a", value: 8, kind: "ok" },
        { label: "b", value: 8, kind: "warn" },
      ],
      10,
      "too many",
    );

    expect(html).toContain('x="0" y="0" width="80%"');
    expect(html).toContain('x="80%" y="0" width="20%"');
  });

  it("draws nothing for a total that is nothing, and still gives its numbers in text", () => {
    const html = bar([{ label: "pages", value: 0, kind: "quiet" }], 0, "No pages");

    expect(html).not.toContain("<rect");
    expect(html).toContain('<span class="l-q"><b>0</b> pages</span>');
  });

  it("escapes its caption and its labels, and sets no style attribute", () => {
    const html = bar([{ label: "<i>x</i>", value: 1, kind: "ok" }], 1, 'a "caption"');

    expect(html).toContain('aria-label="a &quot;caption&quot;"');
    expect(html).toContain("<b>1</b> &lt;i&gt;x&lt;/i&gt;");
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

    expect(html).toContain("<h1>voicecap.netlify.app</h1>");
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

    expect(words(/<h1>(.*?)<\/h1>/s.exec(html)?.[1])).toBe("voicecap.netlify.app");
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

describe("renderSummary", () => {
  it("is a section named by its h2, which comes before How voicecap works", async () => {
    const model = await demoModel();
    const html = pageOf(model);

    expect(renderSummary(model)).toMatch(
      /^<section class="glance" aria-labelledby="glance-h">[\s\S]*<\/section>$/,
    );
    const summary = html.indexOf('<h2 id="glance-h">Summary</h2>');
    const how = html.indexOf('<h2 id="how-h">How voicecap works</h2>');
    expect(summary).toBeGreaterThan(-1);
    expect(how).toBeGreaterThan(summary);
    expect(html.match(/<h2[ >]/g)).toHaveLength(2);
    // The summary's own parts are h3.
    expect(renderSummary(model)).not.toMatch(/<h[14-6][ >]/);
  });

  it("opens with the result in a sentence, then the line on what voicecap and the person each did", async () => {
    const html = renderSummary(await demoModel());

    expect(html).toContain(
      '<p class="lead verdict">NVDA read all 7 pages. 4 problems need attention, on 1 page.</p>',
    );
    expect(html).toContain(
      '<p class="gist">A human review, sped up: voicecap presses NVDA&#39;s keys and moves from page to page; the person running it does the reading and the deciding.</p>',
    );
    expect(html.indexOf("lead verdict")).toBeLessThan(html.indexOf('class="gist"'));
  });

  it("shows five numbers, as the model has them", async () => {
    const tiles = tilesOf(renderSummary(await demoModel()));

    expect(tiles.map(({ shown, label }) => [shown, label])).toEqual([
      ["7", "pages in scope"],
      ["7/7", "transcribed by NVDA"],
      ["1", "page with flags, 3 rules"],
      ["204", "lines NVDA spoke"],
      ["12m 34s", "of NVDA time, across 2 runs"],
    ]);
    // A screen reader says each fraction and each time in words.
    expect(tiles.map(({ spoken }) => spoken)).toEqual([
      "7",
      "7 of 7",
      "1",
      "204",
      "12 minutes 34 seconds",
    ]);
  });

  it("has no tile for the pages a person heard NVDA read", () => {
    // The person heard NVDA on all three of these pages, and no tile says so: it is on each page's
    // chip, and in each run's evidence.
    const html = renderSummary(richModel());

    expect(tilesOf(html)).toHaveLength(5);
    expect(html).not.toContain("heard live by a person");
    expect(tilesOf(html).map(({ label }) => label)).not.toContain("heard live by a person");
  });

  it("shows five numbers that follow the model, in other numbers and in the singular", () => {
    const model = richModel();
    const { numbers } = model.summary;
    const tiles = tilesOf(renderSummary(model));

    expect(numbers).toMatchObject({ pagesInScope: 3, transcribed: 3, flagged: 1, rules: 1 });
    expect(numbers.linesSpoken).toBe(16);
    expect(tiles.map(({ shown, label }) => [shown, label])).toEqual([
      [String(numbers.pagesInScope), "pages in scope"],
      [`${numbers.transcribed}/${numbers.pagesInScope}`, "transcribed by NVDA"],
      [String(numbers.flagged), "page with flags, 1 rule"],
      [String(numbers.linesSpoken), "lines NVDA spoke"],
      ["1h 5m", "of NVDA time, across 1 run"],
    ]);
    expect(tiles.at(-1)?.spoken).toBe("1 hour 5 minutes");
  });

  it("colors a tile by its result, and a tile's words never rest on color", () => {
    // Complete counts are "ok", flags are "warn", plain counts "quiet".
    expect(tilesOf(renderSummary(richModel())).map(({ kind }) => kind)).toEqual([
      "quiet",
      "ok",
      "warn",
      "quiet",
      "quiet",
    ]);
  });

  it("says a tile's count out of its total when some pages weren't read", () => {
    const model = richModel();
    const tiles = tilesOf(
      renderSummary(withNumbers(model, { transcribed: 2, flagged: 0, rules: 0 })),
    );

    expect(tiles.map(({ kind }) => kind)).toEqual(["quiet", "warn", "quiet", "quiet", "quiet"]);
    expect(tiles[1]?.spoken).toBe("2 of 3");
    expect(tiles[2]?.label).toBe("pages with flags");
  });

  it("words each tile in the singular for one", () => {
    const one = { pagesInScope: 1, transcribed: 1, flagged: 1, rules: 1, linesSpoken: 1 };
    const tiles = tilesOf(renderSummary(withNumbers(richModel(), one)));

    expect(tiles.map(({ label }) => label)).toEqual([
      "page in scope",
      "transcribed by NVDA",
      "page with flags, 1 rule",
      "line NVDA spoke",
      "of NVDA time, across 1 run",
    ]);
    expect(tiles.map(({ kind }) => kind)).toEqual(["quiet", "ok", "warn", "quiet", "quiet"]);
    // And in the plural for a rule count that isn't one.
    expect(tilesOf(renderSummary(withNumbers(richModel(), { rules: 3 })))[2]?.label).toBe(
      "page with flags, 3 rules",
    );
  });

  it("shows nothing complete for a run with no pages", () => {
    const model = richModel();
    const empty = withNumbers(model, {
      pagesInScope: 0,
      transcribed: 0,
      flagged: 0,
      rules: 0,
      linesSpoken: 0,
    });
    const html = renderSummary({
      ...empty,
      summary: {
        ...empty.summary,
        bars: { ...empty.summary.bars, results: { done: 0, flagged: 0, never: 0 } },
      },
    });

    expect(tilesOf(html).map(({ kind }) => kind)).toEqual(Array<string>(5).fill("quiet"));
    expect(tilesOf(html)[1]?.spoken).toBe("0 of 0");
    expect(html).toContain('aria-label="No pages"');
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
      const html = renderSummary(withNumbers(richModel(), { nvdaMs: ms }));
      const [time] = tilesOf(html).slice(-1);

      expect(time, shown).toMatchObject({ shown, spoken });
    }
    expect(renderSummary(withNumbers(richModel(), { nvdaMs: 383_000 }))).toContain(
      '<span aria-hidden="true">6<small>m</small> 23<small>s</small></span>',
    );
  });

  it("says how many sessions the NVDA time leaves out, having no recorded end", () => {
    const label = (sessionsWithoutEnd: number) =>
      tilesOf(renderSummary(withNumbers(richModel(), { sessionsWithoutEnd }))).at(-1)?.label;

    expect(label(0)).toBe("of NVDA time, across 1 run");
    expect(label(1)).toBe(
      "of NVDA time, across 1 run; 1 session without a recorded end isn't counted",
    );
    expect(label(2)).toBe(
      "of NVDA time, across 1 run; 2 sessions without a recorded end aren't counted",
    );
  });

  it("writes four panels, each an h3, in order", async () => {
    const html = renderSummary(await demoModel());
    const titles = [...html.matchAll(/<div class="panel[^"]*"><h3>(.*?)<\/h3>/g)].map((found) =>
      textOf(found[1] ?? ""),
    );

    expect(titles).toEqual([
      "What needs attention",
      "How complete the test was",
      "What's still to do",
      "When and how",
    ]);
  });

  it("says how many problems there are and on how many pages, then links each to its card by its title", async () => {
    const model = await demoModel();
    const html = renderSummary(model);

    expect(model.summary.attention).toMatchObject({ problems: 5, pages: 2 });
    expect(html).toContain(
      '<div class="panel attention"><h3>What needs attention</h3>' +
        "<p>5 problems, on 2 pages:</p><ul>" +
        '<li><a href="#need-1">A button is read only as &quot;button&quot;: likely an icon button with no name</a></li>' +
        '<li><a href="#need-2">A form field is read only as &quot;edit&quot;: likely a missing label</a></li>' +
        '<li><a href="#need-3">Links read as &quot;click here&quot;: link text that doesn&#39;t say where it goes</a></li>' +
        '<li><a href="#need-4">The first heading is level 2, not 1: likely a missing &lt;h1&gt;</a></li>' +
        '<li><a href="#need-5">A page the latest run couldn&#39;t read</a></li></ul></div>',
    );
  });

  it("names five cards, then counts the rest, linked to the section", () => {
    const { panel, links } = attentionPanelOf(renderSummary(withCards(richModel(), problemsOf(7))));

    expect(panel).toContain("<p>7 problems, on 7 pages:</p>");
    // Five by their titles, then the other two counted, with a link to every card in its section.
    expect(links).toEqual([
      ["#need-1", "Problem 1"],
      ["#need-2", "Problem 2"],
      ["#need-3", "Problem 3"],
      ["#need-4", "Problem 4"],
      ["#need-5", "Problem 5"],
      ["#need-h", "and 2 more, under What needs attention"],
    ]);
    expect(panel).not.toContain("Problem 6");
    expect(panel).not.toContain("#need-6");
  });

  it("names every card when there are five, and counts one more when there are six", () => {
    const five = attentionPanelOf(renderSummary(withCards(richModel(), problemsOf(5))));
    const six = attentionPanelOf(renderSummary(withCards(richModel(), problemsOf(6))));

    expect(five.links.map(([href]) => href)).toEqual([
      "#need-1",
      "#need-2",
      "#need-3",
      "#need-4",
      "#need-5",
    ]);
    expect(five.panel).not.toContain("more, under");
    expect(six.links.at(-1)).toEqual(["#need-h", "and 1 more, under What needs attention"]);
    expect(six.links).toHaveLength(6);
  });

  it("counts every problem and every page in its lead, however many cards it names (a site with 40)", () => {
    const { panel, links } = attentionPanelOf(
      renderSummary(withCards(richModel(), problemsOf(40))),
    );

    expect(panel).toContain("<p>40 problems, on 40 pages:</p>");
    expect(links).toHaveLength(6);
    expect(links.at(-1)).toEqual(["#need-h", "and 35 more, under What needs attention"]);
  });

  it("says a problem on one page in the singular", () => {
    const { panel } = attentionPanelOf(renderSummary(withCards(richModel(), problemsOf(1))));

    expect(panel).toContain("<p>1 problem, on 1 page:</p>");
  });

  it("escapes a card's title, and its id", () => {
    const model = withCards(richModel(), [
      { id: 'need-"1"', title: '<script>alert("x")</script> & Co' },
    ]);
    const html = renderSummary(model);

    expect(html).toContain(
      '<li><a href="#need-&quot;1&quot;">&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Co</a></li>',
    );
    expect(html).not.toContain("<script>");
  });

  it("says nothing needs attention when no problem is left", () => {
    const run = shareRun({ id: "r1", pages: [{ path: "/" }] });
    const model = buildShareModel(inputOf([run]));
    const html = renderSummary(model);

    expect(model.summary.attention).toEqual({ problems: 0, pages: 0, skipped: 0, cards: [] });
    expect(html).toContain(
      '<div class="panel"><h3>What needs attention</h3><p>Nothing needs attention: every page was read, and every flag was fixed or checked by a person.</p></div>',
    );
    expect(html).not.toContain("panel attention");
    expect(html).not.toContain("No page has flags or an open issue");
  });

  it("says nothing needs attention on the pages read, and how many were skipped, when pages were skipped and nothing else needs attention", () => {
    /** One page read, and `count` that voicecap loaded and skipped: they are on no card. */
    const skipped = (count: number): ShareModel =>
      buildShareModel(
        inputOf([
          shareRun({
            id: "r1",
            pages: [
              { path: "/" },
              ...Array.from({ length: count }, (_, at) => ({
                path: `/file-${at + 1}/`,
                status: "skipped" as const,
              })),
            ],
          }),
        ]),
      );
    const one = skipped(1);
    const two = skipped(2);

    expect(one.summary.attention).toEqual({ problems: 0, pages: 0, skipped: 1, cards: [] });
    expect(two.summary.attention).toMatchObject({ problems: 0, skipped: 2 });
    expect(renderSummary(one)).toContain(
      '<div class="panel"><h3>What needs attention</h3><p>Nothing needs attention on the pages read: every flag was fixed or checked by a person. 1 page was skipped, not read.</p></div>',
    );
    expect(attentionPanelOf(renderSummary(two)).panel).toContain(
      "<p>Nothing needs attention on the pages read: every flag was fixed or checked by a person. 2 pages were skipped, not read.</p>",
    );
    // It never says every page was read, since some weren't, and it isn't the panel of problems.
    for (const model of [one, two]) {
      const { panel } = attentionPanelOf(renderSummary(model));

      expect(panel).not.toContain("every page was read");
      expect(panel).not.toContain("panel attention");
    }
  });

  it("names the problems, never the line for none, when a page was skipped too", () => {
    const { panel, links } = attentionPanelOf(
      renderSummary(withCards(richModel(), problemsOf(2), 3)),
    );

    expect(panel).toContain("<p>2 problems, on 2 pages:</p>");
    expect(links.map(([href]) => href)).toEqual(["#need-1", "#need-2"]);
    expect(panel).not.toContain("Nothing needs attention");
    expect(panel).not.toContain("skipped");
  });

  it("lists how complete the test was, with links to the problems and to what changed", async () => {
    const model = await demoModel();
    const html = renderSummary(model);
    const [pagesRead, problems, unexpected] = model.summary.complete;

    expect(html).toContain("<h3>How complete the test was</h3><ul>");
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
    const html = renderSummary(richModel());

    expect(html).not.toContain("Since the last run");
    expect(html).not.toContain(">What changed</a>");
  });

  it("lists what's still to do, and when and how it was run", async () => {
    const html = renderSummary(await demoModel());

    expect(html).toContain(
      "<h3>What&#39;s still to do</h3><ul>" +
        "<li>http://127.0.0.1:4848/how-a-run-works/ couldn&#39;t be read in the latest run (another window took the screen). Its transcripts are from run 2026-09-29_1315. Read it again.</li>" +
        "<li>Take a closer listen to http://127.0.0.1:4848/common-mistakes/, where flags were raised, and record what you decide.</li></ul>",
    );
    expect(html).toContain(
      "<h3>When and how</h3><ul>" +
        "<li><b>Date</b>: 29 September 2026</li>" +
        "<li><b>Run by</b>: Not recorded: this run used voicecap 0.4.1.</li>" +
        "<li><b>Screen reader</b>: NVDA 2026.2</li>" +
        "<li><b>Browser</b>: Chrome 154.0.8037.58</li>" +
        "<li><b>Operating system</b>: Windows 11 Pro 25H2 (10.0.26200)</li></ul>",
    );
  });

  it("draws three bars, each an h3 with its numbers in text", async () => {
    const meters = metersOf(renderSummary(await demoModel()));

    expect(meters.map((meter) => textOf(/<h3>(.*?)<\/h3>/s.exec(meter)?.[1] ?? ""))).toEqual([
      "Every page's latest result",
      "Flags by rule times each rule was raised, across pages and passes",
      "The human review each out of its total",
    ]);

    // Every page's latest result: a bar with a name, and its numbers beside it.
    const [results = "", rules = "", review = ""] = meters;
    expect(results).toContain('role="img" aria-label="6 pages without flags, 1 page with flags"');
    expect(textOf(results)).toContain("6 no flags 1 flags 0 never transcribed");
    expect(results).toContain('<rect class="c-ok" x="0" y="0" width="85.71%"');
    expect(results).toContain('<rect class="c-warn" x="85.71%" y="0" width="14.29%"');
    expect(results).not.toContain('class="c-bad"');
    expect(results).toContain('<span class="l-ok"><b>6</b> no flags</span>');
    expect(results).toContain('<span class="l-warn"><b>1</b> flags</span>');
    expect(results).toContain('<span class="l-bad"><b>0</b> never transcribed</span>');

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
  });

  it("draws a page never transcribed in its own segment, in words and in red", () => {
    const model = richModel();
    const [results = ""] = metersOf(
      renderSummary({
        ...model,
        summary: {
          ...model.summary,
          bars: { ...model.summary.bars, results: { done: 4, flagged: 2, never: 1 } },
        },
      }),
    );

    expect(results).toContain(
      'aria-label="4 pages without flags, 2 pages with flags, 1 page never transcribed"',
    );
    expect(results).toContain('<rect class="c-ok" x="0" y="0" width="57.14%"');
    expect(results).toContain('<rect class="c-warn" x="57.14%" y="0" width="28.57%"');
    expect(results).toContain('<rect class="c-bad" x="85.71%" y="0" width="14.29%"');
    expect(textOf(results)).toContain("4 no flags 2 flags 1 never transcribed");
  });

  it("gives each bar's numbers in text, and a screen reader each row once", () => {
    const [results = "", , review = ""] = metersOf(
      renderSummary(withReview(richModel(), { reviewed: [3, 3], fixed: [0, 0] })),
    );

    expect(textOf(results)).toContain("2 no flags 1 flags 0 never transcribed");
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
    const [, rules = ""] = metersOf(renderSummary(buildShareModel(inputOf([run]))));

    expect(textOf(rules)).toBe(
      "Flags by rule times each rule was raised, across pages and passes No flags were raised.",
    );
    expect(rules).not.toContain("<svg");
  });

  it("colors a review row by whether it's complete", () => {
    const rowsOf = (review: Summary["bars"]["review"]) => {
      const [, , html = ""] = metersOf(renderSummary(withReview(richModel(), review)));
      return html.split('<div class="rule">').slice(1);
    };
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

  it("ends with links to every later section by its h2's id", () => {
    const html = renderSummary(richModel());
    const nav = /<nav class="toc" aria-label="The full report">(.*?)<\/nav>/s.exec(html)?.[1] ?? "";

    expect(nav).toContain('<span class="sub">Read the full report:</span>');
    expect(
      [...nav.matchAll(/<a href="#([\w-]+)">(.*?)<\/a>/g)].map(([, id, text]) => [id, text]),
    ).toEqual([
      ["need-h", "What needs attention"],
      ["how-h", "How voicecap works"],
      ["pages-h", "Every page"],
      ["chg-h", "What changed since the last run"],
      ["prob-h", "Problems during the runs"],
      ["lim-h", "What these results cover"],
      ["ev-h", "The evidence"],
      ["story-h", "How voicecap came to be"],
      ["app-h", "Every transcript"],
    ]);
  });

  it("says only that no run counts, with no numbers, panels, or bars, when none does", () => {
    const html = renderSummary(noRunModel());

    expect(html).toContain(
      '<p class="lead verdict">No live run counts yet: voicecap shows only completed, sealed runs with a real screen reader.</p>',
    );
    expect(html).toContain('<p class="gist">A human review, sped up:');
    expect(html).not.toContain('class="tile');
    expect(html).not.toContain('class="panel');
    expect(html).not.toContain('class="meter');
    expect(html).not.toContain("<svg");
    // The way into the rest of the page stays.
    expect(html).toContain('<nav class="toc"');
  });

  it("escapes the sentence and the lines it's given", () => {
    const model = richModel();
    const html = renderSummary({
      ...model,
      summary: {
        ...model.summary,
        sentence: 'A <b>bold</b> & "quoted" sentence.',
        attention: {
          problems: 1,
          pages: 1,
          skipped: 0,
          cards: [{ id: "need-1", title: "<N> & d" }],
        },
        todo: ["Fix <i>this</i>."],
        complete: ["Pages read: <3>."],
        whenHow: [{ label: "R&D", value: "<x>" }],
        bars: { ...model.summary.bars, flagsByRule: [{ rule: "<rule>", count: 2 }] },
      },
    });

    expect(html).toContain("A &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot; sentence.");
    expect(html).toContain('<li><a href="#need-1">&lt;N&gt; &amp; d</a></li>');
    expect(html).toContain("<li>Fix &lt;i&gt;this&lt;/i&gt;.</li>");
    expect(html).toContain("<li>Pages read: &lt;3&gt;.</li>");
    expect(html).toContain("<li><b>R&amp;D</b>: &lt;x&gt;</li>");
    expect(html).toContain('<span class="mono">&lt;rule&gt;</span>');
    expect(html).not.toContain("<i>this");
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
    const heard =
      /<div class="heard">(.*?)<\/div>\s*<div class="when">/s.exec(renderHow(model))?.[1] ?? "";

    expect(heard).toContain("<h3>Heard on this site: http://127.0.0.1:4848/, three ways</h3>");
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
      "<h3>Heard on this site: &lt;i&gt;Home&lt;/i&gt; &amp; more, one way</h3>",
    );
    expect(html).toContain(
      '<li><span>“a &lt;b&gt; &amp; &quot;c&quot;”</span><span class="t">1.3 &lt;s&gt;</span></li>',
    );
    expect(html.match(/<figure class="lane">/g)).toHaveLength(1);
    expect(html).toContain("<kbd>Tab</kbd> control by control");
    expect(html).not.toContain("Down Arrow");
    expect(twoWays).toContain("<h3>Heard on this site: Home, two ways</h3>");
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

describe("the top, the summary, and how voicecap works together", () => {
  /** Each model, with how many bars (a picture with a name) its summary draws. */
  const models = async (): Promise<[string, ShareModel, number][]> => [
    ["the demo's", await demoModel(), 1],
    ["a person's run", richModel(), 1],
    ["a copy, named by its canonical address", copyModel(), 1],
    ["no counted run", noRunModel(), 0],
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

  it("is open: nothing in it is folded, so no summary line has a heading in it", async () => {
    // The folds' own rules (no heading in a summary line, no section heading in a fold) are
    // tested on `fold`; these three sections are open at first, and use none.
    for (const [name, model] of await models()) {
      expect(pageOf(model), name).not.toMatch(/<(?:details|summary)[\s>]/);
    }
  });

  it("names every bar with its numbers in text beside it, and hides every other picture", async () => {
    // A chip is never drawn here: the stages' words are in the fixed text, and `chip` itself
    // refuses a chip with no words.
    for (const [name, model, bars] of await models()) {
      const html = pageOf(model);
      const named = [
        ...html.matchAll(/<svg [^>]*role="img"[^>]*>.*?<\/svg>(<div class="legend">.*?<\/div>)/gs),
      ];

      expect(named, name).toHaveLength(bars);
      for (const [, legend = ""] of named) expect(textOf(legend), name).toMatch(/\d/);
      // Every picture is one of those or hidden: the rows' tracks, with their numbers beside
      // them, and the steps' icons.
      const svgs = html.match(/<svg /g)?.length ?? 0;
      const hidden = html.match(/<svg [^>]*aria-hidden="true"/g)?.length ?? 0;
      expect(svgs, name).toBe(hidden + bars);
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
