import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { makeAskListener } from "../src/cli/listener.js";
import { BROWSER_WINDOW, ForegroundError } from "../src/drivers/types.js";
import type { RunJson, TranscriptJson } from "../src/model.js";
import type {
  Check,
  CheckRunner,
  PlatformReadiness,
  PreflightResult,
  Problem,
} from "../src/readiness/model.js";
import { addReview } from "../src/reviews/review.js";
import { runAudit } from "../src/run/audit.js";
import { regenerateLiveReport } from "../src/run/live-report.js";
import {
  collectMachineRecord,
  nodeMachineFacts,
  type MachineProbe,
} from "../src/run/machine-record.js";
import {
  attemptsDir,
  pageDir,
  runCompareDir,
  runDir,
  runReportPath,
  siteFolder,
} from "../src/run/paths.js";
import { listRuns, readRunJson, writeRunJson } from "../src/run/store.js";
import { EnvironmentError, VoicecapError } from "../src/util/errors.js";
import { sealOf } from "../src/util/hash.js";
import { createMemoryLogger } from "../src/util/log.js";
import { verifyHome } from "../src/verify.js";
import {
  config,
  hangOnce,
  ISO_MS,
  MACHINE_PROBE,
  options,
  outDir,
  setup,
  SITE,
  sitePages,
} from "./helpers/run-site.js";
import { fakeSignals } from "./helpers/fake-signals.js";
import { ScriptedDriver } from "./helpers/scripted-driver.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const fixture = (...parts: string[]) => path.join(ROOT, "fixture", ...parts);

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

async function snapshotFolder(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (current: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files[path.relative(dir, full)] = sha256(await readFile(full));
    }
  };
  await walk(dir);
  return files;
}

describe("a complete run", () => {
  it("writes the documented layout with verifiable hashes", async () => {
    const dir = await setup();
    const driver = new ScriptedDriver(sitePages());
    const result = await runAudit(options(dir, driver));
    expect(result.outcome).toBe("completed");
    expect(result.exitCode).toBe(0);

    const out = outDir(dir);
    const runFolder = runDir(out, result.runId);
    expect(result.runId).toMatch(/^\d{4}-\d{2}-\d{2}_\d{4}$/);
    expect((await readFile(path.join(out, "latest.txt"), "utf8")).trim()).toBe(result.runId);
    expect(existsSync(path.join(out, "report.html"))).toBe(true);
    expect(existsSync(path.join(runFolder, "report.html"))).toBe(true);
    expect(await readFile(path.join(dir, "transcripts", ".gitattributes"), "utf8")).toContain(
      "* -text",
    );
    expect(existsSync(path.join(out, ".gitattributes"))).toBe(false);

    const run = await readRunJson(out, result.runId);
    expect(run.status).toBe("completed");
    expect(run.pages.map((p) => p.status)).toEqual(["done", "done", "done"]);
    expect(run.pages[0]?.slug).toBe("home");
    for (const page of run.pages) {
      for (const [file, hash] of Object.entries(page.files)) {
        const bytes = await readFile(path.join(runFolder, "pages", page.slug, file));
        expect(sha256(bytes), `${page.slug}/${file}`).toBe(hash.sha256);
        expect(bytes.length).toBe(hash.bytes);
      }
      expect(Object.keys(page.files).sort()).toEqual([
        "headings.json",
        "headings.txt",
        "read.json",
        "read.txt",
        "tab.json",
        "tab.txt",
      ]);
    }
    expect(run.sessions).toHaveLength(1);
    expect(run.sessions[0]).toMatchObject({ endReason: "completed", pagesDone: 3 });
    expect(run.sessions[0]?.environment?.driver.name).toBe("scripted");

    const txt = await readFile(path.join(runFolder, "pages", "home", "read.txt"), "utf8");
    expect(txt.startsWith("# voicecap transcript: read pass\n")).toBe(true);
    expect(txt).toContain("\n\n[to bottom] content info landmark, © 2026 Example Agency\n");
    expect(txt).not.toContain("\r");

    const resources = run.pages.find((p) => p.url.endsWith("/resources"));
    expect(resources?.flags.map((f) => f.rule)).toEqual(
      expect.arrayContaining(["generic-link-text", "unlabeled", "headings"]),
    );
    expect(driver.starts).toBe(1);
    expect(driver.stops).toBe(1);
  });

  it("records the readiness settings it waited with", async () => {
    const dir = await setup(["/"]);
    const readiness = { readySelector: "#app", settleMs: 250, networkIdleTimeoutMs: 4000 };
    const result = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { config: config({ readiness }) }),
    );
    expect(result.outcome).toBe("completed");

    const run = await readRunJson(outDir(dir), result.runId);
    expect(run.settings.readiness).toEqual({
      readySelector: "#app",
      settleMs: 250,
      networkIdleTimeoutMs: 4000,
    });
  });

  it("records each page's title, as the browser reported it", async () => {
    const dir = await setup(["/", "/about"]);
    const driver = new ScriptedDriver(
      sitePages({ home: { title: "Welcome | Example Agency" }, about: { title: "About us" } }),
    );
    const result = await runAudit(options(dir, driver));
    expect(result.run.pages.map((page) => page.title)).toEqual([
      "Welcome | Example Agency",
      "About us",
    ]);
  });

  it("records a page with no title as null", async () => {
    const dir = await setup(["/"]);
    const result = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    expect(result.run.pages[0]?.title).toBeNull();
  });

  it("takes a page's title from the first load of its last attempt", async () => {
    const dir = await setup(["/about"]);
    const driver = new ScriptedDriver(sitePages(), { hang: hangOnce("nextLine") });
    // Every load reports a new title: "Load 1", "Load 2", and so on.
    const openPage = driver.openPage.bind(driver);
    let loads = 0;
    driver.openPage = async (url) => ({ ...(await openPage(url)), title: `Load ${++loads}` });

    const result = await runAudit(options(dir, driver));
    // The first attempt times out in its read pass (load 1). The second loads the page for each of
    // its three passes (loads 2 to 4), and its first load gives the title.
    expect(loads).toBe(4);
    expect(result.run.pages[0]).toMatchObject({ status: "done", attempts: 2, title: "Load 2" });
  });

  it("skips non-HTML responses and redirects to another origin", async () => {
    const dir = await setup(["/", "/feed", "/contact"]);
    const driver = new ScriptedDriver([
      ...sitePages().slice(0, 1),
      { url: `${SITE}/feed`, contentType: "application/rss+xml" },
      { url: `${SITE}/contact`, finalUrl: "https://forms.example.com/contact" },
    ]);
    const result = await runAudit(options(dir, driver));
    expect(result.exitCode).toBe(0);
    const run = await readRunJson(outDir(dir), result.runId);
    expect(run.pages.map((p) => p.status)).toEqual(["done", "skipped", "skipped"]);
    expect(run.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "non-html-response",
          contentType: "application/rss+xml",
        }),
        expect.objectContaining({
          reason: "redirect-off-origin",
          finalUrl: "https://forms.example.com/contact",
        }),
      ]),
    );
  });

  it("records the title of a page it opened and then skipped or failed", async () => {
    const dir = await setup(["/", "/feed", "/contact", "/gone"]);
    const driver = new ScriptedDriver([
      ...sitePages().slice(0, 1),
      // As the real driver does, this reports no title for a response that isn't HTML.
      { url: `${SITE}/feed`, contentType: "application/rss+xml" },
      {
        url: `${SITE}/contact`,
        finalUrl: "https://forms.example.com/contact",
        title: "Contact us",
      },
      { url: `${SITE}/gone`, status: 404, title: "Page not found" },
    ]);
    const result = await runAudit(options(dir, driver));
    expect(result.run.pages.map((page) => [page.status, page.title])).toEqual([
      ["done", null],
      ["skipped", null],
      ["skipped", "Contact us"],
      ["failed", "Page not found"],
    ]);
  });
});

describe("--page", () => {
  it("runs the pages given with --page, and tells runs apart by them", async () => {
    const dir = await setup();
    const first = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { pages: null, pageUrls: [`${SITE}/about`] }),
    );
    expect(first.outcome).toBe("completed");
    expect(first.run.pages).toHaveLength(1);
    expect(first.run.settings.source).toEqual({ kind: "urls", urls: [`${SITE}/about`] });

    const same = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { pages: null, pageUrls: [`${SITE}/about`] }),
    );
    expect(same.run.settingsHash).toBe(first.run.settingsHash);

    const different = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), {
        pages: null,
        pageUrls: [`${SITE}/resources`],
      }),
    );
    expect(different.run.settingsHash).not.toBe(first.run.settingsHash);
  });
});

describe("a sitemap given by name", () => {
  /** Serves a sitemap at `at` listing sitePages()'s pages, and 404s everything else. */
  function sitemapAt(at: string): typeof fetch {
    const urlset =
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      ["/", "/about", "/resources"].map((p) => `<url><loc>${SITE}${p}</loc></url>`).join("") +
      "</urlset>";
    return (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return Promise.resolve(
        url === at ? new Response(urlset) : new Response("Not found", { status: 404 }),
      );
    };
  }

  /** A driver for sitePages() that interrupts the run as it opens the page whose URL ends so. */
  function interruptingAt(ending: string, controller: AbortController): ScriptedDriver {
    const driver = new ScriptedDriver(sitePages());
    const openPage = driver.openPage.bind(driver);
    driver.openPage = (url) => {
      if (url.endsWith(ending)) controller.abort();
      return openPage(url);
    };
    return driver;
  }

  it("knows the run by the sitemap's full URL, so its name or its URL resumes it", async () => {
    const dir = await setup();
    const fetch = sitemapAt(`${SITE}/sitemap.xml`);
    const sitemapRun = (sitemap: string, driver: ScriptedDriver, extra = {}) =>
      runAudit(options(dir, driver, { pages: null, sitemap, fetch, ...extra }));

    const first = new AbortController();
    const byName = await sitemapRun("sitemap.xml", interruptingAt("/about", first), {
      signal: first.signal,
    });
    expect(byName.outcome).toBe("interrupted");
    expect(byName.run.settings.source).toEqual({ kind: "sitemap", url: `${SITE}/sitemap.xml` });

    // The full URL resumes the run the name started.
    const second = new AbortController();
    const logger = createMemoryLogger();
    const byUrl = await sitemapRun(`${SITE}/sitemap.xml`, interruptingAt("/resources", second), {
      signal: second.signal,
      logger,
    });
    expect(byUrl.runId).toBe(byName.runId);
    expect(logger.text()).toContain(`Resuming ${byName.runId}: 1 of 3 pages already done.`);
    expect(byUrl.outcome).toBe("interrupted");

    // And the same name again, or the path, resumes it too.
    const again = await sitemapRun("/sitemap.xml", new ScriptedDriver(sitePages()));
    expect(again.runId).toBe(byName.runId);
    expect(again.outcome).toBe("completed");
  });

  it("reads a sitemap's name from the site's root, even when --site has a path", async () => {
    const dir = await setup();
    const blogRun = (sitemap: string, at: string) =>
      runAudit(
        options(dir, new ScriptedDriver(sitePages()), {
          site: `${SITE}/blog/`,
          pages: null,
          sitemap,
          fetch: sitemapAt(at),
        }),
      );

    const atRoot = await blogRun("sitemap.xml", `${SITE}/sitemap.xml`);
    expect(atRoot.outcome).toBe("completed");
    expect(atRoot.run.settings.site).toBe(SITE);
    expect(atRoot.run.settings.source).toEqual({ kind: "sitemap", url: `${SITE}/sitemap.xml` });
    expect(atRoot.siteDir).toBe(outDir(dir));

    // A subsite's sitemap is given as its path.
    const subsite = await blogRun("/blog/sitemap.xml", `${SITE}/blog/sitemap.xml`);
    expect(subsite.outcome).toBe("completed");
    expect(subsite.run.settings.source).toEqual({
      kind: "sitemap",
      url: `${SITE}/blog/sitemap.xml`,
    });
  });
});

