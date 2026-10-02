/**
 * The Word copy's "What changed since the last run" and "Problems during the runs", as blocks: what
 * they say, in the page's order. The demo runs of 29 September 2026 (voicecap 0.4.1, in
 * test/fixtures/share/) are the real case: they sound the same, and each lost a page to another
 * window. Runs built in memory cover the rest: pages that sound different, flags that came and went,
 * and an error voicecap didn't expect. The blocks are plain data, so nothing here opens a .docx.
 *
 * A page that sounds different, and a problem, each have blocks of their own, and a check that some
 * words are somewhere in the copy could pass on another page's or another problem's identical
 * words. So the tests look at each one's own part of the outline.
 */
import { describe, expect, it } from "vitest";

import type { AttemptRecord, FlagResult, PassName } from "../src/model.js";
import { renderChanges } from "../src/share/html/changes.js";
import { renderProblems } from "../src/share/html/problems.js";
import { pageTitle } from "../src/share/format.js";
import { firstSentenceBold, lineText, type Line } from "../src/share/line.js";
import type { ShareInput } from "../src/share/load.js";
import { buildShareModel, type ShareModel } from "../src/share/model.js";
import { KIND_ROWS, type Problem } from "../src/share/problems.js";
import { CHANGES_TEXT, ISSUES_URL, PROBLEMS_TEXT, WORD_TEXT } from "../src/share/text.js";
import {
  changesGist,
  decidedFrom,
  flagsLine,
  kindTitle,
  notRecordedLine,
  problemTime,
  problemTitle,
  recordTime,
  sentence,
  whereOf,
} from "../src/share/words.js";
import { heading, para, wordsOf, type Block, type Cell } from "../src/share/word/blocks.js";
import { wordChanges } from "../src/share/word/changes.js";
import { wordProblems } from "../src/share/word/problems.js";
import {
  failedAttempt,
  shareRun,
  type SharePageSpec,
  type ShareRunSpec,
} from "./helpers/share-data.js";
import {
  decode,
  foldsIn,
  rowsOf,
  summariesIn,
  tableOf,
  termsOf,
  textOf,
} from "./helpers/share-html.js";
import { demoModel, inputOf, storeOf, TRANSCRIPTS, type Lines } from "./helpers/share-model.js";
import { boldIn, linesIn, outlineOf, partsAt, tableAt, tablesIn } from "./helpers/word.js";

// The models of the changes.

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

/** A page's read pass with one link: “link, click here” before, “link, Read the annual report” after. */
const OLD_REPORT = [
  "banner landmark, link, Skip to main content",
  "heading, level 1, Annual report",
  "link, click here",
  "main landmark",
  "region, Deadlines",
  "list with 3 items",
  "content info landmark, © 2026 Example Agency",
];
const NEW_REPORT = OLD_REPORT.map((line) =>
  line === "link, click here" ? "link, Read the annual report" : line,
);

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

/**
 * The model of runs built from specs, oldest first. Each page's transcripts are the lines its spec
 * gives, in the run it is in; `readable` says which can be read at all (every one, by default).
 */
function modelOfRuns(
  specs: ShareRunSpec[],
  readable: (run: string, pass: PassName) => boolean = () => true,
): ShareModel {
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
  readable?: (run: string, pass: PassName) => boolean,
): ShareModel {
  return modelOfRuns(
    [
      { id: "r1", createdAt: BEFORE, pages: before },
      { id: "r2", createdAt: AFTER, pages: after },
    ],
    readable,
  );
}

/** The grants page, whose links were fixed between the two runs. */
function grantsModel(): ShareModel {
  return changedModel(
    [done("/grants/", { read: OLD_READ }, { flags: [LINK_FLAG] })],
    [done("/grants/", { read: NEW_READ })],
  );
}

/** Two runs of a page whose read pass differs in one line. */
function twoRuns(): ShareModel {
  return changedModel(
    [done("/report/", { read: OLD_REPORT })],
    [done("/report/", { read: NEW_REPORT })],
  );
}

