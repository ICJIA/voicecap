import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runAudit } from "../src/run/audit.js";
import { sampleRecordOf } from "../src/pages/sample-record.js";
import { shareReport } from "../src/share/share.js";
import { sampleViewOf } from "../src/share/sample.js";
import { SAMPLE_TEXT } from "../src/share/text.js";
import { shareResultOf } from "../src/share/shares.js";
import type { RunJson } from "../src/model.js";
import { UsageError } from "../src/util/errors.js";
import { createMemoryLogger } from "../src/util/log.js";
import { options, outDir, setup, SITE, sitePages } from "./helpers/run-site.js";
import { ScriptedDriver } from "./helpers/scripted-driver.js";

const SITEMAP = `${SITE}/sitemap.xml`;

/** A sitemap of the home page, /about, and three news posts; /resources isn't in it. */
function sitemapFetch(): typeof fetch {
  const urlset =
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    ["/", "/about", "/news/a", "/news/b", "/news/c"]
      .map((p) => `<url><loc>${SITE}${p}</loc></url>`)
      .join("") +
    "</urlset>";
  return (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(
      url === SITEMAP ? new Response(urlset) : new Response("Not found", { status: 404 }),
    );
  };
}

const listed = (paths: string[]) => paths.map((p) => ({ url: `${SITE}${p}`, key: `${SITE}${p}` }));

describe("sampleRecordOf", () => {
  it("counts the sitemap's pages by pattern, most first, and the run's pages it doesn't list", () => {
    const record = sampleRecordOf(
      SITEMAP,
      listed(["/", "/about", "/news/a", "/news/b", "/news/c", "/news/c"]),
      listed(["/", "/news/b", "/search", "/news/b"]),
    );
    expect(record).toEqual({
      sitemap: SITEMAP,
      sitePages: 5,
      groups: [
        { pattern: "/news/*", onSite: 3, sampled: 1 },
        { pattern: "/", onSite: 1, sampled: 1 },
        { pattern: "/*", onSite: 1, sampled: 0 },
      ],
      notInSitemap: 1,
    });
  });
});

describe("sampleViewOf", () => {
  const run = (sample: RunJson["sample"], templates: Record<string, string>) =>
    ({
      sample,
      pages: Object.entries(templates).map(([p, template]) => ({ url: `${SITE}${p}`, template })),
    }) as unknown as RunJson;

  it("names a type by the template its pages share, and leaves it unnamed when they differ", () => {
    const sample = sampleRecordOf(
      SITEMAP,
      listed(["/", "/news/a", "/news/b", "/about/x", "/about/y"]),
      listed(["/news/a", "/news/b", "/about/x", "/about/y"]),
    );
    const view = sampleViewOf(
      run(sample, {
        "/news/a": "News post",
        "/news/b": "News post",
        "/about/x": "Unit",
        "/about/y": "Bio",
      }),
      (url) => url,
      (text) => text,
    );
    expect(view?.types).toEqual([
      { name: null, pattern: "/about/*", onSite: 2, sampled: 2 },
      { name: "News post", pattern: "/news/*", onSite: 2, sampled: 2 },
      { name: null, pattern: "/", onSite: 1, sampled: 0 },
    ]);
    expect(view?.listed).toBe(4);
  });

  it("is null for a run that isn't a sample, and for no run", () => {
    expect(
      sampleViewOf(
        run(undefined, {}),
        (u) => u,
        (t) => t,
      ),
    ).toBeNull();
    expect(
      sampleViewOf(
        null,
        (u) => u,
        (t) => t,
      ),
    ).toBeNull();
  });
});