describe("the home", () => {
  it("puts a run in the site's folder in the home", async () => {
    const dir = await setup();
    const home = path.join(dir, "records");
    const result = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { out: "records" }),
    );
    expect(result.siteDir).toBe(path.join(home, siteFolder(SITE)));
    expect(path.isAbsolute(result.runDir)).toBe(true);
    expect(existsSync(path.join(result.runDir, "run.json"))).toBe(true);
  });

  it("takes the home from VOICECAP_TRANSCRIPTS when there's no --out", async () => {
    const dir = await setup();
    const home = path.join(dir, "from-env");
    const result = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { env: { VOICECAP_TRANSCRIPTS: home } }),
    );
    expect(result.siteDir).toBe(path.join(home, siteFolder(SITE)));
    expect(existsSync(path.join(result.runDir, "run.json"))).toBe(true);
    expect(existsSync(path.join(dir, "transcripts"))).toBe(false);
  });

  it("works in a home whose path has a space and an accent", async () => {
    const dir = await setup();
    const home = path.join(dir, "Jané Doe", "voicecap-transcripts");
    const result = await runAudit(options(dir, new ScriptedDriver(sitePages()), { out: home }));
    expect(result).toMatchObject({ outcome: "completed", exitCode: 0 });
    const run = await readRunJson(path.join(home, siteFolder(SITE)), result.runId);
    expect(run.status).toBe("completed");
  });
});

describe("voicecap 0.2.0's layout", () => {
  it("leaves 0.2.0-layout folders alone, and says so once", async () => {
    const dir = await setup();
    const home = path.join(dir, "transcripts");
    const oldRun = path.join(home, "runs", "2026-09-26_1405", "run.json");
    const oldManual = path.join(home, "manual", "home", "2026-09-26_1405.json");
    await mkdir(path.dirname(oldRun), { recursive: true });
    await writeFile(oldRun, "old run\n");
    await mkdir(path.dirname(oldManual), { recursive: true });
    await writeFile(oldManual, "old manual\n");

    const logger = createMemoryLogger();
    const result = await runAudit({ ...options(dir, new ScriptedDriver(sitePages())), logger });
    expect(result.outcome).toBe("completed");

    // Neither 0.2.0-layout file was read or moved.
    expect(await readFile(oldRun, "utf8")).toBe("old run\n");
    expect(await readFile(oldManual, "utf8")).toBe("old manual\n");

    const notes = logger.entries.filter((entry) => entry.message.includes("read any more"));
    expect(notes).toHaveLength(1);
    expect(notes[0]?.message).toBe(
      `${home} has voicecap 0.2.0's runs/ and manual/ folders. They aren't read any more, ` +
        "and they're left as they are.",
    );
  });
});

describe("dated run folders", () => {
  it("puts a run in <site>/<date>/<time>/", async () => {
    const dir = await setup();
    const result = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { now: () => new Date(2026, 8, 27, 11, 2) }),
    );
    expect(result.runDir).toBe(path.join(outDir(dir), "2026-09-27", "1102"));
  });

  it("gives a second run in the same minute its own folder, and resumes the unfinished one", async () => {
    const dir = await setup();
    const now = () => new Date(2026, 8, 27, 11, 2);

    const first = await runAudit(options(dir, new ScriptedDriver(sitePages()), { now }));
    expect(first).toMatchObject({ runId: "2026-09-27_1102", outcome: "completed" });
    expect(first.runDir).toBe(path.join(outDir(dir), "2026-09-27", "1102"));

    const controller = new AbortController();
    const second = new ScriptedDriver(sitePages());
    const openPage = second.openPage.bind(second);
    second.openPage = (url) => {
      if (url.endsWith("/about")) controller.abort();
      return openPage(url);
    };
    const interrupted = await runAudit(options(dir, second, { now, signal: controller.signal }));
    expect(interrupted).toMatchObject({ runId: "2026-09-27_1102-2", outcome: "interrupted" });
    expect(interrupted.runDir).toBe(path.join(outDir(dir), "2026-09-27", "1102-2"));

    const third = await runAudit(options(dir, new ScriptedDriver(sitePages()), { now }));
    expect(third).toMatchObject({ runId: "2026-09-27_1102-2", outcome: "completed" });
  });

  it("keeps a run that passes midnight in the folder of the day it started", async () => {
    const dir = await setup();
    let calls = 0;
    const now = () => (calls++ === 0 ? new Date(2026, 8, 27, 23, 59) : new Date(2026, 8, 28, 0, 1));
    const result = await runAudit(options(dir, new ScriptedDriver(sitePages()), { now }));
    expect(result).toMatchObject({ runId: "2026-09-27_2359", outcome: "completed" });
    expect(result.runDir).toBe(path.join(outDir(dir), "2026-09-27", "2359"));
    const run = await readRunJson(outDir(dir), result.runId);
    for (const page of run.pages) {
      for (const file of Object.keys(page.files)) {
        expect(existsSync(path.join(result.runDir, "pages", page.slug, file))).toBe(true);
      }
    }
  });

  it("finds the previous run of the same site for --compare previous", async () => {
    const dir = await setup();
    const first = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { now: () => new Date(2026, 8, 26, 9, 0) }),
    );
    const second = await runAudit({
      ...options(dir, new ScriptedDriver(sitePages()), { now: () => new Date(2026, 8, 27, 9, 0) }),
      compare: "previous",
    });
    expect(second.run.compareTo).toBe(first.runId);
  });
});