/** Two runs whose browser differs, and whose passes do: the notes that come before the line. */
function notedModel(): ShareModel {
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

/** Two pages that sound different, each with a flag, a pass, and words of its own. */
function twoPagesModel(): ShareModel {
  return changedModel(
    [
      done(
        "/a/",
        { read: ["a old"], tab: ["a tab old"] },
        { flags: [LINK_FLAG], label: "The A page" },
      ),
      done("/b/", { read: ["b same"], headings: ["b head old"] }, { flags: [UNLABELED_FLAG] }),
    ],
    [
      done("/a/", { read: ["a new"], tab: ["a tab new"] }, { label: "The A page" }),
      done("/b/", { read: ["b same"], headings: ["b head new"] }, { flags: [HEADINGS_FLAG] }),
    ],
    (run, pass) => !(run === "r2" && pass === "tab"),
  );
}

/** A site whose only run was a replay, so no run counts. */
function noRunModel(): ShareModel {
  return buildShareModel(inputOf([shareRun({ id: "r1", replayed: true, pages: [{ path: "/" }] })]));
}

/** What the model says changed. */
function changesOf(model: ShareModel): NonNullable<ShareModel["changes"]> {
  if (model.changes === null) throw new Error("The model has no earlier run to compare with.");
  return model.changes;
}

/** The lines of the first changes table's second column, as pieces of words. */
function diffRows(blocks: Block[]): Line[] {
  return tableAt(blocks, 0).rows.map((row) => row[1]?.lines[0] ?? []);
}

/** The words of each line of a table's cell: one string for each paragraph the cell has. */
function cellLines(cell: Cell | undefined): string[] {
  return (cell?.lines ?? []).map(lineText);
}

/** What one part of the outline says, a line for each string `wordsOf` gives. */
function saysOf(blocks: Block[]): string {
  return wordsOf(blocks).join("\n");
}

/** Every address the blocks link to, in order. */
function hrefsOf(blocks: Block[]): string[] {
  return linesIn(blocks).flatMap((line) =>
    line.flatMap((piece) =>
      typeof piece === "string" || piece.href === undefined ? [] : [piece.href],
    ),
  );
}

// The models of the problems.

/** A run of one page that failed every attempt, as the given attempts say. */
function failedModel(attempts: AttemptRecord[], extra: Partial<ShareRunSpec> = {}): ShareModel {
  const page: SharePageSpec = { path: "/grants/", status: "failed", failedAttempts: attempts };
  return buildShareModel(inputOf([shareRun({ id: "r1", pages: [page], ...extra })]));
}

/** A run of voicecap 0.4.1, which wrote a page's errors as text: the kind is read from the words. */
function wordingModel(...errors: string[]): ShareModel {
  const run = shareRun({
    id: "r1",
    voicecapVersion: "0.4.1",
    pages: [{ path: "/grants/", status: "failed", errors }],
  });
  return buildShareModel(inputOf([run]));
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

/** The parts of the outline that are a problem's (a heading 2 and what's inside it), and the last. */
function problemParts(model: ShareModel): { problems: Block[][]; kinds: Block[] } {
  const parts = partsAt(wordProblems(model), 2);
  return { problems: parts.slice(0, -1), kinds: parts.at(-1) ?? [] };
}

/** The first problem's part of the outline. */
function firstProblem(model: ShareModel): Block[] {
  return problemParts(model).problems[0] ?? [];
}

/** The model with some fields of every problem changed, for words the records don't easily make. */
function withProblems(model: ShareModel, fields: Partial<Problem>): ShareModel {
  return {
    ...model,
    problems: {
      ...model.problems,
      problems: model.problems.problems.map((problem) => ({ ...problem, ...fields })),
    },
  };
}

describe("wordChanges", () => {
  describe("with nothing to compare", () => {
    it("says there's no run to compare with, when there isn't", () => {
      const oneRun = modelOfRuns([{ id: "r1", pages: [done("/a/", { read: ["x"] })] }]);

      expect(oneRun.changes).toBeNull();
      expect(wordsOf(wordChanges(oneRun))).toEqual([
        "What changed since the last run",
        "No earlier run with the same pages to compare with.",
      ]);
      // The page sets the line in bold, as a whole sentence, under the section's heading.
      expect(wordChanges(oneRun)).toEqual([
        heading(1, CHANGES_TEXT.title),
        para({ text: CHANGES_TEXT.none, bold: true }),
      ]);
    });

    it("says the same when no run counts at all", () => {
      expect(wordsOf(wordChanges(noRunModel()))).toEqual([
        "What changed since the last run",
        "No earlier run with the same pages to compare with.",
      ]);
    });
  });

  describe("for the demo runs of 29 September 2026", () => {
    it("says every page sounds the same, with the tools that differ and the pages read in only one run", async () => {
      const blocks = wordChanges(await demoModel());

      expect(wordsOf(blocks)).toEqual([
        "What changed since the last run",
        "The tools differ between the two runs, so anything that sounds different may come from the tools rather than the site:",
        "Browser differs: Chrome 153.0.8010.53 → Chrome 154.0.8037.58 (run 2026-09-29_1315 → run 2026-09-29_1402).",
        "The voicecap config differs (run 2026-09-29_1315 → run 2026-09-29_1402); stop rules or NVDA settings may have changed.",
        "Every page read in full in both runs sounds exactly the same.",
        "Compared: run 2026-09-29_1315 (before) and run 2026-09-29_1402 (latest). 5 pages sound the same, and are counted, not shown.",
        "2 pages were read in full in only one of the two runs, so they weren't compared:",
        "/how-a-run-works/: failed in one run, read in full in the other.",
        "/the-report/: failed in one run, read in full in the other.",
      ]);
      expect(blocks.map(({ kind }) => kind)).toEqual([
        "heading",
        "para",
        "list",
        "para",
        "para",
        "para",
        "list",
      ]);
      // No page sounds different, so there is no page to say, and no table.
      expect(outlineOf(blocks)).toEqual(["1 What changed since the last run"]);
      expect(tablesIn(blocks)).toEqual([]);
    });

    it("sets in bold the first words of the tools' lead, the first sentence of the line, and the names of the pages in only one run", async () => {
      const model = await demoModel();
      const [, lead, tools, line, gist, onlyLead, only] = wordChanges(model);

      expect(lead?.kind === "para" ? boldIn(lead.line) : []).toEqual([
        "The tools differ between the two runs,",
      ]);
      expect(tools?.kind === "list" ? tools.items.map(lineText) : []).toEqual(
        changesOf(model).tools,
      );
      expect(line).toEqual(para(...firstSentenceBold(changesOf(model).line)));
      expect(line?.kind === "para" ? boldIn(line.line) : []).toEqual([
        "Every page read in full in both runs sounds exactly the same.",
      ]);
      // The two runs' ids are in the fixed-width font, as the page sets them.
      expect(gist?.kind === "para" ? gist.line : []).toContainEqual({
        text: "2026-09-29_1315",
        mono: true,
      });
      expect(onlyLead?.kind === "para" ? boldIn(onlyLead.line) : []).toEqual([
        "2 pages were read in full in only one of the two runs,",
      ]);
      expect(only?.kind === "list" ? only.items.map(boldIn) : []).toEqual([
        ["/how-a-run-works/"],
        ["/the-report/"],
      ]);
    });
  });

  describe("the notes before the line", () => {
    it("says the tools that differ, then which passes were compared, then the line, in the page's order", () => {
      const model = notedModel();
      const changes = changesOf(model);
      const blocks = wordChanges(model);

      expect(changes.tools).toHaveLength(1);
      expect(changes.passesNote).toContain("only the read pass is compared");
      expect(wordsOf(blocks)).toEqual([
        "What changed since the last run",
        "The tools differ between the two runs, so anything that sounds different may come from the tools rather than the site:",
        ...changes.tools,
        changes.passesNote,
        changes.line,
        lineText(changesGist(changes) ?? []),
      ]);
      expect(wordsOf(blocks)[2]).toContain("Chrome 153.0.8010.53 → Chrome 154.0.8037.58");
      // The tools are a list under their lead; the note on the passes is a paragraph.
      expect(blocks.map(({ kind }) => kind)).toEqual([
        "heading",
        "para",
        "list",
        "para",
        "para",
        "para",
      ]);
    });

    it("says each note only when there's something to say, so runs that used the same tools and read the same passes have neither", () => {
      const model = grantsModel();
      const words = wordsOf(wordChanges(model));

      expect(changesOf(model).tools).toEqual([]);
      expect(changesOf(model).passesNote).toBeNull();
      expect(words.join("\n")).not.toContain("The tools differ");
      expect(words.join("\n")).not.toContain("is compared");
      // The line comes straight after the heading.
      expect(words[1]).toBe(changesOf(model).line);
    });

    it("says what each run read, and that no pass was compared, when no pass was read in both", () => {
      const model = modelOfRuns([
        { id: "r1", createdAt: BEFORE, passes: ["read"], pages: [done("/a/", { read: ["x"] })] },
        { id: "r2", createdAt: AFTER, passes: ["tab"], pages: [done("/a/", { tab: ["x"] })] },
      ]);
      const words = wordsOf(wordChanges(model));

      expect(changesOf(model).line).toBe(
        "No pass was read in both runs, so no page could be compared.",
      );
      expect(words).toEqual([
        "What changed since the last run",
        changesOf(model).passesNote,
        "No pass was read in both runs, so no page could be compared.",
      ]);
      // Nothing was compared, so it doesn't say two runs were.
      expect(words.join("\n")).not.toContain("Compared:");
    });
  });

  describe("the pages read in only one of the two runs", () => {
    it("lists each with its reason: new, no longer listed, failed in one run, or skipped in one run", () => {
      const model = changedModel(
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
      );
      const blocks = wordChanges(model);
      const list = blocks.at(-1);

      expect(wordsOf(blocks.slice(-2))).toEqual([
        "4 pages were read in full in only one of the two runs, so they weren't compared:",
        "Fresh page: new, not in the run before.",
        "/fails/: failed in one run, read in full in the other.",
        "/skips/: skipped in one run, read in full in the other.",
        "/gone/: no longer listed, not in the latest run.",
      ]);
      // Each page's name is in bold, as the page's is; its reason is plain words.
      expect(list?.kind === "list" ? list.items.map(boldIn) : []).toEqual([
        ["Fresh page"],
        ["/fails/"],
        ["/skips/"],
        ["/gone/"],
      ]);
      expect(list?.kind === "list" ? list.items.map((item) => item.length) : []).toEqual([
        2, 2, 2, 2,
      ]);
    });

    it("says it in the singular for one page", () => {
      const model = changedModel(
        [done("/a/", { read: ["x"] })],
        [done("/a/", { read: ["x"] }), done("/b/", { read: ["x"] })],
      );

      expect(wordsOf(wordChanges(model)).slice(-2)).toEqual([
        "1 page was read in full in only one of the two runs, so it wasn't compared:",
        "/b/: new, not in the run before.",
      ]);
    });

    it("has no list when every page was read in full in both", () => {
      expect(saysOf(wordChanges(grantsModel()))).not.toContain("only one of the two runs");
    });

    it("still lists the page when none could be compared, and doesn't say two runs were compared", () => {
      const model = changedModel(
        [done("/a/", { read: ["x"] })],
        [{ path: "/a/", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] }],
      );

      expect(wordsOf(wordChanges(model))).toEqual([
        "What changed since the last run",
        "No page was read in full in both runs, so none could be compared.",
        "1 page was read in full in only one of the two runs, so it wasn't compared:",
        "/a/: failed in one run, read in full in the other.",
      ]);
      expect(changesGist(changesOf(model))).toBeNull();
    });
  });

  describe("a page that sounds different", () => {
    it("says its name and counts, the rules its flags resolved, its pass, and its flags, as the page does", () => {
      const model = grantsModel();

      expect(wordsOf(wordChanges(model))).toEqual([
        "What changed since the last run",
        changesOf(model).line,
        "Compared: run r1 (before) and run r2 (latest).",
        "/grants/: read: 2 lines removed and 2 added",
        "generic-link-text resolved",
        "The read pass on /grants/: 2 lines removed and 2 added",
        "Change | What NVDA said",
        "Same | banner landmark, link, Skip to main content",
        "Same | heading, level 1, Grants",
        "Removed | To apply,, link, click here, dot",
        "Added | To apply,, link, Read the FY27 plan, dot",
        "Removed | To read the rules,, link, click here, dot",
        "Added | To read the rules,, link, Download the grant rules, dot",
        "Same | main landmark",
        "Same | region, Deadlines",
        "… | 2 lines the same",
        "Flags: generic-link-text (read pass), 2 before, none now (resolved).",
      ]);
      expect(changesOf(model).line).toContain("1 of 1 page sounds different");
    });

    it("has a heading 2 for the page, and a heading 3 for each pass that sounds different, in pass order", () => {
      const model = changedModel(
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
      );
      const blocks = wordChanges(model);

      expect(outlineOf(blocks)).toEqual([
        "1 What changed since the last run",
        "2 /a/: read: 3 lines removed and 2 added; headings: 1 line added; Tab: 1 line removed",
        "3 The read pass on /a/: 3 lines removed and 2 added",
        "3 The headings pass on /a/: 1 line added",
        "3 The Tab pass on /a/: 1 line removed",
      ]);
      expect(tablesIn(blocks)).toHaveLength(3);
    });

    it("gives only a pass that sounds different its heading and table", () => {
      const model = changedModel(
        [done("/a/", { read: ["x", "old"], headings: ["h1", "h2"], tab: ["t1", "old"] })],
        [done("/a/", { read: ["x", "new"], headings: ["h1", "h2"], tab: ["t1", "new"] })],
      );
      const blocks = wordChanges(model);

      expect(outlineOf(blocks).slice(1)).toEqual([
        "2 /a/: read: 1 line removed and 1 added; Tab: 1 line removed and 1 added",
        "3 The read pass on /a/: 1 line removed and 1 added",
        "3 The Tab pass on /a/: 1 line removed and 1 added",
      ]);
      expect(saysOf(blocks)).not.toContain("The headings pass");
    });

    it("says a pass that only lost lines, and one that only gained some, as it is, never 'and 0 added'", () => {
      const lost = changedModel(
        [done("/a/", { read: ["x", "gone"] })],
        [done("/a/", { read: ["x"] })],
      );
      const gained = changedModel(
        [done("/a/", { read: ["x"] })],
        [done("/a/", { read: ["x", "new 1", "new 2"] })],
      );

      expect(outlineOf(wordChanges(lost)).slice(1)).toEqual([
        "2 /a/: read: 1 line removed",
        "3 The read pass on /a/: 1 line removed",
      ]);
      expect(outlineOf(wordChanges(gained)).slice(1)).toEqual([
        "2 /a/: read: 2 lines added",
        "3 The read pass on /a/: 2 lines added",
      ]);
    });

    it("says a pass's heading with no line removed or added when its record differs but the lines shown don't", () => {
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

      expect(outlineOf(wordChanges(model)).slice(1)).toEqual([
        "2 /a/: read: no lines removed or added",
        "3 The read pass on /a/: no lines removed or added",
      ]);
    });

    it("names a page by its label when it has one, and a pass's heading by its address, which no label can make the same as another's", () => {
      const model = changedModel(
        [done("/a/", { read: ["old"] }, { label: "Grants <b>&</b>" })],
        [done("/a/", { read: ["new"] }, { label: "Grants <b>&</b>" })],
      );

      expect(outlineOf(wordChanges(model)).slice(1)).toEqual([
        "2 Grants <b>&</b>: read: 1 line removed and 1 added",
        "3 The read pass on /a/: 1 line removed and 1 added",
      ]);
    });
  });

  describe("a pass's table of lines", () => {
    it("shows a changed page's lines as a table, each marked in words", () => {
      const rows = wordsOf(wordChanges(twoRuns()));

      expect(rows).toContain("Change | What NVDA said");
      expect(rows).toContain("Removed | link, click here");
      expect(rows).toContain("Added | link, Read the annual report");
      expect(rows.some((row) => /^… \| \d+ lines? the same$/.test(row))).toBe(true);
    });

    it("sets the changed words in bold, and not the rest", () => {
      const lines = diffRows(wordChanges(twoRuns()));
      const added = lines.find((line) => lineText(line) === "link, Read the annual report");
      const removed = lines.find((line) => lineText(line) === "link, click here");

      expect(added?.[0]).toBe("link, ");
      expect(
        added?.slice(1).every((piece) => typeof piece !== "string" && piece.bold === true),
      ).toBe(true);
      expect(added).toEqual(["link, ", { text: "Read the annual report", bold: true }]);
      expect(removed).toEqual(["link, ", { text: "click here", bold: true }]);
    });

    it("sets the words around a change apart from it, on each side, in both lines of a pair", () => {
      const lines = diffRows(wordChanges(grantsModel()));

      expect(lines[2]).toEqual(["To apply,, link, ", { text: "click here", bold: true }, ", dot"]);
      expect(lines[3]).toEqual([
        "To apply,, link, ",
        { text: "Read the FY27 plan", bold: true },
        ", dot",
      ]);
      // A line the same has no bold.
      expect(lines[0]).toEqual(["banner landmark, link, Skip to main content"]);
    });

    it("says each row as Same, Removed, or Added, in words, with no sign and no color to carry it", () => {
      const table = tableAt(wordChanges(grantsModel()), 0);

      expect(table.head).toEqual(CHANGES_TEXT.head);
      expect(table.rows.map((row) => cellLines(row[0]))).toEqual([
        ["Same"],
        ["Same"],
        ["Removed"],
        ["Added"],
        ["Removed"],
        ["Added"],
        ["Same"],
        ["Same"],
        ["…"],
      ]);
      // No sign in front of the words, and no "Removed: " in the line: the column says it.
      expect(saysOf([table])).not.toMatch(/[−+] |Removed: |Added: /);
    });

    it("marks a line with no partner whole, and keeps the lines beside a change", () => {
      const model = changedModel(
        [done("/a/", { read: ["first", "gone 1", "gone 2", "last"] })],
        [done("/a/", { read: ["first", "last", "new 1", "new 2", "new 3"] })],
      );
      const blocks = wordChanges(model);

      expect(wordsOf([tableAt(blocks, 0)])).toEqual([
        "Change | What NVDA said",
        "Same | first",
        "Removed | gone 1",
        "Removed | gone 2",
        "Same | last",
        "Added | new 1",
        "Added | new 2",
        "Added | new 3",
      ]);
      expect(diffRows(blocks)[1]).toEqual([{ text: "gone 1", bold: true }]);
      expect(diffRows(blocks)[5]).toEqual([{ text: "new 2", bold: true }]);
    });

    it("counts a run of lines the same, in the singular for one, in a cell beside its mark", () => {
      const lines = (change: string, tail: number) => [
        "first",
        change,
        ...Array.from({ length: tail }, (_, index) => `same ${index + 1}`),
      ];
      const tableOfTail = (tail: number) =>
        tableAt(
          wordChanges(
            changedModel(
              [done("/a/", { read: lines("old", tail) })],
              [done("/a/", { read: lines("new", tail) })],
            ),
          ),
          0,
        );

      expect(wordsOf([tableOfTail(3)]).at(-1)).toBe("… | 1 line the same");
      expect(wordsOf([tableOfTail(14)]).at(-1)).toBe("… | 12 lines the same");
      expect(
        tableOfTail(14)
          .rows.at(-1)
          ?.map((cell) => cellLines(cell)),
      ).toEqual([["…"], ["12 lines the same"]]);
    });

    it("has a cell for each heading in every row, and no heading with no words", () => {
      for (const model of [grantsModel(), twoRuns(), twoPagesModel()]) {
        for (const { head, rows } of tablesIn(wordChanges(model))) {
          expect(head.every((words) => words.trim() !== "")).toBe(true);
          for (const row of rows) expect(row).toHaveLength(head.length);
        }
      }
    });

    it("keeps a line's words exactly, markup and all, since a document holds words and not markup", () => {
      const hostile = '<img src=x onerror="alert(1)">';
      const model = changedModel(
        [done("/a/", { read: [`${hostile} context`, `${hostile} old`] })],
        [done("/a/", { read: [`${hostile} context`, `${hostile} new`] })],
      );
      const rows = wordsOf(wordChanges(model));

      expect(rows).toContain(`Same | ${hostile} context`);
      expect(rows).toContain(`Removed | ${hostile} old`);
      expect(rows).toContain(`Added | ${hostile} new`);
      expect(rows.join("\n")).not.toContain("&lt;");
      expect(rows.join("\n")).not.toContain("&quot;");
    });
  });

  describe("the rules a page's flags resolved and raised", () => {
    /** The model whose page lost one rule, gained another, and kept a third. */
    function ruleModel(): ShareModel {
      return changedModel(
        [done("/a/", { read: ["old"], headings: ["h"] }, { flags: [LINK_FLAG, UNLABELED_FLAG] })],
        [
          done(
            "/a/",
            { read: ["new"], headings: ["h"] },
            { flags: [UNLABELED_FLAG, HEADINGS_FLAG] },
          ),
        ],
      );
    }

    it("says them on one line under the page's heading: the rule's name, then what happened to it", () => {
      const [part = []] = partsAt(wordChanges(ruleModel()), 2);

      expect(wordsOf(part).slice(0, 2)).toEqual([
        "/a/: read: 1 line removed and 1 added",
        "generic-link-text resolved; headings new",
      ]);
      // Unchanged, so no word of it on that line.
      expect(wordsOf(part)[1]).not.toContain("unchanged");
      expect(wordsOf(part)[1]).not.toContain("unlabeled");
    });

    it("sets each rule's name in the fixed-width font, and the words after it in plain, the resolved before the new", () => {
      const [part = []] = partsAt(wordChanges(ruleModel()), 2);

      expect(part[1]).toEqual(
        para(
          { text: "generic-link-text", mono: true },
          ` ${CHANGES_TEXT.rules.resolved}`,
          "; ",
          { text: "headings", mono: true },
          ` ${CHANGES_TEXT.rules.fresh}`,
        ),
      );
    });

    it("says what each flag did between the runs, pass by pass, as the page does, after the tables", () => {
      const model = ruleModel();
      const [page] = changesOf(model).changed;
      const [part = []] = partsAt(wordChanges(model), 2);
      const last = part.at(-1);

      expect(last).toEqual(para(...(page === undefined ? [] : (flagsLine(page.flags) ?? []))));
      expect(wordsOf(last === undefined ? [] : [last])).toEqual([
        "Flags: generic-link-text (read pass), 2 before, none now (resolved). headings (headings pass), none before, new. unlabeled (read pass), unchanged.",
      ]);
      // Each rule in the flags line is in bold, as the page's is.
      expect(last?.kind === "para" ? boldIn(last.line) : []).toEqual([
        "generic-link-text",
        "headings",
        "unlabeled",
      ]);
    });

    it("says no rule for a flag whose count changed, and no flags line for a page with none", () => {
      const fewer: FlagResult = { ...LINK_FLAG, count: 1 };
      const level3: FlagResult = {
        ...HEADINGS_FLAG,
        message: "The first heading is level 3, not level 1.",
      };
      const changed = changedModel(
        [done("/a/", { read: ["old"], headings: ["h"] }, { flags: [LINK_FLAG, HEADINGS_FLAG] })],
        [done("/a/", { read: ["new"], headings: ["h"] }, { flags: [fewer, level3] })],
      );
      const [part = []] = partsAt(wordChanges(changed), 2);

      // Neither went or came, so there is no line of rules; inside, neither is "unchanged".
      expect(wordsOf(part).slice(0, 2)).toEqual([
        "/a/: read: 1 line removed and 1 added",
        "The read pass on /a/: 1 line removed and 1 added",
      ]);
      expect(saysOf(part)).toContain("2 before, 1 now (changed)");
      expect(saysOf(part)).not.toContain("unchanged");

      const plain = wordChanges(
        changedModel([done("/a/", { read: ["old"] })], [done("/a/", { read: ["new"] })]),
      );
      expect(saysOf(plain)).not.toContain("Flags:");
      expect(plain.at(-1)?.kind).toBe("table");
    });

    it("leaves a rule out while another pass still raises it, as the page's chips do, and says the flag inside", () => {
      const tabFlag: FlagResult = { ...LINK_FLAG, pass: "tab" };
      const model = changedModel(
        [done("/a/", { read: ["old"], tab: ["t"] }, { flags: [LINK_FLAG, tabFlag] })],
        [done("/a/", { read: ["new"], tab: ["t"] }, { flags: [tabFlag] })],
      );
      const [part = []] = partsAt(wordChanges(model), 2);

      expect(wordsOf(part)[1]).toBe("The read pass on /a/: 1 line removed and 1 added");
      expect(saysOf(part)).not.toContain("generic-link-text resolved");
      expect(saysOf(part)).toContain(
        "Flags: generic-link-text (read pass), 2 before, none now (resolved). generic-link-text (Tab pass), unchanged.",
      );
    });
  });

  describe("a pass that sounds different but couldn't be read", () => {
    it("says so for the pass, in its place, after the tables, and gives the table of the pass that could be read", () => {
      const model = changedModel(
        [done("/a/", { read: ["old"], tab: ["t old"] })],
        [done("/a/", { read: ["new"], tab: ["t new"] })],
        (run, pass) => !(run === "r2" && pass === "tab"),
      );
      const [part = []] = partsAt(wordChanges(model), 2);

      expect(outlineOf(part)).toEqual([
        "2 /a/: read: 1 line removed and 1 added; Tab: couldn't be read here",
        "3 The read pass on /a/: 1 line removed and 1 added",
      ]);
      expect(tablesIn(part)).toHaveLength(1);
      expect(wordsOf(part).at(-1)).toBe(CHANGES_TEXT.unreadable("tab"));
      expect(CHANGES_TEXT.unreadable("tab")).toBe(
        "The Tab pass sounds different, but its transcript couldn't be read here.",
      );
    });

    it("says a line for each pass that couldn't be read, in pass order, and no table when none can", () => {
      const lost = changedModel(
        [done("/a/", { read: ["old"], headings: ["h old"], tab: ["t old"] })],
        [done("/a/", { read: ["new"], headings: ["h new"], tab: ["t new"] })],
        (run) => run === "r1",
      );
      const [part = []] = partsAt(wordChanges(lost), 2);

      expect(wordsOf(part)).toEqual([
        "/a/: read: couldn't be read here; headings: couldn't be read here; Tab: couldn't be read here",
        "The read pass sounds different, but its transcript couldn't be read here.",
        "The headings pass sounds different, but its transcript couldn't be read here.",
        "The Tab pass sounds different, but its transcript couldn't be read here.",
      ]);
      expect(tablesIn(part)).toEqual([]);
      // No heading 3: there are no lines to show for a pass.
      expect(outlineOf(part)).toHaveLength(1);
    });
  });

  describe("each page that sounds different has its own blocks", () => {
    it("puts each page's counts, rules, passes, lines, and flags under its own heading, and none of the other's", () => {
      const parts = partsAt(wordChanges(twoPagesModel()), 2);
      const [a = [], b = []] = parts;

      expect(parts).toHaveLength(2);
      expect(wordsOf(a)).toEqual([
        "The A page: read: 1 line removed and 1 added; Tab: couldn't be read here",
        "generic-link-text resolved",
        "The read pass on /a/: 1 line removed and 1 added",
        "Change | What NVDA said",
        "Removed | a old",
        "Added | a new",
        "The Tab pass sounds different, but its transcript couldn't be read here.",
        "Flags: generic-link-text (read pass), 2 before, none now (resolved).",
      ]);
      expect(wordsOf(b)).toEqual([
        "/b/: headings: 1 line removed and 1 added",
        "unlabeled resolved; headings new",
        "The headings pass on /b/: 1 line removed and 1 added",
        "Change | What NVDA said",
        "Removed | b head old",
        "Added | b head new",
        "Flags: unlabeled (read pass), 1 before, none now (resolved). headings (headings pass), none before, new.",
      ]);
      // Neither says the other's.
      expect(saysOf(a)).not.toMatch(/\/b\/|b head|headings|unlabeled/);
      expect(saysOf(b)).not.toMatch(/The A page|a old|a new|generic-link-text|Tab pass/);
    });

    it("has a part for each page that sounds different, in the later run's order, and none for a page that sounds the same", () => {
      const model = changedModel(
        [
          done("/one/", { read: ["x"] }),
          done("/two/", { read: ["old"] }),
          done("/three/", { read: ["old"] }),
        ],
        [
          done("/one/", { read: ["x"] }),
          done("/three/", { read: ["new"] }),
          done("/two/", { read: ["new"] }),
        ],
      );

      expect(outlineOf(wordChanges(model)).filter((line) => line.startsWith("2 "))).toEqual([
        "2 /three/: read: 1 line removed and 1 added",
        "2 /two/: read: 1 line removed and 1 added",
      ]);
      expect(saysOf(wordChanges(model))).not.toContain("/one/");
    });
  });

  describe("what the page says", () => {
    /** The page's own words in one fold of a page that sounds different. */
    function pageSays(fold: string) {
      const spans = (html: string, className: string) =>
        [...html.matchAll(new RegExp(`<span class="${className}">(.*?)</span>`, "gs"))].map(
          (found) => textOf(found[1] ?? "", ""),
        );
      const summary = /<summary>(.*?)<\/summary>/s.exec(fold)?.[1] ?? "";
      return {
        name: (spans(summary, "what")[0] ?? "").replace(/:$/, ""),
        counts: spans(summary, "sub")[0] ?? "",
        chips: spans(summary, "chip"),
        // A pass's heading is its words, the page's address (heard, not seen), and how many lines.
        heads: [...fold.matchAll(/<h3 class="logh">(.*?)<\/h3>/gs)].map(([, inside = ""]) => ({
          pass: textOf(inside.split("<span")[0] ?? "", ""),
          on: spans(inside, "sr")[0] ?? "",
          sizes: spans(inside, "sub")[0] ?? "",
        })),
        // A row's mark and its line, the words heard before the line and the mark's sign left out.
        rows: [...fold.matchAll(/<tr class="(?:same|del|add)">(.*?)<\/tr>/gs)].map(
          ([, cells = ""]) => {
            const [change = "", said = ""] = [...cells.matchAll(/<td>(.*?)<\/td>/gs)].map(
              (cell) => cell[1] ?? "",
            );
            const mark = /aria-hidden="true">(?:[−+] )?(.*?)<\/span>/.exec(change)?.[1];
            const words = textOf(said.replace(/<span class="sr">.*?<\/span>/g, ""), "");
            return `${mark ?? textOf(change, "")} | ${words}`;
          },
        ),
        paragraphs: [...fold.matchAll(/<p>(.*?)<\/p>/gs)].map((found) =>
          textOf(found[1] ?? "", ""),
        ),
      };
    }

    it("says, page by page, every phrase of each page's fold in that page's own blocks", () => {
      const models = [
        grantsModel(),
        notedModel(),
        twoPagesModel(),
        changedModel(
          [done("/a/", { read: ["first", "gone 1", "gone 2", "last"], headings: ["h"] })],
          [
            done("/a/", {
              read: ["first", "last", "new 1", "new 2", "new 3"],
              headings: ["h", "i"],
            }),
          ],
        ),
      ];
      let seen = 0;

      for (const model of models) {
        const folds = foldsIn(renderChanges(model));
        const parts = partsAt(wordChanges(model), 2);

        expect(parts).toHaveLength(folds.length);
        for (const [index, fold] of folds.entries()) {
          const part = parts[index] ?? [];
          const says = pageSays(fold);
          const words = wordsOf(part);
          const [headline = ""] = words;

          expect(headline).toBe(`${says.name}: ${says.counts}`);
          for (const chip of says.chips) expect(saysOf(part), chip).toContain(chip);
          expect(outlineOf(part).slice(1)).toEqual(
            says.heads.map(({ pass, on, sizes }) => `3 ${pass} ${on}: ${sizes}`),
          );
          for (const row of says.rows) expect(words, row).toContain(row);
          for (const paragraph of says.paragraphs) expect(words, paragraph).toContain(paragraph);
          seen += says.rows.length + says.paragraphs.length + says.chips.length;
        }
      }
      // Read at all, so a check of nothing can't pass.
      expect(seen).toBeGreaterThan(20);
    });

    it("says what the page says around its folds, with its own sentence about opening a page left out", async () => {
      const mixed = changedModel(
        [done("/a/", { read: ["old"] }), done("/b/", { read: ["x"] })],
        [done("/a/", { read: ["new"] }), done("/b/", { read: ["x"] })],
      );
      const open = " A page that sounds different opens to show what changed.";
      let seen = 0;

      for (const model of [await demoModel(), notedModel(), mixed, grantsModel()]) {
        const html = renderChanges(model);
        const outside = html.split('<div class="folds">')[0] ?? "";
        const words = wordsOf(wordChanges(model));
        const said = [
          ...outside.matchAll(/<p class="(?:gist|prob-verdict)">(.*?)<\/p>/gs),
          ...outside.matchAll(/<li>(.*?)<\/li>/gs),
        ].map((found) => textOf(found[1] ?? "", "").replace(open, ""));

        for (const line of said) expect(words, line).toContain(line);
        seen += said.length;
      }
      expect(seen).toBeGreaterThan(15);
    });
  });

  describe("what only the page has", () => {
    it("says nothing of a page that opens: the Word copy folds nothing", () => {
      const mixed = changedModel(
        [done("/a/", { read: ["old"] }), done("/b/", { read: ["x"] })],
        [done("/a/", { read: ["new"] }), done("/b/", { read: ["x"] })],
      );

      for (const model of [grantsModel(), mixed, notedModel(), twoPagesModel()]) {
        expect(saysOf(wordChanges(model))).not.toMatch(/opens|Open a page|fold/i);
      }
      // The page says it, in the line on the two runs; the Word copy gives that line none.
      expect(renderChanges(mixed)).toContain(
        "A page that sounds different opens to show what changed.",
      );
      expect(wordsOf(wordChanges(mixed))).toContain(
        "Compared: run r1 (before) and run r2 (latest). 1 page sounds the same, and is counted, not shown.",
      );
    });

    it("links to nothing, since the page's links go to its own parts, which this copy has in order", () => {
      for (const model of [grantsModel(), notedModel(), twoRuns(), twoPagesModel()]) {
        expect(hrefsOf(wordChanges(model))).toEqual([]);
      }
    });
  });

  it("sets its headings in order: an h1 for the section, an h2 for each page, an h3 for each pass", async () => {
    for (const model of [await demoModel(), grantsModel(), twoPagesModel(), noRunModel()]) {
      const levels = wordChanges(model).flatMap((block) =>
        block.kind === "heading" ? [block.level] : [],
      );

      expect(levels[0]).toBe(1);
      expect(levels.filter((level) => level === 1)).toHaveLength(1);
      for (const [index, level] of levels.entries()) {
        if (index > 0) expect(level - (levels[index - 1] ?? 0)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("wordProblems", () => {
  describe("for the demo runs of 29 September 2026", () => {
    it("says what the page says of the demo's two problems, each with its own record", async () => {
      expect(wordsOf(wordProblems(await demoModel()))).toEqual([
        "Problems during the runs",
        "2 problems, both outside voicecap: another window took the screen. 1 didn't happen again, and 1 wasn't tried again. Neither was an unexpected error, the kind that could mean a problem in voicecap itself.",
        PROBLEMS_TEXT.gist,
        "Run 2026-09-29_1315 · /the-report/",
        "Time not recorded. Another window came to the front. Didn't happen again.",
        "Question | Answer",
        "What happened | During the read pass, another window took the screen.",
        "How the kind was decided | From the error's own wording, which voicecap wrote: this run was recorded before voicecap noted a cause for each failure.",
        "What voicecap did | Recorded the page as failed.",
        "Did it happen again? | No: read in full in run 2026-09-29_1402.",
        "Effect on the results | No transcripts from this run: the page failed. The partial transcripts it left are in pages/the-report-03940c2f88/.",
        "The record of this problem, word for word, on /the-report/ in run 2026-09-29_1315",
        "Time | From | What was recorded",
        "Not recorded | run.json | read pass: The browser lost the foreground to another window, so this step's keystroke and speech were discarded. Keep the computer free while voicecap runs.",
        "The step and the key: not recorded: this run used voicecap 0.4.1.",
        "Which program came to the front: not recorded: this run used voicecap 0.4.1.",
        "The event log and NVDA's own log: not recorded: this run used voicecap 0.4.1.",
        "Run 2026-09-29_1402 · /how-a-run-works/",
        "Time not recorded. Another window came to the front. Not tried again.",
        "Question | Answer",
        "What happened | During the headings pass, another window took the screen.",
        "How the kind was decided | From the error's own wording, which voicecap wrote: this run was recorded before voicecap noted a cause for each failure.",
        "What voicecap did | Recorded the page as failed.",
        "Did it happen again? | Not known: this run didn't try the page again; run 2026-09-29_1315, before it, read it in full.",
        "Effect on the results | No transcripts from this run: the page failed. The partial transcripts it left are in pages/how-a-run-works-fd116f9328/.",
        "The record of this problem, word for word, on /how-a-run-works/ in run 2026-09-29_1402",
        "Time | From | What was recorded",
        "Not recorded | run.json | headings pass: The browser lost the foreground to another window, so this step's keystroke and speech were discarded. Keep the computer free while voicecap runs.",
        "The step and the key: not recorded: this run used voicecap 0.4.1.",
        "Which program came to the front: not recorded: this run used voicecap 0.4.1.",
        "The event log and NVDA's own log: not recorded: this run used voicecap 0.4.1.",
        "How voicecap tells causes apart",
        "9 kinds of problem, and whose each is",
        "What happened | Whose it is | What voicecap does, and what it means",
        ...KIND_ROWS.map((row) => `${row.title} | ${row.whose} | ${row.meaning}`),
      ]);
    });

    it("has the demo's two problems, each with its record in the fixed-width font", async () => {
      const demo = await demoModel();
      const blocks = wordProblems(demo);

      expect(wordsOf(blocks)).toContain(lineText(firstSentenceBold(demo.problems.line)));
      expect(
        blocks
          .filter((b) => b.kind === "heading" && b.level === 2)
          .map((b) => b.kind === "heading" && b.text),
      ).toEqual([
        ...demo.problems.problems.map((p) => `Run ${p.run} · ${pageTitle(p.page)}`),
        "How voicecap tells causes apart",
      ]);
      const record = blocks.find((b) => b.kind === "table" && b.head[2] === "What was recorded");
      expect(record?.kind === "table" && record.rows[0]?.[2]).toMatchObject({ mono: true });
    });

    it("opens with the section's heading, the verdict line with its first sentence in bold, and what's in the section", async () => {
      const model = await demoModel();
      const [head, verdict, gist] = wordProblems(model);

      expect(head).toEqual(heading(1, "Problems during the runs"));
      expect(verdict).toEqual(para(...firstSentenceBold(model.problems.line)));
      expect(verdict?.kind === "para" ? boldIn(verdict.line) : []).toEqual([
        "2 problems, both outside voicecap: another window took the screen.",
      ]);
      expect(gist).toEqual(para(PROBLEMS_TEXT.gist));
    });

    it("links only the table of kinds to where an unexpected error is reported, since neither problem is one", async () => {
      const model = await demoModel();

      expect(hrefsOf(wordProblems(model))).toEqual([ISSUES_URL]);
      for (const part of problemParts(model).problems) expect(hrefsOf(part)).toEqual([]);
    });
  });

  describe("the line under each problem's heading", () => {
    it("says its time, its kind, and whether it happened again, each a sentence", () => {
      const model = failedModel([failedAttempt({ n: 1, step: 12, command: "nextLine" })]);
      const part = firstProblem(model);

      expect(wordsOf(part)[0]).toBe("Run r1 · /grants/");
      expect(part[1]).toEqual(para("14:05. Another window came to the front. Not tried again."));
    });

    it("gives the time the attempt failed, not when it began", () => {
      const slow = failedAttempt({
        n: 1,
        startedAt: "2026-09-26T14:05:50.000-05:00",
        endedAt: "2026-09-26T14:06:20.000-05:00",
      });

      expect(wordsOf(firstProblem(failedModel([slow])))[1]).toBe(
        "14:06. Another window came to the front. Not tried again.",
      );
    });

    it("says the time wasn't recorded, with a capital as the sentence it begins, when the run kept none", () => {
      expect(wordsOf(firstProblem(wordingModel("read pass: HTTP 500")))[1]).toBe(
        "Time not recorded. The website answered with an error. Not tried again.",
      );
      expect(PROBLEMS_TEXT.noTime).toBe("time not recorded");
    });

    it("names the kind as the table of kinds does, for each kind a problem can be", () => {
      const causes = [
        ["foreground", "Another window came to the front"],
        ["locked", "The computer locked"],
        ["screen-reader-stopped", "NVDA stopped running"],
        ["browser", "The browser stopped, or didn't start"],
        ["http", "The website answered with an error"],
        ["unreachable", "The website couldn't be reached"],
        ["step-timeout", "A step took too long"],
        ["unexpected", "An unexpected error"],
      ] as const;

      for (const [cause, title] of causes) {
        const part = firstProblem(failedModel([failedAttempt({ n: 1, cause })]));

        expect(wordsOf(part)[1], cause).toBe(`14:05. ${title}. Not tried again.`);
      }
    });

    it("says whether it happened again as the page's chip does, for each answer", () => {
      const slow = failedAttempt({
        n: 2,
        cause: "step-timeout",
        message: "nextLine did not finish within 30s",
        ...LATER,
      });
      const lines = (attempts: AttemptRecord[]) =>
        problemParts(failedModel(attempts)).problems.map((part) => wordsOf(part)[1]);
      const read = buildShareModel(
        inputOf([
          shareRun({
            id: "r1",
            pages: [{ path: "/grants/", failedAttempts: [failedAttempt({ n: 1 })], attempts: 2 }],
          }),
        ]),
      );

      expect(wordsOf(firstProblem(read))[1]).toBe(
        "14:05. Another window came to the front. Didn't happen again.",
      );
      expect(lines([failedAttempt({ n: 1 })])).toEqual([
        "14:05. Another window came to the front. Not tried again.",
      ]);
      expect(lines([failedAttempt({ n: 1 }), failedAttempt({ n: 2, ...LATER })])).toEqual([
        "14:05. Another window came to the front. Happened again.",
        "14:06. Another window came to the front. Happened again.",
      ]);
      expect(lines([failedAttempt({ n: 1 }), slow])).toEqual([
        "14:05. Another window came to the front. Happened again, in different ways.",
        "14:06. A step took too long. Happened again, in different ways.",
      ]);
    });
  });

  describe("a problem's questions and answers", () => {
    it("is a table of Question and Answer: what happened, what voicecap did, whether it happened again, and the effect", () => {
      const model = failedModel([failedAttempt({ n: 1, step: 12, command: "nextLine" })]);
      const [problem] = model.problems.problems;
      const table = tableAt(firstProblem(model), 0);

      expect(table.head).toEqual(["Question", "Answer"]);
      expect(table.head).toEqual(WORD_TEXT.problems.questionsHead);
      expect(wordsOf([table])).toEqual([
        "Question | Answer",
        "What happened | During the read pass, at step 12 (Down Arrow), another window took the screen.",
        "What voicecap did | Recorded the page as failed.",
        "Did it happen again? | Not known: this run didn't try the page again, and no other run read it in full.",
        `Effect on the results | ${sentence(problem?.effect ?? "")}`,
      ]);
    });

    it("doesn't say how the kind was decided for a cause the run recorded, and says it for an older run's wording", () => {
      const recorded = firstProblem(failedModel([failedAttempt({ n: 1 })]));
      const wording = firstProblem(wordingModel("read pass: nextLine did not finish within 30s"));

      expect(saysOf(recorded)).not.toContain("How the kind was decided");
      expect(wordsOf([tableAt(wording, 0)]).map((row) => row.split(" | ")[0])).toEqual([
        "Question",
        "What happened",
        "How the kind was decided",
        "What voicecap did",
        "Did it happen again?",
        "Effect on the results",
      ]);
    });

    it("says how the kind was decided as the page does, which isn't the same for every kind", () => {
      const causes = "this run was recorded before voicecap noted a cause for each failure";
      const decided = (error: string) => {
        const model = wordingModel(error);
        const row = wordsOf([tableAt(firstProblem(model), 0)]).find((words) =>
          words.startsWith("How the kind was decided | "),
        );
        return { kind: model.problems.problems[0]?.kind, row };
      };

      expect(decided("read pass: page.goto: Timeout 30000ms exceeded.")).toEqual({
        kind: "unexpected",
        row: `How the kind was decided | voicecap didn't recognize this error's wording, so it counts as unexpected: ${causes}.`,
      });
      expect(
        decided(
          "Could not open the page for the read pass: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4848/",
        ),
      ).toEqual({
        kind: "unreachable",
        row: "How the kind was decided | From the browser's own network error code in the error's wording.",
      });
      expect(decided("read pass: nextLine did not finish within 30s")).toEqual({
        kind: "timeout",
        row: `How the kind was decided | From the error's own wording, which voicecap wrote: ${causes}.`,
      });
      expect(decidedFrom("http")).toBe(
        `From the error's own wording, which voicecap wrote: ${causes}.`,
      );
    });

    it("tells an unexpected error's reader where to report it, with the address a link, in the last row", () => {
      const model = failedModel([UNEXPECTED]);
      const part = firstProblem(model);
      const table = tableAt(part, 0);
      const last = table.rows.at(-1);

      expect(JSON.stringify(wordProblems(model))).toContain(`"href":"${ISSUES_URL}"`);
      expect(cellLines(last?.[0])).toEqual(["Report it"]);
      expect(last?.[1]?.lines).toEqual([PROBLEMS_TEXT.report()]);
      expect(wordsOf([table]).at(-1)).toBe(
        "Report it | This could be a problem in voicecap itself. Please report it, with this record, at github.com/ICJIA/voicecap/issues.",
      );
      expect(last?.[1]?.lines[0]).toContainEqual({
        text: "github.com/ICJIA/voicecap/issues",
        href: ISSUES_URL,
      });
      // The same address in the problem's own links, and in the table of kinds.
      expect(hrefsOf(part)).toEqual([ISSUES_URL]);
      expect(hrefsOf(wordProblems(model))).toEqual([ISSUES_URL, ISSUES_URL]);
    });

    it("doesn't ask for a report of an error voicecap expected", () => {
      const part = firstProblem(failedModel([failedAttempt({ n: 1 })]));

      expect(saysOf(part)).not.toContain("Report it");
      expect(saysOf(part)).not.toContain("github.com");
    });

    it("ends each answer as a sentence, however voicecap's own words for it end", () => {
      const model = failedModel([failedAttempt({ n: 1 })]);
      const answers = (fields: Partial<Problem>) =>
        wordsOf([tableAt(firstProblem(withProblems(model, fields)), 0)]).slice(1);

      expect(
        answers({
          happened: "Something happened",
          did: "Something was done",
          verdict: "Not known",
          effect: "Nothing changed",
        }),
      ).toEqual([
        "What happened | Something happened.",
        "What voicecap did | Something was done.",
        "Did it happen again? | Not known.",
        "Effect on the results | Nothing changed.",
      ]);
      // An answer that ends as a sentence already is left as it is.
      expect(
        answers({ happened: "Did it?", did: "Done!", verdict: "No.", effect: "None." }),
      ).toEqual([
        "What happened | Did it?",
        "What voicecap did | Done!",
        "Did it happen again? | No.",
        "Effect on the results | None.",
      ]);
    });
  });

  describe("a problem's record, word for word", () => {
    it("has a heading that says which problem, and a table of its time, its source, and what was recorded", () => {
      const model = failedModel([failedAttempt({ n: 1, step: 12, command: "nextLine" })]);
      const part = firstProblem(model);

      expect(outlineOf(part)).toEqual([
        "2 Run r1 · /grants/",
        "3 The record of this problem, word for word, on /grants/ in run r1, attempt 1",
      ]);
      expect(wordsOf([tableAt(part, 1)])).toEqual([
        "Time | From | What was recorded",
        "14:05:00.000 | run.json | Attempt 1 started",
        "14:05:10.000 | run.json | Failed: foreground: The browser lost the foreground to another window, so this step's keystroke and speech were discarded. Keep the computer free while voicecap runs.",
      ]);
      expect(tableAt(part, 1).head).toEqual(PROBLEMS_TEXT.record.head);
    });

    it("sets what was recorded in the fixed-width font, and the time and the source in plain words", async () => {
      for (const model of [await demoModel(), failedModel([failedAttempt({ n: 1 })])]) {
        const records = tablesIn(wordProblems(model)).filter(
          (table) => table.head[2] === "What was recorded",
        );

        expect(records.length).toBeGreaterThan(0);
        for (const table of records) {
          for (const [time, source, entry] of table.rows) {
            expect(entry?.mono).toBe(true);
            expect(time?.mono).toBeUndefined();
            expect(source?.mono).toBeUndefined();
          }
        }
      }
    });

    it("says the time wasn't recorded where the run kept none, never a blank", () => {
      const part = firstProblem(wordingModel("read pass: HTTP 500"));
      const [row] = tableAt(part, 1).rows;

      expect(cellLines(row?.[0])).toEqual(["Not recorded"]);
      expect(cellLines(row?.[0])).toEqual([PROBLEMS_TEXT.record.noTime]);
      expect(wordsOf([tableAt(part, 1)])[1]).toBe("Not recorded | run.json | read pass: HTTP 500");
    });

    it("keeps an entry's words exactly, a line break and markup too", () => {
      const message =
        'Timeout 30000ms exceeded.\nCall log:\n  - navigating to "http://127.0.0.1:4848/", waiting until "load"\n<b>&</b>';
      const model = failedModel([failedAttempt({ n: 1, cause: "step-timeout", message })]);
      const part = firstProblem(model);
      const entries = tableAt(part, 1).rows.map((row) => lineText(row[2]?.lines[0] ?? []));

      expect(entries).toEqual(["Attempt 1 started", `Failed: step-timeout: ${message}`]);
      expect(entries[1]).toContain("\n  - navigating to");
      expect(saysOf(part)).not.toContain("&lt;");
    });

    it("says each problem's heading apart, by its page, its run, and its attempt, or its place among the page's when the run didn't number them", () => {
      const numbered = problemParts(
        failedModel([failedAttempt({ n: 1 }), failedAttempt({ n: 2, ...LATER })]),
      ).problems;
      const model = wordingModel(
        "read pass: nextLine did not finish within 30s",
        "headings pass: HTTP 500",
      );
      const text = problemParts(model).problems;

      expect(numbered.map((part) => outlineOf(part)[1])).toEqual([
        "3 The record of this problem, word for word, on /grants/ in run r1, attempt 1",
        "3 The record of this problem, word for word, on /grants/ in run r1, attempt 2",
      ]);
      expect(text.map((part) => outlineOf(part)[1])).toEqual([
        "3 The record of this problem, word for word, on /grants/ in run r1",
        "3 The record of this problem, word for word, on /grants/ in run r1, problem 2",
      ]);
      // The same words as the page names the boxes of the same problems by.
      for (const [index, problem] of model.problems.problems.entries()) {
        expect(outlineOf(text[index] ?? [])[1]).toBe(
          `3 ${PROBLEMS_TEXT.record.title}, ${whereOf(problem, index + 1)}`,
        );
      }
    });

    it("numbers a page's problems among that page's own in its own run, never among another page's or another run's", () => {
      const error = "read pass: HTTP 500";
      const failing = (path: string): SharePageSpec => ({
        path,
        status: "failed",
        errors: [error],
      });
      const pages = buildShareModel(
        inputOf([
          shareRun({
            id: "r1",
            voicecapVersion: "0.4.1",
            pages: [failing("/a/"), failing("/b/")],
          }),
        ]),
      );
      const runs = buildShareModel(
        inputOf([
          shareRun({
            id: "r1",
            createdAt: BEFORE,
            voicecapVersion: "0.4.1",
            pages: [failing("/a/")],
          }),
          shareRun({
            id: "r2",
            createdAt: AFTER,
            voicecapVersion: "0.4.1",
            pages: [failing("/a/")],
          }),
        ]),
      );
      const heads = (model: ShareModel) =>
        problemParts(model).problems.map((part) => outlineOf(part)[1]);

      expect(heads(pages)).toEqual([
        "3 The record of this problem, word for word, on /a/ in run r1",
        "3 The record of this problem, word for word, on /b/ in run r1",
      ]);
      expect(heads(runs)).toEqual([
        "3 The record of this problem, word for word, on /a/ in run r1",
        "3 The record of this problem, word for word, on /a/ in run r2",
      ]);
    });

    it("names a problem's page by its label, markup and all, and its record by its address", () => {
      const page: SharePageSpec = {
        path: "/grants/",
        label: "Grants <i>page</i>",
        status: "failed",
        failedAttempts: [failedAttempt({ n: 1 })],
      };
      const part = firstProblem(buildShareModel(inputOf([shareRun({ id: "r1", pages: [page] })])));

      expect(outlineOf(part)).toEqual([
        "2 Run r1 · Grants <i>page</i>",
        "3 The record of this problem, word for word, on /grants/ in run r1, attempt 1",
      ]);
      expect(saysOf(part)).not.toContain("&lt;");
    });
  });

  describe("the stack of an error voicecap didn't expect", () => {
    it("links an unexpected error to where it's reported, and shows its stack", () => {
      const blocks = wordProblems(failedModel([UNEXPECTED]));

      expect(JSON.stringify(blocks)).toContain('"href":"https://github.com/ICJIA/voicecap/issues"');
      expect(blocks.some((b) => b.kind === "mono")).toBe(true);
    });

    it("shows it under its own heading, as one fixed-width block, a line for each line of the stack, none dropped", () => {
      const part = firstProblem(failedModel([UNEXPECTED]));

      expect(outlineOf(part)).toEqual([
        "2 Run r1 · /grants/",
        "3 The record of this problem, word for word, on /grants/ in run r1, attempt 1",
        "3 Where in voicecap's code it happened, on /grants/ in run r1, attempt 1",
      ]);
      expect(part.filter((block) => block.kind === "mono")).toEqual([
        {
          kind: "mono",
          lines: [
            "TypeError: Cannot read properties of undefined (reading 'steps')",
            "    at runPass (dist/run/page-runner.js:42:9)",
            "    at processPage (dist/run/page-runner.js:90:5)",
          ],
        },
      ]);
      // The block follows the heading that says what it is, after the record.
      const stack = part.findIndex(
        (block) => block.kind === "heading" && block.text.startsWith("Where in voicecap's code"),
      );
      expect(part[stack + 1]?.kind).toBe("mono");
      expect(stack).toBeGreaterThan(part.findLastIndex((block) => block.kind === "table"));
      // The record's table has the entries and not the stack.
      expect(wordsOf([tableAt(part, 1)])).toEqual([
        "Time | From | What was recorded",
        "14:05:00.000 | run.json | Attempt 1 started",
        "14:05:10.000 | run.json | Failed: unexpected: Cannot read properties of undefined (reading 'steps')",
      ]);
      expect(PROBLEMS_TEXT.stack).toBe("Where in voicecap's code it happened");
    });

    it("splits a stack at either kind of line break, keeping every line, a blank one too", () => {
      const stack = "Error: a\r\n\r\n    at b (c.js:1:1)\n    at d (e.js:2:2)\n";
      const part = firstProblem(failedModel([failedAttempt({ n: 1, cause: "unexpected", stack })]));

      expect(part.find((block) => block.kind === "mono")).toEqual({
        kind: "mono",
        lines: ["Error: a", "", "    at b (c.js:1:1)", "    at d (e.js:2:2)", ""],
      });
    });

    it("says no stack for an error that has none, or that isn't one voicecap didn't expect", () => {
      const noStack = firstProblem(failedModel([failedAttempt({ n: 1, cause: "unexpected" })]));
      const expected = firstProblem(failedModel([failedAttempt({ n: 1 })]));
      const wording = firstProblem(wordingModel("read pass: page.goto: Timeout 30000ms exceeded."));

      for (const part of [noStack, expected, wording]) {
        expect(part.some((block) => block.kind === "mono")).toBe(false);
        expect(saysOf(part)).not.toContain("Where in voicecap's code it happened");
      }
      // An unexpected error with no stack still says where to report it.
      expect(saysOf(noStack)).toContain("Report it");
      expect(saysOf(wording)).toContain("Report it");
    });
  });

  describe("what the run didn't record", () => {
    it("says each line the model has, after the record, as a paragraph of its own", () => {
      const model = failedModel([failedAttempt({ n: 1 })], { voicecapVersion: "0.6.0" });
      const [problem] = model.problems.problems;
      const part = firstProblem(model);
      const lines = [
        "Which program came to the front: not recorded: this run used voicecap 0.6.0.",
        "The event log and NVDA's own log: not recorded: this run used voicecap 0.6.0.",
      ];

      expect(problem?.notRecorded).toEqual(lines);
      expect(part.slice(-2)).toEqual(lines.map((line) => para(line)));
      expect(part.at(-3)?.kind).toBe("table");
      expect(saysOf(part)).not.toContain("The step and the key");
    });

    it("puts the words 'Not recorded' in front of a line that doesn't say so, so a gap never reads as a pass", () => {
      const patched = withProblems(failedModel([failedAttempt({ n: 1 })]), {
        notRecorded: ["Only: not recorded: this run used voicecap 0.1.0.", "The step."],
      });

      expect(firstProblem(patched).slice(-2)).toEqual([
        para("Only: not recorded: this run used voicecap 0.1.0."),
        para("Not recorded: The step."),
      ]);
      expect(notRecordedLine("The step.")).toBe("Not recorded: The step.");
    });

    it("says nothing, and makes no paragraph, when the model has no line", () => {
      const part = firstProblem(
        withProblems(failedModel([failedAttempt({ n: 1 })]), { notRecorded: [] }),
      );

      expect(part.at(-1)?.kind).toBe("table");
      expect(saysOf(part)).not.toContain("not recorded");
    });
  });

  describe("each problem has its own blocks", () => {
    /**
     * Three problems with nothing in common: a lost window in an older run, an unexpected error with
     * its stack, and an error an older voicecap wrote as text.
     */
    function threeProblems(): ShareModel {
      const lost = failedAttempt({ n: 1, message: "A-message: lost to another window" });
      const broken = failedAttempt({
        n: 1,
        cause: "unexpected",
        message: "B-message: broke",
        stack: "Error: B-stack\n    at b (b.js:1:1)",
        ...LATER,
      });
      const runs = [
        shareRun({
          id: "r1",
          createdAt: BEFORE,
          pages: [
            { path: "/a/", status: "failed", failedAttempts: [lost] },
            { path: "/b/", status: "failed", failedAttempts: [broken] },
          ],
        }),
        shareRun({
          id: "r2",
          createdAt: AFTER,
          voicecapVersion: "0.4.1",
          pages: [{ path: "/c/", status: "failed", errors: ["read pass: HTTP 500"] }],
        }),
      ];
      return buildShareModel(inputOf(runs));
    }

    it("puts each problem's heading, answers, record, stack, and what wasn't recorded under its own, and none of the others'", () => {
      const model = threeProblems();
      const { problems, kinds } = problemParts(model);
      const [a = [], b = [], c = []] = problems;

      expect(model.problems.problems.map((problem) => problem.kind)).toEqual([
        "foreground",
        "unexpected",
        "http",
      ]);
      expect(problems).toHaveLength(3);
      expect(outlineOf(kinds)).toEqual(["2 How voicecap tells causes apart"]);
      // The first: a lost window, from an attempt record.
      expect(outlineOf(a)[0]).toBe("2 Run r1 · /a/");
      expect(saysOf(a)).toContain("A-message: lost to another window");
      expect(saysOf(a)).not.toMatch(
        /B-message|B-stack|Report it|How the kind was decided|\/b\/|\/c\//,
      );
      // The second: an unexpected error, with its stack and where to report it.
      expect(outlineOf(b)[0]).toBe("2 Run r1 · /b/");
      expect(saysOf(b)).toContain("B-message: broke");
      expect(saysOf(b)).toContain("Error: B-stack");
      expect(saysOf(b)).toContain("Report it");
      expect(saysOf(b)).not.toMatch(/A-message|How the kind was decided|\/a\/|\/c\//);
      // The third: an older run's wording, with how its kind was decided, and no time.
      expect(outlineOf(c)[0]).toBe("2 Run r2 · /c/");
      expect(wordsOf(c)[1]).toBe(
        "Time not recorded. The website answered with an error. Not tried again.",
      );
      expect(saysOf(c)).toContain("How the kind was decided");
      expect(saysOf(c)).not.toMatch(/A-message|B-message|B-stack|Report it|\/a\/|\/b\//);
    });

    it("says each problem's own answers and lines of what wasn't recorded, so another's identical words can't stand in for them", () => {
      const model = threeProblems();
      const { problems } = problemParts(model);

      for (const [index, problem] of model.problems.problems.entries()) {
        const words = wordsOf(problems[index] ?? []);

        expect(words, problem.run).toContain(`What happened | ${sentence(problem.happened)}`);
        expect(words, problem.run).toContain(`What voicecap did | ${sentence(problem.did)}`);
        expect(words, problem.run).toContain(`Did it happen again? | ${sentence(problem.verdict)}`);
        expect(words, problem.run).toContain(`Effect on the results | ${sentence(problem.effect)}`);
        for (const line of problem.notRecorded) expect(words, line).toContain(line);
        expect(words[0]).toBe(problemTitle(problem));
      }
      // The older run says its own version, which the other two don't.
      const [a = [], b = [], c = []] = problems;
      expect(saysOf(c)).toContain("this run used voicecap 0.4.1.");
      expect(saysOf(a)).not.toContain("0.4.1");
      expect(saysOf(b)).not.toContain("0.4.1");
    });

    it("comes before the table of kinds, which is last, and in the order the model has them", () => {
      const model = failedModel([failedAttempt({ n: 1 }), failedAttempt({ n: 2, ...LATER })]);
      const parts = partsAt(wordProblems(model), 2);

      expect(parts.map((part) => outlineOf(part)[0])).toEqual([
        "2 Run r1 · /grants/",
        "2 Run r1 · /grants/",
        "2 How voicecap tells causes apart",
      ]);
      expect(parts.slice(0, 2).map((part) => wordsOf(part)[1])).toEqual([
        "14:05. Another window came to the front. Happened again.",
        "14:06. Another window came to the front. Happened again.",
      ]);
    });
  });

  describe("how voicecap tells causes apart", () => {
    it("has its heading, the line that says what's in it, and a row for each kind of problem, whose it is, and what voicecap does", async () => {
      const { kinds } = problemParts(await demoModel());

      expect(outlineOf(kinds)).toEqual(["2 How voicecap tells causes apart"]);
      expect(wordsOf(kinds)).toEqual([
        "How voicecap tells causes apart",
        "9 kinds of problem, and whose each is",
        "What happened | Whose it is | What voicecap does, and what it means",
        ...KIND_ROWS.map((row) => `${row.title} | ${row.whose} | ${row.meaning}`),
      ]);
      expect(KIND_ROWS).toHaveLength(9);
      expect(tableAt(kinds, 0).head).toEqual(PROBLEMS_TEXT.kinds.head);
    });

    it("sets each kind's name in bold, as the page's row heading is, and links the address where an unexpected error is reported", () => {
      const { kinds } = problemParts(failedModel([failedAttempt({ n: 1 })]));
      const table = tableAt(kinds, 0);

      expect(table.rows.map((row) => row[0]?.lines.map(boldIn))).toEqual(
        KIND_ROWS.map((row) => [[row.title]]),
      );
      const unexpected = table.rows[KIND_ROWS.findIndex((row) => row.kind === "unexpected")];
      expect(unexpected?.[2]?.lines[0]).toEqual([
        "The full error, and where in voicecap's code it happened, are shown, with a link to report it (",
        { text: "github.com/ICJIA/voicecap/issues", href: ISSUES_URL },
        ").",
      ]);
      // Only that kind has the link.
      expect(hrefsOf(kinds)).toEqual([ISSUES_URL]);
    });
  });

  describe("with no problem to say", () => {
    it("says so, has no line on what's in the section, and still says how causes are told apart", () => {
      const model = buildShareModel(inputOf([shareRun({ id: "r1", pages: [{ path: "/a/" }] })]));
      const blocks = wordProblems(model);

      expect(model.problems.problems).toEqual([]);
      expect(wordsOf(blocks).slice(0, 2)).toEqual([
        "Problems during the runs",
        "No problems during the runs: every page was read in full.",
      ]);
      expect(blocks[1]).toEqual(para(...firstSentenceBold(model.problems.line)));
      expect(outlineOf(blocks)).toEqual([
        "1 Problems during the runs",
        "2 How voicecap tells causes apart",
      ]);
      expect(saysOf(blocks)).not.toContain("Every attempt that failed");
      expect(tablesIn(blocks)).toHaveLength(1);
    });

    it("says so when no run counts, with the same heading and the table of kinds", () => {
      const model = noRunModel();

      expect(wordsOf(wordProblems(model)).slice(0, 2)).toEqual([
        "Problems during the runs",
        "No problems to report: no live run counts yet.",
      ]);
      expect(outlineOf(wordProblems(model))).toEqual([
        "1 Problems during the runs",
        "2 How voicecap tells causes apart",
      ]);
    });
  });

  describe("what the page says", () => {
    /** The page's own words in one fold of a problem. */
    function pageSays(fold: string) {
      const summary = /<summary>(.*?)<\/summary>/s.exec(fold)?.[1] ?? "";
      const stack = /<pre class="logblock">(.*?)<\/pre>/s.exec(fold)?.[1];
      return {
        title: textOf(/<span class="what">(.*?)<\/span>/s.exec(summary)?.[1] ?? "", ""),
        time: textOf(/<span class="sub">(.*?)<\/span>/s.exec(summary)?.[1] ?? "", ""),
        chips: [...summary.matchAll(/<span class="chip c-\w+">(.*?)<\/span>/g)].map((chip) =>
          textOf(chip[1] ?? "", ""),
        ),
        questions: termsOf(fold),
        // A heading of a box: its words, and the problem it says (heard, not seen).
        boxes: [
          ...fold.matchAll(/<h3 class="logh">(.*?)<span class="sr">(.*?)<\/span><\/h3>/gs),
        ].map(([, words = "", where = ""]) => `${textOf(words, "")}, ${textOf(where, "")}`),
        record: rowsOf(tableOf(fold, "logtable")),
        // A stack's line breaks and spaces are its own, so only its entities are decoded.
        stack: stack === undefined ? null : decode(stack),
        notRecorded: [...fold.matchAll(/<p class="not-recorded">(.*?)<\/p>/gs)].map((found) =>
          textOf(found[1] ?? "", ""),
        ),
      };
    }

    it("says, problem by problem, every phrase of each problem's fold in that problem's own blocks", async () => {
      const models = [
        await demoModel(),
        failedModel([failedAttempt({ n: 1 }), failedAttempt({ n: 2, ...LATER })]),
        failedModel([UNEXPECTED]),
        wordingModel("read pass: nextLine did not finish within 30s", "headings pass: HTTP 500"),
        wordingModel("read pass: page.goto: Timeout 30000ms exceeded."),
      ];
      let seen = 0;

      for (const model of models) {
        const folds = foldsIn(renderProblems(model));
        const { problems, kinds } = problemParts(model);

        expect(problems).toHaveLength(folds.length - 1);
        for (const [index, part] of problems.entries()) {
          const says = pageSays(folds[index] ?? "");
          const words = wordsOf(part);
          const line = words[1] ?? "";

          expect(words[0]).toBe(says.title);
          // The page's time begins its chip's words in lower case; the line begins a sentence.
          expect(line.toLowerCase()).toContain(says.time.toLowerCase());
          for (const chip of says.chips) expect(line, chip).toContain(chip);
          for (const [question, answer] of says.questions) {
            expect(words, question).toContain(`${question} | ${answer}`);
          }
          expect(outlineOf(part).slice(1)).toEqual(says.boxes.map((box) => `3 ${box}`));
          for (const row of says.record) expect(words, row).toContain(row);
          if (says.stack !== null) {
            const block = part.find((each) => each.kind === "mono");
            expect(block?.kind === "mono" ? block.lines.join("\n") : "").toBe(says.stack);
          }
          for (const notRecorded of says.notRecorded)
            expect(words, notRecorded).toContain(notRecorded);
          seen += says.questions.length + says.record.length + says.notRecorded.length + 3;
        }
        // The table of kinds: its line, and each of its rows.
        const kindsFold = folds.at(-1) ?? "";
        const [first = "", second = ""] = wordsOf(kinds);
        expect(summariesIn(kindsFold)).toEqual([`${first} ${second}`]);
        for (const row of rowsOf(tableOf(kindsFold, "plain")))
          expect(wordsOf(kinds), row).toContain(row);
      }
      // Read at all, so a check of nothing can't pass.
      expect(seen).toBeGreaterThan(40);
    });

    it("says the section's verdict and what's in it as the page does, and nothing the page doesn't", async () => {
      for (const model of [await demoModel(), failedModel([UNEXPECTED]), noRunModel()]) {
        const html = renderProblems(model);
        const verdict = /<p class="prob-verdict">(.*?)<\/p>/s.exec(html)?.[1] ?? "";
        const gist = [...html.matchAll(/<p class="gist">(.*?)<\/p>/gs)].map((found) =>
          textOf(found[1] ?? "", ""),
        );
        const words = wordsOf(wordProblems(model));

        expect(words[1]).toBe(textOf(verdict, ""));
        expect(words.filter((line) => line === PROBLEMS_TEXT.gist)).toEqual(gist);
      }
    });
  });

  describe("what only the page has", () => {
    it("says nothing of a fold, since the Word copy folds nothing", async () => {
      for (const model of [await demoModel(), failedModel([UNEXPECTED]), noRunModel()]) {
        expect(saysOf(wordProblems(model))).not.toMatch(/opens|Open a|fold/i);
      }
    });

    it("sets its headings in order, and gives no table a heading with no words", async () => {
      const three = failedModel([
        failedAttempt({ n: 1 }),
        failedAttempt({ n: 2, ...LATER }),
        failedAttempt({ n: 3, ...LATER }),
      ]);

      for (const model of [await demoModel(), failedModel([UNEXPECTED]), three, noRunModel()]) {
        const blocks = wordProblems(model);
        const levels = blocks.flatMap((block) => (block.kind === "heading" ? [block.level] : []));

        expect(levels[0]).toBe(1);
        expect(levels.filter((level) => level === 1)).toHaveLength(1);
        for (const [index, level] of levels.entries()) {
          if (index > 0) expect(level - (levels[index - 1] ?? 0)).toBeLessThanOrEqual(1);
        }
        for (const { head, rows } of tablesIn(blocks)) {
          expect(head.every((words) => words.trim() !== "")).toBe(true);
          for (const row of rows) expect(row).toHaveLength(head.length);
        }
      }
    });
  });

  it("never calls voicecap automated, and never says a person listened", async () => {
    for (const model of [await demoModel(), failedModel([UNEXPECTED]), grantsModel()]) {
      const blocks = [...wordChanges(model), ...wordProblems(model)];

      for (const line of wordsOf(blocks.filter((block) => block.kind !== "mono"))) {
        expect(line).not.toMatch(/voicecap[^.]*\bautomated\b/i);
        expect(line).not.toMatch(/\blistened\b/i);
      }
    }
  });

  it("says the words the shared functions give, as the page does", () => {
    const model = failedModel([failedAttempt({ n: 1 })]);
    const [problem] = model.problems.problems;
    if (problem === undefined) throw new Error("The failed attempt is a problem.");
    const part = firstProblem(model);

    expect(wordsOf(part)[0]).toBe(problemTitle(problem));
    expect(wordsOf(part)[1]).toBe(
      `${sentence(problemTime(problem))} ${sentence(kindTitle(problem.kind))} ${sentence(PROBLEMS_TEXT.again[problem.again])}`,
    );
    expect(outlineOf(part)[1]).toBe(`3 ${PROBLEMS_TEXT.record.title}, ${whereOf(problem, 1)}`);
    expect(recordTime(problem.record[0]?.time ?? null)).toBe("14:05:00.000");
  });
});
