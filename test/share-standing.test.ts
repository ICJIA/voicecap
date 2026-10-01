import { describe, expect, it } from "vitest";

import type { PageSource, RunJson } from "../src/model.js";
import { canonicalKey } from "../src/pages/url.js";
import { runBefore, standingOf, type PageStanding, type Standing } from "../src/share/standing.js";
import { findPage, SITE } from "./helpers/report-data.js";
import { shareRun } from "./helpers/share-data.js";

const ids = (runs: RunJson[]) => runs.map((run) => run.id);

/** A page's standing, found by its path on the site. */
function pageAt(standing: Standing, pagePath: string): PageStanding {
  const key = canonicalKey(new URL(pagePath, SITE).href);
  const page = standing.pages.find((candidate) => candidate.key === key);
  if (!page) throw new Error(`No page ${pagePath} in the standing`);
  return page;
}

describe("standingOf: which runs count", () => {
  const pages = [{ path: "/" }];

  it("counts completed, sealed, live runs, and leaves out the rest with a reason", () => {
    const standing = standingOf([
      shareRun({ id: "a1", sealed: true, pages }),
      shareRun({ id: "a2", sealed: false, pages }),
      shareRun({ id: "a3", status: "incomplete", endReason: "interrupted", pages }),
      shareRun({ id: "a4", status: "incomplete", endReason: null, pages }),
      shareRun({ id: "a5", replayed: true, pages }),
    ]);

    expect(ids(standing.counted)).toEqual(["a1"]);
    expect(standing.leftOut.map((left) => [left.run.id, left.reason])).toEqual([
      ["a2", "unsealed"],
      ["a3", "interrupted"],
      ["a4", "unfinished"],
      ["a5", "replayed"],
    ]);
  });

  it("calls an incomplete run interrupted only when its last session was interrupted", () => {
    const stopped = (endReason: "environment-failure" | "error" | "completed") =>
      shareRun({ id: endReason, status: "incomplete", endReason, pages });
    const standing = standingOf([
      stopped("environment-failure"),
      stopped("error"),
      stopped("completed"),
      { ...shareRun({ id: "no-sessions", status: "incomplete", pages }), sessions: [] },
    ]);

    expect(standing.counted).toEqual([]);
    expect(standing.leftOut.map((left) => [left.run.id, left.reason])).toEqual([
      ["completed", "unfinished"],
      ["environment-failure", "unfinished"],
      ["error", "unfinished"],
      ["no-sessions", "unfinished"],
    ]);
  });

  it("calls an incomplete run of several sessions interrupted only when its last session was", () => {
    const sessions = (...ends: ("interrupted" | "error")[]) =>
      shareRun({
        id: ends.join("-then-"),
        status: "incomplete",
        sessions: ends.map((endReason, index) => ({
          startedAt: `2026-09-26T1${index}:00:00-05:00`,
          endReason,
        })),
        pages,
      });
    const standing = standingOf([
      sessions("interrupted", "error"),
      sessions("error", "interrupted"),
    ]);

    expect(standing.leftOut.map((left) => [left.run.id, left.reason])).toEqual([
      ["error-then-interrupted", "interrupted"],
      ["interrupted-then-error", "unfinished"],
    ]);
  });

  it("names a replayed run replayed first, however far it got", () => {
    const standing = standingOf([
      shareRun({ id: "p1", replayed: true, status: "incomplete", endReason: "interrupted", pages }),
      shareRun({ id: "p2", replayed: true, sealed: false, pages }),
    ]);

    expect(standing.leftOut.map((left) => left.reason)).toEqual(["replayed", "replayed"]);
  });

  it("counts the pages a left-out run got through", () => {
    const standing = standingOf([
      shareRun({
        id: "a1",
        status: "incomplete",
        pages: [
          { path: "/" },
          { path: "/failed", status: "failed" },
          { path: "/skipped", status: "skipped" },
          { path: "/pending", status: "pending" },
          { path: "/pending-too", status: "pending" },
        ],
      }),
    ]);

    expect(standing.leftOut.map((left) => left.processed)).toEqual([3]);
  });

  it("orders runs by when they were created, then by id, whatever order they come in", () => {
    const runs = [
      shareRun({ id: "b", createdAt: "2026-09-26T10:00:00-05:00", pages }),
      shareRun({ id: "a", createdAt: "2026-09-26T10:00:00-05:00", pages }),
      shareRun({ id: "c", createdAt: "2026-09-25T10:00:00-05:00", pages }),
      shareRun({ id: "z", createdAt: "2026-09-27T10:00:00-05:00", sealed: false, pages }),
      shareRun({ id: "y", createdAt: "2026-09-26T09:00:00-05:00", replayed: true, pages }),
    ];
    const given = ids(runs);
    const standing = standingOf(runs);

    expect(ids(standing.counted)).toEqual(["c", "a", "b"]);
    expect(standing.latest?.id).toBe("b");
    expect(ids(standing.leftOut.map((left) => left.run))).toEqual(["y", "z"]);
    expect(ids(runs)).toEqual(given);
  });

  it("takes the latest run from those that count, not from the newest run", () => {
    const standing = standingOf([
      shareRun({ id: "r1", createdAt: "2026-09-20T09:30:00-05:00", pages: [{ path: "/" }] }),
      shareRun({
        id: "r2",
        createdAt: "2026-09-22T09:30:00-05:00",
        replayed: true,
        pages: [{ path: "/" }, { path: "/extra" }],
      }),
      shareRun({
        id: "r3",
        createdAt: "2026-09-23T09:30:00-05:00",
        status: "incomplete",
        pages: [{ path: "/", status: "failed" }],
      }),
      shareRun({
        id: "r4",
        createdAt: "2026-09-24T09:30:00-05:00",
        sealed: false,
        pages: [{ path: "/", status: "failed" }],
      }),
    ]);

    expect(standing.latest?.id).toBe("r1");
    expect(standing.pages.map((page) => page.key)).toEqual(["https://example.illinois.gov/"]);
    // The replay read "/" later, but a run that doesn't count is never shown.
    expect(pageAt(standing, "/").shown?.run.id).toBe("r1");
    expect(pageAt(standing, "/").latestFailure).toBeNull();
    expect(standing.noLongerListed).toEqual([]);
    expect(ids(standing.drawnOn)).toEqual(["r1"]);
  });

  it("has no standing when no run counts", () => {
    const standing = standingOf([shareRun({ id: "p1", replayed: true, pages })]);

    expect(standing.latest).toBeNull();
    expect(standing.pages).toEqual([]);
    expect(standing.drawnOn).toEqual([]);
    expect(standing.counted).toEqual([]);
    expect(standing.noLongerListed).toEqual([]);
    expect(standing.leftOut).toHaveLength(1);
  });

  it("has no standing for a site with no runs", () => {
    expect(standingOf([])).toEqual({
      counted: [],
      leftOut: [],
      latest: null,
      pages: [],
      noLongerListed: [],
      drawnOn: [],
    });
  });
});

