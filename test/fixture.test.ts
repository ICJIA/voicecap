import { readFile } from "node:fs/promises";
import { request } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PassName, ReviewsFile, RunJson, TranscriptJson } from "../src/model.js";
import { contentSha256, extractBody, renderTranscriptTxt } from "../src/transcripts/format.js";
import { sha256 } from "../src/util/hash.js";
import { REPLAY_RUN_DIR, REVIEWS_FILE, SPEECH_VIEWER_FILE } from "../scripts/fixture-reviews.js";
import { comparableStep, speechViewerLines } from "../scripts/speech-viewer.js";
import {
  CONTACT_REDIRECT,
  startFixtureServer,
  type FixtureServer,
} from "../scripts/serve-fixture.js";

const SITE_DIR = fileURLToPath(new URL("../fixture/site/", import.meta.url));
const PASSES: PassName[] = ["read", "headings", "tab"];
const FIXTURE_ORIGIN = "http://127.0.0.1:4747";

async function readRun(): Promise<RunJson> {
  return JSON.parse(await readFile(path.join(REPLAY_RUN_DIR, "run.json"), "utf8")) as RunJson;
}

async function readTranscript(slug: string, pass: PassName): Promise<TranscriptJson> {
  const file = path.join(REPLAY_RUN_DIR, "pages", slug, `${pass}.json`);
  return JSON.parse(await readFile(file, "utf8")) as TranscriptJson;
}

async function transcriptOf(url: string, pass: PassName): Promise<TranscriptJson> {
  const run = await readRun();
  const page = run.pages.find((candidate) => candidate.url === url);
  if (!page) throw new Error(`no page ${url}`);
  return readTranscript(page.slug, pass);
}

function spoken(transcript: TranscriptJson): string[] {
  return transcript.steps.map((step) => step.spoken);
}

