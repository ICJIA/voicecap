import { describe, expect, it } from "vitest";

import type { RunJson, RunSettings } from "../src/model.js";
import { chooseRun, describeDifferences, settingsHash } from "../src/run/resume.js";

const settings: RunSettings = {
  site: "https://example.illinois.gov",
  source: { kind: "pages", file: "pages.csv", sha256: "a".repeat(64) },
  passes: ["read", "headings", "tab"],
  include: [],
  exclude: [],
  limit: null,
  driver: "guidepup",
  replayFrom: null,
  capture: "complete",
  stepCaps: { read: 400, headings: 200, tab: 300 },
  nvdaSettings: {},
  browser: { channel: "chrome", fallbackToChromium: true },
};

function run(
  id: string,
  createdAt: string,
  status: RunJson["status"],
  runSettings = settings,
): RunJson {
  return {
    schemaVersion: 1,
    id,
    name: null,
    status,
    createdAt,
    completedAt: status === "completed" ? createdAt : null,
    site: runSettings.site,
    settings: runSettings,
    settingsHash: settingsHash(runSettings),
    configSha256: "c",
    flagRulesSha256: "f",
    replayed: false,
    source: {
      kind: "pages",
      listed: 2,
      duplicates: 0,
      invalid: [],
      excludedByFilter: 0,
      excludedByLimit: 0,
      warnings: [],
    },
    compareTo: null,
    sessions: [],
    skipped: [],
    pages: [
      {
        url: "https://example.illinois.gov/",
        key: "https://example.illinois.gov/",
        slug: "home",
        status: "done",
        attempts: 1,
        passes: {},
        files: {},
        flags: [],
        errors: [],
      },
      {
        url: "https://example.illinois.gov/a",
        key: "https://example.illinois.gov/a",
        slug: "a-1",
        status: "pending",
        attempts: 0,
        passes: {},
        files: {},
        flags: [],
        errors: [],
      },
    ],
  };
}

describe("chooseRun", () => {
  it("resumes the most recent incomplete run with matching settings", () => {
    const runs = [
      run("2026-09-20_0900", "2026-09-20T09:00:00-05:00", "incomplete"),
      run("2026-09-21_0900", "2026-09-21T09:00:00-05:00", "incomplete"),
    ];
    const decision = chooseRun(runs, settings, false);
    expect(decision.resume?.id).toBe("2026-09-21_0900");
    expect(decision.message).toBe("Resuming 2026-09-21_0900: 1 of 2 pages already done.");
  });

  it("starts a new run when nothing is incomplete", () => {
    const decision = chooseRun(
      [run("r1", "2026-09-20T09:00:00-05:00", "completed")],
      settings,
      false,
    );
    expect(decision).toEqual({ resume: null, message: null });
  });

  it("doesn't resume a run superseded by a later completed run with the same settings", () => {
    const runs = [
      run("old", "2026-09-20T09:00:00-05:00", "incomplete"),
      run("newer", "2026-09-21T09:00:00-05:00", "completed"),
    ];
    expect(chooseRun(runs, settings, false).resume).toBeNull();
  });

  it("explains why an incomplete run with different settings isn't resumed", () => {
    const other = { ...settings, passes: ["read" as const], limit: 10 };
    const decision = chooseRun(
      [run("r1", "2026-09-20T09:00:00-05:00", "incomplete", other)],
      settings,
      false,
    );
    expect(decision.resume).toBeNull();
    expect(decision.message).toBe(
      "Starting a new run. Not resuming r1 because its settings differ: passes: read → read,headings,tab; limit: 10 → none.",
    );
  });

  it("names a changed page list by file and hash", () => {
    const edited = {
      ...settings,
      source: { kind: "pages" as const, file: "pages.csv", sha256: "b".repeat(64) },
    };
    expect(describeDifferences(edited, settings)[0]).toMatch(
      /^source: page list pages.csv \(sha256 bbbbbbbbbbbb…\) → page list pages.csv \(sha256 aaaaaaaaaaaa…\)$/,
    );
  });

  it("names a changed walkthrough by its file, run, and hash, as it names a page list", () => {
    const walkthrough = (sha256: string) => ({
      ...settings,
      source: {
        kind: "walkthrough" as const,
        file: "w.json",
        sha256,
        run: "2026-09-29_1402",
        from: "sitemap" as const,
      },
    });
    const edited = walkthrough("b".repeat(64));
    const repeat = walkthrough("a".repeat(64));

    expect(describeDifferences(edited, repeat)[0]).toBe(
      "source: walkthrough w.json from run 2026-09-29_1402 (sha256 bbbbbbbbbbbb…) → walkthrough w.json from run 2026-09-29_1402 (sha256 aaaaaaaaaaaa…)",
    );
    expect(describeDifferences(settings, repeat)[0]).toBe(
      "source: page list pages.csv (sha256 aaaaaaaaaaaa…) → walkthrough w.json from run 2026-09-29_1402 (sha256 aaaaaaaaaaaa…)",
    );
  });

  it("names a changed sitemap by its address", () => {
    const sitemap = {
      ...settings,
      source: { kind: "sitemap" as const, url: "https://example.illinois.gov/sitemap.xml" },
    };

    expect(describeDifferences(sitemap, settings)[0]).toBe(
      "source: sitemap https://example.illinois.gov/sitemap.xml → page list pages.csv (sha256 aaaaaaaaaaaa…)",
    );
  });

  it("with --fresh, starts a new run and says the incomplete one is left alone", () => {
    const decision = chooseRun(
      [run("r1", "2026-09-20T09:00:00-05:00", "incomplete")],
      settings,
      true,
    );
    expect(decision.resume).toBeNull();
    expect(decision.message).toMatch(
      /--fresh: starting a new run. The incomplete run r1 is left as it is./,
    );
  });

  it("explains a changed --page list with describePageUrls", () => {
    const pageA = "https://dvfr.illinois.gov/faq/";
    const pageB = "https://dvfr.illinois.gov/about/";
    const before = { ...settings, source: { kind: "urls" as const, urls: [pageA] } };
    const after = { ...settings, source: { kind: "urls" as const, urls: [pageA, pageB] } };
    const decision = chooseRun(
      [run("r1", "2026-09-20T09:00:00-05:00", "incomplete", before)],
      after,
      false,
    );
    expect(decision.resume).toBeNull();
    expect(decision.message).toContain(`page ${pageA}`);
    expect(decision.message).toContain(`2 pages (${pageA}, ${pageB})`);
  });

  it("identifies sitemap runs by URL only, so a changed sitemap still resumes", () => {
    const sitemap = {
      ...settings,
      source: { kind: "sitemap" as const, url: "https://example.illinois.gov/sitemap.xml" },
    };
    expect(settingsHash(sitemap)).toBe(settingsHash(structuredClone(sitemap)));
    expect(
      chooseRun([run("r1", "2026-09-20T09:00:00-05:00", "incomplete", sitemap)], sitemap, false)
        .resume?.id,
    ).toBe("r1");
  });
});