describe("standingOf: each page's result", () => {
  it("shows each page's latest transcription, and a failed page beside its last good one", () => {
    const r1 = shareRun({
      id: "r1",
      createdAt: "2026-09-20T09:30:00-05:00",
      pages: [{ path: "/" }, { path: "/a" }],
    });
    const r2 = shareRun({
      id: "r2",
      createdAt: "2026-09-26T14:05:00-05:00",
      pages: [{ path: "/" }, { path: "/a", status: "failed" }],
    });
    const standing = standingOf([r1, r2]);
    const home = pageAt(standing, "/");
    const a = pageAt(standing, "/a");

    expect(home.shown?.run.id).toBe("r2");
    expect(home.shown?.page).toBe(findPage(r2, "/"));
    expect(home.latestFailure).toBeNull();
    expect(a.shown?.run.id).toBe("r1");
    expect(a.shown?.page).toBe(findPage(r1, "/a"));
    expect(a.latestFailure?.run.id).toBe("r2");
    expect(a.latestFailure?.page).toBe(findPage(r2, "/a"));
    expect(ids(standing.drawnOn)).toEqual(["r1", "r2"]);
  });

  it("marks a page never transcribed", () => {
    const r1 = shareRun({ id: "r1", pages: [{ path: "/" }, { path: "/b", status: "failed" }] });
    // Runs that read /b in full but don't count: a replay, one that wasn't sealed, and one that was
    // interrupted. None of their transcripts is shown.
    const uncounted = [
      shareRun({
        id: "r0",
        createdAt: "2026-09-20T09:30:00-05:00",
        replayed: true,
        pages: [{ path: "/b" }],
      }),
      shareRun({
        id: "r2",
        createdAt: "2026-09-27T09:30:00-05:00",
        sealed: false,
        pages: [{ path: "/b" }],
      }),
      shareRun({
        id: "r3",
        createdAt: "2026-09-28T09:30:00-05:00",
        status: "incomplete",
        pages: [{ path: "/b" }, { path: "/", status: "pending" }],
      }),
    ];
    const b = pageAt(standingOf([r1, ...uncounted]), "/b");

    expect(b.shown).toBeNull();
    expect(b.latestFailure?.run.id).toBe("r1");
    expect(b.latestFailure?.page).toBe(findPage(r1, "/b"));
  });

  it("keeps a skipped page in scope, beside its last good transcription", () => {
    const r1 = shareRun({
      id: "r1",
      createdAt: "2026-09-20T09:30:00-05:00",
      pages: [{ path: "/" }, { path: "/guide" }],
    });
    const r2 = shareRun({
      id: "r2",
      createdAt: "2026-09-26T14:05:00-05:00",
      pages: [{ path: "/" }, { path: "/guide", status: "skipped" }],
    });
    const standing = standingOf([r1, r2]);
    const guide = pageAt(standing, "/guide");

    expect(standing.pages).toHaveLength(2);
    expect(guide.latestFailure?.page.status).toBe("skipped");
    expect(guide.shown?.run.id).toBe("r1");
  });

  it("lists the pages in the latest run's order, with its name for each", () => {
    const standing = standingOf([
      shareRun({
        id: "r1",
        createdAt: "2026-09-20T09:30:00-05:00",
        pages: [{ path: "/a", label: "Old name" }, { path: "/b" }],
      }),
      shareRun({
        id: "r2",
        createdAt: "2026-09-26T14:05:00-05:00",
        pages: [{ path: "/b" }, { path: "/a", label: "Page A" }],
      }),
    ]);

    expect(standing.pages.map((page) => [page.url, page.label])).toEqual([
      ["https://example.illinois.gov/b", undefined],
      ["https://example.illinois.gov/a", "Page A"],
    ]);
    expect(standing.pages.map((page) => "label" in page)).toEqual([false, true]);
    expect(standing.pages.map((page) => page.slug)).toEqual(
      standing.latest?.pages.map((page) => page.slug),
    );
  });

  it("lists pages the latest list no longer has", () => {
    const r1 = shareRun({
      id: "r1",
      createdAt: "2026-09-20T09:30:00-05:00",
      pages: [{ path: "/" }, { path: "/old" }],
    });
    const r2 = shareRun({
      id: "r2",
      createdAt: "2026-09-26T14:05:00-05:00",
      pages: [{ path: "/" }],
    });
    const standing = standingOf([r1, r2]);

    expect(standing.pages.map((page) => page.key)).toEqual([findPage(r2, "/").key]);
    expect(standing.noLongerListed).toHaveLength(1);
    expect(standing.noLongerListed[0]?.run.id).toBe("r1");
    expect(standing.noLongerListed[0]?.page).toBe(findPage(r1, "/old"));
  });

  it("gives a page no longer listed its newest record from the runs that count", () => {
    const standing = standingOf([
      shareRun({
        id: "r1",
        createdAt: "2026-09-20T09:30:00-05:00",
        pages: [{ path: "/" }, { path: "/old" }, { path: "/older" }],
      }),
      shareRun({
        id: "r2",
        createdAt: "2026-09-22T09:30:00-05:00",
        pages: [{ path: "/" }, { path: "/old", status: "failed" }],
      }),
      // A replay's record of the page is newer, but never counts.
      shareRun({
        id: "r3",
        createdAt: "2026-09-23T09:30:00-05:00",
        replayed: true,
        pages: [{ path: "/" }, { path: "/old" }],
      }),
      shareRun({ id: "r4", createdAt: "2026-09-26T14:05:00-05:00", pages: [{ path: "/" }] }),
    ]);

    expect(
      standing.noLongerListed.map((gone) => [gone.page.url, gone.run.id, gone.page.status]),
    ).toEqual([
      ["https://example.illinois.gov/old", "r2", "failed"],
      ["https://example.illinois.gov/older", "r1", "done"],
    ]);
  });
});