/** Send a request with the path exactly as given (fetch would normalize "/../"). */
function rawGet(base: string, rawPath: string): Promise<{ status: number; body: string }> {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request(
      { host: url.hostname, port: url.port, path: rawPath, method: "GET" },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function sitemapLocs(): Promise<string[]> {
  const locs: string[] = [];
  for (const file of ["pages.xml", "files.xml"]) {
    const xml = await readFile(path.join(SITE_DIR, "sitemaps", file), "utf8");
    locs.push(...[...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((match) => match[1]!));
  }
  return locs;
}

describe("fixture server", () => {
  let server: FixtureServer;
  const get = (pathname: string, init?: RequestInit) =>
    fetch(new URL(pathname, server.url), { redirect: "manual", ...init });

  beforeAll(async () => {
    server = await startFixtureServer({ port: 0 });
  });
  afterAll(async () => {
    await server.close();
  });

  it("serves the pages with directory index files", async () => {
    const home = await get("/");
    expect(home.status).toBe(200);
    expect(home.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await home.text()).toContain("Welcome to the Voicecap Test Agency");

    const duplicates = await get("/duplicates/");
    expect(duplicates.status).toBe(200);
    expect(await duplicates.text()).toContain("Applications are due October 31.");

    const flawed = await get("/flawed/");
    expect(flawed.status).toBe(200);
    expect(await flawed.text()).not.toContain("Skip to main content");
  });

  it("redirects a directory without its trailing slash", async () => {
    const response = await get("/duplicates");
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/duplicates/");
  });

  it("redirects /contact/ to another origin", async () => {
    const response = await get("/contact/");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(CONTACT_REDIRECT);
  });

  it("serves /feed/ as RSS, not HTML", async () => {
    const response = await get("/feed/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/rss\+xml/);
    expect(await response.text()).toContain("<rss");
  });

  it("serves the PDF, the image, and the sitemaps with their types", async () => {
    const pdf = await get("/files/annual-report.pdf");
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(
      Buffer.from(await pdf.arrayBuffer())
        .subarray(0, 5)
        .toString("latin1"),
    ).toBe("%PDF-");

    const png = await get("/images/chart.png");
    expect(png.status).toBe(200);
    expect(png.headers.get("content-type")).toBe("image/png");

    const sitemap = await get("/sitemap.xml");
    expect(sitemap.headers.get("content-type")).toMatch(/^application\/xml/);
    expect(await sitemap.text()).toContain("<sitemapindex");
  });

  it("answers 404 with an HTML page, 405 for other methods, and HEAD without a body", async () => {
    const missing = await get("/no-such-page/");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await missing.text()).toContain("Page not found");

    expect((await get("/", { method: "POST" })).status).toBe(405);

    const head = await get("/", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("never serves files outside the site folder", async () => {
    for (const rawPath of [
      "/../package.json",
      "/../../package.json",
      "/%2e%2e/package.json",
      "/..%2fpackage.json",
      "/%2e%2e%5cpackage.json",
      "/sitemaps/..%2f..%2fpackage.json",
    ]) {
      const response = await rawGet(server.url, rawPath);
      expect(response.status, rawPath).not.toBe(200);
      expect(response.body, rawPath).not.toContain("@icjia/voicecap");
    }
  });

  it("serves every same-origin URL in the sitemaps", async () => {
    const expected: Record<string, number> = { "/contact/": 302 };
    for (const loc of await sitemapLocs()) {
      if (!loc.startsWith(FIXTURE_ORIGIN)) continue;
      const pathname = new URL(loc).pathname;
      const response = await get(pathname);
      expect(response.status, loc).toBe(expected[pathname] ?? 200);
    }
  });
});

describe("the fixture run (real NVDA, captured with pnpm fixture:capture)", () => {
  it("is a completed run of the Guidepup NVDA driver, not a replay", async () => {
    const run = await readRun();
    expect(run.status).toBe("completed");
    expect(run.replayed).toBe(false);
    expect(run.settings.driver).toBe("guidepup");
    expect(run.sessions).toHaveLength(1);
    const environment = run.sessions[0]!.environment;
    expect(environment?.driver.name).toBe("guidepup");
    expect(environment?.screenReader?.name).toBe("NVDA");
    expect(environment?.os).toMatch(/^Windows /);
    const home = await transcriptOf(`${FIXTURE_ORIGIN}/`, "read");
    expect(home.environment.driver.name).toBe("guidepup");
    expect(home.replayed).toBe(false);
  });

  it("records every file's SHA-256 and size correctly", async () => {
    const run = await readRun();
    const done = run.pages.filter((page) => page.status === "done");
    expect(done.map((page) => page.url)).toEqual([
      `${FIXTURE_ORIGIN}/`,
      `${FIXTURE_ORIGIN}/duplicates/`,
      `${FIXTURE_ORIGIN}/flawed/`,
    ]);
    for (const page of done) {
      expect(Object.keys(page.files).sort()).toEqual(
        PASSES.flatMap((pass) => [`${pass}.json`, `${pass}.txt`]).sort(),
      );
      for (const [name, hash] of Object.entries(page.files)) {
        const bytes = await readFile(path.join(REPLAY_RUN_DIR, "pages", page.slug, name));
        expect(sha256(bytes), `${page.slug}/${name}`).toBe(hash.sha256);
        expect(bytes.length, `${page.slug}/${name}`).toBe(hash.bytes);
      }
    }
  });

  it("has TXT files rendered from their JSON, with matching content hashes", async () => {
    const run = await readRun();
    for (const page of run.pages.filter((candidate) => candidate.status === "done")) {
      for (const pass of PASSES) {
        const json = await readTranscript(page.slug, pass);
        const txt = await readFile(
          path.join(REPLAY_RUN_DIR, "pages", page.slug, `${pass}.txt`),
          "utf8",
        );
        expect(txt).toBe(renderTranscriptTxt(json));
        expect(contentSha256(extractBody(txt))).toBe(page.passes[pass]!.contentSha256);
        expect(json.stepCount).toBe(json.steps.length);
        expect(page.passes[pass]!.steps).toBe(json.steps.length);
        expect(json.page.key).toBe(page.key);
        expect(json.page.slug).toBe(page.slug);
      }
    }
  });

  // test/replay.test.ts replays this run through the core and gets the same stops and content.
  it("ends each pass naturally: end of page, no next heading, focus leaving the page", async () => {
    const run = await readRun();
    const expected = { read: "end-reached", headings: "no-next-heading", tab: "left-document" };
    for (const page of run.pages.filter((candidate) => candidate.status === "done")) {
      for (const pass of PASSES) {
        const json = await readTranscript(page.slug, pass);
        expect(json.stopReason, `${page.slug} ${pass}`).toBe(expected[pass]);
      }
    }
  });

  it("ends every read pass with the last line repeated, matching the Ctrl+End line", async () => {
    const run = await readRun();
    for (const page of run.pages.filter((candidate) => candidate.status === "done")) {
      const lines = spoken(await readTranscript(page.slug, "read"));
      const last = lines.at(-1)!;
      // The repeat the core detects, plus one confirmation Down Arrow.
      expect(lines.slice(-3), page.slug).toEqual([last, last, last]);
      const ctrlEnd = lines[0]!;
      expect(ctrlEnd === last || ctrlEnd.endsWith(`, ${last}`), page.slug).toBe(true);
    }
  });

  it("puts the duplicate lines and the repeated last line on the duplicates page", async () => {
    const lines = spoken(await transcriptOf(`${FIXTURE_ORIGIN}/duplicates/`, "read"));
    const pair = lines.findIndex(
      (line, index) => line === "Applications are due October 31." && lines[index + 1] === line,
    );
    expect(pair).toBeGreaterThan(0);
    const last = lines.at(-1)!;
    const earlier = lines.slice(2, -4).indexOf(last);
    expect(earlier).toBeGreaterThan(-1);
  });

  it("shows the flawed page's problems in its transcripts", async () => {
    const url = `${FIXTURE_ORIGIN}/flawed/`;
    const read = spoken(await transcriptOf(url, "read"));
    const headings = spoken(await transcriptOf(url, "headings"));
    const tab = await transcriptOf(url, "tab");
    const tabSpoken = spoken(tab);

    expect(read.filter((line) => line.endsWith("link, Read more"))).toHaveLength(3);
    expect(read.some((line) => line.endsWith("link, Click here"))).toBe(true);
    expect(tabSpoken.filter((line) => line.endsWith("Read more, link"))).toHaveLength(3);
    expect(tabSpoken).toContain("Click here, link");

    expect(read).toContain("button");
    expect(tabSpoken).toContain("button");
    expect(read).toContain("edit");
    expect(tabSpoken).toContain("edit, blank");
    expect(read.some((line) => line.includes("graphic"))).toBe(true);

    expect(headings[0]).toMatch(/\blevel 2\b/);

    const firstInMain = tab.steps.findIndex((step) => step.focused?.inMain);
    expect(firstInMain).toBeGreaterThanOrEqual(11);
    expect(tab.steps[0]!.focused?.href?.startsWith("#")).toBe(false);
    expect(tab.steps.some((step) => /skip/i.test(step.focused?.name ?? ""))).toBe(false);
  });

  it("starts the home and duplicates tab passes at the skip link", async () => {
    for (const url of [`${FIXTURE_ORIGIN}/`, `${FIXTURE_ORIGIN}/duplicates/`]) {
      const tab = await transcriptOf(url, "tab");
      expect(tab.initialFocus).toBeNull();
      expect(tab.steps[0]!.focused).toMatchObject({ name: "Skip to main content", href: "#main" });
      const final = tab.steps.at(-1)!;
      expect(final.inDocument).toBe(false);
      expect(final.focused).toBeNull();
      expect(tab.steps.slice(0, -1).every((step) => step.inDocument === true)).toBe(true);
    }
  });

  it("records the skipped URLs with their reasons", async () => {
    const run = await readRun();
    expect(run.skipped).toEqual([
      { url: "https://www.example.com/partner/", reason: "off-origin" },
      { url: `${FIXTURE_ORIGIN}/files/annual-report.pdf`, reason: "non-html-extension" },
      {
        url: `${FIXTURE_ORIGIN}/contact/`,
        reason: "redirect-off-origin",
        finalUrl: CONTACT_REDIRECT,
        // What www.example.com answered when the run was captured.
        status: 404,
      },
      {
        url: `${FIXTURE_ORIGIN}/feed/`,
        reason: "non-html-response",
        finalUrl: `${FIXTURE_ORIGIN}/feed/`,
        contentType: "application/rss+xml; charset=utf-8",
        status: 200,
      },
    ]);
    const onLoad = run.pages.filter((page) => page.status === "skipped");
    expect(onLoad.map((page) => page.skip?.reason)).toEqual([
      "redirect-off-origin",
      "non-html-response",
    ]);
    expect(run.source.listed).toBe((await sitemapLocs()).length);
  });
});

describe("sample reviews.json", () => {
  it("references the run's real hashes, except the entry made against an earlier run", async () => {
    const reviews = JSON.parse(await readFile(REVIEWS_FILE, "utf8")) as ReviewsFile;
    const run = await readRun();
    expect(reviews.schemaVersion).toBe(1);
    expect(Object.keys(reviews.pages).sort()).toEqual(
      [`${FIXTURE_ORIGIN}/`, `${FIXTURE_ORIGIN}/duplicates`, `${FIXTURE_ORIGIN}/flawed`].sort(),
    );
    expect(reviews.pages[`${FIXTURE_ORIGIN}/`]!.map((entry) => entry.status)).toEqual([
      "reviewed",
      "issue",
      "fixed",
    ]);

    for (const [key, entries] of Object.entries(reviews.pages)) {
      const page = run.pages.find((candidate) => candidate.key === key)!;
      for (const entry of entries) {
        expect(entry.reviewer.length).toBeGreaterThan(0);
        expect(entry.url).toBe(page.url);
        const current = Object.fromEntries(
          PASSES.map((pass) => [pass, page.passes[pass]!.contentSha256]),
        );
        if (entry.run === run.id) {
          expect(entry.files).toEqual(
            Object.fromEntries(
              Object.entries(page.files).map(([name, hash]) => [name, hash.sha256]),
            ),
          );
          expect(entry.content).toEqual(current);
        } else {
          // Reviewed against an earlier run: the read transcript changed since, the rest didn't.
          expect(entry.content.read).not.toBe(current.read);
          expect(entry.content.headings).toBe(current.headings);
          expect(entry.content.tab).toBe(current.tab);
        }
      }
    }
    const duplicates = reviews.pages[`${FIXTURE_ORIGIN}/duplicates`]!;
    expect(duplicates.at(-1)!.run).not.toBe(run.id);
  });
});

describe("Speech Viewer capture", () => {
  it("keeps Windows line endings", async () => {
    const text = (await readFile(SPEECH_VIEWER_FILE)).toString("utf8");
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("matches the home read pass once separators and symbols are normalized", async () => {
    const text = (await readFile(SPEECH_VIEWER_FILE)).toString("utf8");
    // Speech Viewer separates items with two spaces and shows symbols as characters ("©");
    // transcripts join items with ", " and have NVDA's spoken names ("copyright").
    const read = spoken(await transcriptOf(`${FIXTURE_ORIGIN}/`, "read"));
    // From Ctrl+Home through the first Down Arrow on the last line.
    expect(speechViewerLines(text)).toEqual(read.slice(1, -2).map(comparableStep));
    expect(text).toContain("©");
  });
});
