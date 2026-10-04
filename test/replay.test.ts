import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveConfig } from "../src/config/load.js";
import { ReplayDriver } from "../src/drivers/replay.js";
import type { RunJson } from "../src/model.js";
import { runAudit, type RunAuditOptions } from "../src/run/audit.js";
import { pageDir, siteFolder } from "../src/run/paths.js";
import { readRunJson } from "../src/run/store.js";
import { createMemoryLogger } from "../src/util/log.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE_RUN = path.join(ROOT, "fixture", "replay-run");
const SITE_DIR = path.join(ROOT, "fixture", "site");
const SITE = "http://127.0.0.1:4747";

/** Serves the fixture site's files for sitemap fetches, without a server. */
const fixtureFetch: typeof fetch = async (input) => {
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
  );
  const file = path.join(SITE_DIR, ...url.pathname.split("/").filter(Boolean));
  try {
    return new Response(await readFile(file), {
      status: 200,
      headers: { "content-type": "application/xml" },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
};

async function fixtureRun(): Promise<RunJson> {
  return JSON.parse(await readFile(path.join(FIXTURE_RUN, "run.json"), "utf8")) as RunJson;
}

/** SITE's folder in the default home. */
const siteDir = (cwd: string) => path.join(cwd, "transcripts", siteFolder(SITE));

async function replay(
  source: { pages?: string; sitemap?: string },
  extra: Partial<RunAuditOptions> = {},
) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "voicecap-replay-"));
  const result = await runAudit({
    site: SITE,
    ...(source.pages ? { pages: source.pages } : {}),
    ...(source.sitemap ? { sitemap: source.sitemap } : {}),
    replayFrom: FIXTURE_RUN,
    cwd,
    env: {},
    config: { config: resolveConfig({}), file: null, sha256: "test" },
    logger: createMemoryLogger(),
    fetch: fixtureFetch,
    ...extra,
  });
  return { result, run: await readRunJson(siteDir(cwd), result.runId), cwd };
}