describe("nothing to transcribe", () => {
  it("stops with a usage error, before creating a run or starting the driver", async () => {
    const dir = await setup(["https://www.example.com/elsewhere", "/files/report.pdf"]);
    const driver = new ScriptedDriver(sitePages());
    await expect(runAudit(options(dir, driver))).rejects.toThrow(
      /No pages to transcribe \(2 listed, 2 skipped/,
    );
    await expect(
      runAudit({ ...options(dir, driver), pages: "pages.json", include: ["nwes/*"] }),
    ).rejects.toThrow(/No pages to transcribe/);
    expect(driver.starts).toBe(0);
    expect(existsSync(path.join(outDir(dir), "latest.txt"))).toBe(false);
    // Left empty, so review, manual add, and report don't take it for a site (chooseSiteDir).
    expect(await readdir(outDir(dir))).toEqual([]);
  });
});

describe("failures", () => {
  it("records a failing page, keeps going, and exits 3", async () => {
    const dir = await setup();
    const driver = new ScriptedDriver(
      sitePages({
        about: { openError: new ForegroundError("The browser couldn't be brought to the front") },
      }),
    );
    const result = await runAudit(options(dir, driver));
    expect(result.exitCode).toBe(3);
    const run = await readRunJson(outDir(dir), result.runId);
    expect(run.pages.map((p) => p.status)).toEqual(["done", "failed", "done"]);
    expect(run.pages[1]).toMatchObject({ failure: "environment", attempts: 5 });
    expect(run.pages[1]?.errors.join(" ")).toMatch(/brought to the front/);
    // The first start, one before each of the 4 retries, and one after the failed page.
    expect(driver.starts).toBe(6);
  });

  it("tries a page again when the browser loses the foreground, with NVDA and the browser started fresh", async () => {
    const dir = await setup(["/about"]);
    const lost = new ForegroundError("The browser lost the foreground to another window");
    const driver = new ScriptedDriver(sitePages({ about: { openError: lost, openErrorTimes: 2 } }));
    const result = await runAudit(options(dir, driver));
    expect(result.exitCode).toBe(0);
    const page = (await readRunJson(outDir(dir), result.runId)).pages[0];
    expect(page).toMatchObject({ status: "done", attempts: 3 });
    expect(page?.errors).toEqual([
      expect.stringMatching(/^Attempt 1 failed \(.*lost the foreground.*\); retrying\.$/),
      expect.stringMatching(/^Attempt 2 failed \(.*lost the foreground.*\); retrying\.$/),
    ]);
    expect(driver.starts).toBe(3); // the first start, then one before each retry
  });

  it("gives a page five attempts in all, then records it as failed with every attempt's reason", async () => {
    const dir = await setup(["/about"]);
    const lost = new ForegroundError("The browser lost the foreground to another window");
    const driver = new ScriptedDriver(sitePages({ about: { openError: lost } }));
    const result = await runAudit(options(dir, driver));
    expect(result.exitCode).toBe(3);
    const page = (await readRunJson(outDir(dir), result.runId)).pages[0];
    expect(page).toMatchObject({ status: "failed", failure: "environment", attempts: 5 });
    expect(page?.errors.filter((error) => /^Attempt [1-4] failed/.test(error))).toHaveLength(4);
    expect(page?.errors.at(-1)).toMatch(/^Could not open the page .*lost the foreground/);
    expect(driver.starts).toBe(5);
  });

  it("tries a page again when a pass fails midway", async () => {
    const dir = await setup(["/about"]);
    let failed = false;
    const driver = new ScriptedDriver(sitePages(), {
      fail: (command) => {
        if (command !== "nextHeading" || failed) return null;
        failed = true;
        return new ForegroundError("The browser lost the foreground to another window");
      },
    });
    const result = await runAudit(options(dir, driver));
    expect(result.exitCode).toBe(0);
    const page = (await readRunJson(outDir(dir), result.runId)).pages[0];
    expect(page).toMatchObject({ status: "done", attempts: 2 });
    expect(page?.errors[0]).toMatch(/^Attempt 1 failed \(headings pass: .*lost the foreground/);
  });

  it("takes the number of attempts from pageAttempts", async () => {
    const dir = await setup(["/about"]);
    const broken = new Error("NVDA is not responding");
    const driver = new ScriptedDriver(sitePages({ about: { openError: broken } }));
    const result = await runAudit({ ...options(dir, driver), config: config({ pageAttempts: 2 }) });
    const page = (await readRunJson(outDir(dir), result.runId)).pages[0];
    expect(page).toMatchObject({ status: "failed", attempts: 2 });
  });

  it("retries a page once after a timeout, restarting the driver first", async () => {
    const dir = await setup(["/about"]);
    const driver = new ScriptedDriver(sitePages(), { hang: hangOnce("nextLine") });
    const result = await runAudit(options(dir, driver));
    expect(result.exitCode).toBe(0);
    const page = (await readRunJson(outDir(dir), result.runId)).pages[0];
    expect(page).toMatchObject({ status: "done", attempts: 2 });
    expect(page?.errors[0]).toMatch(/Attempt 1 failed/);
    expect(driver.starts).toBe(2);
  });

  it("keeps the first attempt at a page that timed out, and reports only the final one", async () => {
    const dir = await setup(["/about"]);
    const driver = new ScriptedDriver(sitePages(), { hang: hangOnce("nextLine") });
    const result = await runAudit(options(dir, driver));
    expect(result.exitCode).toBe(0);
    const out = outDir(dir);
    const run = await readRunJson(out, result.runId);
    const page = run.pages[0]!;
    expect(page).toMatchObject({ status: "done", attempts: 2 });

    // The timed-out first attempt's partial transcript is kept, not deleted.
    const kept = path.join(attemptsDir(out, result.runId, page.slug), "1");
    expect(await readdir(kept)).toEqual(["read.json", "read.txt"]);

    // The page record only names files from the final attempt, in pages/<slug>/.
    const runFolder = runDir(out, result.runId);
    expect(Object.keys(page.files).sort()).toEqual([
      "headings.json",
      "headings.txt",
      "read.json",
      "read.txt",
      "tab.json",
      "tab.txt",
    ]);
    for (const [file, hash] of Object.entries(page.files)) {
      const bytes = await readFile(path.join(runFolder, "pages", page.slug, file));
      expect(sha256(bytes), file).toBe(hash.sha256);
    }
  });

  it("records the page as failed when every retry times out too", async () => {
    const dir = await setup(["/about", "/"]);
    const driver = new ScriptedDriver(sitePages(), {
      hang: (command, url) => command === "nextLine" && url.endsWith("/about"),
    });
    const result = await runAudit(options(dir, driver));
    expect(result.exitCode).toBe(3);
    const run = await readRunJson(outDir(dir), result.runId);
    expect(run.pages[0]).toMatchObject({ status: "failed", attempts: 5 });
    expect(run.pages[0]?.passes.read?.stopReason).toBe("timeout");
    expect(run.pages[1]?.status).toBe("done");
  });

  it("stops after too many failed pages in a row, leaving the run resumable (exit 2)", async () => {
    const dir = await setup();
    const broken = new Error("NVDA is not responding");
    const driver = new ScriptedDriver(
      sitePages({
        home: { openError: broken },
        about: { openError: broken },
        resources: { openError: broken },
      }),
    );
    const result = await runAudit({
      ...options(dir, driver),
      config: config({ maxConsecutiveFailures: 2 }),
    });
    expect(result).toMatchObject({ outcome: "stopped", exitCode: 2 });
    const run = await readRunJson(outDir(dir), result.runId);
    expect(run.status).toBe("incomplete");
    expect(run.sessions[0]?.endReason).toBe("environment-failure");
    expect(run.pages.map((p) => p.status)).toEqual(["failed", "failed", "pending"]);
  });

  it("records a page that never loaded with a null title, and leaves a pending page without one", async () => {
    const dir = await setup();
    const broken = new Error("NVDA is not responding");
    const driver = new ScriptedDriver(
      sitePages({
        home: { openError: broken },
        about: { openError: broken },
        resources: { openError: broken },
      }),
    );
    const result = await runAudit({
      ...options(dir, driver),
      config: config({ maxConsecutiveFailures: 2 }),
    });
    const run = await readRunJson(outDir(dir), result.runId);
    expect(run.pages.map((p) => p.status)).toEqual(["failed", "failed", "pending"]);
    expect(run.pages[0]?.title).toBeNull();
    expect(run.pages[1]?.title).toBeNull();
    expect(run.pages[2]).not.toHaveProperty("title");
  });

  it("treats HTTP errors as page problems: five 404s in a row don't stop the run", async () => {
    const missing = ["/gone-1", "/gone-2", "/gone-3", "/gone-4", "/gone-5"];
    const dir = await setup(["/", ...missing, "/about"]);
    const driver = new ScriptedDriver([
      ...sitePages(),
      ...missing.map((p) => ({ url: `${SITE}${p}`, status: 404 })),
    ]);
    const result = await runAudit(options(dir, driver));
    expect(result).toMatchObject({ outcome: "completed", exitCode: 3, failedPages: 5 });
    const run = await readRunJson(outDir(dir), result.runId);
    expect(run.pages.at(-1)?.status).toBe("done");
    expect(run.pages.filter((p) => p.failure === "page")).toHaveLength(5);
    // The site answered: trying again can't help, so each 404 gets a single attempt.
    expect(run.pages.filter((p) => p.failure === "page").map((p) => p.attempts)).toEqual([
      1, 1, 1, 1, 1,
    ]);
    expect(driver.starts).toBe(1); // no restarts: the browser and screen reader were fine
  });

  it("resumes a stopped run past the pages that failed, and can still complete", async () => {
    const dir = await setup(["/", "/about", "/resources"]);
    const broken = new Error("NVDA is not responding");
    const failing = () =>
      new ScriptedDriver(sitePages({ home: { openError: broken }, about: { openError: broken } }));
    const stopped = await runAudit({
      ...options(dir, failing()),
      config: config({ maxConsecutiveFailures: 2 }),
    });
    expect(stopped.outcome).toBe("stopped");

    // Still broken for the same two pages: the pending page goes first, the retries don't count.
    const second = failing();
    const resumed = await runAudit({
      ...options(dir, second),
      config: config({ maxConsecutiveFailures: 2 }),
    });
    expect(resumed).toMatchObject({ runId: stopped.runId, outcome: "completed", exitCode: 3 });
    expect(second.opened[0]).toBe(`${SITE}/resources`);
    const run = await readRunJson(outDir(dir), resumed.runId);
    expect(run.pages.map((p) => p.status)).toEqual(["failed", "failed", "done"]);
    expect(run.pages[0]?.failure).toBe("environment");
  });

  it("restarts NVDA and the browser every N pages", async () => {
    const dir = await setup();
    const driver = new ScriptedDriver(sitePages());
    await runAudit({ ...options(dir, driver), config: config({ restartEvery: 1 }) });
    expect(driver.starts).toBe(3);
    // Only the final stop gives back what the run took, such as the person's own NVDA.
    expect(driver.stopOptions).toEqual([{ restarting: true }, { restarting: true }, undefined]);
  });
});

describe("failed attempts", () => {
  it("records a failed attempt: its cause, pass, step, command, and times", async () => {
    const dir = await setup(["/"]);
    let lines = 0;
    const driver = new ScriptedDriver(sitePages(), {
      fail: (command) =>
        command === "nextLine" && ++lines === 1
          ? new ForegroundError("The browser lost the foreground to another window.")
          : null,
    });
    const result = await runAudit(options(dir, driver));
    const page = result.run.pages[0]!;
    expect(page.status).toBe("done");
    expect(page.failedAttempts).toEqual([
      {
        n: 1,
        startedAt: expect.stringMatching(ISO_MS) as unknown,
        endedAt: expect.stringMatching(ISO_MS) as unknown,
        pass: "read",
        step: 3,
        command: "nextLine",
        cause: "foreground",
        message: "The browser lost the foreground to another window.",
        restarted: true,
      },
    ]);
  });

  it("keeps an unexpected error's stack, with the home folder replaced", async () => {
    const dir = await setup(["/"]);
    const driver = new ScriptedDriver(sitePages(), {
      fail: (command) =>
        command === "nextHeading"
          ? new TypeError(`Cannot read properties of undefined (${os.homedir()})`)
          : null,
    });
    const result = await runAudit(options(dir, driver, { config: config({ pageAttempts: 1 }) }));
    const attempt = result.run.pages[0]!.failedAttempts![0]!;
    expect(attempt).toMatchObject({ pass: "headings", cause: "unexpected" });
    expect(attempt.stack).toMatch(/^TypeError: Cannot read properties of undefined/);
    expect(attempt.stack).not.toContain(os.homedir());
    // The frames spell the folder with forward slashes on Windows; nothing of it is left there.
    expect(attempt.stack).not.toContain(os.homedir().replaceAll("\\", "/"));
    // The home folder's place is kept, as %USERPROFILE% on Windows and ~ elsewhere.
    const home = process.platform === "win32" ? "%USERPROFILE%" : "~";
    expect(attempt.stack).toContain(`Cannot read properties of undefined (${home})\n`);
    // The message is kept word for word: the report replaces the home folder where it shows it.
    expect(attempt.message).toBe(`Cannot read properties of undefined (${os.homedir()})`);
  });

  // Where there's no home folder (no HOME or USERPROFILE, and no account entry), Node can't give
  // one, and there's nothing to replace: the attempt is recorded all the same.
  it("keeps an unexpected error's stack as it is when there's no home folder", async () => {
    const dir = await setup(["/"]);
    const driver = new ScriptedDriver(sitePages(), {
      fail: (command) =>
        command === "nextHeading" ? new TypeError("Cannot read properties of undefined") : null,
    });
    const homedir = vi.spyOn(os, "homedir").mockImplementation(() => {
      throw new Error("A system error occurred: uv_os_homedir returned ENOENT");
    });
    try {
      const result = await runAudit(options(dir, driver, { config: config({ pageAttempts: 1 }) }));
      expect(result.outcome).toBe("completed");
      const attempt = result.run.pages[0]!.failedAttempts![0]!;
      expect(attempt).toMatchObject({ pass: "headings", cause: "unexpected" });
      expect(attempt.stack).toMatch(/^TypeError: Cannot read properties of undefined\n/);
    } finally {
      homedir.mockRestore();
    }
  });

  it("keeps no stack for a failure that isn't unexpected", async () => {
    const dir = await setup(["/"]);
    const driver = new ScriptedDriver(sitePages(), {
      fail: (command) =>
        command === "nextHeading"
          ? new ForegroundError("Another window took the foreground.")
          : null,
    });
    const result = await runAudit(options(dir, driver, { config: config({ pageAttempts: 1 }) }));
    const attempt = result.run.pages[0]!.failedAttempts![0]!;
    expect(attempt).toMatchObject({ pass: "headings", cause: "foreground" });
    expect(attempt).not.toHaveProperty("stack");
  });

  it("records an HTTP 4xx as one attempt with no step", async () => {
    const dir = await setup(["/"]);
    const driver = new ScriptedDriver(sitePages({ home: { status: 404 } }));
    const result = await runAudit(options(dir, driver));
    expect(result.run.pages[0]!.failedAttempts).toEqual([
      expect.objectContaining({
        n: 1,
        pass: "read",
        step: null,
        command: null,
        cause: "http",
        message: "HTTP 404",
        restarted: false,
      }),
    ]);
  });

  it("records an HTTP 5xx on every attempt, each tried again without a restart", async () => {
    const dir = await setup(["/"]);
    const driver = new ScriptedDriver(sitePages({ home: { status: 503 } }));
    const result = await runAudit(options(dir, driver, { config: config({ pageAttempts: 3 }) }));
    const page = result.run.pages[0]!;
    expect(page).toMatchObject({ status: "failed", failure: "page", attempts: 3 });
    expect(page.failedAttempts!.map((attempt) => attempt.n)).toEqual([1, 2, 3]);
    for (const attempt of page.failedAttempts!) {
      expect(attempt).toMatchObject({
        pass: "read",
        step: null,
        command: null,
        cause: "http",
        message: "HTTP 503",
        restarted: false,
      });
    }
    expect(driver.starts).toBe(1);
  });

  it("records a page that couldn't be opened, with openPage as its command", async () => {
    const dir = await setup(["/"]);
    const driver = new ScriptedDriver(
      sitePages({
        home: {
          openError: new EnvironmentError("Chrome didn't start: it exited (1)", {
            failure: "browser",
          }),
          openErrorTimes: 1,
        },
      }),
    );
    const result = await runAudit(options(dir, driver));
    expect(result.run.pages[0]!.failedAttempts).toEqual([
      expect.objectContaining({
        n: 1,
        pass: "read",
        step: null,
        command: "openPage",
        cause: "browser",
      }),
    ]);
  });

  it("records a page that hung while opening as an open-timeout", async () => {
    const dir = await setup(["/"]);
    const driver = new ScriptedDriver(sitePages(), { hang: hangOnce("openPage") });
    const result = await runAudit(options(dir, driver));
    const page = result.run.pages[0]!;
    expect(page).toMatchObject({ status: "done", attempts: 2 });
    expect(page.failedAttempts).toHaveLength(1);
    const attempt = page.failedAttempts![0]!;
    expect(attempt).toMatchObject({
      n: 1,
      pass: "read",
      step: null,
      command: "openPage",
      cause: "open-timeout",
      restarted: true,
    });
    expect(attempt.message).toMatch(/^Opening the page did not finish within /);
  });

  it("records a page that took longer than its time as a page-timeout", async () => {
    const dir = await setup(["/"]);
    const driver = new ScriptedDriver(sitePages(), { hang: (command) => command === "nextLine" });
    // A step has 5 s but the whole page only 300 ms, so the page runs out of time first.
    const slow = config({ pageAttempts: 1, timeouts: { stepMs: 5000, pageMs: 300 } });
    const result = await runAudit(options(dir, driver, { config: slow }));
    expect(result.run.pages[0]).toMatchObject({ status: "failed", failure: "environment" });
    expect(result.run.pages[0]!.failedAttempts).toEqual([
      expect.objectContaining({
        n: 1,
        pass: "read",
        step: 3,
        command: "nextLine",
        cause: "page-timeout",
        message: "The whole page did not finish within 300ms",
        restarted: false,
      }),
    ]);
  });

  it("records every attempt at a page that never opens, and restarts only between them", async () => {
    const dir = await setup(["/about"]);
    const lost = new ForegroundError("The browser lost the foreground to another window");
    const driver = new ScriptedDriver(sitePages({ about: { openError: lost } }));
    const result = await runAudit(options(dir, driver));
    const page = result.run.pages[0]!;
    expect(page).toMatchObject({ status: "failed", attempts: 5 });
    // Oldest first, the last one included. Nothing is started again after the last attempt.
    expect(
      page.failedAttempts!.map((attempt) => [attempt.n, attempt.cause, attempt.restarted]),
    ).toEqual([
      [1, "foreground", true],
      [2, "foreground", true],
      [3, "foreground", true],
      [4, "foreground", true],
      [5, "foreground", false],
    ]);
    for (const attempt of page.failedAttempts!) {
      expect(attempt).toMatchObject({ pass: "read", step: null, command: "openPage" });
    }
  });

  it("names the pass under way, for a failure in a later pass", async () => {
    const dir = await setup(["/about"]);
    let tabs = 0;
    const driver = new ScriptedDriver(sitePages(), {
      fail: (command) =>
        command === "nextFocusable" && ++tabs === 1
          ? new ForegroundError("The browser lost the foreground to another window")
          : null,
    });
    const result = await runAudit(options(dir, driver));
    expect(result.run.pages[0]).toMatchObject({ status: "done", attempts: 2 });
    expect(result.run.pages[0]!.failedAttempts).toEqual([
      expect.objectContaining({
        pass: "tab",
        step: 1,
        command: "nextFocusable",
        cause: "foreground",
      }),
    ]);
  });

  it("names the pass a page couldn't be opened for, when that's a later pass", async () => {
    const dir = await setup(["/about"]);
    let opens = 0;
    const driver = new ScriptedDriver(sitePages(), {
      // The page opens for its read pass, then not for its headings pass.
      fail: (command) =>
        command === "openPage" && ++opens === 2
          ? new ForegroundError("The browser couldn't be brought to the front.")
          : null,
    });
    const result = await runAudit(options(dir, driver));
    expect(result.run.pages[0]).toMatchObject({ status: "done", attempts: 2 });
    expect(result.run.pages[0]!.failedAttempts).toEqual([
      expect.objectContaining({
        n: 1,
        pass: "headings",
        step: null,
        command: "openPage",
        cause: "foreground",
      }),
    ]);
  });

  it("takes an attempt's times from the run's clock, to the millisecond", async () => {
    const dir = await setup(["/"]);
    // The clock moves on 1 ms each time it's read.
    let ms = 0;
    const now = () => new Date(2026, 8, 30, 14, 5, 9, ms++);
    const driver = new ScriptedDriver(sitePages({ home: { status: 404 } }));
    const result = await runAudit(options(dir, driver, { now }));
    const attempt = result.run.pages[0]!.failedAttempts![0]!;
    expect(attempt.startedAt).toMatch(/^2026-09-30T14:05:09\.\d{3}[+-]\d\d:\d\d$/);
    expect(attempt.endedAt).toMatch(/^2026-09-30T14:05:09\.\d{3}[+-]\d\d:\d\d$/);
    expect(Date.parse(attempt.endedAt)).toBeGreaterThan(Date.parse(attempt.startedAt));
  });

  it("leaves the field out for a page that never failed", async () => {
    const dir = await setup(["/"]);
    const result = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    expect(result.run.pages[0]).not.toHaveProperty("failedAttempts");
    const onDisk = await readRunJson(outDir(dir), result.runId);
    expect(onDisk.pages[0]).not.toHaveProperty("failedAttempts");
  });

  it("writes the attempts to run.json, inside the run's seal", async () => {
    const dir = await setup(["/"]);
    let lines = 0;
    const driver = new ScriptedDriver(sitePages(), {
      fail: (command) =>
        command === "nextLine" && ++lines === 1
          ? new ForegroundError("The browser lost the foreground to another window.")
          : null,
    });
    const result = await runAudit(options(dir, driver));
    const onDisk = await readRunJson(outDir(dir), result.runId);
    expect(onDisk.pages[0]!.failedAttempts).toEqual(result.run.pages[0]!.failedAttempts);
    expect(onDisk.pages[0]!.failedAttempts).toHaveLength(1);
    // The seal is of the record as it is on disk, attempts included.
    expect(onDisk.seal).toBe(sealOf(onDisk));
    const edited = structuredClone(onDisk);
    edited.pages[0]!.failedAttempts![0]!.cause = "unexpected";
    expect(sealOf(edited)).not.toBe(onDisk.seal);
    const verified = await verifyHome({
      home: path.join(dir, "transcripts"),
      logger: createMemoryLogger(),
    });
    expect(verified.problems).toBe(0);
  });

  it("keeps every attempt when a page is tried again in a later session, numbering on", async () => {
    const dir = await setup(["/", "/about", "/resources"]);
    const broken = new Error("NVDA is not responding");
    const failing = () =>
      new ScriptedDriver(sitePages({ home: { openError: broken }, about: { openError: broken } }));
    const stopped = await runAudit({
      ...options(dir, failing()),
      config: config({ maxConsecutiveFailures: 2 }),
    });
    expect(stopped.outcome).toBe("stopped");
    const first = await readRunJson(outDir(dir), stopped.runId);
    expect(first.pages.map((page) => page.failedAttempts?.length)).toEqual([5, 5, undefined]);

    // Still broken for /: this session's attempts follow the last session's, numbered on.
    const second = await runAudit({
      ...options(dir, new ScriptedDriver(sitePages({ home: { openError: broken } }))),
      config: config({ pageAttempts: 2 }),
    });
    expect(second).toMatchObject({ runId: stopped.runId, outcome: "completed" });
    expect(second.run.pages.map((page) => page.status)).toEqual(["failed", "done", "done"]);
    const [home, about] = second.run.pages;
    expect(home!.attempts).toBe(7);
    expect(home!.failedAttempts!.map((attempt) => attempt.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // Oldest first, across the sessions: the times place each attempt in its session.
    const [lastOfFirst, firstOfSecond] = home!.failedAttempts!.slice(4, 6);
    expect(Date.parse(firstOfSecond!.startedAt)).toBeGreaterThanOrEqual(
      Date.parse(lastOfFirst!.endedAt),
    );
    // /about works now, on its sixth attempt: the five it failed before are still in its record.
    expect(about!.attempts).toBe(6);
    expect(about!.failedAttempts!.map((attempt) => attempt.n)).toEqual([1, 2, 3, 4, 5]);
    const onDisk = await readRunJson(outDir(dir), second.runId);
    expect(onDisk.pages[0]!.failedAttempts).toEqual(home!.failedAttempts);
    expect(onDisk.pages[1]!.failedAttempts).toEqual(about!.failedAttempts);
    expect(onDisk.seal).toBe(sealOf(onDisk));
  });

  it("resumes a run recorded before these fields existed, and verify still passes", async () => {
    const dir = await setup();
    const controller = new AbortController();
    const first = new ScriptedDriver(sitePages());
    const openPage = first.openPage.bind(first);
    first.openPage = (url) => {
      if (url.endsWith("/about")) controller.abort();
      return openPage(url);
    };
    const interrupted = await runAudit(options(dir, first, { signal: controller.signal }));
    // As 0.5.0 wrote the record: no page titles, failed attempts, listener's statement, or
    // computer's details.
    const record = await readRunJson(outDir(dir), interrupted.runId);
    for (const page of record.pages) {
      delete page.title;
      delete page.failedAttempts;
    }
    for (const session of record.sessions) {
      delete session.listener;
      if (session.environment) delete session.environment.machine;
    }
    await writeRunJson(outDir(dir), record);

    const resumed = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    expect(resumed.outcome).toBe("completed");
    expect(resumed.run.pages[0]).not.toHaveProperty("title");
    expect(resumed.run.pages[1]?.title).toBeNull();
    // The session 0.5.0 recorded stays as it was; the one resuming it records its computer.
    expect(resumed.run.sessions[0]?.environment).not.toHaveProperty("machine");
    expect(resumed.run.sessions[1]?.environment?.machine?.os.name).toBe("Test OS 1");
    const result = await verifyHome({
      home: path.join(dir, "transcripts"),
      logger: createMemoryLogger(),
    });
    expect(result.problems).toBe(0);
  });
});

describe("the reviewer", () => {
  it("records who ran the session, from --reviewer first, and says so", async () => {
    const dir = await setup(["/"]);
    const logger = createMemoryLogger();
    const result = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { reviewer: "cschweda", logger }),
    );

    expect(result.run.sessions[0]?.reviewer).toEqual({ name: "cschweda", source: "option" });
    expect(logger.text("info")).toContain("Reviewer: cschweda (from --reviewer)");
    const stored = await readRunJson(outDir(dir), result.runId);
    expect(stored.sessions[0]?.reviewer).toEqual({ name: "cschweda", source: "option" });
    expect(stored.seal).toBe(sealOf(stored));
  });

  it("falls back as reviews do, and records that there was no name", async () => {
    const dir = await setup(["/"]);
    const fromEnv = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), {
        env: { VOICECAP_REVIEWER: "Env Name" },
        gitUserName: () => "Git Name",
        fresh: true,
      }),
    );
    expect(fromEnv.run.sessions[0]?.reviewer).toEqual({ name: "Env Name", source: "environment" });

    const fromGit = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { gitUserName: () => "Git Name", fresh: true }),
    );
    expect(fromGit.run.sessions[0]?.reviewer).toEqual({ name: "Git Name", source: "git" });

    const logger = createMemoryLogger();
    const none = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), {
        config: config({ reviewer: null }),
        logger,
        fresh: true,
      }),
    );
    expect(none.outcome).toBe("completed");
    expect(none.run.sessions[0]?.reviewer).toBeNull();
    expect(logger.text("warn")).toContain(
      "No reviewer name, so this session's record won't say who ran it. Pass --reviewer, or set VOICECAP_REVIEWER.",
    );
  });

  it("records each session's own reviewer when someone else resumes the run", async () => {
    const dir = await setup();
    const controller = new AbortController();
    const first = new ScriptedDriver(sitePages());
    const openPage = first.openPage.bind(first);
    first.openPage = (url) => {
      if (url.endsWith("/about")) controller.abort();
      return openPage(url);
    };
    const interrupted = await runAudit(
      options(dir, first, { signal: controller.signal, reviewer: "cschweda" }),
    );
    expect(interrupted.outcome).toBe("interrupted");

    const resumed = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { reviewer: "Jane Doe" }),
    );
    expect(resumed.runId).toBe(interrupted.runId);
    expect(resumed.run.sessions.map((session) => session.reviewer?.name)).toEqual([
      "cschweda",
      "Jane Doe",
    ]);
  });
});

