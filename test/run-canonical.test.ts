import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { RunJson } from "../src/model.js";
import { runAudit, type RunAuditOptions } from "../src/run/audit.js";
import { readRunJson } from "../src/run/store.js";
import { UsageError } from "../src/util/errors.js";
import { sealOf } from "../src/util/hash.js";
import { createMemoryLogger } from "../src/util/log.js";
import { verifyHome } from "../src/verify.js";
import { config, hangOnce, options, setup } from "./helpers/run-site.js";
import { element, ScriptedDriver, type ScriptedPage } from "./helpers/scripted-driver.js";

/** A copy of a site on this computer: its pages are read here, and name where the site is. */
const COPY = "http://localhost:3000";
/** The address the site's own pages call it by, and the same with www. */
const ROOT = "https://dvfr.illinois.gov/";
const WWW = "https://www.dvfr.illinois.gov/";

/** A page of the copy, declaring `tag` as its canonical tag when it's given. */
function page(pathname: string, tag?: string, extra: Partial<ScriptedPage> = {}): ScriptedPage {
  return {
    url: `${COPY}${pathname}`,
    lines: ["main landmark, heading, level 1, A page", "Some text.", "© 2026 Example Agency"],
    headings: ["heading, level 1, A page"],
    stops: [{ spoken: "Home, link", focused: element("Home") }],
    ...(tag === undefined ? {} : { canonical: tag }),
    ...extra,
  };
}

/** The pages' paths, which a page list names. */
const pathsOf = (pages: ScriptedPage[]) =>
  pages.map((candidate) => new URL(candidate.url).pathname);

/** A run of `pages`, listed in this order, on the copy: its folder, its log, and its record. */
async function runOn(pages: ScriptedPage[], extra: Partial<RunAuditOptions> = {}) {
  const dir = await setup(pathsOf(pages));
  const logger = createMemoryLogger();
  const driver = new ScriptedDriver(pages);
  const result = await runAudit(options(dir, driver, { site: COPY, logger, ...extra }));
  return { dir, logger, result, stored: await readRunJson(result.siteDir, result.runId) };
}