describe("standingOf: the pages in scope", () => {
  const SITEMAP: PageSource = { kind: "sitemap", url: "https://example.illinois.gov/sitemap.xml" };
  /** What a run given its pages with --page records as its source. */
  const given = (...paths: string[]): PageSource => ({
    kind: "urls",
    urls: paths.map((path) => new URL(path, SITE).href),
  });

  it("keeps the sitemap's pages in scope after a spot check of one of them with --page", () => {
    const full = shareRun({
      id: "r1",
      createdAt: "2026-09-20T09:30:00-05:00",
      source: SITEMAP,
      pages: [{ path: "/" }, { path: "/a" }, { path: "/b" }],
    });
    const spotCheck = shareRun({
      id: "r2",
      createdAt: "2026-09-26T14:05:00-05:00",
      source: given("/a"),
      pages: [{ path: "/a" }],
    });
    const standing = standingOf([full, spotCheck]);

    expect(standing.latest?.id).toBe("r1");
    expect(standing.pages.map((page) => page.url)).toEqual(full.pages.map((page) => page.url));
    // The spot check's newer transcripts are shown for its page; the others are the full run's.
    expect(standing.pages.map((page) => page.shown?.run.id)).toEqual(["r1", "r2", "r1"]);
    expect(standing.pages.map((page) => page.latestFailure)).toEqual([null, null, null]);
    expect(standing.noLongerListed).toEqual([]);
    expect(ids(standing.drawnOn)).toEqual(["r1", "r2"]);
  });

  it("takes the pages in scope from a page list as from a sitemap", () => {
    const list = shareRun({
      id: "r1",
      createdAt: "2026-09-20T09:30:00-05:00",
      pages: [{ path: "/" }, { path: "/a" }],
    });
    const spotCheck = shareRun({
      id: "r2",
      createdAt: "2026-09-26T14:05:00-05:00",
      source: given("/"),
      pages: [{ path: "/" }],
    });
    const standing = standingOf([list, spotCheck]);

    expect(standing.latest?.id).toBe("r1");
    expect(standing.pages.map((page) => page.shown?.run.id)).toEqual(["r2", "r1"]);
    expect(standing.noLongerListed).toEqual([]);
  });

  it("says a page a later spot check couldn't read failed there, beside its last good transcripts", () => {
    const full = shareRun({
      id: "r1",
      createdAt: "2026-09-20T09:30:00-05:00",
      source: SITEMAP,
      pages: [{ path: "/" }, { path: "/a" }],
    });
    const spotCheck = shareRun({
      id: "r2",
      createdAt: "2026-09-26T14:05:00-05:00",
      source: given("/a"),
      pages: [{ path: "/a", status: "failed" }],
    });
    const standing = standingOf([full, spotCheck]);
    const a = pageAt(standing, "/a");

    expect(a.shown?.run.id).toBe("r1");
    expect(a.latestFailure?.run.id).toBe("r2");
    expect(a.latestFailure?.page).toBe(findPage(spotCheck, "/a"));
    // The spot check is drawn on: its failure is the page's latest, and its problem is shown.
    expect(ids(standing.drawnOn)).toEqual(["r1", "r2"]);
  });

  it("takes a page's newest record, so a later spot check that read it settles the failure before", () => {
    const full = shareRun({
      id: "r1",
      createdAt: "2026-09-20T09:30:00-05:00",
      source: SITEMAP,
      pages: [{ path: "/" }, { path: "/a", status: "failed" }],
    });
    const spotCheck = shareRun({
      id: "r2",
      createdAt: "2026-09-26T14:05:00-05:00",
      source: given("/a"),
      pages: [{ path: "/a" }],
    });
    const a = pageAt(standingOf([full, spotCheck]), "/a");

    expect(a.shown?.run.id).toBe("r2");
    expect(a.latestFailure).toBeNull();
  });

  it("compares the run that decides the pages with the run before it, from the same sitemap", () => {
    const sitemapRun = (id: string, createdAt: string) =>
      shareRun({ id, createdAt, source: SITEMAP, pages: [{ path: "/" }, { path: "/a" }] });
    const r0 = sitemapRun("r0", "2026-09-18T09:30:00-05:00");
    const r1 = sitemapRun("r1", "2026-09-20T09:30:00-05:00");
    const spotCheck = shareRun({
      id: "r2",
      createdAt: "2026-09-26T14:05:00-05:00",
      source: given("/a"),
      pages: [{ path: "/a" }],
    });
    const standing = standingOf([r0, r1, spotCheck]);

    expect(standing.latest?.id).toBe("r1");
    expect(runBefore(standing.counted, r1)?.id).toBe("r0");
    expect(ids(standing.drawnOn)).toEqual(["r0", "r1", "r2"]);
  });

  it("lists no page a later spot check read that the list doesn't have, as no longer listed or in scope", () => {
    const full = shareRun({
      id: "r1",
      createdAt: "2026-09-20T09:30:00-05:00",
      source: SITEMAP,
      pages: [{ path: "/" }, { path: "/a" }],
    });
    const offList = shareRun({
      id: "r2",
      createdAt: "2026-09-26T14:05:00-05:00",
      source: given("/elsewhere"),
      pages: [{ path: "/elsewhere" }],
    });
    const standing = standingOf([full, offList]);

    expect(standing.pages.map((page) => page.url)).toEqual(full.pages.map((page) => page.url));
    expect(standing.noLongerListed).toEqual([]);
    expect(ids(standing.drawnOn)).toEqual(["r1"]);
  });

  it("takes the pages from the newest run when every run was given its pages with --page", () => {
    const first = shareRun({
      id: "r1",
      createdAt: "2026-09-20T09:30:00-05:00",
      source: given("/", "/a"),
      pages: [{ path: "/" }, { path: "/a" }],
    });
    const second = shareRun({
      id: "r2",
      createdAt: "2026-09-26T14:05:00-05:00",
      source: given("/a"),
      pages: [{ path: "/a" }],
    });
    const standing = standingOf([first, second]);

    expect(standing.latest?.id).toBe("r2");
    expect(standing.pages.map((page) => page.url)).toEqual([new URL("/a", SITE).href]);
    expect(standing.noLongerListed.map((gone) => [gone.page.url, gone.run.id])).toEqual([
      [new URL("/", SITE).href, "r1"],
    ]);
  });
});