describe("the listener's statement", () => {
  it("asks once the session's pages are read, and seals the answer with the run", async () => {
    const dir = await setup();
    const asked: { screenReader: string; pagesRead: number }[] = [];
    const result = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), {
        askListener: (question) => {
          asked.push(question);
          return Promise.resolve("all");
        },
      }),
    );
    expect(asked).toEqual([{ screenReader: "NVDA", pagesRead: 3 }]);
    expect(result.run.sessions[0]?.listener).toEqual({
      answer: "all",
      askedAt: expect.stringMatching(ISO_MS) as unknown,
      answeredAt: expect.stringMatching(ISO_MS) as unknown,
    });
    expect(result.run.seal).toBe(sealOf(result.run));
  });

  it("asks after Ctrl+C too, and records nothing without an answer", async () => {
    for (const [answer, expected] of [
      ["part", { answer: "part" }],
      [null, undefined],
    ] as const) {
      const dir = await setup();
      const controller = new AbortController();
      const driver = new ScriptedDriver(sitePages());
      const openPage = driver.openPage.bind(driver);
      driver.openPage = (url) => {
        if (url.endsWith("/about")) controller.abort();
        return openPage(url);
      };
      const asked: number[] = [];
      const result = await runAudit(
        options(dir, driver, {
          signal: controller.signal,
          askListener: ({ pagesRead }) => {
            asked.push(pagesRead);
            return Promise.resolve(answer);
          },
        }),
      );
      expect(result.outcome).toBe("interrupted");
      expect(asked).toEqual([1]);
      if (expected) expect(result.run.sessions[0]?.listener).toMatchObject(expected);
      else expect(result.run.sessions[0]).not.toHaveProperty("listener");
    }
  });

  it("doesn't ask when the session read no pages", async () => {
    const dir = await setup();
    const controller = new AbortController();
    controller.abort();
    let asked = 0;
    await runAudit(
      options(dir, new ScriptedDriver(sitePages()), {
        signal: controller.signal,
        askListener: () => {
          asked++;
          return Promise.resolve("all");
        },
      }),
    );
    expect(asked).toBe(0);
  });

  it("doesn't ask for a replayed run", async () => {
    const dir = await setup();
    let asked = 0;
    const result = await runAudit(
      options(dir, undefined, {
        site: "http://127.0.0.1:4747",
        pages: fixture("pages.json"),
        replayFrom: fixture("replay-run"),
        askListener: () => {
          asked++;
          return Promise.resolve("all");
        },
      }),
    );
    // Pages were replayed, so it's the replay, not an empty session, that kept the question away.
    expect(result.run.replayed).toBe(true);
    expect(result.run.sessions[0]?.pagesDone).toBeGreaterThan(0);
    expect(asked).toBe(0);
  });

  it("asks only once the screen reader has stopped", async () => {
    const dir = await setup(["/"]);
    const driver = new ScriptedDriver(sitePages());
    let stopsWhenAsked = 0;
    await runAudit(
      options(dir, driver, {
        askListener: () => {
          stopsWhenAsked = driver.stops;
          return Promise.resolve("all");
        },
      }),
    );
    expect(stopsWhenAsked).toBe(1);
  });

  it("asks when the run stops after failed pages in a row, and keeps the answer with the stop", async () => {
    const dir = await setup();
    const broken = new Error("NVDA is not responding");
    const driver = new ScriptedDriver(
      sitePages({
        home: { openError: broken },
        about: { openError: broken },
        resources: { openError: broken },
      }),
    );
    const asked: number[] = [];
    const result = await runAudit({
      ...options(dir, driver, {
        askListener: ({ pagesRead }) => {
          asked.push(pagesRead);
          return Promise.resolve("part");
        },
      }),
      config: config({ maxConsecutiveFailures: 2 }),
    });
    expect(result.outcome).toBe("stopped");
    expect(asked).toEqual([2]);
    const stored = await readRunJson(outDir(dir), result.runId);
    expect(stored.sessions[0]).toMatchObject({
      endReason: "environment-failure",
      listener: { answer: "part" },
    });
  });

  it("asks when the session ends with an error, once it has said why, then throws the error", async () => {
    const dir = await setup();
    const driver = new ScriptedDriver(sitePages());
    // The screen reader won't start again for its restart after the first page.
    const start = driver.start.bind(driver);
    let starts = 0;
    driver.start = () =>
      ++starts === 2
        ? Promise.reject(new EnvironmentError("NVDA didn't start\nIts log says more."))
        : start();
    const logger = createMemoryLogger();
    const asked: { screenReader: string; pagesRead: number }[] = [];
    let when: { stops: number; said: string | undefined } | undefined;
    await expect(
      runAudit({
        ...options(dir, driver, {
          logger,
          askListener: (question) => {
            asked.push(question);
            when = { stops: driver.stops, said: logger.entries.at(-1)?.message };
            return Promise.resolve("part");
          },
        }),
        config: config({ restartEvery: 1 }),
      }),
    ).rejects.toThrow("NVDA didn't start");
    expect(asked).toEqual([{ screenReader: "NVDA", pagesRead: 1 }]);
    // Asked once the screen reader had stopped, straight after one line that says why: the
    // error's first line. The whole error follows the question, where the CLI explains it.
    expect(when?.stops).toBeGreaterThanOrEqual(2);
    expect(when?.said).toBe("The session ended with an error: NVDA didn't start");
    const [stored] = await listRuns(outDir(dir));
    expect(stored?.sessions[0]).toMatchObject({
      endReason: "environment-failure",
      pagesDone: 1,
      listener: { answer: "part" },
    });
  });

  it("asks when the session ends with an error that isn't the environment's, too", async () => {
    const dir = await setup(["/", "/about"]);
    const driver = new ScriptedDriver(sitePages());
    // An error of voicecap's own that isn't the environment's ends the session as an error.
    const start = driver.start.bind(driver);
    let starts = 0;
    driver.start = () =>
      ++starts === 2 ? Promise.reject(new VoicecapError("The config changed")) : start();
    let asked = 0;
    await expect(
      runAudit({
        ...options(dir, driver, {
          askListener: () => {
            asked++;
            return Promise.resolve(null);
          },
        }),
        config: config({ restartEvery: 1 }),
      }),
    ).rejects.toThrow("The config changed");
    expect(asked).toBe(1);
    const [stored] = await listRuns(outDir(dir));
    expect(stored?.sessions[0]).toMatchObject({ endReason: "error", pagesDone: 1 });
    // No answer, so no statement.
    expect(stored?.sessions[0]).not.toHaveProperty("listener");
  });

  it("notes when it asked and when the answer came, to the millisecond", async () => {
    const dir = await setup(["/"]);
    const start = new Date(2026, 8, 30, 14, 30, 0, 250).getTime();
    let time = start;
    const result = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), {
        now: () => new Date(time),
        askListener: () => {
          // The person takes four and a half seconds.
          time += 4_500;
          return Promise.resolve("all");
        },
      }),
    );
    const { askedAt, answeredAt } = result.run.sessions[0]!.listener!;
    expect(Date.parse(askedAt)).toBe(start);
    expect(Date.parse(answeredAt)).toBe(start + 4_500);
  });

  it("keeps each session's own statement when the run is resumed, and seals both", async () => {
    const dir = await setup();
    const controller = new AbortController();
    const first = new ScriptedDriver(sitePages());
    const openPage = first.openPage.bind(first);
    first.openPage = (url) => {
      if (url.endsWith("/about")) controller.abort();
      return openPage(url);
    };
    const interrupted = await runAudit(
      options(dir, first, {
        signal: controller.signal,
        askListener: () => Promise.resolve("part"),
      }),
    );
    // Saved with the interrupted session, before any seal.
    const saved = await readRunJson(outDir(dir), interrupted.runId);
    expect(saved.seal).toBeUndefined();
    expect(saved.sessions[0]?.listener?.answer).toBe("part");

    const asked: number[] = [];
    const resumed = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), {
        askListener: ({ pagesRead }) => {
          asked.push(pagesRead);
          return Promise.resolve("all");
        },
      }),
    );
    expect(resumed.runId).toBe(interrupted.runId);
    // Only the pages this session read: /about and /resources.
    expect(asked).toEqual([2]);
    const run = await readRunJson(outDir(dir), resumed.runId);
    expect(run.sessions.map((session) => session.listener?.answer)).toEqual(["part", "all"]);
    expect(run.seal).toBe(sealOf(run));
  });

  it("keeps the statement when the run is resumed with changed flag rules", async () => {
    const dir = await setup(["/resources", "/", "/about"]);
    const controller = new AbortController();
    const first = new ScriptedDriver(sitePages());
    const openPage = first.openPage.bind(first);
    first.openPage = (url) => {
      if (url.endsWith("/about")) controller.abort();
      return openPage(url);
    };
    const interrupted = await runAudit(options(dir, first, { signal: controller.signal }));
    expect(interrupted.outcome).toBe("interrupted");

    // A flag rule turned off, so the completed run is sealed and written from a copy of the run.
    const resumed = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), {
        config: config({ flags: { genericLinkText: { enabled: false } } }),
        askListener: () => Promise.resolve("all"),
      }),
    );
    expect(resumed).toMatchObject({ runId: interrupted.runId, outcome: "completed" });
    const run = await readRunJson(outDir(dir), resumed.runId);
    expect(resumed.run.sessions[1]?.listener?.answer).toBe("all");
    expect(run.sessions[1]?.listener?.answer).toBe("all");
    expect(run.seal).toBe(sealOf(run));
  });

  it("is covered by the seal: verify catches an answer edited afterward", async () => {
    const dir = await setup(["/"]);
    const result = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { askListener: () => Promise.resolve("no") }),
    );
    const home = path.join(dir, "transcripts");
    const verify = () => verifyHome({ home, logger: createMemoryLogger() });
    expect((await verify()).problems).toBe(0);

    const file = path.join(result.runDir, "run.json");
    const edited = JSON.parse(await readFile(file, "utf8")) as RunJson;
    edited.sessions[0]!.listener!.answer = "all";
    await writeFile(file, `${JSON.stringify(edited, null, 2)}\n`);
    expect((await verify()).problems).toBe(1);
  });

  it("takes the answer of a person at a terminal, through the CLI's own question", async () => {
    const dir = await setup(["/"]);
    const keyboard = Object.assign(new PassThrough(), { isTTY: true });
    // Pressed during the run: not an answer.
    keyboard.write("1\n");
    let screen = "";
    const person = {
      write: (chunk: string) => {
        screen += chunk;
        // Answered once the question is on screen.
        if (chunk.includes("Choose [3]: ")) setImmediate(() => keyboard.write("2\n"));
        return true;
      },
    };
    const result = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), {
        askListener: makeAskListener(keyboard, person, {
          drainMs: 0,
          signals: fakeSignals().source,
        }),
      }),
    );
    expect(screen).toContain("Did you hear NVDA speaking as it read these pages?");
    expect(result.run.sessions[0]?.listener?.answer).toBe("part");
    expect(result.run.seal).toBe(sealOf(result.run));
  });

  it("still completes the run, with a warning and no statement, when asking fails", async () => {
    const dir = await setup(["/"]);
    const logger = createMemoryLogger();
    const result = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), {
        logger,
        askListener: () => Promise.reject(new Error("The terminal went away")),
      }),
    );
    expect(result.outcome).toBe("completed");
    expect(result.run.sessions[0]).not.toHaveProperty("listener");
    expect(result.run.seal).toBe(sealOf(result.run));
    expect(logger.text("warn")).toContain(
      "Couldn't ask whether you heard the screen reader (The terminal went away), so this session's record won't say.",
    );
  });
});