describe("a run's canonical root", () => {
  it("records the root the home page's tag names", async () => {
    const { result, stored } = await runOn([page("/", ROOT), page("/about/"), page("/grants/")]);
    expect(result.outcome).toBe("completed");
    expect(result.run.canonical).toBe(ROOT);
    expect(stored.canonical).toBe(ROOT);
    // The site stays the address voicecap read, and each page keeps the tag it gave.
    expect(stored.site).toBe(COPY);
    expect(stored.pages.map((candidate) => candidate.canonical)).toEqual([ROOT, null, null]);
  });

  // The home page's path ("/") ends any tag's path that ends in "/", so a home page's tag fits
  // whatever page it names. An inner page's tag has to end with that page's own path.
  it("takes the root most inner pages' tags name, over a home page tag that names another page", async () => {
    const { result } = await runOn([
      page("/", `${ROOT}about/`),
      page("/grants/", `${ROOT}grants/`),
      page("/news/", `${ROOT}news/`),
      page("/about/", `${WWW}about/`),
    ]);
    expect(result.run.canonical).toBe(ROOT);
  });

  it("gives a tie between inner pages to the first of them in the run's page order", async () => {
    const grants = page("/grants/", `${ROOT}grants/`);
    const news = page("/news/", `${WWW}news/`);
    // The home page names the other root, so letting it break the tie would change the answer.
    expect((await runOn([page("/", WWW), grants, news])).result.run.canonical).toBe(ROOT);
    expect((await runOn([page("/", ROOT), news, grants])).result.run.canonical).toBe(WWW);
  });

  it("uses the home page's root when no inner page's tag fits", async () => {
    const { result } = await runOn([
      page("/", ROOT),
      page("/grants/", `${ROOT}news/`),
      page("/news/"),
    ]);
    expect(result.run.canonical).toBe(ROOT);
  });

  it("records a root with a path, for a site that lives under one", async () => {
    const { result } = await runOn([
      page("/", "https://example.org/agency/"),
      page("/grants/", "https://example.org/agency/grants/"),
    ]);
    expect(result.run.canonical).toBe("https://example.org/agency/");
  });

  // Each tag is on an inner page: the home page's path fits any tag that ends in "/".
  it.each([
    ["another page of the site", "https://dvfr.illinois.gov/news/"],
    ["a page of another site", "https://other.example.org/news/"],
    ["the copy itself, as a tag written as a path is resolved", `${COPY}/grants/`],
    ["an address that isn't http or https", "ftp://dvfr.illinois.gov/grants/"],
    ["something that isn't an address", "grants"],
  ])("ignores a tag that names %s", async (_what, tag) => {
    const { result, stored } = await runOn([page("/"), page("/grants/", tag)]);
    expect(result.run).not.toHaveProperty("canonical");
    expect(stored).not.toHaveProperty("canonical");
    // The page's own record still says what its tag gave.
    expect(stored.pages[1]?.canonical).toBe(tag);
  });

  it("ignores a home page tag that is the copy's own address", async () => {
    const { stored } = await runOn([page("/", `${COPY}/`), page("/grants/")]);
    expect(stored).not.toHaveProperty("canonical");
  });

  it("reads a page at the address it ended at, so a redirect inside the site still fits its tag", async () => {
    const redirected = page("/about", `${ROOT}about/`, { finalUrl: `${COPY}/about/` });
    const { stored } = await runOn([redirected]);
    expect(stored.canonical).toBe(ROOT);
    expect(stored.pages[0]).toMatchObject({ url: `${COPY}/about`, finalUrl: `${COPY}/about/` });
    // Without the redirect, the tag's path doesn't end with the page's, so it names no root.
    const same = await runOn([page("/about", `${ROOT}about/`)]);
    expect(same.stored).not.toHaveProperty("canonical");
  });

  it("doesn't count a page it skipped or one that failed, and records no tag for either", async () => {
    const { stored } = await runOn([
      page("/", ROOT),
      // Another site's page, and its tag fits it: it says nothing about this site.
      page("/contact/", "https://forms.example.org/contact/", {
        finalUrl: "https://forms.example.org/contact/",
      }),
      page("/gone/", `${WWW}gone/`, { status: 404 }),
      page("/feed/", `${WWW}feed/`, { contentType: "application/rss+xml" }),
    ]);
    expect(stored.pages.map((candidate) => [candidate.status, candidate.canonical])).toEqual([
      ["done", ROOT],
      ["skipped", null],
      ["failed", null],
      ["skipped", null],
    ]);
    expect(stored.canonical).toBe(ROOT);
  });

  it("records null for a page that never loaded, and nothing for a page not yet tried", async () => {
    const broken = new Error("NVDA is not responding");
    const pages = [
      page("/a/", `${ROOT}a/`, { openError: broken }),
      page("/b/", `${ROOT}b/`, { openError: broken }),
      page("/c/", `${ROOT}c/`),
    ];
    const dir = await setup(pathsOf(pages));
    const result = await runAudit({
      ...options(dir, new ScriptedDriver(pages), { site: COPY }),
      config: config({ maxConsecutiveFailures: 2 }),
    });
    expect(result.outcome).toBe("stopped");
    const run = await readRunJson(result.siteDir, result.runId);
    expect(run.pages.map((candidate) => candidate.status)).toEqual(["failed", "failed", "pending"]);
    expect(run.pages[0]?.canonical).toBeNull();
    expect(run.pages[1]?.canonical).toBeNull();
    expect(run.pages[2]).not.toHaveProperty("canonical");
    // The root is chosen when the run completes.
    expect(run).not.toHaveProperty("canonical");
  });

  it("takes a page's tag from the first load of its last attempt", async () => {
    const dir = await setup(["/about/"]);
    const driver = new ScriptedDriver([page("/about/")], { hang: hangOnce("nextLine") });
    // Every load reports a new tag, ?load=1, ?load=2, and so on.
    const openPage = driver.openPage.bind(driver);
    let loads = 0;
    driver.openPage = async (url) => ({
      ...(await openPage(url)),
      canonical: `${ROOT}about/?load=${++loads}`,
    });

    const result = await runAudit(options(dir, driver, { site: COPY }));
    // The first attempt times out in its read pass (load 1). The second loads the page for each of
    // its three passes (loads 2 to 4), and its first load gives the tag.
    expect(loads).toBe(4);
    expect(result.run.pages[0]).toMatchObject({
      status: "done",
      attempts: 2,
      canonical: `${ROOT}about/?load=2`,
    });
    // The tag's query doesn't count.
    expect(result.run.canonical).toBe(ROOT);
  });

  it("records no canonical when no page names one, leaving the key out", async () => {
    const { result, stored } = await runOn([page("/"), page("/about/"), page("/grants/")]);
    expect(result.outcome).toBe("completed");
    expect(result.run).not.toHaveProperty("canonical");
    // `stored` is read from run.json, so the key isn't there either.
    expect(stored).not.toHaveProperty("canonical");
    // Every page was read, and none had a tag.
    expect(stored.pages.map((candidate) => candidate.canonical)).toEqual([null, null, null]);
  });

  it("keeps --canonical out of the run's settings, so it can't change which run resumes", async () => {
    const { result } = await runOn([page("/", ROOT)], { canonical: "https://example.org/" });
    expect(result.run.settings).not.toHaveProperty("canonical");
  });

  it("says nothing about it on the terminal", async () => {
    const named = await runOn([page("/", ROOT), page("/about/")]);
    const given = await runOn([page("/")], { canonical: "dvfr.illinois.gov" });
    expect(named.logger.text()).not.toMatch(/canonical/i);
    expect(given.logger.text()).not.toMatch(/canonical/i);
  });
});

