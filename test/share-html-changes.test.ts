/**
 * The shareable page's "What changed since the last run" and "Problems during the runs". The demo
 * runs of 29 September 2026 (voicecap 0.4.1, in test/fixtures/share/) are the real case: they sound
 * the same, and each lost a page to another window. Runs built in memory, with their transcripts
 * held in memory too, cover what the demo has none of: pages that sound different, flags that came
 * and went, and an error voicecap didn't expect. The tests are on the markup: it is the mockup's,
 * so its classes and its order are the contract.
 */
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { FlagResult, PassName } from "../src/model.js";
import { renderChanges } from "../src/share/html/changes.js";
import { renderProblems } from "../src/share/html/problems.js";
import type { ShareInput } from "../src/share/load.js";
import { buildShareModel, type ShareModel } from "../src/share/model.js";
import { KIND_ROWS } from "../src/share/problems.js";
import {
  failedAttempt,
  shareRun,
  type SharePageSpec,
  type ShareRunSpec,
} from "./helpers/share-data.js";
import {
  attributes,
  foldsIn,
  listsOf,
  rowsOf,
  scrollBoxes,
  summariesIn,
  tableOf,
  termsOf,
  textOf,
} from "./helpers/share-html.js";
import { demoModel, inputOf, storeOf, TRANSCRIPTS, type Lines } from "./helpers/share-model.js";

const ISSUES = "https://github.com/ICJIA/voicecap/issues";

/** The two runs compared are made on these days: "26 September" and "27 September". */
const BEFORE = "2026-09-26T14:05:00-05:00";
const AFTER = "2026-09-27T09:30:00-05:00";

/** The grants page's read pass before someone fixed its links, and after. */
const OLD_READ = [
  "banner landmark, link, Skip to main content",
  "heading, level 1, Grants",
  "To apply,, link, click here, dot",
  "To read the rules,, link, click here, dot",
  "main landmark",
  "region, Deadlines",
  "list with 3 items",
  "content info landmark, © 2026 Example Agency",
];
const NEW_READ = [
  "banner landmark, link, Skip to main content",
  "heading, level 1, Grants",
  "To apply,, link, Read the FY27 plan, dot",
  "To read the rules,, link, Download the grant rules, dot",
  "main landmark",
  "region, Deadlines",
  "list with 3 items",
  "content info landmark, © 2026 Example Agency",
];

const LINK_FLAG: FlagResult = {
  rule: "generic-link-text",
  pass: "read",
  count: 2,
  found: [{ text: "click here", count: 2 }],
  message: 'Generic link text announced 2 times in the read pass: "click here" ×2.',
};

const HEADINGS_FLAG: FlagResult = {
  rule: "headings",
  pass: "headings",
  message: "The first heading is level 2, not level 1.",
};

const UNLABELED_FLAG: FlagResult = {
  rule: "unlabeled",
  pass: "read",
  count: 1,
  message: "1 control has no name in the read pass.",
};

/** A page read in full, with the lines of each pass it gives. */
function done(pagePath: string, passes: Lines, extra: Partial<SharePageSpec> = {}): SharePageSpec {
  return { path: pagePath, files: TRANSCRIPTS, passes, ...extra };
}

interface RunsOptions {
  /** Which transcripts can be read at all: all of them by default. */
  readable?: (run: string, pass: PassName) => boolean;
}

/**
 * The model of runs built from specs, oldest first. Each page's transcripts are the lines its
 * spec gives, in the run it is in.
 */
function modelOfRuns(specs: ShareRunSpec[], options: RunsOptions = {}): ShareModel {
  const { readable = () => true } = options;
  const runs = specs.map((spec) => shareRun(spec));
  const said = new Map<string, Lines>();
  specs.forEach((spec, index) => {
    spec.pages.forEach((page, at) => {
      const slug = runs[index]?.pages[at]?.slug;
      if (slug !== undefined) said.set(`${spec.id}|${slug}`, page.passes ?? {});
    });
  });
  const store = storeOf((slug, run) => said.get(`${run}|${slug}`) ?? {});
  const transcripts: ShareInput["transcripts"] = {
    txt: (run, slug, pass) => (readable(run, pass) ? store.txt(run, slug, pass) : null),
    steps: (run, slug, pass) => store.steps(run, slug, pass),
  };
  return buildShareModel(inputOf(runs, { transcripts }));
}

/** Two runs of pages: the model of what changed from the first to the second. */
function changedModel(
  before: SharePageSpec[],
  after: SharePageSpec[],
  options: RunsOptions = {},
): ShareModel {
  return modelOfRuns(
    [
      { id: "r1", createdAt: BEFORE, pages: before },
      { id: "r2", createdAt: AFTER, pages: after },
    ],
    options,
  );
}

/** The grants page, whose links were fixed between the two runs. */
function grantsModel(): ShareModel {
  return changedModel(
    [done("/grants/", { read: OLD_READ }, { flags: [LINK_FLAG] })],
    [done("/grants/", { read: NEW_READ })],
  );
}

/** A run of one page that failed every attempt, as the given attempts say. */
function failedModel(
  attempts: ReturnType<typeof failedAttempt>[],
  extra: Partial<ShareRunSpec> = {},
): ShareModel {
  const page: SharePageSpec = { path: "/grants/", status: "failed", failedAttempts: attempts };
  return buildShareModel(inputOf([shareRun({ id: "r1", pages: [page], ...extra })]));
}

/** An error voicecap didn't expect, with the stack it left. */
const UNEXPECTED = failedAttempt({
  n: 1,
  cause: "unexpected",
  step: 3,
  message: "Cannot read properties of undefined (reading 'steps')",
  stack:
    "TypeError: Cannot read properties of undefined (reading 'steps')\n    at runPass (dist/run/page-runner.js:42:9)\n    at processPage (dist/run/page-runner.js:90:5)",
});

/** A later attempt, a minute after the first. */
const LATER = {
  startedAt: "2026-09-26T14:06:00.000-05:00",
  endedAt: "2026-09-26T14:06:10.000-05:00",
} as const;