describe("the computer each session ran on", () => {
  it("records it in the session's environment, with the browser's fixed window", async () => {
    const dir = await setup(["/"]);
    const result = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    const stored = await readRunJson(outDir(dir), result.runId);
    const machine = stored.sessions[0]?.environment?.machine;
    expect(machine?.browserWindow).toEqual({ width: 1280, height: 960 });
    expect(machine).toEqual(
      await collectMachineRecord(MACHINE_PROBE, nodeMachineFacts(BROWSER_WINDOW)),
    );
    expect(machine).toMatchObject({
      os: { name: "Test OS 1", build: "1.2.3", arch: os.arch() },
      cpu: { baseMhz: 3000, physicalCores: 4, logicalProcessors: os.cpus().length },
      memoryBytes: os.totalmem(),
      display: { width: 1920, height: 1080, refreshHz: 60, scalePercent: 100 },
      language: "en-US",
      software: { node: process.versions.node },
    });
  });

  it("repeats it in every transcript, as the rest of the environment is", async () => {
    const dir = await setup(["/"]);
    const result = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    const machine = result.run.sessions[0]?.environment?.machine;
    expect(machine).toBeDefined();
    for (const pass of ["read", "headings", "tab"]) {
      const file = path.join(pageDir(outDir(dir), result.runId, "home"), `${pass}.json`);
      const transcript = JSON.parse(await readFile(file, "utf8")) as TranscriptJson;
      expect(transcript.environment.machine, pass).toEqual(machine);
    }
  });

  it("is covered by the seal: verify catches a record edited afterward", async () => {
    const dir = await setup(["/"]);
    const result = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    const home = path.join(dir, "transcripts");
    const verify = () => verifyHome({ home, logger: createMemoryLogger() });
    expect(result.run.seal).toBe(sealOf(result.run));
    expect((await verify()).problems).toBe(0);

    const file = path.join(result.runDir, "run.json");
    const edited = JSON.parse(await readFile(file, "utf8")) as RunJson;
    edited.sessions[0]!.environment!.machine!.cpu.name = "A faster processor";
    await writeFile(file, `${JSON.stringify(edited, null, 2)}\n`);
    expect((await verify()).problems).toBe(1);
  });

  it("records the computer that replayed a run, with no browser window: none was opened", async () => {
    const dir = await setup(["/"]);
    const recorded = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    const replayed = await runAudit({
      ...options(dir, undefined),
      replayFrom: runDir(path.join("transcripts", siteFolder(SITE)), recorded.runId),
    });
    expect(replayed.outcome).toBe("completed");
    const environment = replayed.run.sessions[0]?.environment;
    expect(environment?.replay?.sourceRun).toBe(recorded.runId);
    expect(environment?.machine).toMatchObject({
      os: { name: "Test OS 1" },
      browserWindow: null,
    });
  });

  it("is recorded again by each session, since the computer may have changed", async () => {
    const dir = await setup();
    const controller = new AbortController();
    const first = new ScriptedDriver(sitePages());
    const openPage = first.openPage.bind(first);
    first.openPage = (url) => {
      if (url.endsWith("/about")) controller.abort();
      return openPage(url);
    };
    const reads: string[] = [];
    const counting: MachineProbe = {
      ...MACHINE_PROBE,
      os: () => {
        reads.push("os");
        return Promise.resolve({ name: `Test OS ${reads.length}`, build: null });
      },
    };
    const interrupted = await runAudit(
      options(dir, first, { signal: controller.signal, machineProbe: counting }),
    );
    expect(interrupted.outcome).toBe("interrupted");
    const resumed = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { machineProbe: counting }),
    );
    expect(resumed.outcome).toBe("completed");

    expect(reads).toHaveLength(2);
    expect(resumed.run.sessions.map((session) => session.environment?.machine?.os.name)).toEqual([
      "Test OS 1",
      "Test OS 2",
    ]);
  });

  it("goes without what the computer won't say, and the run goes on", async () => {
    const dir = await setup(["/"]);
    const unreadable = () => {
      throw new Error("no answer");
    };
    const result = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), {
        machineProbe: {
          ...MACHINE_PROBE,
          os: unreadable,
          display: () => Promise.reject(new Error("no")),
        },
      }),
    );
    expect(result.outcome).toBe("completed");
    expect(result.run.sessions[0]?.environment?.machine).toMatchObject({
      os: { name: "unknown", build: null },
      display: null,
      language: "en-US",
    });
  });

  it("reads it with the probe for the platform the run was told it's on", async () => {
    const dir = await setup(["/"]);
    // No fake probe: Linux's is node:os alone, so this starts nothing.
    const result = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { machineProbe: undefined, platform: "linux" }),
    );
    const machine = result.run.sessions[0]?.environment?.machine;
    expect(machine?.os).toEqual({
      name: `${os.type()} ${os.release()}`,
      build: null,
      arch: os.arch(),
    });
    expect(machine?.display).toBeNull();
    expect(machine?.browserWindow).toEqual(BROWSER_WINDOW);
  });

  // The probe takes seconds on Windows (a start of PowerShell): read while the screen reader and
  // browser start, it isn't time they spend running with nothing to read.
  it("starts reading it before the screen reader starts", async () => {
    const dir = await setup(["/"]);
    const driver = new ScriptedDriver(sitePages());
    const startsWhenRead: number[] = [];
    const result = await runAudit(
      options(dir, driver, {
        machineProbe: {
          ...MACHINE_PROBE,
          os: () => {
            startsWhenRead.push(driver.starts);
            return MACHINE_PROBE.os();
          },
        },
      }),
    );
    expect(startsWhenRead).toEqual([0]);
    expect(result.run.sessions[0]?.environment?.machine?.os.name).toBe("Test OS 1");
  });

  it("leaves nothing behind when the screen reader doesn't start, whatever the probe does", async () => {
    const dir = await setup(["/"]);
    const driver = new ScriptedDriver(sitePages());
    driver.start = () => Promise.reject(new EnvironmentError("NVDA didn't start"));
    const failing = () => Promise.reject(new Error("PowerShell didn't answer"));
    await expect(
      runAudit(
        options(dir, driver, {
          machineProbe: { os: failing, cpu: failing, display: failing, language: failing },
        }),
      ),
    ).rejects.toThrow("NVDA didn't start");
    const [stored] = await listRuns(outDir(dir));
    expect(stored?.sessions[0]).toMatchObject({
      endReason: "environment-failure",
      environment: null,
    });
  });
});

