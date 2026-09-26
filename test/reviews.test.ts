import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { PageRecord, ReviewEntry } from "../src/model.js";
import { changedSinceReview } from "../src/reviews/changed.js";
import { resolveReviewer } from "../src/reviews/reviewer.js";
import { appendReview, latestReview, readReviews } from "../src/reviews/store.js";

const tmp = () => mkdtemp(path.join(os.tmpdir(), "voicecap-reviews-"));
const KEY = "https://example.illinois.gov/about";

function entry(status: ReviewEntry["status"], note: string | null = null): ReviewEntry {
  return {
    status,
    reviewer: "Pat Reviewer",
    at: "2026-09-26T15:00:00-05:00",
    note,
    run: "2026-09-26_1405",
    url: KEY,
    files: { "read.txt": "a".repeat(64) },
    content: { read: "b".repeat(64) },
  };
}

describe("review history", () => {
  it("appends entries and never edits earlier ones; the latest is the current status", async () => {
    const out = await tmp();
    await appendReview(out, KEY, entry("issue", "Missing label"));
    await appendReview(out, KEY, entry("fixed"));
    const reviews = await readReviews(out);
    expect(reviews.pages[KEY]?.map((e) => e.status)).toEqual(["issue", "fixed"]);
    expect(latestReview(reviews, KEY)?.status).toBe("fixed");
    expect(reviews.pages[KEY]?.[0]?.note).toBe("Missing label");
  });

  it("keeps entries for other pages and unknown top-level fields intact", async () => {
    const out = await tmp();
    const file = path.join(out, "reviews.json");
    await writeFile(
      file,
      JSON.stringify({ schemaVersion: 1, note: "kept", pages: { other: [entry("reviewed")] } }),
    );
    await appendReview(out, KEY, entry("issue"));
    const data = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    expect(data.note).toBe("kept");
    expect(Object.keys(data.pages as object).sort()).toEqual([KEY, "other"].sort());
  });

  it("never overwrites a damaged history", async () => {
    const out = await tmp();
    const file = path.join(out, "reviews.json");
    await writeFile(file, "{ this is not json");
    await expect(appendReview(out, KEY, entry("issue"))).rejects.toThrow(
      /never overwrites review history/,
    );
    expect(await readFile(file, "utf8")).toBe("{ this is not json");
    await writeFile(file, JSON.stringify({ schemaVersion: 1, pages: { [KEY]: "not an array" } }));
    await expect(readReviews(out)).rejects.toThrow(/doesn't look like a voicecap review history/);
  });
});

describe("reviewer name", () => {
  const none = () => null;
  it("prefers --reviewer, then VOICECAP_REVIEWER, then git, then the config", () => {
    const base = { cwd: ".", configReviewer: "Config Name" };
    expect(
      resolveReviewer({
        ...base,
        option: "Flag Name",
        env: { VOICECAP_REVIEWER: "Env Name" },
        gitUserName: () => "Git Name",
      }),
    ).toEqual({ name: "Flag Name", source: "option" });
    expect(
      resolveReviewer({
        ...base,
        env: { VOICECAP_REVIEWER: "Env Name" },
        gitUserName: () => "Git Name",
      }),
    ).toEqual({ name: "Env Name", source: "environment" });
    expect(resolveReviewer({ ...base, env: {}, gitUserName: () => "Git Name" })).toEqual({
      name: "Git Name",
      source: "git",
    });
    expect(resolveReviewer({ ...base, env: {}, gitUserName: none })).toEqual({
      name: "Config Name",
      source: "config",
    });
  });

  it("refuses to record without a name", () => {
    expect(() =>
      resolveReviewer({
        cwd: ".",
        configReviewer: null,
        env: { VOICECAP_REVIEWER: "  " },
        gitUserName: none,
      }),
    ).toThrow(/No reviewer name/);
  });
});

describe("changed since review", () => {
  const page = (content: string): PageRecord => ({
    url: KEY,
    key: KEY,
    slug: "about-1",
    status: "done",
    attempts: 1,
    passes: {
      read: {
        steps: 3,
        stopReason: "end-reached",
        durationMs: 1,
        contentSha256: content,
        errors: [],
        warnings: [],
      },
    },
    files: {},
    flags: [],
    errors: [],
  });

  it("compares the reviewed content hashes with the run shown", () => {
    expect(changedSinceReview(entry("reviewed"), page("b".repeat(64)))).toBe(false);
    expect(changedSinceReview(entry("reviewed"), page("c".repeat(64)))).toBe(true);
    expect(
      changedSinceReview(
        { ...entry("reviewed"), content: { read: "b".repeat(64), tab: "d".repeat(64) } },
        page("b".repeat(64)),
      ),
    ).toBe(true);
  });

  it("has nothing to compare without a review, for an unreviewed entry, or a page not transcribed", () => {
    expect(changedSinceReview(undefined, page("b".repeat(64)))).toBeNull();
    expect(changedSinceReview(entry("unreviewed"), page("b".repeat(64)))).toBeNull();
    expect(
      changedSinceReview(entry("reviewed"), { ...page("b".repeat(64)), status: "failed" }),
    ).toBeNull();
  });
});