describe("renderChanges", () => {
  describe("for the demo runs of 29 September 2026", () => {
    it("says every page read in full in both runs sounds exactly the same, with nothing folded", async () => {
      const html = renderChanges(await demoModel());

      expect(html).toMatch(/^<section aria-labelledby="chg-h">\s*<h2 id="chg-h">/);
      expect(html).toContain('<h2 id="chg-h">What changed since the last run</h2>');
      expect(html).toMatch(/<\/section>$/);
      expect(textOf(html)).toContain(
        "Every page read in full in both runs sounds exactly the same.",
      );
      // The line is set as the mockup sets its verdicts: in bold, as a whole sentence.
      expect(html).toContain(
        '<p class="prob-verdict"><b>Every page read in full in both runs sounds exactly the same.</b></p>',
      );
      // No page sounds different, so no page opens to show what changed.
      expect(foldsIn(html)).toEqual([]);
    });

    it("counts the pages that sound the same, and names the two runs it compared", async () => {
      const text = textOf(renderChanges(await demoModel()));

      expect(text).toContain("5 pages sound the same, and are counted, not shown.");
      expect(text).toContain(
        "Compared: run 2026-09-29_1315 (before) and run 2026-09-29_1402 (latest).",
      );
    });

    it("lists the pages read in only one of the two runs, each with its reason", async () => {
      const html = renderChanges(await demoModel());

      expect(textOf(html)).toContain(
        "2 pages were read in full in only one of the two runs, so they weren't compared:",
      );
      expect(listsOf(html).at(-1)).toEqual([
        "/how-a-run-works/: failed in one run, read in full in the other.",
        "/the-report/: failed in one run, read in full in the other.",
      ]);
    });

    it("says first that the browser and the config changed between the runs, since that can sound different", async () => {
      const model = await demoModel();
      const html = renderChanges(model);
      const [tools = []] = listsOf(html);

      expect(tools).toEqual(model.changes?.tools);
      expect(tools[0]).toContain("Chrome 153.0.8010.53 → Chrome 154.0.8037.58");
      expect(textOf(html)).toContain(
        "The tools differ between the two runs, so anything that sounds different may come from the tools rather than the site:",
      );
      // Before the verdict line: the first thing the section says.
      expect(html.indexOf("The tools differ")).toBeLessThan(html.indexOf("prob-verdict"));
    });
  });

  describe("for a page that sounds different", () => {
    it("folds it behind a line with its name, the lines each pass lost and gained, and its flags", () => {
      const html = renderChanges(grantsModel());

      expect(foldsIn(html)).toHaveLength(1);
      // As heard: a stop the eye doesn't see ends the counts before the chip.
      const summary = /<summary>(.*?)<\/summary>/s.exec(html)?.[1] ?? "";
      expect(textOf(summary, "")).toBe(
        "/grants/: read: 2 lines removed and 2 added. generic-link-text resolved",
      );
      expect(html).toContain('<details class="fold"><summary><span class="what">/grants/:</span>');
      // Closed: a page that sounds different opens to show what changed.
      expect(html).not.toMatch(/<details[^>]* open/);
      expect(html).toContain('<div class="folds">');
    });

    it("opens with the model's line, set as the mockup sets its verdicts", () => {
      const model = grantsModel();
      const html = renderChanges(model);

      expect(model.changes?.line).toContain("1 of 1 page sounds different");
      expect(textOf(html)).toContain(model.changes?.line);
      expect(html).toMatch(
        /<p class="prob-verdict"><b>Compared with the run on 26 September: 1 of 1 page sounds different, and 0 sound exactly the same\.<\/b> Resolved: on [^<]*, the links that don&#39;t say where they go \(generic-link-text\)\.<\/p>/,
      );
      expect(textOf(html)).toContain("A page that sounds different opens to show what changed.");
    });

    it("marks every removed and added line in words as well as color, with <mark> on the words that changed", () => {
      const [fold = ""] = foldsIn(renderChanges(grantsModel()));
      const table = tableOf(fold, "difftable");

      // The classes are the mockup's, one for each kind of row, in the order the lines come.
      expect([...table.matchAll(/<tr class="(\w+)">/g)].map((row) => row[1])).toEqual([
        "same",
        "same",
        "del",
        "add",
        "del",
        "add",
        "same",
        "same",
        "same",
      ]);
      const rows = [...table.matchAll(/<tr class="(del|add)">(.*?)<\/tr>/gs)].map(
        ([, kind = "", cells = ""]) => ({ kind, cells }),
      );
      expect(rows.map((row) => row.kind)).toEqual(["del", "add", "del", "add"]);
      for (const { kind, cells } of rows) {
        const [sign, word] = kind === "del" ? ["−", "Removed"] : ["+", "Added"];
        // The word is on the row to see, and in the line itself for a screen reader, which can read
        // a column of lines without the column beside it.
        expect(cells).toContain(`<td><span aria-hidden="true">${sign} ${word}</span></td>`);
        expect(cells).toContain(`<td><span class="sr">${word}: </span>`);
      }
      expect(rows[0]?.cells).toContain("To apply,, link, <mark>click here</mark>, dot</td>");
      expect(rows[1]?.cells).toContain(
        "To apply,, link, <mark>Read the FY27 plan</mark>, dot</td>",
      );
      expect(rows[3]?.cells).toContain("<mark>Download the grant rules</mark>");
      // The words that didn't change aren't marked.
      expect(rows[1]?.cells).not.toContain("<mark>To apply");
    });

    it("keeps the lines beside a change, and counts the run of lines the same that it leaves out", () => {
      const [fold = ""] = foldsIn(renderChanges(grantsModel()));

      expect(rowsOf(tableOf(fold, "difftable"))).toEqual([
        "Change | What NVDA said",
        "Same | banner landmark, link, Skip to main content",
        "Same | heading, level 1, Grants",
        "− Removed | Removed: To apply,, link, click here, dot",
        "+ Added | Added: To apply,, link, Read the FY27 plan, dot",
        "− Removed | Removed: To read the rules,, link, click here, dot",
        "+ Added | Added: To read the rules,, link, Download the grant rules, dot",
        "Same | main landmark",
        "Same | region, Deadlines",
        "… | 2 lines the same",
      ]);
      // The dots are for the eye: a screen reader is told the count, and not the dots.
      expect(tableOf(fold, "difftable")).toContain(
        '<tr class="same"><td><span aria-hidden="true">…</span></td><td>2 lines the same</td></tr>',
      );
    });

    it("says '1 line the same' for a run of one, and counts a long run", () => {
      const lines = (change: string, tail: number) => [
        "first",
        change,
        ...Array.from({ length: tail }, (_, index) => `same ${index + 1}`),
      ];
      const lastRow = (tail: number) =>
        rowsOf(
          tableOf(
            renderChanges(
              changedModel(
                [done("/a/", { read: lines("old", tail) })],
                [done("/a/", { read: lines("new", tail) })],
              ),
            ),
            "difftable",
          ),
        ).at(-1);

      expect(lastRow(3)).toBe("… | 1 line the same");
      expect(lastRow(14)).toBe("… | 12 lines the same");
    });

    it("gives each changed pass a heading and a table of its own, in pass order", () => {
      const html = renderChanges(
        changedModel(
          [done("/a/", { read: ["x", "old"], headings: ["h1", "h2"], tab: ["t1", "old"] })],
          [done("/a/", { read: ["x", "new"], headings: ["h1", "h2"], tab: ["t1", "new"] })],
        ),
      );
      const [fold = ""] = foldsIn(html);

      // The line gives each pass its own count, as the spec has it, and not their total.
      expect(summariesIn(html)).toEqual([
        "/a/: read: 1 line removed and 1 added; Tab: 1 line removed and 1 added",
      ]);
      const headings = [...fold.matchAll(/<h3 class="logh">(.*?)<\/h3>/gs)].map((found) =>
        textOf(found[1] ?? ""),
      );
      // Each names its page too, for a reader who goes through the headings and not the folds.
      expect(headings).toEqual([
        "The read pass on /a/ 1 line removed and 1 added",
        "The Tab pass on /a/ 1 line removed and 1 added",
      ]);
      expect(fold).toContain('<span class="sr">on /a/</span>');
      expect(fold.match(/<table class="difftable">/g)).toHaveLength(2);
      // The pass that didn't change has none.
      expect(fold).not.toContain("The headings pass");
    });

    it("gives each changed pass its own count on the line, and says what a pass only lost or only gained as it is", () => {
      const html = renderChanges(
        changedModel(
          [
            done("/a/", {
              read: ["first", "gone 1", "gone 2", "gone 3", "last"],
              headings: ["h1"],
              tab: ["t1", "t2", "t3"],
            }),
          ],
          [
            done("/a/", {
              read: ["first", "new 1", "new 2", "last"],
              headings: ["h1", "h2"],
              tab: ["t1", "t3"],
            }),
          ],
        ),
      );
      const [fold = ""] = foldsIn(html);

      expect(summariesIn(html)).toEqual([
        "/a/: read: 3 lines removed and 2 added; headings: 1 line added; Tab: 1 line removed",
      ]);
      // The same words head each pass's own table.
      const headings = [...fold.matchAll(/<h3 class="logh">(.*?)<\/h3>/gs)].map((found) =>
        textOf(found[1] ?? ""),
      );
      expect(headings).toEqual([
        "The read pass on /a/ 3 lines removed and 2 added",
        "The headings pass on /a/ 1 line added",
        "The Tab pass on /a/ 1 line removed",
      ]);
    });

    it("says no line was removed or added when a pass's record differs but the lines shown don't", () => {
      const before = shareRun({
        id: "r1",
        createdAt: BEFORE,
        pages: [done("/a/", { read: ["old"] })],
      });
      const after = shareRun({
        id: "r2",
        createdAt: AFTER,
        pages: [done("/a/", { read: ["new"] })],
      });
      // The records fingerprinted different lines, and the transcripts hold the same ones.
      const model = buildShareModel(
        inputOf([before, after], { transcripts: storeOf(() => ({ read: ["same"] })) }),
      );

      expect(summariesIn(renderChanges(model))).toEqual(["/a/: read: no lines removed or added"]);
    });

    it("counts the lines gone and the lines come apart, for a page that only lost or gained some", () => {
      const html = renderChanges(
        changedModel(
          [done("/a/", { read: ["first", "gone 1", "gone 2", "last"] })],
          [done("/a/", { read: ["first", "last", "new 1", "new 2", "new 3"] })],
        ),
      );
      const [fold = ""] = foldsIn(html);

      expect(summariesIn(html)).toEqual(["/a/: read: 2 lines removed and 3 added"]);
      expect(textOf(fold)).toContain("The read pass on /a/ 2 lines removed and 3 added");
      expect(rowsOf(tableOf(fold, "difftable"))).toEqual([
        "Change | What NVDA said",
        "Same | first",
        "− Removed | Removed: gone 1",
        "− Removed | Removed: gone 2",
        "Same | last",
        "+ Added | Added: new 1",
        "+ Added | Added: new 2",
        "+ Added | Added: new 3",
      ]);
      // A line with no partner is marked whole.
      expect(fold).toContain('<td><span class="sr">Added: </span><mark>new 1</mark></td>');
    });

    it("escapes the tools it says differ", () => {
      const html = renderChanges(
        modelOfRuns([
          {
            id: "r1",
            createdAt: BEFORE,
            sessions: [{ environment: { browser: { name: "<i>Chrome</i>", version: "153" } } }],
            pages: [done("/a/", { read: ["x"] })],
          },
          {
            id: "r2",
            createdAt: AFTER,
            sessions: [{ environment: { browser: { name: "Chrome", version: "154" } } }],
            pages: [done("/a/", { read: ["x"] })],
          },
        ]),
      );

      expect(listsOf(html)[0]?.[0]).toContain("<i>Chrome</i> 153 → Chrome 154");
      expect(html).not.toContain("<i>Chrome</i>");
      expect(html).toContain("&lt;i&gt;Chrome&lt;/i&gt;");
    });

    it("puts each table in a named box that a keyboard can reach and scroll", () => {
      const [fold = ""] = foldsIn(renderChanges(grantsModel()));

      expect(scrollBoxes(fold)).toEqual([
        '<div class="scroll" tabindex="0" role="region" aria-label="Changes in the read pass on /grants/, table">',
      ]);
      expect(fold).toContain('<caption class="sr">Changes in the read pass on /grants/</caption>');
      expect(fold).toContain('<th scope="col">Change</th><th scope="col">What NVDA said</th>');
    });

    it("says what each flag did between the runs, as resolved, new, or unchanged", () => {
      const html = renderChanges(
        changedModel(
          [done("/a/", { read: ["old"], headings: ["h"] }, { flags: [LINK_FLAG, UNLABELED_FLAG] })],
          [
            done(
              "/a",
              { read: ["new"], headings: ["h"] },
              { flags: [UNLABELED_FLAG, HEADINGS_FLAG] },
            ),
          ],
        ),
      );

      // On the line: the flags that came or went, as chips that say it in words.
      const [summary = ""] = summariesIn(html);
      expect(summary).toContain("generic-link-text resolved");
      expect(summary).toContain("headings new");
      expect(summary).not.toContain("unlabeled");
      expect(html).toContain('<span class="chip c-ok">generic-link-text resolved</span>');
      expect(html).toContain('<span class="chip c-warn">headings new</span>');
      // Heard, the counts end before the chips start, and each chip is said apart.
      expect(html).toContain(
        '<span class="sub">read: 1 line removed and 1 added</span><span class="sr">.</span> <span class="chips"><span class="chip c-ok">generic-link-text resolved</span><span class="sr">,</span> <span class="chip c-warn">headings new</span></span>',
      );
      // Inside: each flag, with its pass and what happened to it.
      expect(textOf(html)).toContain(
        "Flags: generic-link-text (read pass), 2 before, none now (resolved). headings (headings pass), none before, new. unlabeled (read pass), unchanged.",
      );
    });

    it("says a flag changed, with both counts, or with what it finds now when it has no count", () => {
      const fewer: FlagResult = {
        ...LINK_FLAG,
        count: 1,
        found: [{ text: "click here", count: 1 }],
        message: 'Generic link text announced 1 time in the read pass: "click here" ×1.',
      };
      const level3: FlagResult = {
        ...HEADINGS_FLAG,
        message: "The first heading is level 3, not level 1.",
      };
      const html = renderChanges(
        changedModel(
          [done("/a/", { read: ["old"], headings: ["h"] }, { flags: [LINK_FLAG, HEADINGS_FLAG] })],
          [done("/a/", { read: ["new"], headings: ["h"] }, { flags: [fewer, level3] })],
        ),
      );

      // Neither went or came, so the line has no chip for them; inside, neither is "unchanged".
      expect(summariesIn(html)).toEqual(["/a/: read: 1 line removed and 1 added"]);
      expect(textOf(html)).toContain(
        "Flags: generic-link-text (read pass), 2 before, 1 now (changed). headings (headings pass), changed: now its first heading is level 3, not 1.",
      );
      expect(textOf(html)).not.toContain("unchanged");
    });

    it("leaves a rule out of the chips while a pass only the later run read still raises it", () => {
      const tabFlag: FlagResult = { ...LINK_FLAG, pass: "tab" };
      const html = renderChanges(
        modelOfRuns([
          {
            id: "r1",
            createdAt: BEFORE,
            passes: ["read"],
            pages: [done("/a/", { read: ["old"] }, { flags: [LINK_FLAG] })],
          },
          {
            id: "r2",
            createdAt: AFTER,
            pages: [done("/a/", { read: ["new"], tab: ["t"] }, { flags: [tabFlag] })],
          },
        ]),
      );

      // Gone from the read pass, which both runs read; but the Tab pass, which only the later run
      // read, still has the links, so the page doesn't call the rule resolved.
      expect(summariesIn(html)).toEqual(["/a/: read: 1 line removed and 1 added"]);
      expect(html).not.toContain("resolved</span>");
      expect(textOf(html)).toContain(
        "Flags: generic-link-text (read pass), 2 before, none now (resolved).",
      );
    });

    it("has no chips and no flags line for a page with no flags in either run", () => {
      const html = renderChanges(
        changedModel([done("/a/", { read: ["old"] })], [done("/a/", { read: ["new"] })]),
      );

      expect(summariesIn(html)).toEqual(["/a/: read: 1 line removed and 1 added"]);
      expect(html).not.toContain('class="chips"');
      expect(html).not.toContain("Flags:");
    });

    it("leaves a rule out of the chips while another pass still raises it", () => {
      const tabFlag: FlagResult = { ...LINK_FLAG, pass: "tab" };
      const html = renderChanges(
        changedModel(
          [done("/a/", { read: ["old"], tab: ["t"] }, { flags: [LINK_FLAG, tabFlag] })],
          [done("/a/", { read: ["new"], tab: ["t"] }, { flags: [tabFlag] })],
        ),
      );

      // Gone from the read pass, still there in the Tab pass: not "resolved" for the page.
      expect(summariesIn(html)).toEqual(["/a/: read: 1 line removed and 1 added"]);
      expect(textOf(html)).toContain(
        "Flags: generic-link-text (read pass), 2 before, none now (resolved). generic-link-text (Tab pass), unchanged.",
      );
    });

    it("leaves a rule out of the chips when its flag moved from one pass to another, and says so inside", () => {
      const tabFlag: FlagResult = { ...LINK_FLAG, pass: "tab" };
      const html = renderChanges(
        changedModel(
          [done("/a/", { read: ["old"], tab: ["t"] }, { flags: [LINK_FLAG] })],
          [done("/a/", { read: ["new"], tab: ["t"] }, { flags: [tabFlag] })],
        ),
      );

      expect(summariesIn(html)).toEqual(["/a/: read: 1 line removed and 1 added"]);
      expect(textOf(html)).toContain(
        "Flags: generic-link-text (read pass), 2 before, none now (resolved). generic-link-text (Tab pass), none before, 2 now (new).",
      );
    });

    it("names a flag that belongs to the page as a whole by its rule alone", () => {
      const wholePage: FlagResult = { rule: "repeated-phrase", message: "Said twice." };
      const html = renderChanges(
        changedModel(
          [done("/a/", { read: ["old"] }, { flags: [wholePage] })],
          [done("/a/", { read: ["new"] }, { flags: [wholePage] })],
        ),
      );

      expect(textOf(html, "")).toContain("Flags: repeated-phrase, unchanged.");
    });

    it("names a pass that sounds different but can't be read, instead of showing it as every line gone", () => {
      const html = renderChanges(
        changedModel(
          [done("/a/", { read: ["old"], tab: ["t old"] })],
          [done("/a/", { read: ["new"], tab: ["t new"] })],
          { readable: (run, pass) => !(run === "r2" && pass === "tab") },
        ),
      );
      const [fold = ""] = foldsIn(html);

      expect(textOf(fold)).toContain(
        "The Tab pass sounds different, but its transcript couldn't be read here.",
      );
      // Only the pass that can be read has a table. The line counts that one and names the other.
      expect(fold.match(/<table class="difftable">/g)).toHaveLength(1);
      expect(summariesIn(html)).toEqual([
        "/a/: read: 1 line removed and 1 added; Tab: couldn't be read here",
      ]);
    });

    it("names each pass on the line in pass order, the readable and the unreadable alike", () => {
      const html = renderChanges(
        changedModel(
          [done("/a/", { read: ["old"], headings: ["h old"], tab: ["t", "gone"] })],
          [done("/a/", { read: ["new"], headings: ["h new"], tab: ["t"] })],
          { readable: (run, pass) => !(run === "r2" && pass === "headings") },
        ),
      );
      const [fold = ""] = foldsIn(html);

      expect(summariesIn(html)).toEqual([
        "/a/: read: 1 line removed and 1 added; headings: couldn't be read here; Tab: 1 line removed",
      ]);
      expect(fold.match(/<table class="difftable">/g)).toHaveLength(2);
      expect(textOf(fold)).toContain(
        "The headings pass sounds different, but its transcript couldn't be read here.",
      );
    });

    it("says so on the line when no pass of the page can be read", () => {
      const html = renderChanges(
        changedModel([done("/a/", { read: ["old"] })], [done("/a/", { read: ["new"] })], {
          readable: (run) => run === "r1",
        }),
      );
      const [fold = ""] = foldsIn(html);

      // "here": a pass named "read" that couldn't be read would otherwise say "read" twice over.
      expect(summariesIn(html)).toEqual(["/a/: read: couldn't be read here"]);
      expect(fold).not.toContain("difftable");
      expect(textOf(fold)).toContain(
        "The read pass sounds different, but its transcript couldn't be read here.",
      );
    });

    it("names a page by its label when it has one, and escapes everything it shows", () => {
      const hostile = '<img src=x onerror="alert(1)">';
      const label = "Grants <b>&</b>";
      const html = renderChanges(
        changedModel(
          [
            done(
              "/a/",
              { read: [`${hostile} context`, `${hostile} old`] },
              { label, flags: [LINK_FLAG] },
            ),
          ],
          [
            done("/a/", { read: [`${hostile} context`, `${hostile} new`] }, { label }),
            done("/b/", { read: ["x"] }, { label: "New <i>page</i>" }),
          ],
        ),
      );

      // Decoded, the label is what it was written as: it was never markup.
      expect(summariesIn(html)[0]).toContain("Grants <b>&</b>:");
      expect(listsOf(html)).toEqual([["New <i>page</i>: new, not in the run before."]]);
      // In the line too, which names the page whose flag was resolved.
      expect(textOf(html)).toContain("Resolved: on Grants <b>&</b>, the links that don't say");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("<b>&</b>");
      expect(html).not.toContain("<i>page</i>");
      // In a line the same, a line removed, and a line added.
      expect(html).toContain("<td>&lt;img src=x onerror=&quot;alert(1)&quot;&gt; context</td>");
      expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; <mark>old</mark>");
      expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; <mark>new</mark>");
      // A screen reader is told the page's address, which no label can make the same as another's.
      expect(attributes(html, "aria-label")).toEqual(["Changes in the read pass on /a/, table"]);
    });
  });

  describe("the notes before the line", () => {
    /** Two runs whose browser differs, and whose passes do. */
    function noted(): ShareModel {
      return modelOfRuns([
        {
          id: "r1",
          createdAt: BEFORE,
          sessions: [{ environment: { browser: { name: "Chrome", version: "153.0.8010.53" } } }],
          pages: [done("/a/", { read: ["x"], headings: ["h"], tab: ["t"] })],
        },
        {
          id: "r2",
          createdAt: AFTER,
          passes: ["read"],
          sessions: [{ environment: { browser: { name: "Chrome", version: "154.0.8037.58" } } }],
          pages: [done("/a/", { read: ["x"] })],
        },
      ]);
    }

    it("says which passes were compared when the two runs read different ones, before the line", () => {
      const model = noted();
      const html = renderChanges(model);
      const note = model.changes?.passesNote ?? "";

      expect(note).toContain("only the read pass is compared");
      expect(html).toContain(`<p class="gist">${note}</p>`);
      expect(html.indexOf(note)).toBeLessThan(html.indexOf("prob-verdict"));
    });

    it("says the tools differ, then which passes were compared, then the line", () => {
      const html = renderChanges(noted());

      const tools = html.indexOf("The tools differ between the two runs");
      const passes = html.indexOf("only the read pass is compared");
      const line = html.indexOf('<p class="prob-verdict">');
      expect(tools).toBeGreaterThan(-1);
      expect(tools).toBeLessThan(passes);
      expect(passes).toBeLessThan(line);
      expect(textOf(html)).toContain("Chrome 153.0.8010.53 → Chrome 154.0.8037.58");
    });

    it("escapes what the model says of the tools and the passes", () => {
      const model = grantsModel();
      const { changes } = model;
      if (changes === null) throw new Error("The grants runs have a run before.");
      const html = renderChanges({
        ...model,
        changes: { ...changes, tools: ["<b>Browser</b> differs"], passesNote: "<i>Only</i> some" },
      });

      expect(html).not.toContain("<b>Browser</b>");
      expect(html).not.toContain("<i>Only</i>");
      expect(listsOf(html)[0]).toEqual(["<b>Browser</b> differs"]);
      expect(textOf(html)).toContain("<i>Only</i> some");
    });

    it("has neither note when the runs used the same tools and read the same passes", () => {
      const html = renderChanges(grantsModel());

      expect(html).toContain('<p class="prob-verdict">');
      expect(html).not.toContain("The tools differ");
      expect(html).not.toContain("is compared");
    });
  });

  describe("the pages read in only one of the two runs", () => {
    it("lists each with its reason: new, no longer listed, failed in one run, or skipped in one run", () => {
      const html = renderChanges(
        changedModel(
          [
            done("/same/", { read: ["x"] }),
            done("/gone/", { read: ["x"] }),
            done("/fails/", { read: ["x"] }),
            done("/skips/", { read: ["x"] }),
          ],
          [
            done("/same/", { read: ["x"] }),
            done("/fresh/", { read: ["x"] }, { label: "Fresh page" }),
            { path: "/fails/", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
            { path: "/skips/", status: "skipped" },
          ],
        ),
      );

      expect(textOf(html)).toContain(
        "4 pages were read in full in only one of the two runs, so they weren't compared:",
      );
      expect(listsOf(html)).toEqual([
        [
          "Fresh page: new, not in the run before.",
          "/fails/: failed in one run, read in full in the other.",
          "/skips/: skipped in one run, read in full in the other.",
          "/gone/: no longer listed, not in the latest run.",
        ],
      ]);
    });

    it("says it in the singular for one page", () => {
      const html = renderChanges(
        changedModel(
          [done("/a/", { read: ["x"] })],
          [done("/a/", { read: ["x"] }), done("/b/", { read: ["x"] })],
        ),
      );

      expect(textOf(html)).toContain(
        "1 page was read in full in only one of the two runs, so it wasn't compared:",
      );
      expect(listsOf(html)).toEqual([["/b/: new, not in the run before."]]);
    });

    it("has no list when every page was read in full in both", () => {
      const html = renderChanges(grantsModel());

      expect(html).toContain('<p class="prob-verdict">');
      expect(html).not.toContain("only one of the two runs");
    });
  });

  describe("with no run before", () => {
    it("says there is nothing to compare with, and keeps the heading the page's contents link to", () => {
      const model = modelOfRuns([{ id: "r1", pages: [done("/a/", { read: ["x"] })] }]);
      const html = renderChanges(model);

      expect(model.changes).toBeNull();
      expect(html).toContain('<h2 id="chg-h">What changed since the last run</h2>');
      expect(textOf(html)).toContain("No earlier run with the same pages to compare with.");
      expect(foldsIn(html)).toEqual([]);
      expect(html).not.toContain("prob-verdict");
    });

    it("says the same when no run counts at all", () => {
      const model = buildShareModel(
        inputOf([shareRun({ id: "r1", replayed: true, pages: [{ path: "/" }] })]),
      );
      const html = renderChanges(model);

      expect(html).toContain('<h2 id="chg-h">');
      expect(textOf(html)).toContain("No earlier run with the same pages to compare with.");
    });
  });

  describe("when no page could be compared", () => {
    it("says so, and doesn't say two runs were compared, when no page was read in full in both", () => {
      const model = changedModel(
        [done("/a/", { read: ["x"] })],
        [{ path: "/a/", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] }],
      );
      const html = renderChanges(model);

      expect(textOf(html)).toContain(
        "No page was read in full in both runs, so none could be compared.",
      );
      // The page read in only one of the runs is still listed, with its reason.
      expect(listsOf(html)).toEqual([["/a/: failed in one run, read in full in the other."]]);
      expect(html).not.toContain("Compared:");
      expect(html).not.toContain("counted, not shown");
    });

    it("says so, and doesn't say two runs were compared, when no pass was read in both", () => {
      const model = modelOfRuns([
        {
          id: "r1",
          createdAt: BEFORE,
          passes: ["read"],
          pages: [done("/a/", { read: ["x"] })],
        },
        { id: "r2", createdAt: AFTER, passes: ["tab"], pages: [done("/a/", { tab: ["x"] })] },
      ]);
      const html = renderChanges(model);

      expect(model.changes?.line).toBe(
        "No pass was read in both runs, so no page could be compared.",
      );
      expect(textOf(html)).toContain(model.changes?.line);
      // What each run read is still said first, before the line.
      expect(html.indexOf(model.changes?.passesNote ?? "x")).toBeLessThan(
        html.indexOf("prob-verdict"),
      );
      expect(html).not.toContain("Compared:");
      expect(html).not.toContain("counted, not shown");
    });

    it("still names the two runs it compared when some page was compared", () => {
      expect(textOf(renderChanges(grantsModel()))).toContain(
        "Compared: run r1 (before) and run r2 (latest).",
      );
    });
  });

  it("sets no style attribute, links nowhere, and holds no heading in a summary line or section heading in a fold", async () => {
    for (const model of [await demoModel(), grantsModel()]) {
      const html = renderChanges(model);

      expect(html).not.toMatch(/\sstyle=/);
      expect(html).not.toContain("<a ");
      for (const summary of html.match(/<summary>.*?<\/summary>/gs) ?? []) {
        expect(summary).not.toMatch(/<h[1-6]/);
      }
      // A fold's own parts start at level 3.
      for (const fold of foldsIn(html)) expect(fold).not.toMatch(/<h[12][ >]/);
      expect(html.match(/<h2/g)).toHaveLength(1);
    }
    expect(foldsIn(renderChanges(grantsModel())).join("")).toMatch(/<h3 class="logh">/);
  });
});