describe("standingOf: the runs it draws on", () => {
  it("draws on the run before too, for what changed", () => {
    const pages = [{ path: "/" }, { path: "/a" }];
    const r1 = shareRun({ id: "r1", createdAt: "2026-09-20T09:30:00-05:00", pages });
    const r2 = shareRun({ id: "r2", createdAt: "2026-09-26T14:05:00-05:00", pages });
    const standing = standingOf([r1, r2]);

    // Every page's result is r2's, but the page compares r2 with r1 and shows r1's evidence.
    expect(standing.pages.map((page) => page.shown?.run.id)).toEqual(["r2", "r2"]);
    expect(ids(standing.drawnOn)).toEqual(["r1", "r2"]);
  });

  it("draws on each run a result comes from, and the run before, once each, oldest first", () => {
    const everything = [{ path: "/" }, { path: "/a" }, { path: "/b" }];
    const standing = standingOf([
      shareRun({ id: "r0", createdAt: "2026-09-18T09:30:00-05:00", pages: everything }),
      shareRun({ id: "r1", createdAt: "2026-09-20T09:30:00-05:00", pages: everything }),
      shareRun({
        id: "r2",
        createdAt: "2026-09-22T09:30:00-05:00",
        pages: [{ path: "/" }, { path: "/a" }, { path: "/b", status: "failed" }],
      }),
      shareRun({
        id: "r3",
        createdAt: "2026-09-24T09:30:00-05:00",
        pages: [{ path: "/" }, { path: "/a", status: "failed" }, { path: "/b", status: "failed" }],
      }),
    ]);

    // "/" comes from r3, "/a" from r2 (also the run before), and "/b" from r1. r0 gives nothing.
    expect(standing.pages.map((page) => page.shown?.run.id)).toEqual(["r3", "r2", "r1"]);
    expect(ids(standing.counted)).toEqual(["r0", "r1", "r2", "r3"]);
    expect(ids(standing.drawnOn)).toEqual(["r1", "r2", "r3"]);
  });

  it("draws on the latest run even when none of its pages were transcribed", () => {
    const standing = standingOf([shareRun({ id: "r1", pages: [{ path: "/", status: "failed" }] })]);

    expect(standing.pages.map((page) => page.shown)).toEqual([null]);
    expect(ids(standing.drawnOn)).toEqual(["r1"]);
  });
});

