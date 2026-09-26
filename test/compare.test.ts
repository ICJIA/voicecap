import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compareRuns, environmentDifferences, resolveCompareBase } from "../src/report/index.js";
import { liveCompareDir, runDir } from "../src/run/paths.js";
import { UsageError } from "../src/util/errors.js";
import { environment, findPage, tempOutDir, writeSyntheticRun } from "./helpers/report-data.js";

async function twoRuns(outDir: string) {
  const base = await writeSyntheticRun(outDir, {
    id: "2026-09-20_0930",
    createdAt: "2026-09-20T09:30:00-05:00",
    pages: [
      { path: "/" },
      {
        path: "/changed",
        lines: { read: ["heading, level 1, Changed", "Old line", "Footer", "Footer", "Footer"] },
      },
      { path: "/gone" },
      { path: "/later-failed" },
    ],
  });
  const run = await writeSyntheticRun(outDir, {
    id: "2026-09-26_1405",
    createdAt: "2026-09-26T14:05:00-05:00",
    pages: [
      { path: "/" },
      {
        path: "/changed",
        lines: { read: ["heading, level 1, Changed", "New line", "Footer", "Footer", "Footer"] },
      },
      { path: "/new" },
      { path: "/later-failed", status: "failed", errors: ["timeout"] },
    ],
  });
  return { base, run };
}

describe("compareRuns", () => {
  it("marks changed pages and writes diffs of the step lines only", async () => {
    const outDir = await tempOutDir();
    const { base, run } = await twoRuns(outDir);
    const diffDir = liveCompareDir(outDir, base.id, run.id);
    const result = await compareRuns({ outDir, base, run, diffDir });

    expect(result.base).toBe(base.id);
    expect(result.run).toBe(run.id);
    expect(result.unchanged).toBe(1);
    expect(result.changed.map((page) => page.key)).toEqual([findPage(run, "/changed").key]);
    expect(result.changed[0]!.passes.map((pass) => pass.pass)).toEqual(["read"]);
    expect(result.onlyInBase.map((page) => page.url)).toEqual([findPage(base, "/gone").url]);
    expect(result.onlyInRun.map((page) => page.url)).toEqual([findPage(run, "/new").url]);
    expect(result.notCompared).toEqual([
      expect.objectContaining({
        url: findPage(run, "/later-failed").url,
        reason: `failed in run ${run.id}`,
      }),
    ]);
    expect(result.environmentDifferences).toEqual([]);

    const diffFile = result.changed[0]!.passes[0]!.diffFile;
    expect(diffFile).toBe(path.join(diffDir, findPage(run, "/changed").slug, "read.diff.txt"));
    const diff = await readFile(diffFile, "utf8");
    expect(diff).toContain(`Page: ${findPage(run, "/changed").url}`);
    expect(diff).toContain(`Base run: ${base.id}`);
    expect(diff).toContain(`--- ${base.id}/pages/`);
    expect(diff).toContain(`+++ ${run.id}/pages/`);
    expect(diff).toContain("\n-Old line\n");
    expect(diff).toContain("\n+New line\n");
    expect(diff).toContain("\n heading, level 1, Changed\n");
    // Header blocks (which differ in every run) are never diffed.
    expect(diff).not.toContain("# voicecap transcript");
    expect(diff).not.toContain("Captured:");
  });

  it("treats a pass run in only one of the runs as changed", async () => {
    const outDir = await tempOutDir();
    const base = await writeSyntheticRun(outDir, {
      id: "2026-09-20_0930",
      createdAt: "2026-09-20T09:30:00-05:00",
      passes: ["read"],
      pages: [{ path: "/" }],
    });
    const run = await writeSyntheticRun(outDir, {
      id: "2026-09-26_1405",
      createdAt: "2026-09-26T14:05:00-05:00",
      passes: ["read", "tab"],
      pages: [{ path: "/" }],
    });
    const result = await compareRuns({
      outDir,
      base,
      run,
      diffDir: liveCompareDir(outDir, base.id, run.id),
    });
    expect(result.changed[0]!.passes.map((pass) => pass.pass)).toEqual(["tab"]);
    const diff = await readFile(result.changed[0]!.passes[0]!.diffFile, "utf8");
    expect(diff).toContain(`The tab pass wasn't run in run ${base.id}.`);
    expect(diff).toContain("+Skip to main content, link");
  });

  it("refuses to write diffs into a completed run's folder", async () => {
    const outDir = await tempOutDir();
    const { base, run } = await twoRuns(outDir);
    await expect(
      compareRuns({
        outDir,
        base,
        run,
        diffDir: path.join(runDir(outDir, run.id), "compare", base.id),
      }),
    ).rejects.toThrow(/completed; its folder is never modified/);
  });

  it("refuses to compare a run with itself", async () => {
    const outDir = await tempOutDir();
    const { run } = await twoRuns(outDir);
    await expect(
      compareRuns({ outDir, base: run, run, diffDir: path.join(outDir, "compare", "x") }),
    ).rejects.toThrow(UsageError);
  });
});

