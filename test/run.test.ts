import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveConfig, type LoadedConfig } from "../src/config/load.js";
import type { UserConfig } from "../src/config/schema.js";
import { ForegroundError } from "../src/drivers/types.js";
import type { RunJson } from "../src/model.js";
import { addReview } from "../src/reviews/review.js";
import { runAudit, type RunAuditOptions } from "../src/run/audit.js";
import { regenerateLiveReport } from "../src/run/live-report.js";
import { readRunJson, writeRunJson } from "../src/run/store.js";
import { createMemoryLogger } from "../src/util/log.js";
import { element, ScriptedDriver, type ScriptedPage } from "./helpers/scripted-driver.js";

const SITE = "https://example.illinois.gov";

function sitePages(
  overrides: Partial<Record<"home" | "about" | "resources", Partial<ScriptedPage>>> = {},
): ScriptedPage[] {
  return [
    {
      url: `${SITE}/`,
      lines: [
        "link, Skip to main content",
        "banner landmark, link, Example Agency",
        "main landmark, heading, level 1, Welcome",
        "Grant applications are open.",
        "content info landmark, © 2026 Example Agency",
      ],
      headings: ["heading, level 1, Welcome", "heading, level 2, News"],
      stops: [
        {
          spoken: "Skip to main content, link",
          focused: element("Skip to main content", { href: "#main" }),
        },
        { spoken: "Example Agency, link", focused: element("Example Agency") },
        { spoken: "Grants, link", focused: element("Grants", { inMain: true, href: "/grants" }) },
      ],
      ...overrides.home,
    },
    {
      url: `${SITE}/about`,
      lines: ["heading, level 1, About us", "We are an example.", "© 2026 Example Agency"],
      headings: ["heading, level 1, About us"],
      stops: [{ spoken: "Home, link", focused: element("Home") }],
      ...overrides.about,
    },
    {
      url: `${SITE}/resources`,
      lines: [
        "heading, level 2, Resources",
        "link, Read more",
        "Text",
        "link, Read more",
        "button",
        "End",
      ],
      headings: ["heading, level 2, Resources"],
      stops: [
        { spoken: "Read more, link", focused: element("Read more", { inMain: true }) },
        { spoken: "Read more, link", focused: element("Read more", { inMain: true }) },
        {
          spoken: "button",
          focused: element("", { tag: "button", role: "button", inMain: true, href: null }),
        },
      ],
      ...overrides.resources,
    },
  ];
}

async function setup(entries: string[] = ["/", "/about", "/resources"]): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "voicecap-run-"));
  await writeFile(path.join(dir, "pages.json"), JSON.stringify(entries));
  return dir;
}

function config(user: UserConfig = {}): LoadedConfig {
  const resolved = resolveConfig({
    timeouts: { stepMs: 300, pageMs: 5000, driverStartMs: 2000 },
    readiness: { readySelector: null, settleMs: 0, networkIdleTimeoutMs: 200 },
    reviewer: "Test Reviewer",
    ...user,
  });
  return { config: resolved, file: null, sha256: "test-config" };
}

function options(
  dir: string,
  driver: ScriptedDriver | undefined,
  extra: Partial<RunAuditOptions> = {},
): RunAuditOptions {
  return {
    site: SITE,
    pages: "pages.json",
    cwd: dir,
    ...(driver ? { driver } : {}),
    config: config(),
    logger: createMemoryLogger(),
    ...extra,
  };
}

const outDir = (dir: string) => path.join(dir, "transcripts");
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
    const runFolder = path.join(out, "runs", result.runId);
    expect(result.runId).toMatch(/^\d{4}-\d{2}-\d{2}_\d{4}$/);
    expect((await readFile(path.join(out, "latest.txt"), "utf8")).trim()).toBe(result.runId);
    expect(existsSync(path.join(out, "report.html"))).toBe(true);
    expect(existsSync(path.join(runFolder, "report.html"))).toBe(true);
    expect(await readFile(path.join(out, ".gitattributes"), "utf8")).toContain("* -text");

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
    expect(run.pages[1]?.errors.join(" ")).toMatch(/brought to the front/);
    expect(driver.starts).toBe(2); // restarted after the failed page
  });

  it("retries a page once after a timeout, restarting the driver first", async () => {
    const dir = await setup(["/about"]);
    let hung = false;
    const driver = new ScriptedDriver(sitePages(), {
      hang: (command) => {
        if (command === "nextLine" && !hung) {
          hung = true;
          return true;
        }
        return false;
      },
    });
    const result = await runAudit(options(dir, driver));
    expect(result.exitCode).toBe(0);
    const page = (await readRunJson(outDir(dir), result.runId)).pages[0];
    expect(page).toMatchObject({ status: "done", attempts: 2 });
    expect(page?.errors[0]).toMatch(/Attempt 1 failed/);
    expect(driver.starts).toBe(2);
  });

  it("records the page as failed when the retry times out too", async () => {
    const dir = await setup(["/about", "/"]);
    const driver = new ScriptedDriver(sitePages(), {
      hang: (command, url) => command === "nextLine" && url.endsWith("/about"),
    });
    const result = await runAudit(options(dir, driver));
    expect(result.exitCode).toBe(3);
    const run = await readRunJson(outDir(dir), result.runId);
    expect(run.pages[0]).toMatchObject({ status: "failed", attempts: 2 });
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

  it("restarts NVDA and the browser every N pages", async () => {
    const dir = await setup();
    const driver = new ScriptedDriver(sitePages());
    await runAudit({ ...options(dir, driver), config: config({ restartEvery: 1 }) });
    expect(driver.starts).toBe(3);
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

  it("--fresh always starts a new run", async () => {
    const dir = await setup();
    const controller = new AbortController();
    controller.abort();
    const first = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { signal: controller.signal }),
    );
    const logger = createMemoryLogger();
    const second = await runAudit({
      ...options(dir, new ScriptedDriver(sitePages())),
      fresh: true,
      logger,
    });
    expect(second.runId).not.toBe(first.runId);
    expect(second.runId).toBe(`${first.runId}-2`);
    expect(logger.text()).toContain("--fresh: starting a new run");
  });
});

describe("completed runs are sealed", () => {
  it("never modifies a run folder after completion", async () => {
    const dir = await setup();
    const result = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    const out = outDir(dir);
    const folder = path.join(out, "runs", result.runId);
    const before = await snapshotFolder(folder);

    const quiet = createMemoryLogger();
    await addReview({
      page: "/about",
      status: "reviewed",
      cwd: dir,
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
    const inRun = path.join(
      out,
      "runs",
      second.runId,
      "compare",
      first.runId,
      slug,
      "read.diff.txt",
    );
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

  it("rejects --compare previous before doing any work when there is no earlier run", async () => {
    const dir = await setup();
    const driver = new ScriptedDriver(sitePages());
    await expect(runAudit({ ...options(dir, driver), compare: "previous" })).rejects.toThrow();
    expect(driver.starts).toBe(0);
    expect(existsSync(path.join(outDir(dir), "runs"))).toBe(false);
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
      replayFrom: path.join("transcripts", "runs", recorded.runId),
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
    const txt = await readFile(
      path.join(out, "runs", replayed.runId, "pages", "home", "read.txt"),
      "utf8",
    );
    expect(txt.split("\n")[1]).toMatch(/^# REPLAYED from .*: not a live NVDA session$/);
    const report = await readFile(path.join(out, "runs", replayed.runId, "report.html"), "utf8");
    expect(report.toLowerCase()).toContain("not a live nvda session");
  });
});