describe("interrupting and resuming", () => {
  it("saves state on Ctrl+C, exits 130, and the next run resumes where it stopped", async () => {
    const dir = await setup();
    const controller = new AbortController();
    const first = new ScriptedDriver(sitePages());
    const openPage = first.openPage.bind(first);
    first.openPage = (url) => {
      if (url.endsWith("/about")) controller.abort();
      return openPage(url);
    };
    const interrupted = await runAudit(options(dir, first, { signal: controller.signal }));
    expect(interrupted).toMatchObject({ outcome: "interrupted", exitCode: 130 });
    expect(first.stops).toBe(1);

    let run = await readRunJson(outDir(dir), interrupted.runId);
    expect(run.status).toBe("incomplete");
    expect(run.pages.map((p) => p.status)).toEqual(["done", "pending", "pending"]);
    expect(run.sessions[0]?.endReason).toBe("interrupted");

    const second = new ScriptedDriver(sitePages());
    const logger = createMemoryLogger();
    const resumed = await runAudit({ ...options(dir, second), logger });
    expect(resumed.runId).toBe(interrupted.runId);
    expect(logger.text()).toContain(`Resuming ${interrupted.runId}: 1 of 3 pages already done.`);
    expect(second.opened.some((url) => url === `${SITE}/`)).toBe(false);
    run = await readRunJson(outDir(dir), resumed.runId);
    expect(run.status).toBe("completed");
    expect(run.sessions.map((s) => s.endReason)).toEqual(["interrupted", "completed"]);
  });

  it("starts a new run when the settings differ, and says why", async () => {
    const dir = await setup();
    const controller = new AbortController();
    controller.abort();
    const first = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { signal: controller.signal }),
    );
    expect(first.outcome).toBe("interrupted");

    const logger = createMemoryLogger();
    const second = await runAudit({
      ...options(dir, new ScriptedDriver(sitePages())),
      passes: ["read"],
      logger,
    });
    expect(second.runId).not.toBe(first.runId);
    expect(logger.text()).toContain(
      `Not resuming ${first.runId} because its settings differ: passes: read,headings,tab → read`,
    );
  });

  it("keeps a page's partial transcripts from before an interruption when the run resumes", async () => {
    const dir = await setup();
    const controller = new AbortController();
    const first = new ScriptedDriver(sitePages());
    const openPage = first.openPage.bind(first);
    let aboutLoads = 0;
    first.openPage = (url) => {
      // Interrupted as /about loads for its second pass: its read pass is already written.
      if (url.endsWith("/about") && ++aboutLoads === 2) controller.abort();
      return openPage(url);
    };
    const interrupted = await runAudit(options(dir, first, { signal: controller.signal }));
    expect(interrupted.outcome).toBe("interrupted");
    const out = outDir(dir);
    const about = (await readRunJson(out, interrupted.runId)).pages[1]!;
    expect(about).toMatchObject({ url: `${SITE}/about`, status: "pending" });
    const partial = pageDir(out, interrupted.runId, about.slug);
    expect(await readdir(partial)).toEqual(["read.json", "read.txt"]);
    const partialRead = await readFile(path.join(partial, "read.txt"));

    const resumed = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    expect(resumed).toMatchObject({ runId: interrupted.runId, outcome: "completed" });
    const kept = path.join(attemptsDir(out, resumed.runId, about.slug), "1");
    expect(await readdir(kept)).toEqual(["read.json", "read.txt"]);
    expect(await readFile(path.join(kept, "read.txt"))).toEqual(partialRead);
    expect(await readdir(partial)).toEqual([
      "headings.json",
      "headings.txt",
      "read.json",
      "read.txt",
      "tab.json",
      "tab.txt",
    ]);
  });

  it("--fresh always starts a new run", async () => {
    const dir = await setup();
    // Both runs in one minute: on the real clock, a minute can turn between them.
    const now = () => new Date(2026, 8, 27, 11, 2);
    const controller = new AbortController();
    controller.abort();
    const first = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { signal: controller.signal, now }),
    );
    const logger = createMemoryLogger();
    const second = await runAudit({
      ...options(dir, new ScriptedDriver(sitePages()), { now }),
      fresh: true,
      logger,
    });
    expect(second.runId).not.toBe(first.runId);
    expect(second.runId).toBe(`${first.runId}-2`);
    expect(logger.text()).toContain("--fresh: starting a new run");
  });
});