describe("replaying the fixture run", () => {
  it("detects exactly the stop reasons and content recorded for every page and pass", async () => {
    const source = await fixtureRun();
    const { result, run } = await replay({ pages: path.join(ROOT, "fixture", "pages.json") });
    expect(result.exitCode).toBe(0);
    const done = source.pages.filter((page) => page.status === "done");
    expect(done).toHaveLength(3);
    for (const recorded of done) {
      const replayed = run.pages.find((page) => page.key === recorded.key);
      expect(replayed?.status, recorded.url).toBe("done");
      for (const pass of ["read", "headings", "tab"] as const) {
        expect(replayed?.passes[pass]?.stopReason, `${recorded.slug} ${pass}`).toBe(
          recorded.passes[pass]?.stopReason,
        );
        expect(replayed?.passes[pass]?.steps, `${recorded.slug} ${pass}`).toBe(
          recorded.passes[pass]?.steps,
        );
        expect(replayed?.passes[pass]?.contentSha256, `${recorded.slug} ${pass}`).toBe(
          recorded.passes[pass]?.contentSha256,
        );
      }
    }
  });

  // The flawed page (fixture/site/flawed/) has three "Read more" links and one "Click here", an
  // image without alt text and an image-only link without it, an unlabeled field, an icon-only
  // button, 12 links before main and no skip link, and an h2 as its first heading. NVDA 2026.2
  // reads an image without alt text as "unlabeled graphic". The unlabeled field is flagged in the
  // tab pass only: in the read pass, a line with only "edit" could be a labeled field whose label
  // NVDA read as the line before (tabOnlyRoles).
  it("raises exactly the flawed page's problems as flags, and none for the other pages", async () => {
    const { run } = await replay({ pages: path.join(ROOT, "fixture", "pages.json") });
    const flawed = run.pages.find((page) => page.url.endsWith("/flawed/"));
    expect(flawed?.flags).toEqual([
      {
        rule: "generic-link-text",
        pass: "read",
        count: 4,
        found: [
          { text: "read more", count: 3 },
          { text: "click here", count: 1 },
        ],
        message:
          'Generic link text announced 4 times in the read pass: "read more" ×3, "click here" ×1.',
      },
      {
        rule: "generic-link-text",
        pass: "tab",
        count: 4,
        found: [
          { text: "read more", count: 3 },
          { text: "click here", count: 1 },
        ],
        message:
          'Generic link text announced 4 times in the tab pass: "read more" ×3, "click here" ×1.',
      },
      {
        rule: "unlabeled",
        pass: "read",
        count: 3,
        found: [
          { text: "unlabeled graphic", count: 2 },
          { text: "button", count: 1 },
        ],
        message:
          'Unlabeled or poorly labeled items in the read pass: "unlabeled graphic" ×2, "button" ×1.',
      },
      {
        rule: "unlabeled",
        pass: "tab",
        count: 3,
        found: [
          { text: "button", count: 1 },
          { text: "edit", count: 1 },
          { text: "unlabeled graphic", count: 1 },
        ],
        message:
          'Unlabeled or poorly labeled items in the tab pass: "button" ×1, "edit" ×1, "unlabeled graphic" ×1.',
      },
      {
        rule: "headings",
        pass: "headings",
        message: "The first heading is level 2, not level 1.",
      },
      {
        rule: "tab-before-main",
        pass: "tab",
        count: 12,
        message:
          "12 focus stops before main content, and the first stop isn't a skip link (possible missing skip link).",
      },
    ]);
    const others = run.pages.filter((page) => page.status === "done" && page !== flawed);
    expect(others).toHaveLength(2);
    for (const page of others) expect(page.flags, page.slug).toEqual([]);
  });

  it("replays a sitemap run, skipping what the recording skipped", async () => {
    const { result, run } = await replay({ sitemap: `${SITE}/sitemap.xml` });
    expect(result.exitCode).toBe(0);
    const reasons = run.skipped.map((skip) => `${skip.reason} ${skip.url}`).sort();
    expect(reasons).toEqual([
      "non-html-extension http://127.0.0.1:4747/files/annual-report.pdf",
      "non-html-response http://127.0.0.1:4747/feed/",
      "off-origin https://www.example.com/partner/",
      "redirect-off-origin http://127.0.0.1:4747/contact/",
    ]);
    expect(run.pages.filter((page) => page.status === "done")).toHaveLength(3);
  });

  it("labels everything it writes as replayed", async () => {
    const { run, cwd } = await replay({ pages: path.join(ROOT, "fixture", "pages.json") });
    expect(run.replayed).toBe(true);
    expect(run.sessions[0]?.environment?.driver.name).toBe("replay");
    expect(run.sessions[0]?.environment?.replay).toMatchObject({
      sourceRun: (await fixtureRun()).id,
      sourceDriver: "guidepup",
    });
    const json = JSON.parse(
      await readFile(path.join(pageDir(siteDir(cwd), run.id, "home"), "tab.json"), "utf8"),
    ) as { replayed: boolean };
    expect(json.replayed).toBe(true);
  });

  it("learns no canonical root, since a replay records no tag: only --canonical names one", async () => {
    const pages = path.join(ROOT, "fixture", "pages.json");
    const { run } = await replay({ pages });
    expect(run).not.toHaveProperty("canonical");
    expect(
      run.pages.filter((page) => page.status === "done").map((page) => page.canonical),
    ).toEqual([null, null, null]);

    const given = await replay({ pages }, { canonical: "dvfr.illinois.gov" });
    expect(given.run.canonical).toBe("https://dvfr.illinois.gov/");
  });
});

describe("ReplayDriver", () => {
  it("reports no canonical tag for a page, or for one the recording skipped", async () => {
    const driver = new ReplayDriver(FIXTURE_RUN, "fixture/replay-run");
    await driver.start();
    expect(await driver.openPage(`${SITE}/`)).toMatchObject({ canonical: null });
    // /feed/ and /contact/ were skipped on load: for their type, and for a redirect to another site.
    expect(await driver.openPage(`${SITE}/feed/`)).toMatchObject({ canonical: null });
    expect(await driver.openPage(`${SITE}/contact/`)).toMatchObject({ canonical: null });
  });

  it("emulates NVDA's end-of-pass behavior after the recording runs out", async () => {
    const driver = new ReplayDriver(FIXTURE_RUN, "fixture/replay-run");
    await driver.start();
    await driver.openPage(`${SITE}/`);
    const source = await fixtureRun();
    const home = source.pages.find((page) => page.slug === "home")!;
    for (let i = 0; i < (home.passes.headings?.steps ?? 0); i++) await driver.nextHeading();
    expect(await driver.nextHeading()).toBe("no next heading");

    await driver.openPage(`${SITE}/`);
    for (let i = 0; i < (home.passes.tab?.steps ?? 0); i++) await driver.nextFocusable();
    expect(await driver.focusInDocument()).toBe(false);
  });

  it("rejects unknown pages and missing folders", async () => {
    const driver = new ReplayDriver(FIXTURE_RUN);
    await driver.start();
    await expect(driver.openPage(`${SITE}/not-recorded/`)).rejects.toThrow(/No recording/);
    await expect(new ReplayDriver(path.join(ROOT, "no-such-folder")).start()).rejects.toThrow(
      /doesn't exist/,
    );
  });
});