describe("renderProblems", () => {
  describe("for the demo runs of 29 September 2026", () => {
    it("opens with the verdict line, as the model words it", async () => {
      const model = await demoModel();
      const html = renderProblems(model);

      expect(html).toMatch(/^<section aria-labelledby="prob-h">\s*<h2 id="prob-h">/);
      expect(html).toContain('<h2 id="prob-h">Problems during the runs</h2>');
      expect(model.problems.line).toBe(
        "2 problems, both outside voicecap: another window took the screen. 1 didn't happen again, and 1 wasn't tried again. Neither was an unexpected error, the kind that could mean a problem in voicecap itself.",
      );
      expect(textOf(html)).toContain(model.problems.line);
      expect(html).toContain(
        '<p class="prob-verdict"><b>2 problems, both outside voicecap: another window took the screen.</b> 1 didn&#39;t happen again, and 1 wasn&#39;t tried again. Neither was an unexpected error, the kind that could mean a problem in voicecap itself.</p>',
      );
    });

    it("has a fold for each of the two problems, and one for the table of kinds", async () => {
      const html = renderProblems(await demoModel());

      expect(foldsIn(html)).toHaveLength(3);
      expect(html.match(/<details class="fold problem" id="[^"]+">/g)).toHaveLength(2);
      expect(summariesIn(html)).toEqual([
        "Run 2026-09-29_1315 · /the-report/ time not recorded Another window came to the front Didn't happen again",
        "Run 2026-09-29_1402 · /how-a-run-works/ time not recorded Another window came to the front Not tried again",
        "How voicecap tells causes apart 9 kinds of problem, and whose each is",
      ]);
      // Each starts closed: a problem opens to show its record.
      expect(html).not.toMatch(/<details[^>]* open/);
      // In the box the mockup gives its folds, the problems first and the table of kinds last.
      expect(html).toContain('<div class="folds"><details class="fold problem"');
    });

    it("sets out a problem in the order the mockup does: the questions, the record, then what wasn't recorded", async () => {
      const [first = ""] = foldsIn(renderProblems(await demoModel()));

      const parts = ['<dl class="qa">', 'class="logtable"', 'class="not-recorded"'];
      const at = parts.map((part) => first.indexOf(part));
      expect(at.every((index) => index > -1)).toBe(true);
      expect(at).toEqual([...at].sort((a, b) => a - b));
    });

    it("gives each problem a fold id from its run and page, so a link can point to it", async () => {
      expect(attributes(renderProblems(await demoModel()), "id")).toEqual([
        "prob-h",
        "prob-2026-09-29_1315-the-report-03940c2f88",
        "prob-2026-09-29_1402-how-a-run-works-fd116f9328",
      ]);
    });

    it("says what happened, what voicecap did, whether it happened again, and the effect", async () => {
      const [first = ""] = foldsIn(renderProblems(await demoModel()));

      expect(termsOf(first)).toEqual([
        ["What happened", "During the read pass, another window took the screen."],
        [
          "How the kind was decided",
          "From the error's own wording, which voicecap wrote: this run was recorded before voicecap noted a cause for each failure.",
        ],
        ["What voicecap did", "Recorded the page as failed."],
        ["Did it happen again?", "No: read in full in run 2026-09-29_1402."],
        [
          "Effect on the results",
          "No transcripts from this run: the page failed. The partial transcripts it left are in pages/the-report-03940c2f88/.",
        ],
      ]);
    });

    it("shows the record word for word in a named table, with no time where the run kept none", async () => {
      const [first = ""] = foldsIn(renderProblems(await demoModel()));

      // The heading says which problem, to a reader who goes through the headings and not the folds.
      expect(first).toContain(
        '<h3 class="logh">The record of this problem, word for word <span class="sr">on /the-report/ in run 2026-09-29_1315</span></h3>',
      );
      expect(scrollBoxes(first)).toEqual([
        '<div class="scroll" tabindex="0" role="region" aria-label="The record of the problem on /the-report/ in run 2026-09-29_1315, table">',
      ]);
      const table = tableOf(first, "logtable");
      expect(table).toContain('<caption class="sr">The record of this problem</caption>');
      expect(rowsOf(table)).toEqual([
        "Time | From | What was recorded",
        "Not recorded | run.json | read pass: The browser lost the foreground to another window, so this step's keystroke and speech were discarded. Keep the computer free while voicecap runs.",
      ]);
      // The entry is in code, as written.
      expect(table).toContain(
        '<td class="lt">Not recorded</td><td class="src">run.json</td><td><code>read pass: The browser lost the foreground',
      );
    });

    it("says what the run didn't record, once each, in the model's words and after the record", async () => {
      const model = await demoModel();
      const [first = ""] = foldsIn(renderProblems(model));

      const lines = [...first.matchAll(/<p class="not-recorded">(.*?)<\/p>/gs)].map((found) =>
        textOf(found[1] ?? "", ""),
      );
      expect(lines).toEqual(model.problems.problems[0]?.notRecorded);
      expect(lines).toEqual([
        "The step and the key: not recorded: this run used voicecap 0.4.1.",
        "Which program came to the front: not recorded: this run used voicecap 0.4.1.",
        "The event log and NVDA's own log: not recorded: this run used voicecap 0.4.1.",
      ]);
      expect(first.indexOf("not-recorded")).toBeGreaterThan(first.indexOf("logtable"));
      // A failure voicecap worded itself has no stack.
      expect(first).not.toContain("<pre");
    });

    it("explains the kinds of problem in a folded table, a row for each", async () => {
      const html = renderProblems(await demoModel());
      const kinds = foldsIn(html).at(-1) ?? "";
      const table = tableOf(kinds, "plain");

      expect(KIND_ROWS).toHaveLength(9);
      expect(rowsOf(table)).toEqual([
        "What happened | Whose it is | What voicecap does, and what it means",
        ...KIND_ROWS.map((row) => `${row.title} | ${row.whose} | ${row.meaning}`),
      ]);
      expect(table).toContain('<caption class="sr">Kinds of problem</caption>');
      expect(table).toContain(
        '<th scope="row">Another window came to the front</th><td>Outside voicecap: another program, or someone at the computer</td>',
      );
      // Folded, and named for a keyboard and a screen reader.
      expect(html).toContain(
        '<details class="fold kinds"><summary><span class="what">How voicecap tells causes apart</span>',
      );
      expect(scrollBoxes(kinds)).toEqual([
        '<div class="scroll" tabindex="0" role="region" aria-label="Kinds of problem, table">',
      ]);
    });

    it("tells the reader what is here", async () => {
      expect(textOf(renderProblems(await demoModel()))).toContain(
        "Every attempt that failed in the runs these results come from is here, with what voicecap recorded about it, word for word: what happened, what voicecap did, whether it happened again, and what it means for the results.",
      );
    });
  });

  describe("for a problem from an older run's wording", () => {
    /** The "How the kind was decided" row of the only problem of a voicecap 0.4.1 run's page. */
    function decidedOf(error: string): { kind: string; said: string | undefined } {
      const run = shareRun({
        id: "r1",
        voicecapVersion: "0.4.1",
        pages: [{ path: "/grants/", status: "failed", errors: [error] }],
      });
      const model = buildShareModel(inputOf([run]));
      const [fold = ""] = foldsIn(renderProblems(model));
      return {
        kind: model.problems.problems[0]?.kind ?? "no problem",
        said: termsOf(fold).find(([term]) => term === "How the kind was decided")?.[1],
      };
    }

    it("says an error voicecap doesn't recognize counts as unexpected, which is no finding about its wording", () => {
      expect(decidedOf("read pass: page.goto: Timeout 30000ms exceeded.")).toEqual({
        kind: "unexpected",
        said: "voicecap didn't recognize this error's wording, so it counts as unexpected: this run was recorded before voicecap noted a cause for each failure.",
      });
    });

    it("says a network error was read from the browser's own error code", () => {
      expect(
        decidedOf(
          "Could not open the page for the read pass: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4848/",
        ),
      ).toEqual({
        kind: "unreachable",
        said: "From the browser's own network error code in the error's wording.",
      });
    });

    it("keeps the words voicecap wrote for every other kind it read from wording", () => {
      const said =
        "From the error's own wording, which voicecap wrote: this run was recorded before voicecap noted a cause for each failure.";

      expect(decidedOf("read pass: nextLine did not finish within 30s")).toEqual({
        kind: "timeout",
        said,
      });
      expect(decidedOf("read pass: HTTP 500")).toEqual({ kind: "http", said });
    });

    it("says it of an error voicecap doesn't recognize beside the link to report it", () => {
      const run = shareRun({
        id: "r1",
        voicecapVersion: "0.4.1",
        pages: [
          {
            path: "/grants/",
            status: "failed",
            errors: ["read pass: page.goto: Timeout 30000ms exceeded."],
          },
        ],
      });
      const [fold = ""] = foldsIn(renderProblems(buildShareModel(inputOf([run]))));

      expect(termsOf(fold).map(([term]) => term)).toEqual([
        "What happened",
        "How the kind was decided",
        "What voicecap did",
        "Did it happen again?",
        "Effect on the results",
        "Report it",
      ]);
    });
  });

  describe("for a problem the run recorded as an attempt", () => {
    const attempt = failedAttempt({ n: 1, step: 12, command: "nextLine", cause: "foreground" });

    it("puts the time of the failure on the fold's line", () => {
      const model = failedModel([attempt]);

      expect(model.problems.problems[0]?.endedAt).toBe("2026-09-26T14:05:10.000-05:00");
      expect(summariesIn(renderProblems(model))[0]).toBe(
        "Run r1 · /grants/ 14:05 Another window came to the front Not tried again",
      );
    });

    it("gives the time the attempt failed, not when it began", () => {
      const slow = failedAttempt({
        n: 1,
        startedAt: "2026-09-26T14:05:50.000-05:00",
        endedAt: "2026-09-26T14:06:20.000-05:00",
      });

      expect(summariesIn(renderProblems(failedModel([slow])))[0]).toBe(
        "Run r1 · /grants/ 14:06 Another window came to the front Not tried again",
      );
    });

    it("shows when the attempt began and when it failed in the record, to the millisecond", () => {
      const [fold = ""] = foldsIn(renderProblems(failedModel([attempt])));

      expect(rowsOf(tableOf(fold, "logtable"))).toEqual([
        "Time | From | What was recorded",
        "14:05:00.000 | run.json | Attempt 1 started",
        "14:05:10.000 | run.json | Failed: foreground: The browser lost the foreground to another window, so this step's keystroke and speech were discarded. Keep the computer free while voicecap runs.",
      ]);
      expect(termsOf(fold)[0]).toEqual([
        "What happened",
        "During the read pass, at step 12 (Down Arrow), another window took the screen.",
      ]);
    });

    it("doesn't say the kind came from wording, for a cause the run recorded", () => {
      const html = renderProblems(failedModel([attempt]));

      expect(termsOf(foldsIn(html)[0] ?? "").map(([term]) => term)).toEqual([
        "What happened",
        "What voicecap did",
        "Did it happen again?",
        "Effect on the results",
      ]);
      expect(html).not.toContain("How the kind was decided");
    });

    it("says what the record can't, as the model words it", () => {
      const model = failedModel([attempt], { voicecapVersion: "0.6.0" });
      const [fold = ""] = foldsIn(renderProblems(model));

      expect(textOf(fold)).toContain(
        "Which program came to the front: not recorded: this run used voicecap 0.6.0.",
      );
      expect(textOf(fold)).not.toContain("The step and the key");
    });

    it("says each line the model has of what the run didn't record, and no box when it has none", () => {
      const model = failedModel([attempt]);
      const withLines = (notRecorded: string[]): string => {
        const patched: ShareModel = {
          ...model,
          problems: {
            ...model.problems,
            problems: model.problems.problems.map((problem) => ({ ...problem, notRecorded })),
          },
        };
        return foldsIn(renderProblems(patched))[0] ?? "";
      };

      expect(withLines(["Only: not recorded: this run used voicecap 0.1.0."])).toContain(
        '<div><p class="not-recorded">Only: not recorded: this run used voicecap 0.1.0.</p></div>',
      );
      const none = withLines([]);
      expect(none).toContain('class="logtable"');
      expect(none).not.toContain("not-recorded");
      expect(none).not.toContain("<div></div>");
    });

    it("says it didn't happen again, in a chip that says so in words, when the page was read in full", () => {
      const run = shareRun({
        id: "r1",
        pages: [{ path: "/grants/", failedAttempts: [attempt], attempts: 2 }],
      });
      const html = renderProblems(buildShareModel(inputOf([run])));

      expect(html).toContain('<span class="chip c-ok">Didn&#39;t happen again</span>');
      expect(html).toContain('<span class="chip c-warn">Another window came to the front</span>');
      expect(textOf(html)).toContain("No: read in full on attempt 2.");
    });

    it("says it happened again when a later attempt failed the same way", () => {
      const html = renderProblems(failedModel([attempt, failedAttempt({ n: 2, ...LATER })]));

      expect(summariesIn(html).slice(0, 2)).toEqual([
        "Run r1 · /grants/ 14:05 Another window came to the front Happened again",
        "Run r1 · /grants/ 14:06 Another window came to the front Happened again",
      ]);
      expect(html).toContain('<span class="chip c-bad">Happened again</span>');
    });

    it("says it happened again in different ways when later attempts failed otherwise", () => {
      const slow = failedAttempt({
        n: 2,
        cause: "step-timeout",
        message: "nextLine did not finish within 30s",
        ...LATER,
      });
      const html = renderProblems(failedModel([attempt, slow]));

      expect(summariesIn(html).slice(0, 2)).toEqual([
        "Run r1 · /grants/ 14:05 Another window came to the front Happened again, in different ways",
        "Run r1 · /grants/ 14:06 A step took too long Happened again, in different ways",
      ]);
      expect(html).toContain('<span class="chip c-bad">Happened again, in different ways</span>');
    });

    it("says it wasn't tried again when nothing shows whether it would have happened again", () => {
      const html = renderProblems(failedModel([attempt]));

      expect(html).toContain('<span class="chip c-warn">Not tried again</span>');
      expect(textOf(html)).toContain(
        "Not known: this run didn't try the page again, and no other run read it in full.",
      );
    });

    it("gives two problems on one page in one run ids of their own", () => {
      const ids = attributes(
        renderProblems(failedModel([attempt, failedAttempt({ n: 2, ...LATER })])),
        "id",
      );

      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(3);
      expect(ids[1]).toMatch(/^prob-r1-grants-[0-9a-f]+$/);
      expect(ids[2]).toBe(`${ids[1]}-2`);
    });

    it("names the boxes of each problem apart, so a screen reader can tell them apart", () => {
      const html = renderProblems(failedModel([attempt, failedAttempt({ n: 2, ...LATER })]));
      const names = attributes(html, "aria-label");

      expect(names).toEqual([
        "The record of the problem on /grants/ in run r1, attempt 1, table",
        "The record of the problem on /grants/ in run r1, attempt 2, table",
        "Kinds of problem, table",
      ]);
    });

    it("numbers the problems of a run that wrote them as text and didn't number its attempts", () => {
      const run = shareRun({
        id: "r1",
        voicecapVersion: "0.4.1",
        pages: [
          {
            path: "/grants/",
            status: "failed",
            errors: ["read pass: nextLine did not finish within 30s", "headings pass: HTTP 500"],
          },
        ],
      });
      const html = renderProblems(buildShareModel(inputOf([run])));

      expect(attributes(html, "aria-label").slice(0, 2)).toEqual([
        "The record of the problem on /grants/ in run r1, table",
        "The record of the problem on /grants/ in run r1, problem 2, table",
      ]);
    });
  });

  describe("for an error voicecap didn't expect", () => {
    it("links to where it can be reported, inside its own fold", () => {
      const [fold = ""] = foldsIn(renderProblems(failedModel([UNEXPECTED])));
      const terms = termsOf(fold);

      expect(fold).toContain(`<a href="${ISSUES}">github.com/ICJIA/voicecap/issues</a>`);
      expect(terms.at(-1)).toEqual([
        "Report it",
        "This could be a problem in voicecap itself. Please report it, with this record, at github.com/ICJIA/voicecap/issues.",
      ]);
    });

    it("shows the stack in a box a keyboard can reach and scroll, beneath the record", () => {
      const [fold = ""] = foldsIn(renderProblems(failedModel([UNEXPECTED])));

      expect(fold).toContain(
        '<h3 class="logh">Where in voicecap\'s code it happened <span class="sr">on /grants/ in run r1, attempt 1</span></h3>',
      );
      expect(scrollBoxes(fold)).toEqual([
        '<div class="scroll" tabindex="0" role="region" aria-label="The record of the problem on /grants/ in run r1, attempt 1, table">',
        '<div class="scroll" tabindex="0" role="region" aria-label="Where in voicecap&#39;s code it happened on /grants/ in run r1, attempt 1">',
      ]);
      expect(fold).toContain(
        '<pre class="logblock">TypeError: Cannot read properties of undefined (reading &#39;steps&#39;)\n    at runPass (dist/run/page-runner.js:42:9)\n    at processPage (dist/run/page-runner.js:90:5)</pre>',
      );
      // Once, in its box, and not again as a row of the table.
      expect(fold.match(/at runPass/g)).toHaveLength(1);
      expect(fold.indexOf("logblock")).toBeGreaterThan(fold.indexOf("logtable"));
    });

    it("marks the kind as the one that could be voicecap's, and counts it in the verdict line", () => {
      const html = renderProblems(failedModel([UNEXPECTED]));

      expect(html).toContain('<span class="chip c-bad">An unexpected error</span>');
      expect(textOf(html)).toContain(
        "1 was an unexpected error, the kind that could mean a problem in voicecap itself: see its record.",
      );
    });

    it("links nowhere but the table of kinds for a problem that isn't one", async () => {
      const html = renderProblems(await demoModel());

      expect(attributes(html, "href")).toEqual([ISSUES]);
      expect(foldsIn(html)[0]).not.toContain("<a ");
      expect(foldsIn(html)[1]).not.toContain("<a ");
    });

    it("links the issues page from the table of kinds", async () => {
      const kinds = foldsIn(renderProblems(await demoModel())).at(-1) ?? "";

      expect(kinds).toContain(
        `with a link to report it (<a href="${ISSUES}">github.com/ICJIA/voicecap/issues</a>)`,
      );
    });
  });

  describe("with no problems", () => {
    it("says so, keeps the heading, and still explains how causes are told apart", () => {
      const model = buildShareModel(inputOf([shareRun({ id: "r1", pages: [{ path: "/a/" }] })]));
      const html = renderProblems(model);

      expect(model.problems.problems).toEqual([]);
      expect(model.problems.line).toBe("No problems during the runs: every page was read in full.");
      expect(html).toContain('<h2 id="prob-h">Problems during the runs</h2>');
      expect(textOf(html)).toContain(model.problems.line);
      expect(summariesIn(html)).toEqual([
        "How voicecap tells causes apart 9 kinds of problem, and whose each is",
      ]);
      expect(textOf(html)).not.toContain("Every attempt that failed");
    });

    it("says so, with its heading, when no run counts", () => {
      const model = buildShareModel(
        inputOf([shareRun({ id: "r1", replayed: true, pages: [{ path: "/" }] })]),
      );
      const html = renderProblems(model);

      expect(html).toContain('<h2 id="prob-h">');
      expect(textOf(html)).toContain("No problems to report: no live run counts yet.");
    });
  });

  it("never shows the home folder, in a message, a record, or a stack", () => {
    const home = os.homedir();
    const message = `ENOENT: no such file or directory, open '${path.join(home, "voicecap-demo", "x.txt")}'`;
    const stack = `Error: ${message}\n    at open (${path.join(home, "code", "voicecap", "dist", "run.js")}:10:5)`;
    const run = shareRun({
      id: "r1",
      voicecapVersion: "0.5.0",
      pages: [
        {
          path: "/recorded",
          status: "failed",
          failedAttempts: [failedAttempt({ n: 1, cause: "unexpected", message, stack })],
        },
        { path: "/written", status: "failed", errors: [`read pass: ${message}`] },
      ],
    });
    const html = renderProblems(buildShareModel(inputOf([run])));
    const lowered = html.toLowerCase();

    expect(lowered).not.toContain(home.toLowerCase());
    expect(lowered).not.toContain(home.toLowerCase().replaceAll("\\", "/"));
    expect(html).toContain(process.platform === "win32" ? "%USERPROFILE%" : "~");
  });

  it("escapes what a record holds, and a page's label", () => {
    const attempt = failedAttempt({
      n: 1,
      cause: "unexpected",
      message: '<script>alert("x")</script>',
      stack: "<b>stack</b>",
    });
    const run = shareRun({
      id: "r1",
      pages: [
        {
          path: "/grants/",
          label: "Grants <i>page</i>",
          status: "failed",
          failedAttempts: [attempt],
        },
      ],
    });
    const html = renderProblems(buildShareModel(inputOf([run])));

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>stack</b>");
    expect(html).not.toContain("<i>page</i>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(summariesIn(html)[0]).toContain("Run r1 · Grants <i>page</i>");
    // A screen reader is told the page's address in the names inside, which no label can make the
    // same as another page's.
    expect(attributes(html, "aria-label").slice(0, 2)).toEqual([
      "The record of the problem on /grants/ in run r1, attempt 1, table",
      "Where in voicecap&#39;s code it happened on /grants/ in run r1, attempt 1",
    ]);
  });

  it("sets no style attribute, and holds no heading in a summary line or section heading in a fold", async () => {
    for (const model of [await demoModel(), failedModel([UNEXPECTED])]) {
      const html = renderProblems(model);

      expect(html).not.toMatch(/\sstyle=/);
      for (const summary of html.match(/<summary>.*?<\/summary>/gs) ?? []) {
        expect(summary).not.toMatch(/<h[1-6]/);
      }
      // A fold's own parts start at level 3, and the section's heading is outside every fold.
      for (const fold of foldsIn(html)) expect(fold).not.toMatch(/<h[12][ >]/);
      expect(html.match(/<h2/g)).toHaveLength(1);
    }
  });
});