describe("runBefore", () => {
  const pages = [{ path: "/" }];

  it("picks the run before as --compare previous does", () => {
    const sitemap: PageSource = {
      kind: "sitemap",
      url: "https://example.illinois.gov/sitemap.xml",
    };
    const { counted } = standingOf([
      shareRun({ id: "2026-09-18_0900", createdAt: "2026-09-18T09:00:00-05:00", pages }),
      // The run before: the most recent run that counts, has the same page source, and is earlier.
      shareRun({ id: "2026-09-20_0930", createdAt: "2026-09-20T09:30:00-05:00", pages }),
      // A different page source.
      shareRun({
        id: "2026-09-21_0800",
        createdAt: "2026-09-21T08:00:00-05:00",
        source: sitemap,
        pages,
      }),
      // The same source, but they don't count: one is still going, one is a replay.
      shareRun({
        id: "2026-09-22_0800",
        createdAt: "2026-09-22T08:00:00-05:00",
        status: "incomplete",
        pages,
      }),
      shareRun({
        id: "2026-09-23_0800",
        createdAt: "2026-09-23T08:00:00-05:00",
        replayed: true,
        pages,
      }),
      shareRun({ id: "2026-09-24_1405", createdAt: "2026-09-24T14:05:00-05:00", pages }),
      // Later than the run asked about.
      shareRun({ id: "2026-09-26_0900", createdAt: "2026-09-26T09:00:00-05:00", pages }),
    ]);
    const named = (id: string): RunJson => {
      const run = counted.find((candidate) => candidate.id === id);
      if (!run) throw new Error(`No counted run ${id}`);
      return run;
    };

    expect(runBefore(counted, named("2026-09-24_1405"))?.id).toBe("2026-09-20_0930");
    expect(runBefore(counted, named("2026-09-26_0900"))?.id).toBe("2026-09-24_1405");
    // Nothing earlier has the same page source.
    expect(runBefore(counted, named("2026-09-18_0900"))).toBeNull();
    expect(runBefore(counted, named("2026-09-21_0800"))).toBeNull();
  });

  it("is never the run itself, and none when it's the only run", () => {
    const only = shareRun({ id: "r1", pages });

    expect(runBefore([only], only)).toBeNull();
  });

  it("counts a run created in the same second, as --compare previous does", () => {
    const r1 = shareRun({ id: "r1", createdAt: "2026-09-26T14:05:00-05:00", pages });
    const r2 = shareRun({ id: "r2", createdAt: "2026-09-26T14:05:00-05:00", pages });

    expect(runBefore([r1, r2], r2)?.id).toBe("r1");
  });

  it("doesn't depend on the order it is given the runs in", () => {
    const r1 = shareRun({ id: "r1", createdAt: "2026-09-20T09:30:00-05:00", pages });
    const r2 = shareRun({ id: "r2", createdAt: "2026-09-22T09:30:00-05:00", pages });
    const r3 = shareRun({ id: "r3", createdAt: "2026-09-24T09:30:00-05:00", pages });

    expect(runBefore([r3, r1, r2], r3)?.id).toBe("r2");
    expect(runBefore([r2, r3, r1], r3)?.id).toBe("r2");
  });
});