describe("what a run that ends early says to do next", () => {
  /** A run of SITE's pages that ends early as `ending` says, given `again` if there is one. */
  async function endedEarly(ending: "interrupted" | "stopped", again?: string) {
    const dir = await setup();
    const logger = createMemoryLogger();
    const controller = new AbortController();
    if (ending === "interrupted") controller.abort();
    const broken = new Error("NVDA is not responding");
    const driver = new ScriptedDriver(
      ending === "stopped"
        ? sitePages({
            home: { openError: broken },
            about: { openError: broken },
            resources: { openError: broken },
          })
        : sitePages(),
    );
    const result = await runAudit({
      ...options(dir, driver, { signal: controller.signal, logger }),
      config: config({ maxConsecutiveFailures: 2 }),
      ...(again ? { again } : {}),
    });
    expect(result.outcome).toBe(ending);
    return { entries: logger.entries, runId: result.runId };
  }

  it("says to run the same command again to resume, word for word as before", async () => {
    const interrupted = await endedEarly("interrupted");
    expect(interrupted.entries).toContainEqual({
      level: "warn",
      message: `Interrupted. Progress is saved in ${interrupted.runId}; run the same command again to resume.`,
    });
    const stopped = await endedEarly("stopped");
    expect(stopped.entries).toContainEqual({
      level: "error",
      message: `Stopped after 2 failed pages in a row: the screen reader or browser seems to be unusable. Fix the problem, then run the same command again to resume ${stopped.runId}.`,
    });
  });

  // voicecap demo's run is --fresh, on a demo site that stops with the tour: it can't resume.
  it("says to run the caller's own command to start again, when it gives one", async () => {
    const interrupted = await endedEarly("interrupted", "npx @icjia/voicecap demo");
    expect(interrupted.entries).toContainEqual({
      level: "warn",
      message: `Interrupted. Progress is saved in ${interrupted.runId}; run npx @icjia/voicecap demo to start again.`,
    });
    const stopped = await endedEarly("stopped", "npx @icjia/voicecap demo");
    expect(stopped.entries).toContainEqual({
      level: "error",
      message:
        "Stopped after 2 failed pages in a row: the screen reader or browser seems to be unusable. Fix the problem, then run npx @icjia/voicecap demo to start again.",
    });
    const said = [...interrupted.entries, ...stopped.entries].map((entry) => entry.message);
    expect(said.join("\n")).not.toContain("the same command");
  });
});