describe("--canonical", () => {
  it("wins over the pages' tags", async () => {
    const { result, stored } = await runOn(
      [page("/", WWW), page("/grants/", `${WWW}grants/`), page("/news/", `${WWW}news/`)],
      { canonical: "https://example.org/agency/" },
    );
    expect(result.run.canonical).toBe("https://example.org/agency/");
    expect(stored.canonical).toBe("https://example.org/agency/");
  });

  it.each([
    ["dvfr.illinois.gov", ROOT],
    ["https://Example.org/agency?x=1#y", "https://example.org/agency/"],
  ])("records a root, from %s, when no page names one", async (given, root) => {
    const { result, stored } = await runOn([page("/"), page("/grants/")], { canonical: given });
    expect(result.run.canonical).toBe(root);
    expect(stored.canonical).toBe(root);
  });

  it.each([
    [
      "ftp://dvfr.illinois.gov",
      `"ftp://dvfr.illinois.gov" isn't a web address, such as https://dvfr.illinois.gov.`,
    ],
    ["", `"" isn't a web address, such as https://dvfr.illinois.gov.`],
    [
      "http://localhost:3000",
      `"http://localhost:3000" is an IP address or a local address, not a site's name; give the address people visit, such as https://dvfr.illinois.gov.`,
    ],
    [
      "127.0.0.1:4848",
      `"127.0.0.1:4848" is an IP address or a local address, not a site's name; give the address people visit, such as https://dvfr.illinois.gov.`,
    ],
  ])("refuses an invalid --canonical, %j, before the run starts", async (value, message) => {
    const dir = await setup(["/"]);
    const driver = new ScriptedDriver([page("/")]);
    const running = runAudit(options(dir, driver, { site: COPY, canonical: value }));
    await expect(running).rejects.toBeInstanceOf(UsageError);
    await expect(running).rejects.toThrow(message);
    expect(driver.starts).toBe(0);
    expect(driver.opened).toEqual([]);
    expect(existsSync(path.join(dir, "transcripts"))).toBe(false);
  });
});

