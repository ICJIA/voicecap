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
