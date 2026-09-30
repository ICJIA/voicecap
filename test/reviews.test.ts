import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { PageRecord, ReviewEntry } from "../src/model.js";
import { changedSinceReview } from "../src/reviews/changed.js";
import { addReview } from "../src/reviews/review.js";
import { findReviewer, resolveReviewer } from "../src/reviews/reviewer.js";
import { appendReview, latestReview, readReviews } from "../src/reviews/store.js";
import { runAudit } from "../src/run/audit.js";
import { sealOf } from "../src/util/hash.js";
import { createMemoryLogger } from "../src/util/log.js";

const tmp = () => mkdtemp(path.join(os.tmpdir(), "voicecap-reviews-"));
const KEY = "https://example.illinois.gov/about";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const fixture = (...parts: string[]) => path.join(ROOT, "fixture", ...parts);

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

    // The pre-existing entry predates seq/prev/seal: the new one starts the chain at 1 rather
    // than trying to continue from it.
    const pages = data.pages as Record<string, ReviewEntry[]>;
    expect(pages.other?.[0]?.seq).toBeUndefined();
    expect(pages[KEY]?.[0]).toMatchObject({ seq: 1, prev: null });
  });

  it("chains review entries across pages", async () => {
    const out = await tmp();
    const otherKey = "https://example.illinois.gov/contact";
    await appendReview(out, KEY, entry("issue"));
    await appendReview(out, otherKey, entry("reviewed"));
    await appendReview(out, KEY, entry("fixed"));

    // Read back from disk: the chain must hold for what's actually written, not just in memory.
    const reviews = await readReviews(out);
    const a = reviews.pages[KEY]!;
    const b = reviews.pages[otherKey]!;
    expect(a.map((e) => e.seq)).toEqual([1, 3]);
    expect(b.map((e) => e.seq)).toEqual([2]);
    expect(a[0]?.prev).toBeNull();
    expect(b[0]?.prev).toBe(a[0]?.seal);
    expect(a[1]?.prev).toBe(b[0]?.seal);
    for (const written of [a[0]!, b[0]!, a[1]!]) {
      expect(written.seal).toBe(sealOf(written));
    }
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

describe("addReview", () => {
  it("returns the entry as reviews.json holds it: sealed and chained", async () => {
    const dir = await tmp();
    const common = { out: path.join(dir, "home"), cwd: dir, env: {}, logger: createMemoryLogger() };
    const run = await runAudit({
      ...common,
      site: "http://127.0.0.1:4747",
      pages: fixture("pages.json"),
      replayFrom: fixture("replay-run"),
    });
    expect(run.outcome).toBe("completed");
    const review = (status: ReviewEntry["status"]) =>
      addReview({ ...common, page: "/flawed/", status, reviewer: "Pat Reviewer" });

    const first = await review("reviewed");
    const second = await review("issue");
    expect(first.entry).toMatchObject({ seq: 1, prev: null });
    expect(first.entry.seal).toMatch(/^[0-9a-f]{64}$/);
    expect(second.entry).toMatchObject({ seq: 2, prev: first.entry.seal });
    expect(second.entry.seal).toMatch(/^[0-9a-f]{64}$/);
    expect(second.history.at(-1)).toEqual(second.entry);
    const stored = (await readReviews(run.siteDir)).pages[second.key];
    expect(stored).toEqual([first.entry, second.entry]);
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

  it("finds the same name in the same order, and nothing when there's none", () => {
    const base = { cwd: ".", configReviewer: "Config Name" };
    expect(
      findReviewer({ ...base, option: "Flag Name", env: {}, gitUserName: () => "Git Name" }),
    ).toEqual({ name: "Flag Name", source: "option" });
    expect(findReviewer({ ...base, env: {}, gitUserName: none })).toEqual({
      name: "Config Name",
      source: "config",
    });
    expect(
      findReviewer({
        cwd: ".",
        configReviewer: null,
        env: { VOICECAP_REVIEWER: " " },
        gitUserName: none,
      }),
    ).toBeNull();
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