describe("sealing a run", () => {
  it("keeps the seal holding with a root recorded, and the seal covers the root", async () => {
    const { dir, result, stored } = await runOn([page("/", ROOT), page("/about/")]);
    expect(stored.canonical).toBe(ROOT);
    expect(stored.seal).toBe(sealOf(stored));
    const home = path.join(dir, "transcripts");
    const verify = () => verifyHome({ home, logger: createMemoryLogger() });
    expect((await verify()).problems).toBe(0);

    const file = path.join(result.runDir, "run.json");
    const edited = JSON.parse(await readFile(file, "utf8")) as RunJson;
    edited.canonical = "https://elsewhere.example/";
    await writeFile(file, `${JSON.stringify(edited, null, 2)}\n`);
    expect((await verify()).problems).toBe(1);
  });

  it("keeps the seal holding for a run with none, as for a run from before roots were recorded", async () => {
    const { dir, stored } = await runOn([page("/"), page("/about/")]);
    expect(stored.seal).toBe(sealOf(stored));
    const home = path.join(dir, "transcripts");
    expect((await verifyHome({ home, logger: createMemoryLogger() })).problems).toBe(0);
  });

  it("keeps the seal holding when the run completes from a copy of itself, after changed flag rules", async () => {
    const pages = [page("/", ROOT), page("/about/"), page("/grants/")];
    const dir = await setup(pathsOf(pages));
    const controller = new AbortController();
    const first = new ScriptedDriver(pages);
    const openPage = first.openPage.bind(first);
    first.openPage = (url) => {
      if (url.endsWith("/grants/")) controller.abort();
      return openPage(url);
    };
    const interrupted = await runAudit(
      options(dir, first, { site: COPY, signal: controller.signal }),
    );
    expect(interrupted.outcome).toBe("interrupted");

    // A flag rule turned off, so the completed run is sealed and written from a copy of the run.
    const resumed = await runAudit(
      options(dir, new ScriptedDriver(pages), {
        site: COPY,
        config: config({ flags: { genericLinkText: { enabled: false } } }),
      }),
    );
    expect(resumed).toMatchObject({ runId: interrupted.runId, outcome: "completed" });
    const stored = await readRunJson(resumed.siteDir, resumed.runId);
    expect(stored.canonical).toBe(ROOT);
    expect(resumed.run.canonical).toBe(ROOT);
    expect(stored.seal).toBe(sealOf(stored));
  });
});

describe("a resumed run", () => {
  /**
   * `pages` run on the copy, interrupted as the page whose URL ends `stopAt` opens, then resumed.
   * `first` and `later` are the options of the two sessions.
   */
  async function interruptedThenResumed(
    pages: ScriptedPage[],
    stopAt: string,
    {
      first = {},
      later = {},
    }: { first?: Partial<RunAuditOptions>; later?: Partial<RunAuditOptions> } = {},
  ) {
    const dir = await setup(pathsOf(pages));
    const controller = new AbortController();
    const before = new ScriptedDriver(pages);
    const openPage = before.openPage.bind(before);
    before.openPage = (url) => {
      if (url.endsWith(stopAt)) controller.abort();
      return openPage(url);
    };
    const interrupted = await runAudit(
      options(dir, before, { site: COPY, signal: controller.signal, ...first }),
    );
    expect(interrupted.outcome).toBe("interrupted");
    expect(interrupted.run).not.toHaveProperty("canonical");

    const after = new ScriptedDriver(pages);
    const resumed = await runAudit(options(dir, after, { site: COPY, ...later }));
    expect(resumed).toMatchObject({ runId: interrupted.runId, outcome: "completed" });
    expect(resumed.run.sessions).toHaveLength(2);
    return { resumed, opened: after.opened };
  }

  it("counts pages read in an earlier session of a resumed run", async () => {
    const { resumed, opened } = await interruptedThenResumed(
      [page("/grants/", `${ROOT}grants/`), page("/news/"), page("/about/")],
      "/news/",
    );
    // The page that names the root was read before the run was interrupted, and isn't read again.
    // (Each page is opened once for each pass.)
    expect([...new Set(opened)]).toEqual([`${COPY}/news/`, `${COPY}/about/`]);
    expect(resumed.run.canonical).toBe(ROOT);
  });

  it("counts the pages of every session together", async () => {
    const { resumed } = await interruptedThenResumed(
      [page("/a/", `${ROOT}a/`), page("/b/", `${WWW}b/`), page("/c/", `${WWW}c/`)],
      "/c/",
    );
    // Two pages name the www root, and one the other: the earlier session's page counts, and so
    // does the later session's.
    expect(resumed.run.canonical).toBe(WWW);
  });

  it("records the root --canonical gave the session that completed the run, and still resumes it", async () => {
    const pages = [page("/", ROOT), page("/about/"), page("/grants/")];
    const given = await interruptedThenResumed(pages, "/about/", {
      later: { canonical: "https://example.org/agency" },
    });
    expect(given.resumed.run.canonical).toBe("https://example.org/agency/");

    // And a root given only to the session that was interrupted isn't recorded.
    const earlier = await interruptedThenResumed(pages, "/about/", {
      first: { canonical: "https://example.org/agency" },
    });
    expect(earlier.resumed.run.canonical).toBe(ROOT);
  });
});
