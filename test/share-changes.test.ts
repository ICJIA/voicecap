import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { PASS_NAMES, type FlagResult, type PassName, type RunJson } from "../src/model.js";
import { pageSlug } from "../src/pages/slug.js";
import { canonicalKey } from "../src/pages/url.js";
import { environmentDifferences } from "../src/report/compare.js";
import { pageName } from "../src/report/model.js";
import { changesOf, type Changes, type DiffLine } from "../src/share/changes.js";
import { extractBody } from "../src/transcripts/format.js";
import { SITE } from "./helpers/report-data.js";
import { shareRun, type ShareRunSpec, type SharePageSpec } from "./helpers/share-data.js";
import { DEMO_DAY, demoRun } from "./helpers/share-fixture.js";

/** The runs compared are made on these days: "26 September" and "27 September". */
const BEFORE = "2026-09-26T14:05:00-05:00";
const AFTER = "2026-09-27T09:30:00-05:00";

const keyOf = (path: string) => canonicalKey(new URL(path, SITE).href);
const slugOf = (path: string) => pageSlug(keyOf(path));
const pathOf = (page: { url: string }) => new URL(page.url).pathname;

/**
 * Runs built in memory from specs whose passes are body lines, and the `body` that finds those
 * lines for `changesOf`, as its caller finds them in the TXT files.
 */
function transcripts() {
  const lines = new Map<string, string[]>();
  const linesKey = (run: string, slug: string, pass: PassName) => `${run}|${slug}|${pass}`;
  return {
    run(spec: ShareRunSpec): RunJson {
      const run = shareRun(spec);
      run.pages.forEach((page, index) => {
        for (const pass of PASS_NAMES) {
          const body = spec.pages[index]?.passes?.[pass];
          if (body !== undefined) lines.set(linesKey(run.id, page.slug, pass), body);
        }
      });
      return run;
    },
    body: (run: string, slug: string, pass: PassName): string[] | null =>
      lines.get(linesKey(run, slug, pass)) ?? null,
  };
}

/** What changed from a run on 26 September to one on 27 September, each given as its pages. */
function compare(before: SharePageSpec[], after: SharePageSpec[]): Changes {
  const t = transcripts();
  return changesOf(
    t.run({ id: "r1", createdAt: BEFORE, pages: before }),
    t.run({ id: "r2", createdAt: AFTER, pages: after }),
    t.body,
    pageName,
  );
}

/** What changed in the read pass of a page, from its lines in the earlier run to those in the later. */
function readChange(before: string[], after: string[]) {
  const changes = compare(
    [{ path: "/", passes: { read: before } }],
    [{ path: "/", passes: { read: after } }],
  );
  const pass = changes.changed[0]?.passes[0];
  if (pass === undefined) throw new Error("The read pass didn't change");
  return pass;
}

/** Lines in a short form: "same Home", "removed Old", "added New", "collapsed 7". */
const shape = (lines: DiffLine[]) =>
  lines.map((line) =>
    line.kind === "collapsed" ? `collapsed ${line.count}` : `${line.kind} ${line.text}`,
  );