describe("--sample-of", () => {
  it("records the sample as the run is made, and the report says the pages are one", async () => {
    const dir = await setup();
    await writeFile(
      path.join(dir, "pages.json"),
      JSON.stringify([
        { url: "/", label: "Home", template: "one-off", notes: "home page" },
        { url: "/about", template: "one-off", notes: "one-off page: every one is in" },
        { url: "/resources", notes: "not in the sitemap" },
      ]),
    );
    const logger = createMemoryLogger();
    const result = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), {
        sampleOf: "sitemap.xml",
        fetch: sitemapFetch(),
        logger,
      }),
    );
    expect(result.outcome).toBe("completed");
    expect(result.run.sample).toEqual({
      sitemap: SITEMAP,
      sitePages: 5,
      groups: [
        { pattern: "/news/*", onSite: 3, sampled: 0 },
        { pattern: "/", onSite: 1, sampled: 1 },
        { pattern: "/*", onSite: 1, sampled: 1 },
      ],
      notInSitemap: 1,
    });
    // It isn't a setting: the same command without it is the same run.
    expect(result.run.settings).not.toHaveProperty("sample");
    expect(logger.text()).toContain(
      `A sample of the 5 pages ${SITEMAP} lists: 2 pages of them, and 1 page it doesn't list.`,
    );

    const page = await readFile(path.join(outDir(dir), "share", "current.html"), "utf8");
    expect(page).toContain(`<h3 id="sample-h">${SAMPLE_TEXT.title}</h3>`);
    expect(page).toContain(
      `This report covers 3 pages: 2 of the 5 pages the sitemap ${SITEMAP} lists, chosen to stand for the rest, and 1 page it doesn&#39;t list.`,
    );
    expect(page).toContain(
      "Professional auditors who test with a screen reader don&#39;t go through every page",
    );
    expect(page).toContain(
      '<th scope="row">/news/*</th><td class="num">3</td><td class="num">0</td>',
    );
    expect(page).toContain(
      '<th scope="row">one-off (/)</th><td class="num">1</td><td class="num">1</td>',
    );
    // /about and /resources share "/*" but not a template, so it goes by its pattern alone.
    expect(page).toContain('<th scope="row">/*</th><td class="num">1</td><td class="num">1</td>');
    expect(page).toContain(`<p class="sub">${SAMPLE_TEXT.card}: one-off page: every one is in</p>`);

    // The share records the sitemap's count for the website, and writes the sample for AI tools.
    const home = path.join(dir, "transcripts");
    await shareReport({
      out: home,
      site: SITE,
      reviewer: "Test Reviewer",
      now: new Date("2026-11-11T12:00:00-06:00"),
      logger: createMemoryLogger(),
      cwd: dir,
      env: {},
    });
    const shares = JSON.parse(
      await readFile(path.join(outDir(dir), "share", "shares.json"), "utf8"),
    ) as { shares: { result: unknown }[] };
    const recorded = shareResultOf(shares.shares.at(-1)?.result);
    expect(recorded?.sample).toEqual({ sitePages: 5 });
    expect(SAMPLE_TEXT.site(recorded!.pages, 5)).toBe(
      "A sample of the site: 3 pages, chosen by type of page from the 5 pages its sitemap lists.",
    );
    const files = await readdir(path.join(outDir(dir), "share"));
    const markdown = await readFile(
      path.join(
        outDir(dir),
        "share",
        files.find((name) => name.endsWith(".md"))!,
      ),
      "utf8",
    );
    expect(markdown).toContain(`### ${SAMPLE_TEXT.title}`);
    expect(markdown).toContain("- /news/\\*: 0 of 3");
    const json = JSON.parse(
      await readFile(
        path.join(
          outDir(dir),
          "share",
          files.find((name) => name.endsWith(".json") && name !== "shares.json")!,
        ),
        "utf8",
      ),
    ) as { sample?: { sitePages: number }; pages: { chosen?: string }[] };
    expect(json.sample?.sitePages).toBe(5);
    expect(json.pages[0]?.chosen).toBe("home page");
  });

  it("is refused beside --sitemap, which reads every page it lists", async () => {
    const dir = await setup();
    await expect(
      runAudit(
        options(dir, new ScriptedDriver(sitePages()), {
          pages: null,
          sitemap: "sitemap.xml",
          sampleOf: "sitemap.xml",
          fetch: sitemapFetch(),
        }),
      ),
    ).rejects.toThrow(UsageError);
  });

  it("leaves a run without it as it was: no sample, and no box", async () => {
    const dir = await setup();
    const result = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    expect(result.run).not.toHaveProperty("sample");
    const page = await readFile(path.join(outDir(dir), "share", "current.html"), "utf8");
    expect(page).not.toContain("sample-h");
    expect(page).not.toContain(SAMPLE_TEXT.card);
  });
});