describe("completed runs are sealed", () => {
  it("seals a run when it completes, but not while it's still interrupted", async () => {
    const dir = await setup();
    const controller = new AbortController();
    const first = new ScriptedDriver(sitePages());
    const openPage = first.openPage.bind(first);
    first.openPage = (url) => {
      if (url.endsWith("/about")) controller.abort();
      return openPage(url);
    };
    const interrupted = await runAudit(options(dir, first, { signal: controller.signal }));
    expect(interrupted.outcome).toBe("interrupted");

    const out = outDir(dir);
    const incomplete = await readRunJson(out, interrupted.runId);
    expect(incomplete.status).toBe("incomplete");
    expect(incomplete.seal).toBeUndefined();

    const resumed = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    expect(resumed).toMatchObject({ runId: interrupted.runId, outcome: "completed" });
    const run = await readRunJson(out, resumed.runId);
    expect(run.status).toBe("completed");
    expect(run.seal).toBe(sealOf(run));
  });

  it("seals a run resumed with changed flag rules as it's written", async () => {
    const dir = await setup(["/resources", "/", "/about"]);
    const controller = new AbortController();
    const first = new ScriptedDriver(sitePages());
    const openPage = first.openPage.bind(first);
    first.openPage = (url) => {
      if (url.endsWith("/about")) controller.abort();
      return openPage(url);
    };
    const interrupted = await runAudit(options(dir, first, { signal: controller.signal }));
    expect(interrupted.outcome).toBe("interrupted");
    const out = outDir(dir);
    const before = await readRunJson(out, interrupted.runId);
    expect(before.pages[0]?.flags.map((flag) => flag.rule)).toContain("generic-link-text");

    // Resumed with a flag rule turned off: every page's flags are recomputed as it completes.
    const resumed = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), {
        config: config({ flags: { genericLinkText: { enabled: false } } }),
      }),
    );
    expect(resumed).toMatchObject({ runId: interrupted.runId, outcome: "completed" });
    const run = await readRunJson(out, resumed.runId);
    expect(run.pages[0]?.flags.map((flag) => flag.rule)).not.toContain("generic-link-text");
    expect(run.seal).toBe(sealOf(run));
  });

  it("never modifies a run folder after completion", async () => {
    const dir = await setup();
    const result = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    const out = outDir(dir);
    const folder = runDir(out, result.runId);
    const before = await snapshotFolder(folder);

    const quiet = createMemoryLogger();
    await addReview({
      page: "/about",
      status: "reviewed",
      cwd: dir,
      env: {},
      config: config(),
      logger: quiet,
    });
    await regenerateLiveReport({ outDir: out, config: config().config, logger: quiet });
    await runAudit({ ...options(dir, new ScriptedDriver(sitePages())), compare: "previous" });

    expect(await snapshotFolder(folder)).toEqual(before);
    const run: RunJson = await readRunJson(out, result.runId);
    await expect(writeRunJson(out, run)).rejects.toThrow(/completed; its folder is never modified/);
  });
});

describe("--compare", () => {
  it("records the base run and writes diffs for pages whose transcripts changed", async () => {
    const dir = await setup();
    const first = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    const changed = sitePages({
      about: {
        lines: ["heading, level 1, About us", "We are a changed example.", "© 2026 Example Agency"],
      },
    });
    const second = await runAudit({
      ...options(dir, new ScriptedDriver(changed)),
      compare: "previous",
    });
    const out = outDir(dir);
    const run = await readRunJson(out, second.runId);
    expect(run.compareTo).toBe(first.runId);

    const slug = run.pages.find((p) => p.url.endsWith("/about"))!.slug;
    const inRun = path.join(runCompareDir(out, second.runId, first.runId), slug, "read.diff.txt");
    const live = path.join(
      out,
      "compare",
      `${first.runId}__${second.runId}`,
      slug,
      "read.diff.txt",
    );
    for (const file of [inRun, live]) {
      const diff = await readFile(file, "utf8");
      expect(diff).toContain("-We are an example.");
      expect(diff).toContain("+We are a changed example.");
      expect(diff).not.toContain("# voicecap transcript");
    }
  });

  it("leaves a home that verify finds nothing wrong with", async () => {
    const dir = await setup();
    const first = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    const changed = sitePages({
      about: {
        lines: ["heading, level 1, About us", "We are a changed example.", "© 2026 Example Agency"],
      },
    });
    const second = await runAudit({
      ...options(dir, new ScriptedDriver(changed)),
      compare: "previous",
    });
    expect(second.run.compareTo).toBe(first.runId);
    // Diffs in the run's own folder and in the site's compare/.
    expect(await readdir(path.join(second.runDir, "compare"))).toEqual([first.runId]);
    expect(await readdir(path.join(second.siteDir, "compare"))).toEqual([
      `${first.runId}__${second.runId}`,
    ]);

    const logger = createMemoryLogger();
    const result = await verifyHome({ home: path.join(dir, "transcripts"), logger });
    expect(logger.entries.map((entry) => entry.message)).toEqual([
      "example.illinois.gov: 2 runs (0 incomplete), 0 manual sessions, 0 reviews, 0 shares checked: everything matches.",
    ]);
    expect(result.problems).toBe(0);
  });

  it("rejects --compare previous before doing any work when there is no earlier run", async () => {
    const dir = await setup();
    const driver = new ScriptedDriver(sitePages());
    await expect(runAudit({ ...options(dir, driver), compare: "previous" })).rejects.toThrow();
    expect(driver.starts).toBe(0);
    // No run was created before the missing base was reported.
    expect(await readdir(outDir(dir))).toEqual([]);
  });
});

describe("replay", () => {
  it("replays a run folder and detects the same stop reasons and content", async () => {
    const dir = await setup();
    const recorded = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    const out = outDir(dir);
    const source = await readRunJson(out, recorded.runId);

    const replayed = await runAudit({
      ...options(dir, undefined),
      replayFrom: runDir(path.join("transcripts", siteFolder(SITE)), recorded.runId),
    });
    expect(replayed.exitCode).toBe(0);
    const run = await readRunJson(out, replayed.runId);
    expect(run.replayed).toBe(true);
    expect(run.sessions[0]?.environment?.replay?.sourceRun).toBe(recorded.runId);
    for (const page of source.pages) {
      const again = run.pages.find((p) => p.key === page.key)!;
      for (const pass of ["read", "headings", "tab"] as const) {
        expect(again.passes[pass]?.stopReason, `${page.slug} ${pass}`).toBe(
          page.passes[pass]?.stopReason,
        );
        expect(again.passes[pass]?.contentSha256, `${page.slug} ${pass}`).toBe(
          page.passes[pass]?.contentSha256,
        );
      }
    }
    const txt = await readFile(path.join(pageDir(out, replayed.runId, "home"), "read.txt"), "utf8");
    expect(txt.split("\n")[1]).toMatch(/^# REPLAYED from .*: not a live NVDA session$/);
    const report = await readFile(runReportPath(out, replayed.runId), "utf8");
    expect(report.toLowerCase()).toContain("not a live nvda session");
  });
});

describe("readiness checks before a real run", () => {
  const problem: Problem = {
    title: "NVDA isn't installed",
    whatsWrong: "voicecap couldn't find NVDA on this computer.",
    fix: ["Install NVDA from https://nvaccess.org."],
    setupHelps: true,
  };

  function fakeRunner(id: string, check: Check): CheckRunner {
    return { id, run: () => Promise.resolve(check) };
  }

  /** A platform module whose quick checks are exactly `checks`, naming NVDA on Windows. */
  function fakeReadiness(checks: Check[]): () => Promise<PlatformReadiness> {
    return () =>
      Promise.resolve({
        screenReader: "NVDA",
        cannotRunYet: null,
        readyTip: null,
        liveTestNotice: [],
        checkingNotice: [],
        liveTest: null,
        machineInfo: () =>
          Promise.resolve({
            lines: [],
            screenReader: "NVDA 2026.2",
            system: "Windows 11 Pro 24H2",
          }),
        quickChecks: () => checks.map((check) => fakeRunner(check.id, check)),
      });
  }

  it("rejects before touching the site folder when a check FAILs", async () => {
    const dir = await setup();
    const driver = new ScriptedDriver(sitePages());
    const readiness = fakeReadiness([
      { id: "nvda", status: "FAIL", summary: "NVDA isn't installed", problem },
    ]);
    const error: unknown = await runAudit(options(dir, driver, { readiness })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(EnvironmentError);
    expect((error as EnvironmentError).exitCode).toBe(2);
    expect((error as Error).message).toMatch(/^Not ready: 1 problem\./);
    expect(driver.starts).toBe(0);
    expect(existsSync(outDir(dir))).toBe(false);
  });

  it("logs the pass summary and WARN lines, then runs normally, when checks are ready", async () => {
    const dir = await setup();
    const logger = createMemoryLogger();
    const driver = new ScriptedDriver(sitePages());
    const readiness = fakeReadiness([
      { id: "log-level", status: "WARN", summary: "NVDA's log level is Debug" },
    ]);
    const result = await runAudit({ ...options(dir, driver, { readiness }), logger });
    expect(result.outcome).toBe("completed");
    expect(logger.text()).toContain(
      "Checks passed: NVDA 2026.2 on Windows 11 Pro 24H2\n  WARN  NVDA's log level is Debug",
    );
  });

  it("never checks a replay run, even when readiness is given", async () => {
    const dir = await setup();
    const recorded = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    let calls = 0;
    const readiness = () => {
      calls++;
      return fakeReadiness([])();
    };
    const replayed = await runAudit({
      ...options(dir, undefined),
      replayFrom: runDir(path.join("transcripts", siteFolder(SITE)), recorded.runId),
      readiness,
    });
    expect(replayed.exitCode).toBe(0);
    expect(calls).toBe(0);
  });

  it("runs no checks when a driver is given directly and no readiness is set", async () => {
    const dir = await setup();
    const logger = createMemoryLogger();
    const driver = new ScriptedDriver(sitePages());
    const result = await runAudit({ ...options(dir, driver), logger });
    expect(result.outcome).toBe("completed");
    expect(logger.text()).not.toMatch(/Checks passed:|Not ready:/);
  });

  /** A preflight's result, as voicecap demo's step 2 has it: NVDA on Windows, with these checks. */
  function preflightOf(checks: Check[]): PreflightResult {
    return {
      info: { lines: [], screenReader: "NVDA 2026.2", system: "Windows 11 Pro 24H2" },
      checks,
      ready: checks.every((check) => check.status !== "FAIL"),
    };
  }

  it("uses a preflight it's given instead of checking again", async () => {
    const dir = await setup();
    const logger = createMemoryLogger();
    let checked = 0;
    const readiness = () => {
      checked++;
      return fakeReadiness([])();
    };
    const preflight = preflightOf([
      { id: "ownNvda", status: "WARN", summary: "Your NVDA is running" },
    ]);
    const result = await runAudit({
      ...options(dir, new ScriptedDriver(sitePages()), { readiness, preflight }),
      logger,
    });
    expect(result.outcome).toBe("completed");
    expect(checked).toBe(0);
    expect(logger.text()).toContain(
      "Checks passed: NVDA 2026.2 on Windows 11 Pro 24H2\n  WARN  Your NVDA is running",
    );
  });

  it("stops before touching the site folder when the preflight it's given isn't ready", async () => {
    const dir = await setup();
    const driver = new ScriptedDriver(sitePages());
    const preflight = preflightOf([
      { id: "nvda", status: "FAIL", summary: "NVDA isn't installed", problem },
    ]);
    const error: unknown = await runAudit(options(dir, driver, { preflight })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(EnvironmentError);
    expect((error as Error).message).toMatch(/^Not ready: 1 problem\./);
    expect(driver.starts).toBe(0);
    expect(existsSync(outDir(dir))).toBe(false);
  });
});