/** `count` lines named "<prefix> 1", "<prefix> 2", ... */
const numbered = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`);

describe("changesOf: the demo runs of 29 September 2026", () => {
  // voicecap 0.4.1 had no retries, so each run lost a page the other read: /the-report/ failed in
  // run 1315, and /how-a-run-works/ in run 1402. The five other pages were read in both.
  const demoBody = (run: string, slug: string, pass: PassName): string[] | null => {
    const file = `${DEMO_DAY}${run.slice("2026-09-29_".length)}/pages/${slug}/${pass}.txt`;
    return existsSync(file) ? extractBody(readFileSync(file, "utf8")) : null;
  };
  /** The two demo runs, what changed from the first to the second, and the reads of TXT files it took. */
  const demo = () => {
    const before = demoRun("1315");
    const after = demoRun("1402");
    const body = vi.fn(demoBody);
    return { before, after, body, changes: changesOf(before, after, body, pageName) };
  };

  it("says every page sounds the same for the demo runs of 29 September", () => {
    const { body, changes } = demo();

    expect(changes.changed).toEqual([]);
    expect(changes.same).toBe(5);
    expect(changes.onlyInOne.map((page) => [pathOf(page), page.reason])).toEqual([
      ["/how-a-run-works/", "failed in one run"],
      ["/the-report/", "failed in one run"],
    ]);
    expect(changes.line).toBe("Every page read in full in both runs sounds exactly the same.");
    expect(changes.summaryLine).toBe(
      "Since the last run on 29 September: every page read in full in both runs sounds the same.",
    );
    // Both runs read all three passes, so there is nothing to say about passes.
    expect(changes.passesNote).toBeNull();
    // The pages' fingerprints agree, so no transcript is opened to say so.
    expect(body).not.toHaveBeenCalled();
  });

  it("counts pages whose real transcripts are the same in both runs", () => {
    const { before, after } = demo();
    const readInBoth = after.pages.filter(
      (page) =>
        page.status === "done" &&
        before.pages.some((other) => other.key === page.key && other.status === "done"),
    );

    expect(readInBoth).toHaveLength(5);
    for (const page of readInBoth) {
      for (const pass of PASS_NAMES) {
        const then = demoBody(before.id, page.slug, pass);
        expect(then, `${page.slug} ${pass}, run 1315`).not.toBeNull();
        expect(demoBody(after.id, page.slug, pass), `${page.slug} ${pass}`).toEqual(then);
      }
    }
  });

  it("names the Chrome update between the demo runs", () => {
    const { before, after, changes } = demo();

    expect(changes.tools).toEqual(environmentDifferences(before, after));
    expect(changes.tools[0]).toContain("Chrome 153.0.8010.53 → Chrome 154.0.8037.58");
  });

  it("carries the two runs it compared", () => {
    const { before, after, changes } = demo();

    expect(changes.before).toBe(before);
    expect(changes.after).toBe(after);
  });
});

describe("changesOf: the lines of a pass", () => {
  it("marks removed and added lines in words, with the changed words", () => {
    const t = transcripts();
    const before = t.run({
      id: "r1",
      createdAt: BEFORE,
      pages: [{ path: "/", passes: { read: ["Home", "click here link", "Footer"] } }],
    });
    const after = t.run({
      id: "r2",
      createdAt: AFTER,
      pages: [{ path: "/", passes: { read: ["Home", "Read the report link", "Footer"] } }],
    });

    const { changed } = changesOf(before, after, t.body, pageName);

    expect(changed).toHaveLength(1);
    expect(changed[0]?.passes).toEqual([
      {
        pass: "read",
        removed: 1,
        added: 1,
        lines: [
          { kind: "same", text: "Home" },
          {
            kind: "removed",
            text: "click here link",
            words: [
              { text: "click here", changed: true },
              { text: " link", changed: false },
            ],
          },
          {
            kind: "added",
            text: "Read the report link",
            words: [
              { text: "Read the report", changed: true },
              { text: " link", changed: false },
            ],
          },
          { kind: "same", text: "Footer" },
        ],
      },
    ]);
  });

  it("marks a phrase as one change, and leaves the punctuation beside it alone", () => {
    // The approved mockup's own example of a fixed link.
    const pass = readChange(["click here, link"], ["Read the FY27 plan, link"]);

    expect(pass.lines).toEqual([
      {
        kind: "removed",
        text: "click here, link",
        words: [
          { text: "click here", changed: true },
          { text: ", link", changed: false },
        ],
      },
      {
        kind: "added",
        text: "Read the FY27 plan, link",
        words: [
          { text: "Read the FY27 plan", changed: true },
          { text: ", link", changed: false },
        ],
      },
    ]);
  });

  it("keeps the words before and after a change unmarked, with their spaces", () => {
    const pass = readChange(["Skip to main content, link"], ["Skip to the content, link"]);

    expect(pass.lines).toEqual([
      {
        kind: "removed",
        text: "Skip to main content, link",
        words: [
          { text: "Skip to ", changed: false },
          { text: "main", changed: true },
          { text: " content, link", changed: false },
        ],
      },
      {
        kind: "added",
        text: "Skip to the content, link",
        words: [
          { text: "Skip to ", changed: false },
          { text: "the", changed: true },
          { text: " content, link", changed: false },
        ],
      },
    ]);
  });

  it("keeps unchanged words between two changes unmarked", () => {
    const pass = readChange(["go to page one, link"], ["read page one, button"]);

    expect(pass.lines).toEqual([
      {
        kind: "removed",
        text: "go to page one, link",
        words: [
          { text: "go to", changed: true },
          { text: " page one, ", changed: false },
          { text: "link", changed: true },
        ],
      },
      {
        kind: "added",
        text: "read page one, button",
        words: [
          { text: "read", changed: true },
          { text: " page one, ", changed: false },
          { text: "button", changed: true },
        ],
      },
    ]);
  });

  it("marks a word that was added without the space before it", () => {
    const pass = readChange(["Home"], ["Home page"]);

    expect(pass.lines).toEqual([
      { kind: "removed", text: "Home", words: [{ text: "Home", changed: false }] },
      {
        kind: "added",
        text: "Home page",
        words: [
          { text: "Home ", changed: false },
          { text: "page", changed: true },
        ],
      },
    ]);
  });

  it("marks a change of spaces alone, since that is all there is to mark", () => {
    const pass = readChange(["a b"], ["a  b"]);

    expect(pass.lines).toEqual([
      {
        kind: "removed",
        text: "a b",
        words: [
          { text: "a", changed: false },
          { text: " ", changed: true },
          { text: "b", changed: false },
        ],
      },
      {
        kind: "added",
        text: "a  b",
        words: [
          { text: "a", changed: false },
          { text: "  ", changed: true },
          { text: "b", changed: false },
        ],
      },
    ]);
  });

  it("doesn't mark spaces that didn't change", () => {
    const pass = readChange(["   "], ["   foo"]);

    expect(pass.lines).toEqual([
      { kind: "removed", text: "   ", words: [{ text: "   ", changed: false }] },
      {
        kind: "added",
        text: "   foo",
        words: [
          { text: "   ", changed: false },
          { text: "foo", changed: true },
        ],
      },
    ]);
  });

  it("always gives words that add up to the line", () => {
    const pass = readChange(
      ["  main landmark. edit,  blank ", "Tab search, button, collapsed"],
      ["  main landmark. edit,  Search, edit ", "Tab search, button, expanded", "A new line"],
    );

    const marked = pass.lines.filter((line) => line.kind === "removed" || line.kind === "added");
    expect(marked).toHaveLength(5);
    for (const line of marked) {
      if (line.kind === "collapsed" || line.kind === "same") continue;
      expect(line.words.map((word) => word.text).join("")).toBe(line.text);
    }
  });

  it("marks a whole line when it has no partner", () => {
    const added = readChange(["Home", "Footer"], ["Home", "Skip link", "Footer"]);
    const removed = readChange(["Home", "Old banner", "Footer"], ["Home", "Footer"]);

    expect(added).toEqual({
      pass: "read",
      removed: 0,
      added: 1,
      lines: [
        { kind: "same", text: "Home" },
        { kind: "added", text: "Skip link", words: [{ text: "Skip link", changed: true }] },
        { kind: "same", text: "Footer" },
      ],
    });
    expect(removed).toEqual({
      pass: "read",
      removed: 1,
      added: 0,
      lines: [
        { kind: "same", text: "Home" },
        { kind: "removed", text: "Old banner", words: [{ text: "Old banner", changed: true }] },
        { kind: "same", text: "Footer" },
      ],
    });
  });

  it("pairs a removed block with an added block line by line, and leaves the rest unpaired", () => {
    const pass = readChange(
      ["top", "go to page one, link", "go to page two, link", "go to page three, link", "end"],
      ["top", "read page one, link", "read page two, link", "end"],
    );

    expect(shape(pass.lines)).toEqual([
      "same top",
      "removed go to page one, link",
      "added read page one, link",
      "removed go to page two, link",
      "added read page two, link",
      "removed go to page three, link",
      "same end",
    ]);
    expect([pass.removed, pass.added]).toEqual([3, 2]);
    // Each pair gets its own highlights, and a line with no partner is marked whole.
    const words = pass.lines.flatMap((line) =>
      line.kind === "removed" || line.kind === "added" ? [line.words] : [],
    );
    expect(words).toEqual([
      [
        { text: "go to", changed: true },
        { text: " page one, link", changed: false },
      ],
      [
        { text: "read", changed: true },
        { text: " page one, link", changed: false },
      ],
      [
        { text: "go to", changed: true },
        { text: " page two, link", changed: false },
      ],
      [
        { text: "read", changed: true },
        { text: " page two, link", changed: false },
      ],
      [{ text: "go to page three, link", changed: true }],
    ]);
  });

  it("pairs an added block that is longer than the removed one the same way", () => {
    const pass = readChange(["top", "one", "end"], ["top", "uno", "dos", "tres", "end"]);

    expect(shape(pass.lines)).toEqual([
      "same top",
      "removed one",
      "added uno",
      "added dos",
      "added tres",
      "same end",
    ]);
    expect([pass.removed, pass.added]).toEqual([1, 3]);
  });
});

describe("changesOf: runs of unchanged lines", () => {
  it("collapses long runs of unchanged lines to a count", () => {
    const before = numbered("line", 20);
    const after = before.map((line, index) => (index === 9 ? "line ten, changed" : line));

    const { lines } = readChange(before, after);

    expect(lines[0]).toEqual({ kind: "collapsed", count: 7 });
    expect(lines.at(-1)).toEqual({ kind: "collapsed", count: 8 });
    expect(shape(lines)).toEqual([
      "collapsed 7",
      "same line 8",
      "same line 9",
      "removed line 10",
      "added line ten, changed",
      "same line 11",
      "same line 12",
      "collapsed 8",
    ]);
  });

  it("keeps two lines of context on each side of every change, and collapses what lies between", () => {
    /** Two changes, with `between` unchanged lines between them. */
    const around = (between: number) => {
      const before = ["a", "x1", ...numbered("b", between), "x2", "c"];
      return readChange(
        before,
        before.map((line) => line.replace(/^x/, "y")),
      );
    };

    // Four lines between two changes are all context for one of them.
    expect(shape(around(4).lines)).toEqual([
      "same a",
      "removed x1",
      "added y1",
      "same b 1",
      "same b 2",
      "same b 3",
      "same b 4",
      "removed x2",
      "added y2",
      "same c",
    ]);
    // A fifth is left out, though it is only one.
    expect(shape(around(5).lines)).toEqual([
      "same a",
      "removed x1",
      "added y1",
      "same b 1",
      "same b 2",
      "collapsed 1",
      "same b 4",
      "same b 5",
      "removed x2",
      "added y2",
      "same c",
    ]);
  });

  it("collapses nothing within two lines of a change, at either edge of the pass", () => {
    expect(shape(readChange(["a", "b", "c"], ["a", "x", "c"]).lines)).toEqual([
      "same a",
      "removed b",
      "added x",
      "same c",
    ]);
    expect(shape(readChange(["a", "b", "c"], ["z", "b", "c"]).lines)).toEqual([
      "removed a",
      "added z",
      "same b",
      "same c",
    ]);
    expect(shape(readChange(["a", "b", "c"], ["a", "b", "z"]).lines)).toEqual([
      "same a",
      "same b",
      "removed c",
      "added z",
    ]);
  });

  it("collapses the lines beyond the context at an edge, down to one", () => {
    expect(shape(readChange(["a", "b", "c", "d"], ["a", "b", "c", "e"]).lines)).toEqual([
      "collapsed 1",
      "same b",
      "same c",
      "removed d",
      "added e",
    ]);
    expect(shape(readChange(["a", "b", "c", "d"], ["z", "b", "c", "d"]).lines)).toEqual([
      "removed a",
      "added z",
      "same b",
      "same c",
      "collapsed 1",
    ]);
  });
});

describe("changesOf: which pages changed", () => {
  it("counts pages that sound the same, and doesn't read their transcripts", () => {
    const t = transcripts();
    const pages: SharePageSpec[] = [
      { path: "/", passes: { read: ["Home"], headings: ["Home, heading"], tab: ["Skip, link"] } },
      { path: "/about", passes: { read: ["About"] } },
    ];
    const before = t.run({ id: "r1", createdAt: BEFORE, pages });
    const after = t.run({ id: "r2", createdAt: AFTER, pages });
    const body = vi.fn(t.body);

    const changes = changesOf(before, after, body, pageName);

    expect(changes.same).toBe(2);
    expect(changes.changed).toEqual([]);
    // Equal fingerprints say the lines are the same, so a caller needn't read a file for them.
    expect(body).not.toHaveBeenCalled();
  });

  it("compares each pass, and counts the lines that changed in each", () => {
    const changes = compare(
      [
        {
          path: "/",
          label: "Home",
          passes: { read: ["r1", "r2", "r3"], headings: ["h1"], tab: ["t1", "t2"] },
        },
      ],
      [
        {
          path: "/",
          label: "Home",
          passes: { read: ["r1", "R2", "r3", "r4"], headings: ["h1"], tab: ["t1"] },
        },
      ],
    );

    expect(changes.same).toBe(0);
    expect(changes.changed).toHaveLength(1);
    const page = changes.changed[0];
    expect(page).toMatchObject({ label: "Home", url: "https://example.illinois.gov/" });
    // The headings pass sounds the same, so it isn't listed; the others are, in pass order.
    expect(page?.passes.map((pass) => [pass.pass, pass.removed, pass.added])).toEqual([
      ["read", 1, 2],
      ["tab", 1, 0],
    ]);
    expect(page?.unreadable).toEqual([]);
  });

  it("gives a changed page the key, slug, and url of its record, and a label only when it has one", () => {
    const changes = compare(
      [
        { path: "/a/", label: "Page A", passes: { read: ["one"] } },
        { path: "/b/", passes: { read: ["one"] } },
      ],
      [
        { path: "/a/", label: "Page A", passes: { read: ["two"] } },
        { path: "/b/", passes: { read: ["two"] } },
      ],
    );

    expect(
      changes.changed.map(
        ({ passes: _passes, unreadable: _unreadable, flags: _flags, ...page }) => page,
      ),
    ).toStrictEqual([
      {
        key: keyOf("/a/"),
        slug: slugOf("/a/"),
        url: "https://example.illinois.gov/a/",
        label: "Page A",
      },
      { key: keyOf("/b/"), slug: slugOf("/b/"), url: "https://example.illinois.gov/b/" },
    ]);
  });

  it("lists pages read in only one run, with the reason", () => {
    const changes = compare(
      [
        { path: "/", passes: { read: ["Home"] } },
        { path: "/gone", label: "Old page", passes: { read: ["Gone"] } },
        { path: "/failed-before", status: "failed" },
        { path: "/failed-now", passes: { read: ["Now"] } },
        { path: "/skipped-before", status: "skipped" },
        { path: "/skipped-now", passes: { read: ["Skipped"] } },
        { path: "/neither", status: "failed" },
        { path: "/dropped-failure", status: "failed" },
      ],
      [
        { path: "/", passes: { read: ["Home"] } },
        { path: "/new", label: "New page", passes: { read: ["New"] } },
        { path: "/failed-before", passes: { read: ["Before"] } },
        { path: "/failed-now", status: "failed" },
        { path: "/skipped-before", passes: { read: ["Was skipped"] } },
        { path: "/skipped-now", status: "skipped" },
        { path: "/neither", status: "failed" },
        { path: "/new-failure", status: "failed" },
      ],
    );

    // In the later run's order, then the pages only the earlier run listed. The reason of a page
    // the other run didn't read is what that run recorded: it failed, or voicecap skipped it. A page
    // read in neither run isn't here: it wasn't read in only one.
    expect(changes.onlyInOne.map((page) => [pathOf(page), page.reason])).toEqual([
      ["/new", "new"],
      ["/failed-before", "failed in one run"],
      ["/failed-now", "failed in one run"],
      ["/skipped-before", "skipped in one run"],
      ["/skipped-now", "skipped in one run"],
      ["/gone", "no longer listed"],
    ]);
    expect(changes.same).toBe(1);
    expect(changes.changed).toEqual([]);
  });

  it("doesn't list a page the other run never reached, which a completed run has none of", () => {
    const changes = compare(
      [
        { path: "/", passes: { read: ["Home"] } },
        { path: "/pending-now", passes: { read: ["Now"] } },
        { path: "/pending-before", status: "pending" },
      ],
      [
        { path: "/", passes: { read: ["Home"] } },
        { path: "/pending-now", status: "pending" },
        { path: "/pending-before", passes: { read: ["Before"] } },
      ],
    );

    expect([changes.onlyInOne, changes.same, changes.changed]).toEqual([[], 1, []]);
  });

  it("gives a page read in only one run its key, url, and label, and no label it doesn't have", () => {
    const changes = compare(
      [{ path: "/gone", label: "Old page", passes: { read: ["Gone"] } }],
      [
        { path: "/new", label: "New page", passes: { read: ["New"] } },
        { path: "/plain", passes: { read: ["Plain"] } },
      ],
    );

    expect(changes.onlyInOne).toStrictEqual([
      {
        key: keyOf("/new"),
        url: "https://example.illinois.gov/new",
        label: "New page",
        reason: "new",
      },
      { key: keyOf("/plain"), url: "https://example.illinois.gov/plain", reason: "new" },
      {
        key: keyOf("/gone"),
        url: "https://example.illinois.gov/gone",
        label: "Old page",
        reason: "no longer listed",
      },
    ]);
  });

  it("asks for each run's lines by the slug that run recorded for the page", () => {
    const t = transcripts();
    const pages: SharePageSpec[] = [{ path: "/", passes: { read: ["a"] } }];
    const before = t.run({ id: "r1", createdAt: BEFORE, pages });
    const after = t.run({
      id: "r2",
      createdAt: AFTER,
      pages: [{ path: "/", passes: { read: ["b"] } }],
    });
    // An older voicecap named the page's folder differently.
    const renamed: RunJson = {
      ...before,
      pages: before.pages.map((page) => ({ ...page, slug: "older-name" })),
    };
    const body = vi.fn(t.body);

    const { changed } = changesOf(renamed, after, body, pageName);

    expect(body).toHaveBeenCalledTimes(2);
    expect(body).toHaveBeenCalledWith("r1", "older-name", "read");
    expect(body).toHaveBeenCalledWith("r2", slugOf("/"), "read");
    // The page is known by the later run's slug, as the page being shown is.
    expect(changed.map((page) => page.slug)).toEqual([slugOf("/")]);
  });

  it("doesn't change the runs it compares", () => {
    const t = transcripts();
    const before = t.run({
      id: "r1",
      createdAt: BEFORE,
      pages: [
        {
          path: "/",
          flags: [{ rule: "unlabeled", pass: "read", message: "m" }],
          passes: { read: ["a", "b"] },
        },
      ],
    });
    const after = t.run({
      id: "r2",
      createdAt: AFTER,
      pages: [{ path: "/", passes: { read: ["a", "c"] } }],
    });
    const snapshot = structuredClone([before, after]);

    changesOf(before, after, t.body, pageName);

    expect([before, after]).toEqual(snapshot);
  });
});

describe("changesOf: runs that read different passes", () => {
  /** Lines for each of `passes` on one page. */
  const lines = (passes: PassName[]) =>
    Object.fromEntries(passes.map((pass) => [pass, [`${pass} line`]]));

  /** A flag of `rule`, in `pass` (or on the page as a whole, with no pass). */
  const flag = (rule: string, pass?: PassName): FlagResult => ({
    rule,
    ...(pass === undefined ? {} : { pass }),
    message: `A ${rule} flag.`,
  });

  /** A run that read all three passes, then one that read only the read pass, each as its pages. */
  const allThenRead = (before: SharePageSpec[], after: SharePageSpec[]) => {
    const t = transcripts();
    return changesOf(
      t.run({ id: "r1", createdAt: BEFORE, passes: [...PASS_NAMES], pages: before }),
      t.run({ id: "r2", createdAt: AFTER, passes: ["read"], pages: after }),
      t.body,
      pageName,
    );
  };

  it.each([
    { before: ["read", "headings", "tab"], after: ["read"] },
    { before: ["read"], after: ["read", "headings", "tab"] },
  ] satisfies { before: PassName[]; after: PassName[] }[])(
    "compares only the read pass when one run read $before and the next $after",
    ({ before, after }) => {
      /** Three pages read in `passes`, whose lines in the other passes only that run has. */
      const pages = (passes: PassName[], readDiffers: string): SharePageSpec[] => {
        const others = lines(passes.filter((pass) => pass !== "read"));
        return [
          { path: "/same", passes: { ...others, read: ["a"] } },
          { path: "/others-differ", passes: { ...others, read: ["b"] } },
          { path: "/read-differs", passes: { ...others, read: [readDiffers] } },
        ];
      };
      const t = transcripts();
      const earlier = t.run({
        id: "r1",
        createdAt: BEFORE,
        passes: before,
        pages: pages(before, "c1"),
      });
      const later = t.run({
        id: "r2",
        createdAt: AFTER,
        passes: after,
        pages: pages(after, "c2"),
      });
      const body = vi.fn(t.body);

      const changes = changesOf(earlier, later, body, pageName);

      expect(changes.passesNote).toContain("only the read pass is compared.");
      // The headings and tab passes of the pages aren't compared, so they aren't called different.
      expect(changes.same).toBe(2);
      expect(changes.changed.map(pathOf)).toEqual(["/read-differs"]);
      expect(changes.changed[0]?.passes.map((pass) => pass.pass)).toEqual(["read"]);
      expect(body.mock.calls.map(([, , pass]) => pass)).toEqual(["read", "read"]);
      expect(changes.line).toBe(
        "Compared with the run on 26 September: 1 of 3 pages sounds different, and 2 sound exactly the same.",
      );
    },
  );

  it.each([
    {
      before: ["read", "headings", "tab"],
      after: ["read"],
      note: "The run before read the read, headings, and Tab passes, and this one only the read pass; only the read pass is compared.",
    },
    {
      before: ["read"],
      after: ["read", "headings", "tab"],
      note: "The run before read only the read pass, and this one the read, headings, and Tab passes; only the read pass is compared.",
    },
    {
      before: ["read", "headings"],
      after: ["read", "tab"],
      note: "The run before read the read and headings passes, and this one the read and Tab passes; only the read pass is compared.",
    },
    {
      before: ["read", "headings", "tab"],
      after: ["headings", "tab"],
      note: "The run before read the read, headings, and Tab passes, and this one the headings and Tab passes; only the headings and Tab passes are compared.",
    },
  ] satisfies { before: PassName[]; after: PassName[]; note: string }[])(
    "says which passes are compared when one run read $before and the next $after",
    ({ before, after, note }) => {
      const t = transcripts();
      const earlier = t.run({
        id: "r1",
        createdAt: BEFORE,
        passes: before,
        pages: [{ path: "/", passes: lines(before) }],
      });
      const later = t.run({
        id: "r2",
        createdAt: AFTER,
        passes: after,
        pages: [{ path: "/", passes: lines(after) }],
      });

      expect(changesOf(earlier, later, t.body, pageName).passesNote).toBe(note);
    },
  );

  it("has no note when both runs read the same passes, in whatever order they list them", () => {
    const t = transcripts();
    const pages: SharePageSpec[] = [{ path: "/", passes: lines(["read", "tab"]) }];
    const earlier = t.run({ id: "r1", createdAt: BEFORE, passes: ["tab", "read"], pages });
    const later = t.run({ id: "r2", createdAt: AFTER, passes: ["read", "tab"], pages });

    const changes = changesOf(earlier, later, t.body, pageName);

    expect(changes.passesNote).toBeNull();
    // Nothing to qualify: the summary says what it always says.
    expect(changes.summaryLine).toBe(
      "Since the last run on 26 September: every page read in full in both runs sounds the same.",
    );
  });

  it("says nothing could be compared when the runs have no pass in common", () => {
    const t = transcripts();
    const earlier = t.run({
      id: "r1",
      createdAt: BEFORE,
      passes: ["read"],
      pages: [{ path: "/", passes: lines(["read"]) }],
    });
    const later = t.run({
      id: "r2",
      createdAt: AFTER,
      passes: ["tab"],
      pages: [
        { path: "/", passes: lines(["tab"]) },
        { path: "/new", passes: lines(["tab"]) },
      ],
    });
    const body = vi.fn(t.body);

    const changes = changesOf(earlier, later, body, pageName);

    // Neither the same nor different: nothing about the page was compared.
    expect([changes.changed, changes.same]).toEqual([[], 0]);
    expect(changes.onlyInOne.map((page) => [pathOf(page), page.reason])).toEqual([["/new", "new"]]);
    expect(changes.passesNote).toBe(
      "The run before read only the read pass, and this one only the Tab pass; no pass is compared.",
    );
    expect(changes.line).toBe("No pass was read in both runs, so no page could be compared.");
    expect(changes.summaryLine).toBe(
      "Since the last run on 26 September: no pass was read in both runs, so no page could be compared.",
    );
    expect(body).not.toHaveBeenCalled();
  });

  it("says in the summary that it speaks for the passes both runs read", () => {
    const same = allThenRead(
      [{ path: "/", passes: { read: ["a"], tab: ["t"] } }],
      [{ path: "/", passes: { read: ["a"] } }],
    );
    const flagged = allThenRead(
      [
        { path: "/a", label: "Contact", passes: { read: ["a1"] } },
        { path: "/b", label: "Reports", passes: { read: ["b1"] } },
        {
          path: "/c",
          label: "Common mistakes",
          flags: [flag("generic-link-text", "read")],
          passes: { read: ["click here, link"] },
        },
      ],
      [
        { path: "/a", label: "Contact", passes: { read: ["a2"] } },
        { path: "/b", label: "Reports", passes: { read: ["b2"] } },
        { path: "/c", label: "Common mistakes", passes: { read: ["Read the plan, link"] } },
      ],
    );
    const plain = allThenRead(
      [
        { path: "/a", passes: { read: ["a1"] } },
        { path: "/b", passes: { read: ["b"] } },
      ],
      [
        { path: "/a", passes: { read: ["a2"] } },
        { path: "/b", passes: { read: ["b"] } },
      ],
    );

    expect(same.summaryLine).toBe(
      "Since the last run on 26 September: in the passes both runs read, every page read in full in both runs sounds the same.",
    );
    expect(flagged.summaryLine).toBe(
      "Since the last run on 26 September: in the passes both runs read, 3 pages sound different; resolved: the links that don't say where they go, on Common mistakes.",
    );
    expect(plain.summaryLine).toBe(
      "Since the last run on 26 September: in the passes both runs read, 1 page sounds different.",
    );
    // The section's line stands under the note, which says which passes, so it isn't qualified.
    expect(same.line).toBe("Every page read in full in both runs sounds exactly the same.");
    expect(flagged.line).toBe(
      "Compared with the run on 26 September: 3 of 3 pages sound different, and 0 sound exactly the same. Resolved: on Common mistakes, the links that don't say where they go (generic-link-text).",
    );
  });

  it("groups the resolved flags in that summary too, after its semicolon", () => {
    const changes = allThenRead(
      [
        {
          path: "/a",
          label: "Contact",
          flags: [flag("unlabeled", "read")],
          passes: { read: ["a1"] },
        },
        {
          path: "/b",
          label: "Reports",
          flags: [flag("unlabeled", "read"), flag("generic-link-text", "read")],
          passes: { read: ["b1"] },
        },
        {
          path: "/c",
          label: "Home",
          flags: [flag("unlabeled", "read")],
          passes: { read: ["c1"] },
        },
      ],
      [
        { path: "/a", label: "Contact", passes: { read: ["a2"] } },
        { path: "/b", label: "Reports", passes: { read: ["b2"] } },
        { path: "/c", label: "Home", passes: { read: ["c2"] } },
      ],
    );

    expect(changes.summaryLine).toBe(
      "Since the last run on 26 September: in the passes both runs read, 3 pages sound different; resolved: the unnamed items, on all 3 of them; the links that don't say where they go, on Reports.",
    );
    // The section's line names each page, as it does when the runs read the same passes.
    expect(changes.line).toBe(
      "Compared with the run on 26 September: 3 of 3 pages sound different, and 0 sound exactly the same. Resolved: on Contact, the unnamed items (unlabeled); on Reports, the unnamed items (unlabeled); on Reports, the links that don't say where they go (generic-link-text); on Home, the unnamed items (unlabeled).",
    );
  });

  it("doesn't compare the flags of a pass only the earlier run read", () => {
    const changes = allThenRead(
      [
        {
          path: "/",
          label: "Home",
          flags: [
            flag("generic-link-text", "read"),
            flag("generic-link-text", "tab"),
            flag("tab-no-stops", "tab"),
            flag("headings", "headings"),
            flag("unlabeled", "read"),
            flag("brand-name"),
          ],
          passes: { read: ["a"], headings: ["h"], tab: ["t"] },
        },
      ],
      [
        {
          path: "/",
          label: "Home",
          flags: [flag("unlabeled", "read"), flag("repeated-phrase", "read")],
          passes: { read: ["b"] },
        },
      ],
    );

    // The later run didn't read the tab or headings passes, so their flags aren't gone: nothing
    // looked for them. A flag with no pass belongs to the page, and is compared.
    expect(changes.changed[0]?.flags).toEqual({
      resolved: [flag("generic-link-text", "read"), flag("brand-name")],
      added: [flag("repeated-phrase", "read")],
      unchanged: [flag("unlabeled", "read")],
      changed: [],
      uncompared: [],
    });
    expect(changes.line).toContain(
      "Resolved: on Home, the links that don't say where they go (generic-link-text); on Home, brand-name.",
    );
    expect(changes.line).not.toContain("Tab stops");
    expect(changes.line).not.toContain("heading structure");
  });

  it("doesn't call the flags of a pass only the later run read new", () => {
    const t = transcripts();
    const earlier = t.run({
      id: "r1",
      createdAt: BEFORE,
      passes: ["read"],
      pages: [{ path: "/", label: "Home", passes: { read: ["a"] } }],
    });
    const later = t.run({
      id: "r2",
      createdAt: AFTER,
      passes: [...PASS_NAMES],
      pages: [
        {
          path: "/",
          label: "Home",
          flags: [flag("tab-no-stops", "tab"), flag("unlabeled", "read")],
          passes: { read: ["b"], tab: ["t"] },
        },
      ],
    });

    const changes = changesOf(earlier, later, t.body, pageName);

    // The later run's flag in the Tab pass is kept apart: the earlier run didn't look for it.
    expect(changes.changed[0]?.flags).toEqual({
      resolved: [],
      added: [flag("unlabeled", "read")],
      unchanged: [],
      changed: [],
      uncompared: [flag("tab-no-stops", "tab")],
    });
  });

  it("doesn't call a rule resolved while a pass only the later run read still raises it", () => {
    const t = transcripts();
    const earlier = t.run({
      id: "r1",
      createdAt: BEFORE,
      passes: ["read"],
      pages: [
        {
          path: "/",
          label: "Home",
          flags: [flag("generic-link-text", "read")],
          passes: { read: ["a"] },
        },
      ],
    });
    const later = t.run({
      id: "r2",
      createdAt: AFTER,
      passes: [...PASS_NAMES],
      pages: [
        {
          path: "/",
          label: "Home",
          flags: [flag("generic-link-text", "tab")],
          passes: { read: ["b"], tab: ["t"] },
        },
      ],
    });

    const changes = changesOf(earlier, later, t.body, pageName);

    // Gone from the read pass, which both runs read; but the page still has the links, in the Tab
    // pass, so no sentence calls the rule resolved.
    expect(changes.changed[0]?.flags.resolved).toEqual([flag("generic-link-text", "read")]);
    expect(changes.changed[0]?.flags.uncompared).toEqual([flag("generic-link-text", "tab")]);
    expect(changes.line).not.toContain("Resolved");
    expect(changes.summaryLine).not.toContain("resolved");
  });
});

describe("changesOf: transcripts that can't be read", () => {
  it("names a differing pass whose lines can't be read, and leaves it out of the passes", () => {
    const t = transcripts();
    const before = t.run({
      id: "r1",
      createdAt: BEFORE,
      pages: [
        { path: "/a", passes: { read: ["a1"], headings: ["h1"] } },
        { path: "/b", passes: { read: ["b1"] } },
        { path: "/c", passes: { read: ["c1"] } },
        { path: "/d", passes: { read: ["d1"], headings: ["h1"], tab: ["t"] } },
      ],
    });
    const after = t.run({
      id: "r2",
      createdAt: AFTER,
      pages: [
        { path: "/a", passes: { read: ["a2"], headings: ["h2"] } },
        { path: "/b", passes: { read: ["b2"] } },
        { path: "/c", passes: { read: ["c2"] } },
        { path: "/d", passes: { read: ["d2"], headings: ["h2"], tab: ["t"] } },
      ],
    });
    // The earlier run's transcript of /a's read pass, the later run's of /b's, and both runs' of
    // /d's read and headings passes can't be found.
    const body = (run: string, slug: string, pass: PassName) => {
      const lost =
        (slug === slugOf("/a") && run === "r1" && pass === "read") ||
        (slug === slugOf("/b") && run === "r2" && pass === "read") ||
        (slug === slugOf("/d") && pass !== "tab");
      return lost ? null : t.body(run, slug, pass);
    };

    const changes = changesOf(before, after, body, pageName);

    // None is taken as a pass with no lines, which would show every line of the other run as new
    // or gone.
    expect(
      changes.changed.map((page) => [
        pathOf(page),
        page.passes.map((pass) => pass.pass),
        page.unreadable,
      ]),
    ).toEqual([
      ["/a", ["headings"], ["read"]],
      ["/b", [], ["read"]],
      ["/c", ["read"], []],
      ["/d", [], ["read", "headings"]],
    ]);
    // The fingerprints say they sound different, whether or not the lines can be shown.
    expect(changes.same).toBe(0);
    expect(changes.line).toBe(
      "Compared with the run on 26 September: 4 of 4 pages sound different, and 0 sound exactly the same.",
    );
  });
});

describe("changesOf: flags", () => {
  const generic = (pass: PassName, count: number): FlagResult => ({
    rule: "generic-link-text",
    pass,
    count,
    message: `Generic link text announced ${count} times in the ${pass} pass: "click here" ×${count}.`,
  });
  const unlabeled = (count: number): FlagResult => ({
    rule: "unlabeled",
    pass: "read",
    count,
    message: `Unlabeled or poorly labeled items in the read pass: "edit" ×${count}.`,
  });
  const headings: FlagResult = {
    rule: "headings",
    pass: "headings",
    message: "The first heading is level 2, not level 1.",
  };
  const repeated: FlagResult = {
    rule: "repeated-phrase",
    pass: "tab",
    count: 3,
    message: `"click here, link" repeated 3 times in a row in the tab pass (possible focus trap or duplicated content).`,
  };

  it("names flags resolved and new", () => {
    const changes = compare(
      [
        {
          path: "/",
          flags: [generic("read", 3), generic("tab", 3), unlabeled(2), headings],
          passes: { read: ["click here, link"] },
        },
      ],
      [
        {
          path: "/",
          flags: [unlabeled(1), headings, repeated],
          passes: { read: ["Read the plan, link"] },
        },
      ],
    );

    // Resolved flags are as the earlier run had them; new and unchanged ones, as the later run does.
    // A flag both runs raised, but with another count, changed: it's never "unchanged".
    expect(changes.changed[0]?.flags).toEqual({
      resolved: [generic("read", 3), generic("tab", 3)],
      added: [repeated],
      unchanged: [headings],
      changed: [{ before: unlabeled(2), after: unlabeled(1) }],
      uncompared: [],
    });
  });

  it("calls a flag with no count changed when what it found changed", () => {
    const level3: FlagResult = {
      ...headings,
      message: "The first heading is level 3, not level 1.",
    };
    const changes = compare(
      [{ path: "/", flags: [headings, unlabeled(2)], passes: { read: ["a"] } }],
      [{ path: "/", flags: [level3, unlabeled(2)], passes: { read: ["b"] } }],
    );

    expect(changes.changed[0]?.flags).toMatchObject({
      unchanged: [unlabeled(2)],
      changed: [{ before: headings, after: level3 }],
    });
  });

  it("compares flags by rule and pass, so a rule moving to another pass is one resolved and one new", () => {
    const inTab: FlagResult = { ...unlabeled(2), pass: "tab" };
    const changes = compare(
      [{ path: "/", flags: [unlabeled(2)], passes: { read: ["a"] } }],
      [{ path: "/", flags: [inTab], passes: { read: ["b"] } }],
    );

    expect(changes.changed[0]?.flags).toEqual({
      resolved: [unlabeled(2)],
      added: [inTab],
      unchanged: [],
      changed: [],
      uncompared: [],
    });
    // The rule is still on the page, so no sentence calls it resolved.
    expect(changes.line).not.toContain("Resolved");
  });

  it("compares a flag that has no pass by its rule alone", () => {
    const own = (message: string): FlagResult => ({ rule: "brand-name", message });
    const changes = compare(
      [{ path: "/", flags: [own("said 2 times"), headings], passes: { read: ["a"] } }],
      [{ path: "/", flags: [own("said 3 times")], passes: { read: ["b"] } }],
    );

    // What it found changed, and it has no count to say so: its message does.
    expect(changes.changed[0]?.flags).toEqual({
      resolved: [headings],
      added: [],
      unchanged: [],
      changed: [{ before: own("said 2 times"), after: own("said 3 times") }],
      uncompared: [],
    });
  });

  it("has no flags to name for a page with none", () => {
    const changes = compare(
      [{ path: "/", passes: { read: ["a"] } }],
      [{ path: "/", passes: { read: ["b"] } }],
    );

    expect(changes.changed[0]?.flags).toEqual({
      resolved: [],
      added: [],
      unchanged: [],
      changed: [],
      uncompared: [],
    });
  });
});

describe("changesOf: the tools", () => {
  const pages: SharePageSpec[] = [{ path: "/", passes: { read: ["a"] } }];

  it("names the tools that changed between the runs", () => {
    const t = transcripts();
    const before = t.run({ id: "r1", createdAt: BEFORE, voicecapVersion: "0.5.0", pages });
    const after = t.run({ id: "r2", createdAt: AFTER, voicecapVersion: "0.6.0", pages });

    const changes = changesOf(before, after, t.body, pageName);

    expect(changes.tools).toEqual(environmentDifferences(before, after));
    expect(changes.tools).toEqual(["voicecap differs: 0.5.0 → 0.6.0 (run r1 → run r2)."]);
  });

  it("names none when the runs used the same tools", () => {
    expect(compare(pages, pages).tools).toEqual([]);
  });
});

describe("changesOf: the lines that open the section and the summary", () => {
  const labels: Record<string, string> = { "/a": "Contact", "/c": "Common mistakes" };
  /**
   * Seven pages, each read once: /a, /b, and /c say what `spoken` gives them, and the other four
   * say the same in every run. `extra` is added to /c.
   */
  const sevenPages = (spoken: Record<string, string>, extra: Partial<SharePageSpec> = {}) =>
    ["/a", "/b", "/c", "/d", "/e", "/f", "/g"].map((path): SharePageSpec => ({
      path,
      ...(labels[path] === undefined ? {} : { label: labels[path] }),
      passes: { read: ["Intro", spoken[path] ?? "Same"] },
      ...(path === "/c" ? extra : {}),
    }));
  const generic: FlagResult = {
    rule: "generic-link-text",
    pass: "read",
    count: 3,
    message: "Generic link text announced 3 times in the read pass.",
  };
  const genericTab: FlagResult = { ...generic, pass: "tab" };
  const unnamed: FlagResult = {
    rule: "unlabeled",
    pass: "read",
    count: 1,
    message: "Unlabeled items in the read pass.",
  };
  const outline: FlagResult = {
    rule: "headings",
    pass: "headings",
    message: "The first heading is level 2, not level 1.",
  };
  /**
   * What changed when each page, given by its label and the flags it had in the earlier run, sounds
   * different in the later run and has no flags in it: each flag is resolved, on every changed page
   * that had it. `same` pages that sound the same in both runs are read too.
   */
  const resolving = (pages: [label: string, flags: FlagResult[]][], same = 0) => {
    const unchanged = (): SharePageSpec[] =>
      Array.from({ length: same }, (_, at) => ({
        path: `/same-${at + 1}`,
        passes: { read: ["The same"] },
      }));
    return compare(
      [
        ...pages.map(([label, flags], at) => ({
          path: `/p${at + 1}`,
          label,
          flags,
          passes: { read: [`Before ${at + 1}`] },
        })),
        ...unchanged(),
      ],
      [
        ...pages.map(([label], at) => ({
          path: `/p${at + 1}`,
          label,
          passes: { read: [`After ${at + 1}`] },
        })),
        ...unchanged(),
      ],
    );
  };

  it("says how many pages sound different, and which flags were resolved", () => {
    const changes = compare(
      sevenPages(
        { "/a": "Before", "/b": "Before", "/c": "click here, link" },
        { flags: [generic, genericTab] },
      ),
      sevenPages({ "/a": "After", "/b": "After", "/c": "Read the plan, link" }),
    );

    expect(changes.same).toBe(4);
    expect(changes.changed.map(pathOf)).toEqual(["/a", "/b", "/c"]);
    expect(changes.line).toBe(
      "Compared with the run on 26 September: 3 of 7 pages sound different, and 4 sound exactly the same. Resolved: on Common mistakes, the links that don't say where they go (generic-link-text).",
    );
    expect(changes.summaryLine).toBe(
      "Since the last run on 26 September: 3 pages sound different, and this flag is resolved: the links that don't say where they go, on Common mistakes.",
    );
  });

  it("names every resolved flag with the page it was on, in page order, one after another", () => {
    const changes = compare(
      [
        { path: "/a", label: "Contact", flags: [unnamed], passes: { read: ["a1"] } },
        {
          path: "/b",
          label: "Common mistakes",
          flags: [generic, genericTab],
          passes: { read: ["b1"] },
        },
        { path: "/c", label: "Home", flags: [outline], passes: { read: ["c1"] } },
      ],
      [
        { path: "/a", label: "Contact", passes: { read: ["a2"] } },
        { path: "/b", label: "Common mistakes", passes: { read: ["b2"] } },
        { path: "/c", label: "Home", passes: { read: ["c2"] } },
      ],
    );

    // People hear these read aloud, so the section's line says where first, and the items are set
    // apart by semicolons, since a plain name can have a comma of its own. The summary says what
    // was resolved first, and groups it (below): here each flag was on a page of its own.
    expect(changes.line).toBe(
      "Compared with the run on 26 September: 3 of 3 pages sound different, and 0 sound exactly the same. Resolved: on Contact, the unnamed items (unlabeled); on Common mistakes, the links that don't say where they go (generic-link-text); on Home, the heading structure (headings).",
    );
    expect(changes.summaryLine).toBe(
      "Since the last run on 26 September: 3 pages sound different, and these flags are resolved: the unnamed items, on Contact; the links that don't say where they go, on Common mistakes; the heading structure, on Home.",
    );
  });

  it('joins two resolved flags with a semicolon too, and no "and"', () => {
    const changes = compare(
      [
        { path: "/a", label: "Contact", flags: [unnamed], passes: { read: ["a1"] } },
        { path: "/b", label: "Home", flags: [outline], passes: { read: ["b1"] } },
      ],
      [
        { path: "/a", label: "Contact", passes: { read: ["a2"] } },
        { path: "/b", label: "Home", passes: { read: ["b2"] } },
      ],
    );

    expect(changes.line).toContain(
      "Resolved: on Contact, the unnamed items (unlabeled); on Home, the heading structure (headings).",
    );
  });

  it("says a flag resolved on every changed page once, with how many pages that is: the i2i shape, one problem on 32 pages", () => {
    const pages = Array.from({ length: 32 }, (_, at): [string, FlagResult[]] => [
      `Page ${at + 1}`,
      [unnamed],
    ]);

    const changes = resolving(pages);

    expect(changes.changed).toHaveLength(32);
    expect(changes.summaryLine).toBe(
      "Since the last run on 26 September: 32 pages sound different, and this flag is resolved: the unnamed items, on all 32 of them.",
    );
    // The section's line is as it was: each page, with its rule.
    expect(changes.line).toBe(
      "Compared with the run on 26 September: 32 of 32 pages sound different, and 0 sound exactly the same. Resolved: " +
        `${pages.map(([label]) => `on ${label}, the unnamed items (unlabeled)`).join("; ")}.`,
    );
  });

  it("says all of them only when a flag was resolved on every changed page, however many pages sound the same", () => {
    // 7 pages were read in both runs, and 2 sound different: the flag was on both of those.
    const changes = resolving(
      [
        ["Contact", [unnamed]],
        ["Reports", [unnamed]],
      ],
      5,
    );

    expect([changes.changed.length, changes.same]).toEqual([2, 5]);
    expect(changes.summaryLine).toBe(
      "Since the last run on 26 September: 2 pages sound different, and this flag is resolved: the unnamed items, on all 2 of them.",
    );
  });

  it("says how many of the changed pages a flag was resolved on, when it wasn't all of them", () => {
    const changes = resolving([
      ["Contact", [unnamed]],
      ["Reports", [unnamed]],
      ["Grants", []],
      ["Home", [unnamed]],
    ]);

    expect(changes.summaryLine).toBe(
      "Since the last run on 26 September: 4 pages sound different, and this flag is resolved: the unnamed items, on 3 of them.",
    );
    // The section's line still says which three.
    expect(changes.line).toContain(
      "Resolved: on Contact, the unnamed items (unlabeled); on Reports, the unnamed items (unlabeled); on Home, the unnamed items (unlabeled).",
    );
  });

  it("names the page when a flag was resolved on one page, even when it is the only page that changed", () => {
    const some = resolving([
      ["Contact", []],
      ["Common mistakes", [generic]],
      ["Home", []],
    ]);
    const only = resolving([["Home", [unnamed]]]);

    expect(some.summaryLine).toBe(
      "Since the last run on 26 September: 3 pages sound different, and this flag is resolved: the links that don't say where they go, on Common mistakes.",
    );
    // One page is named, not "all 1 of them", though every page that changed had the flag.
    expect(only.summaryLine).toBe(
      "Since the last run on 26 September: 1 page sounds different, and this flag is resolved: the unnamed items, on Home.",
    );
  });

  it("groups the flags by what they found: each once, in the order its flag first appears, set apart by semicolons", () => {
    const changes = resolving([
      ["Contact", [unnamed]],
      ["Reports", [generic]],
      ["Grants", [unnamed]],
      ["Home", []],
    ]);

    // "The unnamed items" first appears on Contact, before the links on Reports, though it is on
    // Grants too.
    expect(changes.summaryLine).toBe(
      "Since the last run on 26 September: 4 pages sound different, and these flags are resolved: the unnamed items, on 2 of them; the links that don't say where they go, on Reports.",
    );
  });

  it("says all of them for the flag that was on every changed page beside one on a page of its own", () => {
    const changes = resolving([
      ["Contact", [unnamed]],
      ["Reports", [unnamed, generic]],
      ["Home", [unnamed]],
    ]);

    expect(changes.summaryLine).toBe(
      "Since the last run on 26 September: 3 pages sound different, and these flags are resolved: the unnamed items, on all 3 of them; the links that don't say where they go, on Reports.",
    );
  });

  it("counts a flag only on the pages that are rid of its rule, not those that still have it in another pass", () => {
    const unnamedTab: FlagResult = { ...unnamed, pass: "tab" };
    const t = transcripts();
    const earlier = t.run({
      id: "r1",
      createdAt: BEFORE,
      passes: ["read", "tab"],
      pages: [
        { path: "/a", label: "Contact", flags: [unnamed], passes: { read: ["a1"] } },
        // Gone from the read pass here, but the page still has it in the Tab pass.
        { path: "/b", label: "Reports", flags: [unnamed], passes: { read: ["b1"] } },
        { path: "/c", label: "Home", flags: [unnamed], passes: { read: ["c1"] } },
      ],
    });
    const later = t.run({
      id: "r2",
      createdAt: AFTER,
      passes: ["read", "tab"],
      pages: [
        { path: "/a", label: "Contact", passes: { read: ["a2"] } },
        { path: "/b", label: "Reports", flags: [unnamedTab], passes: { read: ["b2"] } },
        { path: "/c", label: "Home", passes: { read: ["c2"] } },
      ],
    });

    const changes = changesOf(earlier, later, t.body, pageName);

    expect(changes.summaryLine).toBe(
      "Since the last run on 26 September: 3 pages sound different, and this flag is resolved: the unnamed items, on 2 of them.",
    );
  });

  it.each([
    ["generic-link-text", "the links that don't say where they go"],
    ["unlabeled", "the unnamed items"],
    ["headings", "the heading structure"],
    ["read-not-finished", "the unfinished read"],
    ["tab-no-stops", "the missing Tab stops"],
    ["tab-before-main", "the Tab stops before the main content"],
    ["repeated-phrase", "the repeated speech"],
  ])("calls the %s rule %j", (rule, plain) => {
    const flag: FlagResult = { rule, pass: "read", message: "A message." };
    const changes = compare(
      [{ path: "/", label: "Home", flags: [flag], passes: { read: ["a"] } }],
      [{ path: "/", label: "Home", passes: { read: ["b"] } }],
    );

    expect(changes.line).toContain(`Resolved: on Home, ${plain} (${rule}).`);
    expect(changes.summaryLine).toContain(`this flag is resolved: ${plain}, on Home.`);
  });

  it("says nothing of resolved flags when none were", () => {
    const changes = compare(sevenPages({ "/a": "Before" }), sevenPages({ "/a": "After" }));

    expect(changes.line).toBe(
      "Compared with the run on 26 September: 1 of 7 pages sounds different, and 6 sound exactly the same.",
    );
    expect(changes.summaryLine).toBe(
      "Since the last run on 26 September: 1 page sounds different.",
    );
  });

  it("says a count of one in the singular", () => {
    const two = compare(
      [
        { path: "/a", passes: { read: ["a1"] } },
        { path: "/b", passes: { read: ["b"] } },
      ],
      [
        { path: "/a", passes: { read: ["a2"] } },
        { path: "/b", passes: { read: ["b"] } },
      ],
    );
    const one = compare(
      [{ path: "/a", passes: { read: ["a1"] } }],
      [{ path: "/a", passes: { read: ["a2"] } }],
    );

    expect(two.line).toBe(
      "Compared with the run on 26 September: 1 of 2 pages sounds different, and 1 sounds exactly the same.",
    );
    expect(one.line).toBe(
      "Compared with the run on 26 September: 1 of 1 page sounds different, and 0 sound exactly the same.",
    );
  });

  it("says every page sounds the same when none changed", () => {
    const pages: SharePageSpec[] = [{ path: "/", passes: { read: ["a"] } }];
    const changes = compare(pages, pages);

    expect(changes.line).toBe("Every page read in full in both runs sounds exactly the same.");
    expect(changes.summaryLine).toBe(
      "Since the last run on 26 September: every page read in full in both runs sounds the same.",
    );
  });

  it("names a page by the function it's given", () => {
    const t = transcripts();
    const before = t.run({
      id: "r1",
      createdAt: BEFORE,
      pages: [
        { path: "/common/", label: "Common mistakes", flags: [generic], passes: { read: ["a"] } },
      ],
    });
    const after = t.run({
      id: "r2",
      createdAt: AFTER,
      pages: [{ path: "/common/", label: "Common mistakes", passes: { read: ["b"] } }],
    });

    const changes = changesOf(before, after, t.body, pathOf);

    expect(changes.line).toContain(
      "on /common/, the links that don't say where they go (generic-link-text).",
    );
  });

  it("names a resolved flag once for its page, however many passes it was in", () => {
    const changes = compare(
      [{ path: "/", label: "Home", flags: [generic, genericTab], passes: { read: ["a"] } }],
      [{ path: "/", label: "Home", passes: { read: ["b"] } }],
    );

    expect(changes.changed[0]?.flags.resolved).toHaveLength(2);
    expect(changes.line.match(/generic-link-text/g)).toHaveLength(1);
  });

  it("doesn't call a rule resolved while its page still has it in another pass", () => {
    const changes = compare(
      [{ path: "/", label: "Home", flags: [generic, genericTab], passes: { read: ["a"] } }],
      [{ path: "/", label: "Home", flags: [genericTab], passes: { read: ["b"] } }],
    );

    // The read pass's flag is resolved, and the page's own record says so; the sentences don't
    // claim more than that.
    expect(changes.changed[0]?.flags.resolved).toEqual([generic]);
    expect(changes.line).not.toContain("Resolved");
    expect(changes.summaryLine).toBe(
      "Since the last run on 26 September: 1 page sounds different.",
    );
  });

  it("names a rule that has no plain name by its id alone", () => {
    const own: FlagResult = {
      rule: "brand-name",
      pass: "read",
      count: 2,
      message: "Brand name said 2 times.",
    };
    // An id that is also the name of something every object has must still be taken as an id.
    const inherited: FlagResult = { ...own, rule: "constructor" };
    const changes = compare(
      [{ path: "/", label: "Home", flags: [own, inherited], passes: { read: ["a"] } }],
      [{ path: "/", label: "Home", passes: { read: ["b"] } }],
    );

    // The id is said once, since there is no plain name for it to follow.
    expect(changes.line).toContain("Resolved: on Home, brand-name; on Home, constructor.");
    expect(changes.summaryLine).toBe(
      "Since the last run on 26 September: 1 page sounds different, and these flags are resolved: brand-name, on Home; constructor, on Home.",
    );
  });

  it("says no page could be compared when no page was read in full in both runs", () => {
    const changes = compare(
      [{ path: "/old", passes: { read: ["a"] } }],
      [{ path: "/new", passes: { read: ["b"] } }],
    );

    expect([changes.changed, changes.same]).toEqual([[], 0]);
    expect(changes.line).toBe("No page was read in full in both runs, so none could be compared.");
    expect(changes.summaryLine).toBe(
      "Since the last run on 26 September: no page was read in full in both runs, so none could be compared.",
    );
  });
});