describe("environmentDifferences", () => {
  it("names each tooling difference between the runs", async () => {
    const outDir = await tempOutDir();
    const base = await writeSyntheticRun(outDir, { id: "a", pages: [{ path: "/" }] });
    const run = await writeSyntheticRun(outDir, {
      id: "b",
      pages: [{ path: "/" }],
      environment: {
        screenReader: { name: "NVDA", version: "2026.3", build: "0.2.2-2026.3", language: "en" },
        browser: { name: "Chrome", version: "142.0.0.0" },
        voicecap: { version: "0.2.0", configSha256: "e".repeat(64) },
        capture: "initial",
        screenReaderSettings: {
          ...environment().screenReaderSettings,
          speech: { symbolLevel: 100, rate: 60 },
        },
      },
    });
    const differences = environmentDifferences(base, run);
    expect(differences).toEqual([
      "Screen reader differs: NVDA 2026.2 (build 0.2.1-2026.2) → NVDA 2026.3 (build 0.2.2-2026.3) (run a → run b).",
      "Browser differs: Chrome 141.0.7390.55 → Chrome 142.0.0.0 (run a → run b).",
      "voicecap differs: 0.1.0 → 0.2.0 (run a → run b).",
      "Capture mode differs: complete → initial (run a → run b).",
      "Screen reader settings differ: speech.rate 50 → 60 (run a → run b).",
    ]);
  });

  it("notes a driver change and a run whose environment changed while resuming", async () => {
    const outDir = await tempOutDir();
    const base = await writeSyntheticRun(outDir, { id: "a", pages: [{ path: "/" }] });
    const run = await writeSyntheticRun(outDir, {
      id: "b",
      replayed: true,
      pages: [{ path: "/" }],
      resumedWith: [{ driver: { name: "replay", version: "0.1.1" } }],
    });
    const differences = environmentDifferences(base, run);
    expect(differences[0]).toBe(
      "The environment changed during run b (it was resumed with different tooling): Driver differs: replay 0.1.0 → replay 0.1.1.",
    );
    expect(differences[1]).toBe("Driver differs: guidepup 0.34.0 → replay 0.1.1 (run a → run b).");
  });

  it("is empty when the tooling matches", async () => {
    const outDir = await tempOutDir();
    const base = await writeSyntheticRun(outDir, { id: "a", pages: [{ path: "/" }] });
    const run = await writeSyntheticRun(outDir, { id: "b", pages: [{ path: "/" }] });
    expect(environmentDifferences(base, run)).toEqual([]);
  });
});

describe("resolveCompareBase", () => {
  async function history(outDir: string) {
    const older = await writeSyntheticRun(outDir, {
      id: "2026-09-18_0900",
      createdAt: "2026-09-18T09:00:00-05:00",
      pages: [{ path: "/" }],
    });
    const previous = await writeSyntheticRun(outDir, {
      id: "2026-09-20_0930",
      createdAt: "2026-09-20T09:30:00-05:00",
      pages: [{ path: "/" }],
    });
    await writeSyntheticRun(outDir, {
      id: "2026-09-22_0800",
      createdAt: "2026-09-22T08:00:00-05:00",
      source: { kind: "sitemap", url: "https://example.illinois.gov/sitemap.xml" },
      pages: [{ path: "/" }],
    });
    await writeSyntheticRun(outDir, {
      id: "2026-09-24_0800",
      createdAt: "2026-09-24T08:00:00-05:00",
      status: "incomplete",
      pages: [{ path: "/" }],
    });
    const run = await writeSyntheticRun(outDir, {
      id: "2026-09-26_1405",
      createdAt: "2026-09-26T14:05:00-05:00",
      status: "incomplete",
      pages: [{ path: "/" }],
    });
    return { older, previous, run };
  }

  it("resolves previous to the latest earlier completed run with the same page source", async () => {
    const outDir = await tempOutDir();
    const { previous, run } = await history(outDir);
    expect((await resolveCompareBase(outDir, run, "previous")).id).toBe(previous.id);
  });

  it("matches sitemap runs by sitemap URL", async () => {
    const outDir = await tempOutDir();
    await history(outDir);
    const sitemapRun = await writeSyntheticRun(outDir, {
      id: "2026-09-27_0800",
      createdAt: "2026-09-27T08:00:00-05:00",
      source: { kind: "sitemap", url: "https://example.illinois.gov/sitemap.xml" },
      pages: [{ path: "/" }],
    });
    expect((await resolveCompareBase(outDir, sitemapRun, "previous")).id).toBe("2026-09-22_0800");
  });

  it("accepts a completed run id and rejects incomplete, missing, or the same run", async () => {
    const outDir = await tempOutDir();
    const { older, run } = await history(outDir);
    expect((await resolveCompareBase(outDir, run, older.id)).id).toBe(older.id);
    await expect(resolveCompareBase(outDir, run, "2026-09-24_0800")).rejects.toThrow(/incomplete/);
    await expect(resolveCompareBase(outDir, run, "nope")).rejects.toThrow(UsageError);
    await expect(resolveCompareBase(outDir, run, run.id)).rejects.toThrow(/itself/);
  });

  it("explains when there is no earlier run to compare with", async () => {
    const outDir = await tempOutDir();
    const run = await writeSyntheticRun(outDir, { id: "2026-09-26_1405", pages: [{ path: "/" }] });
    await expect(resolveCompareBase(outDir, run, "previous")).rejects.toThrow(
      /No earlier completed run with the same page source \(page list pages\.csv\)/,
    );
  });
});
