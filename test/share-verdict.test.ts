/**
 * The verdict: what a share's result says in words and in kind, the one rule that the page's At a
 * glance, its Word copy, and the website's card all go by.
 */
import { describe, expect, it } from "vitest";

import type { ShareResult } from "../src/model.js";
import { verdictOf, type VerdictKind } from "../src/share/verdict.js";

interface Row extends ShareResult {
  kind: VerdictKind;
  headline: string;
}

describe("verdictOf", () => {
  it.each<Row>([
    {
      pages: 9,
      read: 9,
      problems: 0,
      problemPages: 0,
      kind: "ok",
      headline: "Nothing needs attention",
    },
    {
      pages: 32,
      read: 32,
      problems: 1,
      problemPages: 32,
      kind: "warn",
      headline: "1 problem needs attention, on 32 pages",
    },
    {
      pages: 3,
      read: 3,
      problems: 2,
      problemPages: 1,
      kind: "warn",
      headline: "2 problems need attention, on 1 page",
    },
    {
      pages: 9,
      read: 7,
      problems: 2,
      problemPages: 2,
      kind: "bad",
      headline: "2 problems need attention, on 2 pages",
    },
    {
      pages: 9,
      read: 8,
      problems: 0,
      problemPages: 0,
      kind: "bad",
      headline: "Nothing needs attention on the pages read",
    },
    {
      pages: 1,
      read: 1,
      problems: 1,
      problemPages: 1,
      kind: "warn",
      headline: "1 problem needs attention, on 1 page",
    },
  ])(
    "says each kind of result in words, with its kind: pages=$pages read=$read problems=$problems problemPages=$problemPages",
    ({ kind, headline, ...result }) => {
      expect(verdictOf(result)).toEqual({ kind, headline });
    },
  );

  it("is bad whenever NVDA read fewer pages than are in scope, whatever the problems", () => {
    // Red outranks the warning: a site that wasn't read in full isn't one with only some problems.
    expect(verdictOf({ pages: 2, read: 0, problems: 0, problemPages: 0 }).kind).toBe("bad");
    expect(verdictOf({ pages: 2, read: 1, problems: 5, problemPages: 2 }).kind).toBe("bad");
    // And a site whose pages were all read is warn only for a problem, else ok.
    expect(verdictOf({ pages: 2, read: 2, problems: 5, problemPages: 2 }).kind).toBe("warn");
    expect(verdictOf({ pages: 2, read: 2, problems: 0, problemPages: 0 }).kind).toBe("ok");
  });
});