// `settings` above has no readiness: it's what voicecap 0.7.0 and earlier recorded. `recorded` is
// the same settings as the versions after record them. Their hashes differ, so a later version
// never resumes a run of 0.7.0's: a newer completed run is what supersedes it.
const readiness = { readySelector: null, settleMs: 500, networkIdleTimeoutMs: 15_000 };
const recorded: RunSettings = { ...settings, readiness };

describe("a run from before voicecap recorded the readiness settings", () => {
  const NOT_RESUMED =
    'Starting a new run. Not resuming old because its settings differ: readiness: not recorded → {"readySelector":null,"settleMs":500,"networkIdleTimeoutMs":15000}.';

  it("is superseded by a newer completed run whose settings are the same, with readiness", () => {
    const runs = [
      run("old", "2026-09-20T09:00:00-05:00", "incomplete"),
      run("newer", "2026-09-21T09:00:00-05:00", "completed", recorded),
    ];
    // Nothing to resume, and no note about the old run: the newer run has taken its place.
    expect(chooseRun(runs, recorded, false)).toEqual({ resume: null, message: null });
  });

  it("has its readiness described as not recorded, while no newer completed run supersedes it", () => {
    const runs = [run("old", "2026-09-20T09:00:00-05:00", "incomplete")];
    expect(chooseRun(runs, recorded, false)).toEqual({ resume: null, message: NOT_RESUMED });
  });

  it("isn't superseded by a newer completed run that differs in another setting too", () => {
    const runs = [
      run("old", "2026-09-20T09:00:00-05:00", "incomplete"),
      run("newer", "2026-09-21T09:00:00-05:00", "completed", { ...recorded, passes: ["read"] }),
    ];
    expect(chooseRun(runs, recorded, false)).toEqual({ resume: null, message: NOT_RESUMED });
  });
});

describe("a run that recorded the readiness settings", () => {
  it("isn't superseded by a newer completed run with other readiness settings", () => {
    const slower = { ...settings, readiness: { ...readiness, settleMs: 2000 } };
    const runs = [
      run("old", "2026-09-20T09:00:00-05:00", "incomplete", recorded),
      run("newer", "2026-09-21T09:00:00-05:00", "completed", slower),
    ];
    // Compared exactly as before: the readiness settings are among those that must be the same.
    expect(chooseRun(runs, slower, false)).toEqual({
      resume: null,
      message:
        'Starting a new run. Not resuming old because its settings differ: readiness: {"readySelector":null,"settleMs":500,"networkIdleTimeoutMs":15000} → {"readySelector":null,"settleMs":2000,"networkIdleTimeoutMs":15000}.',
    });
  });
});
