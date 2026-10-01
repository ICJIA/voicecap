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
      "Since the last run on 29 September: every page sounds the same.",
    );
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
      changes.changed.map(({ passes: _passes, flags: _flags, ...page }) => page),
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

  it("takes a pass that only one run has as all removed or all added, as --compare does", () => {
    const changes = compare(
      [{ path: "/", passes: { read: ["same"], headings: ["h1", "h2"] } }],
      [{ path: "/", passes: { read: ["same"], tab: ["t1"] } }],
    );

    const passes = changes.changed[0]?.passes ?? [];
    expect(passes.map((pass) => [pass.pass, pass.removed, pass.added])).toEqual([
      ["headings", 2, 0],
      ["tab", 0, 1],
    ]);
    expect(shape(passes[0]?.lines ?? [])).toEqual(["removed h1", "removed h2"]);
    expect(shape(passes[1]?.lines ?? [])).toEqual(["added t1"]);
  });

  it("lists pages read in only one run, with the reason", () => {
    const changes = compare(
      [
        { path: "/", passes: { read: ["Home"] } },
        { path: "/gone", label: "Old page", passes: { read: ["Gone"] } },
        { path: "/failed-before", status: "failed" },
        { path: "/failed-now", passes: { read: ["Now"] } },
        { path: "/skipped-now", passes: { read: ["Skipped"] } },
        { path: "/neither", status: "failed" },
        { path: "/dropped-failure", status: "failed" },
      ],
      [
        { path: "/", passes: { read: ["Home"] } },
        { path: "/new", label: "New page", passes: { read: ["New"] } },
        { path: "/failed-before", passes: { read: ["Before"] } },
        { path: "/failed-now", status: "failed" },
        { path: "/skipped-now", status: "skipped" },
        { path: "/neither", status: "failed" },
        { path: "/new-failure", status: "failed" },
      ],
    );

    // In the later run's order, then the pages only the earlier run listed. A page read in neither
    // run isn't here: it wasn't read in only one. A skipped page wasn't read either.
    expect(changes.onlyInOne.map((page) => [pathOf(page), page.reason])).toEqual([
      ["/new", "new"],
      ["/failed-before", "failed in one run"],
      ["/failed-now", "failed in one run"],
      ["/skipped-now", "failed in one run"],
      ["/gone", "no longer listed"],
    ]);
    expect(changes.same).toBe(1);
    expect(changes.changed).toEqual([]);
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
    expect(changes.changed[0]?.flags).toEqual({
      resolved: [generic("read", 3), generic("tab", 3)],
      added: [repeated],
      unchanged: [unlabeled(1), headings],
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

    expect(changes.changed[0]?.flags).toEqual({
      resolved: [headings],
      added: [],
      unchanged: [own("said 3 times")],
    });
  });

  it("has no flags to name for a page with none", () => {
    const changes = compare(
      [{ path: "/", passes: { read: ["a"] } }],
      [{ path: "/", passes: { read: ["b"] } }],
    );

    expect(changes.changed[0]?.flags).toEqual({ resolved: [], added: [], unchanged: [] });
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
      "Compared with the run on 26 September: 3 of 7 pages sound different, and 4 sound exactly the same. Resolved: the links that say only what they do, not where they go on Common mistakes (generic-link-text).",
    );
    expect(changes.summaryLine).toBe(
      "Since the last run on 26 September: 3 pages sound different, and this flag is resolved: the links that say only what they do, not where they go on Common mistakes (generic-link-text).",
    );
  });

  it("names every resolved flag with the page it was on, in page order", () => {
    const changes = compare(
      [
        { path: "/a", label: "Contact", flags: [unnamed], passes: { read: ["a1"] } },
        {
          path: "/b",
          label: "Common mistakes",
          flags: [generic, genericTab],
          passes: { read: ["b1"] },
        },
      ],
      [
        { path: "/a", label: "Contact", passes: { read: ["a2"] } },
        { path: "/b", label: "Common mistakes", passes: { read: ["b2"] } },
      ],
    );

    expect(changes.line).toBe(
      "Compared with the run on 26 September: 2 of 2 pages sound different, and 0 sound exactly the same. Resolved: the unnamed controls on Contact (unlabeled) and the links that say only what they do, not where they go on Common mistakes (generic-link-text).",
    );
    expect(changes.summaryLine).toBe(
      "Since the last run on 26 September: 2 pages sound different, and these flags are resolved: the unnamed controls on Contact (unlabeled) and the links that say only what they do, not where they go on Common mistakes (generic-link-text).",
    );
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
      "Since the last run on 26 September: every page sounds the same.",
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

    expect(changes.line).toContain("on /common/ (generic-link-text).");
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

    expect(changes.line).toContain("Resolved: brand-name on Home and constructor on Home.");
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
