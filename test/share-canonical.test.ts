/**
 * The shareable page names a site by its canonical address (0.10.0): the host of the root that
 * `report.canonical` gives, else the root the latest run recorded, else, with neither, the address
 * voicecap read. Every address the page and its Word copy show for a page is that page on the root,
 * and nothing a reader meets leads with, or holds, the address of a copy on the tester's computer.
 * The records keep the address voicecap read.
 *
 * The demo runs of 29 September 2026 (voicecap 0.4.1, in test/fixtures/share/) are the real case:
 * read on a copy at http://127.0.0.1:4848, whose canonical address is the demo's,
 * https://voicecap.netlify.app/demo-site/. Runs built in memory cover what the demo has none of: a
 * page no longer listed, a label, a page that sounds different, a failure, a page on another site,
 * and runs that recorded their own canonical root.
 */
import { writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { FlagResult, PageSource, RunJson } from "../src/model.js";
import { runJsonPath } from "../src/run/paths.js";
import { renderWordCopy } from "../src/share/docx.js";
import { renderSharePage } from "../src/share/html/document.js";
import { loadShareInput, resolveCanonical } from "../src/share/load.js";
import { buildShareModel, type ShareModel } from "../src/share/model.js";
import { PROBLEMS_TEXT } from "../src/share/text.js";
import { parseWalkthrough } from "../src/share/walkthrough.js";
import { documentTitle } from "../src/share/words.js";
import { sealOf } from "../src/util/hash.js";
import {
  footerWords,
  linksOf,
  paragraphsOf,
  propertyOf,
  tablesOf,
  unzipDocx,
} from "./helpers/docx.js";
import { tempOutDir, writeSyntheticRun, type SyntheticRun } from "./helpers/report-data.js";
import { failedAttempt, shareRun } from "./helpers/share-data.js";
import { attributes, decode } from "./helpers/share-html.js";
import {
  DEMO_ROOT,
  DEMO_SITE,
  demoModel,
  downloadOf,
  fileBytes,
  inputOf,
  LINES,
  storeOf,
  TRANSCRIPTS,
} from "./helpers/share-model.js";

/** The address the demo's runs read: a copy on the tester's computer. */
const READ = "http://127.0.0.1:4848";

/** What the demo's canonical address makes of it. */
const NAME = "voicecap.netlify.app";

/** The address of a page of the demo, on its canonical address. */
const on = (path: string): string => `${DEMO_ROOT}${path}`;

/** What marks the address of a copy on this computer, wherever it shows. */
const LOCAL_ADDRESS = /127\.0\.0\.1|localhost/i;

/** Each page the cards of what needs attention are on, once, by the name the cards give it. */
const namesOnCards = ({ attention }: ShareModel): string[] => [
  ...new Set(attention.flatMap(({ pages }) => pages.map(({ name }) => name))),
];

/** A run written as voicecap writes one, then sealed as a completed run is, with a recorded root. */
async function sealedRunOf(siteDir: string, spec: SyntheticRun, root: string): Promise<RunJson> {
  const run = { ...(await writeSyntheticRun(siteDir, spec)), canonical: root };
  const sealed: RunJson = { ...run, seal: sealOf(run) };
  await writeFile(runJsonPath(siteDir, run.id), `${JSON.stringify(sealed, null, 2)}\n`);
  return sealed;
}

describe("resolveCanonical", () => {
  const recorded = shareRun({ id: "r1", canonical: "https://dvfr.illinois.gov/", pages: [] });
  const unrecorded = shareRun({ id: "r2", pages: [] });

  it("is the root the config gives, whatever the latest run recorded", () => {
    expect(resolveCanonical({ configCanonical: DEMO_ROOT, latest: recorded })).toBe(DEMO_ROOT);
    expect(resolveCanonical({ configCanonical: DEMO_ROOT, latest: unrecorded })).toBe(DEMO_ROOT);
    expect(resolveCanonical({ configCanonical: DEMO_ROOT, latest: null })).toBe(DEMO_ROOT);
  });

  it("is the root the latest run recorded, when the config gives none", () => {
    expect(resolveCanonical({ configCanonical: null, latest: recorded })).toBe(
      "https://dvfr.illinois.gov/",
    );
  });

  it("is none when neither gives one: a run from before 0.10.0 recorded none, and no run may count", () => {
    expect(resolveCanonical({ configCanonical: null, latest: unrecorded })).toBeNull();
    expect(resolveCanonical({ configCanonical: null, latest: null })).toBeNull();
  });

  // A record is data, which something other than voicecap may have written: a recorded root that
  // isn't a site's name never names the site, and never leads the page.
  it.each([
    ["an IP address", "http://127.0.0.1:4848/"],
    ["a local address", "http://localhost:3000/"],
    ["an IPv6 address", "http://[::1]:4848/"],
    ["something that isn't an address", "not an address"],
    ["another scheme", "ftp://dvfr.illinois.gov/"],
    ["nothing", ""],
  ])("ignores a recorded root that is %s", (_, root) => {
    const run = shareRun({ id: "r1", canonical: root, pages: [] });

    expect(resolveCanonical({ configCanonical: null, latest: run })).toBeNull();
  });

  it("ignores a recorded root that isn't text", () => {
    const run = { ...shareRun({ id: "r1", pages: [] }), canonical: 42 as unknown as string };

    expect(resolveCanonical({ configCanonical: null, latest: run })).toBeNull();
  });

  it("is as a recorded root is written, once it fits: with its slash", () => {
    const run = shareRun({ id: "r1", canonical: "https://dvfr.illinois.gov", pages: [] });

    expect(resolveCanonical({ configCanonical: null, latest: run })).toBe(
      "https://dvfr.illinois.gov/",
    );
  });
});

describe("loadShareInput", () => {
  it("gives the address voicecap read, and the config's root", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      report: { ...DEFAULT_CONFIG.report, canonical: DEMO_ROOT },
    };

    expect(await loadShareInput({ siteDir: DEMO_SITE, config })).toMatchObject({
      readOrigin: READ,
      canonical: DEMO_ROOT,
    });
    // The demo's runs are from before 0.10.0: none recorded a root, and the config gave none.
    expect(await loadShareInput({ siteDir: DEMO_SITE, config: DEFAULT_CONFIG })).toMatchObject({
      readOrigin: READ,
      canonical: null,
    });
  });

  it("gives the root the latest counted run recorded, and the config's over it", async () => {
    const siteDir = await tempOutDir();
    await sealedRunOf(siteDir, { id: "2026-09-26_1405", pages: [{ path: "/" }] }, DEMO_ROOT);

    expect(await loadShareInput({ siteDir, config: DEFAULT_CONFIG })).toMatchObject({
      canonical: DEMO_ROOT,
    });
    const config = {
      ...DEFAULT_CONFIG,
      report: { ...DEFAULT_CONFIG.report, canonical: "https://dvfr.illinois.gov/" },
    };
    expect(await loadShareInput({ siteDir, config })).toMatchObject({
      canonical: "https://dvfr.illinois.gov/",
    });
  });
});

describe("the header", () => {
  it("names the site by the host of the root report.canonical gives", async () => {
    const model = await demoModel(DEMO_ROOT);

    expect(model.header).toMatchObject({ name: NAME, site: DEMO_ROOT });
    expect(documentTitle(model.header)).toBe(`${NAME}: how its pages read aloud with NVDA`);
  });

  it("names the site by the host of the root the latest run recorded", async () => {
    const siteDir = await tempOutDir();
    await sealedRunOf(siteDir, { id: "2026-09-26_1405", pages: [{ path: "/" }] }, DEMO_ROOT);

    const model = buildShareModel(await loadShareInput({ siteDir, config: DEFAULT_CONFIG }));

    expect(model.header).toMatchObject({ name: NAME, site: DEMO_ROOT });
  });

  it("names a root with a port by its host and port, as the root says it", () => {
    const run = shareRun({ id: "r1", pages: [{ path: "/" }] });
    const model = buildShareModel(inputOf([run], { canonical: "https://staging.dvfr.org:8443/" }));

    expect(model.header).toMatchObject({
      name: "staging.dvfr.org:8443",
      site: "https://staging.dvfr.org:8443/",
    });
  });

  it("falls back to the host voicecap read for runs that recorded none, never the home page's title", () => {
    const run = shareRun({
      id: "r1",
      site: READ,
      pages: [
        { path: "/", title: "Example Agency" },
        { path: "/about/", title: "About us" },
      ],
    });
    const model = buildShareModel(inputOf([run], { readOrigin: READ }));

    expect(model.header).toMatchObject({ name: "127.0.0.1:4848", site: READ, readFrom: null });
  });

  it("shows report.siteName as a line of its own, not as the name", () => {
    const run = shareRun({ id: "r1", pages: [{ path: "/", title: "Example Agency" }] });
    const named = buildShareModel(
      inputOf([run], { canonical: DEMO_ROOT, siteName: "  The voicecap demo " }),
    );

    expect(named.header).toMatchObject({ name: NAME, siteName: "The voicecap demo" });
    expect(documentTitle(named.header)).toBe(`${NAME}: how its pages read aloud with NVDA`);
    // Without it, or with only blanks, there is no line.
    expect(buildShareModel(inputOf([run])).header.siteName).toBeNull();
    expect(buildShareModel(inputOf([run], { siteName: "   " })).header.siteName).toBeNull();
  });

  it("dates the test by when the latest run began, as that run recorded it", () => {
    const earlier = shareRun({
      id: "r1",
      createdAt: "2026-09-25T10:15:00-05:00",
      pages: [{ path: "/" }],
    });
    const latest = shareRun({
      id: "r2",
      createdAt: "2026-09-29T14:02:31.482+01:00",
      pages: [{ path: "/" }],
    });

    // In the run's own offset, not the computer's: the fields are read as they are written.
    expect(buildShareModel(inputOf([earlier, latest])).header.testedAt).toBe(
      "29 September 2026, 14:02",
    );
    // With no run that counts, nothing was tested.
    const replay = shareRun({ id: "r3", replayed: true, pages: [{ path: "/" }] });
    expect(buildShareModel(inputOf([replay])).header.testedAt).toBeNull();
  });

  // A run is created, then its first session starts: the test began with the session, as the
  // days the page says it was tested on, and the evidence's Started row, say.
  it("dates the test by when the latest run's first session began, not when the run was created", () => {
    const run = shareRun({
      id: "r1",
      createdAt: "2026-09-29T14:02:31.482+01:00",
      sessions: [
        { startedAt: "2026-09-29T14:03:40.120+01:00", endedAt: "2026-09-29T14:09:00.000+01:00" },
        { startedAt: "2026-09-29T15:30:00.000+01:00", endedAt: "2026-09-29T15:40:00.000+01:00" },
      ],
      pages: [{ path: "/" }],
    });
    const model = buildShareModel(inputOf([run]));

    expect(model.header.testedAt).toBe("29 September 2026, 14:03");
    const started = model.evidence[0]?.facts.find(({ label }) => label === "Started");
    expect(started?.value).toBe("29 September 2026, 14:03");
  });

  it("says where the runs read the site: the same address, a copy on this computer, or a copy elsewhere", () => {
    const readFrom = (readOrigin: string, canonical: string | null) =>
      buildShareModel(
        inputOf([shareRun({ id: "r1", site: readOrigin, pages: [{ path: "/" }] })], {
          readOrigin,
          canonical,
        }),
      ).header.readFrom;

    expect(readFrom("https://dvfr.illinois.gov", "https://dvfr.illinois.gov/")).toBe("same");
    expect(readFrom(READ, DEMO_ROOT)).toBe("local");
    expect(readFrom("http://localhost:3000", DEMO_ROOT)).toBe("local");
    expect(readFrom("https://staging.dvfr.illinois.gov", "https://dvfr.illinois.gov/")).toBe(
      "elsewhere",
    );
    // With no root, the site is named by what voicecap read: there's no copy to speak of.
    expect(readFrom(READ, null)).toBeNull();
  });
});

describe("the addresses a model shows", () => {
  it("maps each page's address onto the root, keeping its path and query", async () => {
    const model = await demoModel(DEMO_ROOT);

    // The home page is the root itself.
    expect(model.pages.map(({ name }) => name)).toEqual([
      DEMO_ROOT,
      on("before-you-start/"),
      on("how-a-run-works/"),
      on("reading-transcripts/"),
      on("the-report/"),
      on("ask-a-question/"),
      on("common-mistakes/"),
    ]);
    // A page's path is its address without the site's, so it doesn't change.
    expect(model.pages.map(({ path }) => path)).toEqual([
      "/",
      "/before-you-start/",
      "/how-a-run-works/",
      "/reading-transcripts/",
      "/the-report/",
      "/ask-a-question/",
      "/common-mistakes/",
    ]);
    expect(model.appendix.map(({ name }) => name)).toEqual(model.pages.map(({ name }) => name));
    expect(model.flagged.map(({ card }) => card.name)).toEqual([on("common-mistakes/")]);
    expect(model.heard?.page).toBe(DEMO_ROOT);
  });

  it("maps the address in each sentence that names a page, and the sitemap the pages came from", async () => {
    const model = await demoModel(DEMO_ROOT);

    // The cards of what needs attention name each page as the page does: on the root.
    expect(namesOnCards(model)).toEqual([on("common-mistakes/"), on("how-a-run-works/")]);
    expect(model.summary.todo).toEqual([
      `${on("how-a-run-works/")} couldn't be read in the latest run (another window took the screen). Its transcripts are from run 2026-09-29_1315. Read it again.`,
      `Take a closer listen to ${on("common-mistakes/")}, where flags were raised, and record what you decide.`,
    ]);
    expect(model.coverage.covered[0]).toBe(`7 pages from the sitemap ${on("sitemap.xml")}.`);
    const rows = new Map(model.evidence[0]?.environment.map((row) => [row.label, row.value]));
    expect(rows.get("Page source")).toBe(`sitemap ${on("sitemap.xml")}`);
  });

  it("offers the commands for the canonical address, and the files named for it", async () => {
    const model = await demoModel(DEMO_ROOT);

    expect(model.evidence).toHaveLength(2);
    for (const each of model.evidence) {
      const file = downloadOf(each);
      const name = `${NAME}_${each.run.id}_walkthrough.json`;

      // It checks every site in the home, so it names none.
      expect(each.verify).toBe("npx @icjia/voicecap verify");
      expect(file.fileName).toBe(name);
      expect(file.get).toBe(
        `npx @icjia/voicecap walkthrough --site ${DEMO_ROOT} --run ${each.run.id} ${name}`,
      );
      expect(file.repeat).toBe(`npx @icjia/voicecap --walkthrough ${name}`);
    }
  });

  it("keeps the address voicecap read in the records, the walkthrough files, and the check's data", async () => {
    const model = await demoModel(DEMO_ROOT);

    for (const each of model.evidence) {
      expect(each.run.site).toBe(READ);
      expect(each.run.pages.every(({ url }) => url.startsWith(`${READ}/`))).toBe(true);
      // A repeat runs where voicecap read, so the file says so, as `voicecap walkthrough` writes it.
      const file = downloadOf(each);
      expect(parseWalkthrough(fileBytes(file).toString("utf8"), file.fileName).site).toBe(READ);
    }
    expect(model.check.runs.map(({ site }) => site)).toEqual([READ, READ]);
  });

  it("names a site known only by the address voicecap read as before, and its commands too", async () => {
    const model = await demoModel();

    expect(model.pages[1]?.name).toBe(`${READ}/before-you-start/`);
    expect(model.heard?.page).toBe(`${READ}/`);
    expect(model.coverage.covered[0]).toBe(`7 pages from the sitemap ${READ}/sitemap.xml.`);
    const file = downloadOf(model.evidence[0]!);
    expect(file.fileName).toBe(`127.0.0.1_4848_${model.evidence[0]?.run.id}_walkthrough.json`);
    expect(file.get).toContain(`walkthrough --site ${READ} --run`);
    // Only the command that checks every site drops the site.
    expect(model.evidence[0]?.verify).toBe("npx @icjia/voicecap verify");
  });
});

/** A flag the earlier run raised on a page, and the later run's fix of it. */
const LINK_FLAG: FlagResult = {
  rule: "generic-link-text",
  pass: "read",
  count: 1,
  found: [{ text: "click here", count: 1 }],
  message: 'Generic link text announced 1 time in the read pass: "click here" ×1.',
};

const FIXED = LINES.read.map((line) => line.replace("click here", "Read the FY27 plan"));

const SITEMAP: PageSource = { kind: "sitemap", url: `${READ}/sitemap.xml` };

const EARLIER = { id: "2026-09-26_1405", createdAt: "2026-09-26T14:05:00-05:00" };
const LATER = { id: "2026-09-27_0930", createdAt: "2026-09-27T09:30:00-05:00" };

/** What a failed attempt at a page on the copy says, which is what voicecap recorded of it. */
const REFUSED = `page.goto: net::ERR_CONNECTION_REFUSED at ${READ}/broken/`;

/**
 * Two runs on a copy of the site at http://127.0.0.1:4848, with what the demo has none of. A page
 * no longer listed (`/old/`, and `/older/` with a label), a page with a label (`/grants/`), one
 * that sounds different, whose flag is resolved (`/apply/`), a new one with a flag (`/forms/`), a
 * page with a query, one that failed in the latest run (`/broken/`, read by the run before) and one
 * that was skipped, and a page on another site. The latest run's pages come from a sitemap.
 */
function copyModel(canonical: string | null): ShareModel {
  const pages = (latest: boolean) =>
    latest
      ? [
          { path: "/", title: "Home", files: TRANSCRIPTS, passes: LINES },
          {
            path: "/apply/",
            files: TRANSCRIPTS,
            passes: { ...LINES, read: FIXED },
          },
          { path: "/grants/", label: "Grants", files: TRANSCRIPTS, passes: LINES },
          { path: "/forms/", files: TRANSCRIPTS, passes: LINES, flags: [LINK_FLAG] },
          { path: "/search/?q=nvda", files: TRANSCRIPTS, passes: LINES },
          {
            path: "/broken/",
            status: "failed" as const,
            failedAttempts: [failedAttempt({ n: 1, cause: "unreachable", message: REFUSED })],
          },
          { path: "/skipped/", status: "skipped" as const },
          { path: "https://other.example/offsite/", files: TRANSCRIPTS, passes: LINES },
        ]
      : [
          { path: "/", files: TRANSCRIPTS, passes: LINES },
          { path: "/apply/", files: TRANSCRIPTS, passes: LINES, flags: [LINK_FLAG] },
          { path: "/grants/", label: "Grants", files: TRANSCRIPTS, passes: LINES },
          { path: "/old/", files: TRANSCRIPTS, passes: LINES },
          { path: "/older/", label: "An older page", files: TRANSCRIPTS, passes: LINES },
          { path: "/broken/", files: TRANSCRIPTS, passes: LINES },
        ];
  const runs = [
    shareRun({ ...EARLIER, site: READ, source: SITEMAP, pages: pages(false) }),
    shareRun({
      ...LATER,
      site: READ,
      source: SITEMAP,
      sessions: [{ reviewer: "Pat Lee" }],
      pages: pages(true),
    }),
  ];
  const apply = runs[1]?.pages[1]?.slug;
  const transcripts = storeOf((slug, run) =>
    run === LATER.id && slug === apply ? { ...LINES, read: FIXED } : LINES,
  );
  return buildShareModel(inputOf(runs, { readOrigin: READ, canonical, transcripts }));
}

describe("every address the page shows for a page", () => {
  const model = copyModel(DEMO_ROOT);

  it("is the page on the root, whether its name is its address, its path is, or it has a label", () => {
    expect(model.pages.map(({ name }) => name)).toEqual([
      DEMO_ROOT,
      on("apply/"),
      "Grants",
      on("forms/"),
      on("search/?q=nvda"),
      on("broken/"),
      on("skipped/"),
      // On another site, so it isn't on the root.
      "https://other.example/offsite/",
    ]);
    expect(model.pages.map(({ path }) => path)).toEqual([
      "/",
      "/apply/",
      "/grants/",
      "/forms/",
      "/search/?q=nvda",
      "/broken/",
      "/skipped/",
      "/offsite/",
    ]);
  });

  it("is the page on the root in the sample of what NVDA said, the flags, and the appendix", () => {
    expect(model.heard?.page).toBe(DEMO_ROOT);
    expect(model.flagged.map(({ card }) => card.name)).toEqual([on("forms/")]);
    expect(model.appendix.map(({ name }) => name)).toEqual([
      DEMO_ROOT,
      on("apply/"),
      "Grants",
      on("forms/"),
      on("search/?q=nvda"),
      on("broken/"),
      "https://other.example/offsite/",
    ]);
  });

  it("is the page on the root in the pages no longer listed, with a label as it is", () => {
    expect(model.noLongerListed).toEqual([
      { name: on("old/"), url: on("old/"), lastRun: EARLIER.id, lastStatus: "Transcribed" },
      { name: "An older page", url: on("older/"), lastRun: EARLIER.id, lastStatus: "Transcribed" },
    ]);
  });

  it("is the page on the root in the summary: what needs attention, and what's still to do", () => {
    expect(namesOnCards(model)).toEqual([on("forms/"), on("broken/")]);
    expect(model.summary.todo).toEqual([
      `${on("broken/")} couldn't be read in the latest run (the website couldn't be reached). Its transcripts are from run ${EARLIER.id}. Read it again.`,
      `${on("skipped/")} was skipped: the site didn't answer with an HTML page. Check whether it belongs on the list.`,
      `Take a closer listen to ${on("forms/")}, where flags were raised, and record what you decide.`,
    ]);
  });

  it("is the page on the root in what changed since the last run", () => {
    const resolved = `Resolved: on ${on("apply/")}, the links that don't say where they go (generic-link-text).`;

    expect(model.changes?.line).toContain(resolved);
    expect(model.summary.changesLine).toContain(
      `this flag is resolved: on ${on("apply/")}, the links that don't say where they go.`,
    );
  });

  it("is the page on the root in the sitemap the pages came from, and in the pages given", () => {
    expect(model.coverage.covered[0]).toBe(`8 pages from the sitemap ${on("sitemap.xml")}.`);
    const rows = new Map(model.evidence[0]?.environment.map((row) => [row.label, row.value]));
    expect(rows.get("Page source")).toBe(`sitemap ${on("sitemap.xml")}`);

    // Pages given with --page: each address is mapped, and one on another site is left as it is.
    const given: PageSource = {
      kind: "urls",
      urls: [`${READ}/a/`, "https://other.example/b/", `${READ}/c/?x=1`],
    };
    const run = shareRun({ id: "r1", site: READ, source: given, pages: [{ path: "/a/" }] });
    const spot = buildShareModel(inputOf([run], { readOrigin: READ, canonical: DEMO_ROOT }));
    const spotRows = new Map(spot.evidence[0]?.environment.map((row) => [row.label, row.value]));
    expect(spotRows.get("Page source")).toBe(
      `3 pages (${on("a/")}, https://other.example/b/, ${on("c/?x=1")})`,
    );

    // A page list is named by its file, which holds no address of the site to map.
    const listed = shareRun({ id: "r2", site: READ, pages: [{ path: "/a/" }] });
    const list = buildShareModel(inputOf([listed], { readOrigin: READ, canonical: DEMO_ROOT }));
    const listRows = new Map(list.evidence[0]?.environment.map((row) => [row.label, row.value]));
    expect(listRows.get("Page source")).toBe(`page list pages.csv (sha256 ${"a".repeat(64)})`);
  });

  it("is left as it was with no root, and for a page on another site", () => {
    const bare = copyModel(null);

    expect(bare.pages[1]?.name).toBe(`${READ}/apply/`);
    expect(bare.heard?.page).toBe(`${READ}/`);
    expect(bare.noLongerListed[0]?.url).toBe(`${READ}/old/`);
    expect(bare.coverage.covered[0]).toBe(`8 pages from the sitemap ${READ}/sitemap.xml.`);
    expect(bare.pages.at(-1)?.name).toBe("https://other.example/offsite/");
  });

  it("keeps the problems' records word for word, and no more of the address voicecap read", () => {
    const [problem] = model.problems.problems;

    expect(model.problems.problems).toHaveLength(1);
    expect(problem?.record.map(({ entry }) => entry)).toContain(`Failed: unreachable: ${REFUSED}`);
    // The page's path is all a problem says of it, as before.
    expect(problem?.page.slug).toBe(model.pages[5]?.slug);
  });
});

/**
 * Everything a reader of the page meets, as separate strings: each run of its words, with its
 * entities decoded, and the values of the attributes that name or address something (links, names
 * for a screen reader, a picture's description, a download's name, a title). What isn't for a
 * reader is left out:
 * - the page's scripts and its style block, and with them `#fp-data`, the sealed records its
 *   fingerprint check reads, which are exactly as recorded;
 * - the data addresses that carry each run's walkthrough file, which says where voicecap read;
 * - a problem's record, which quotes what happened word for word.
 */
function pageMeets(html: string): string[] {
  const read = html
    .replace(/<script\b[\s\S]*?<\/script>/g, "")
    .replace(/<style\b[\s\S]*?<\/style>/g, "")
    .replace(/<table class="logtable">[\s\S]*?<\/table>/g, "")
    .replace(/<pre class="logblock">[\s\S]*?<\/pre>/g, "");
  const words = read
    .split(/<[^>]*>/)
    .map((text) => decode(text).trim())
    .filter((text) => text !== "");
  const named = ["href", "aria-label", "alt", "download", "title"]
    .flatMap((name) => attributes(read, name))
    .map(decode)
    .filter((value) => !value.startsWith("data:"));
  return [...words, ...named];
}

/**
 * Everything a reader of the Word copy meets: each paragraph and each cell of each table, the
 * words in the footer of each page, the document's title and author, and each address it links to.
 * A problem's record is left out: it quotes what happened word for word.
 */
async function wordMeets(model: ShareModel): Promise<string[]> {
  const parts = await unzipDocx(await renderWordCopy(model));
  const records = PROBLEMS_TEXT.record.head.join("|");
  const tables = tablesOf(parts.document).filter(
    ({ rows }) => (rows[0] ?? []).join("|") !== records,
  );
  return [
    ...paragraphsOf(parts.document).map(({ text }) => text),
    ...tables.flatMap(({ rows }) => rows.flat()),
    ...footerWords(parts.footer),
    propertyOf(parts.core, "dc:title"),
    propertyOf(parts.core, "dc:creator"),
    ...linksOf(parts),
  ];
}

describe("the page shows no address of a copy on this computer", () => {
  it("leaves none in a word, a link, a name, or a title of the demo's page", async () => {
    const model = await demoModel(DEMO_ROOT);
    const html = renderSharePage(model, { fontCss: "" });
    const met = pageMeets(html);

    // The guard sees what it should: the page leads with the canonical name, and the pages are on
    // the root.
    expect(html).toContain(`<title>${NAME}: how its pages read aloud with NVDA</title>`);
    expect(html).toContain(`<h1>${NAME}</h1>`);
    expect(met).toContain("Tested 29 September 2026, 14:02");
    // The address of the site comes last, small, and is the root, linked.
    expect(met).toContain("Site address");
    expect(attributes(html, "href")).toContain(DEMO_ROOT);
    expect(html).toContain(`<a href="${DEMO_ROOT}">${DEMO_ROOT}</a></span>`);
    expect(met).toContain(`Heard on this site: ${DEMO_ROOT}, three ways`);
    expect(met).toContain(`${on("common-mistakes/")}:`);
    expect(met).toContain(`7 pages from the sitemap ${on("sitemap.xml")}.`);
    expect(met).toContain("npx @icjia/voicecap verify");
    expect(met).toContain(`${NAME}_2026-09-29_1402_walkthrough.json`);

    expect(met.filter((text) => LOCAL_ADDRESS.test(text))).toEqual([]);
    // The records the page carries for its fingerprint check are as recorded, so they have it.
    expect(
      /<script type="application\/json" id="fp-data">[\s\S]*?<\/script>/.exec(html)?.[0],
    ).toContain(READ);
  });

  it("leaves none in a word or a link of the demo's Word copy", async () => {
    const model = await demoModel(DEMO_ROOT);
    const met = await wordMeets(model);

    expect(met).toContain(NAME);
    expect(met).toContain("Tested 29 September 2026, 14:02. This copy was made 30 September 2026.");
    expect(met).toContain(`Site address ${DEMO_ROOT}.`);
    expect(met).toContain(`${NAME}: how its pages read aloud with NVDA`);
    expect(met).toContain(`${NAME}, as of 30 September 2026. Page `);
    expect(met).toContain(`Heard on this site: ${DEMO_ROOT}, three ways`);
    expect(met).toContain(`7 pages from the sitemap ${on("sitemap.xml")}.`);
    expect(met).toContain("npx @icjia/voicecap verify");
    expect(met).toContain(
      `npx @icjia/voicecap walkthrough --site ${DEMO_ROOT} --run 2026-09-29_1402 ${NAME}_2026-09-29_1402_walkthrough.json`,
    );

    expect(met.filter((text) => LOCAL_ADDRESS.test(text))).toEqual([]);
  });

  it("leaves none in a page with a label, a query, a page no longer listed, a flag resolved, and a failure", () => {
    const model = copyModel(DEMO_ROOT);
    const html = renderSharePage(model, { fontCss: "" });
    const met = pageMeets(html);

    // Each place a page's address shows is the page on the root.
    expect(met).toContain(on("old/"));
    expect(met).toContain(`${on("forms/")}:`);
    expect(met).toContain(`${on("search/?q=nvda")}:`);
    expect(
      met.some((text) => text.includes(`Resolved: on ${on("apply/")}, the links that don't say`)),
    ).toBe(true);
    expect(met).toContain(`8 pages from the sitemap ${on("sitemap.xml")}.`);
    // A problem's record says word for word what voicecap recorded, address and all.
    expect(html).toContain(`Failed: unreachable: ${REFUSED}`);

    expect(met.filter((text) => LOCAL_ADDRESS.test(text))).toEqual([]);
  });

  it("leaves none in the Word copy of that page either", async () => {
    const model = copyModel(DEMO_ROOT);
    const met = await wordMeets(model);

    expect(met).toContain(on("old/"));
    expect(met.some((text) => text.includes(`Resolved: on ${on("apply/")},`))).toBe(true);
    expect(met).toContain(`${on("forms/")}: 1 flag`);
    expect(met).toContain(`8 pages from the sitemap ${on("sitemap.xml")}.`);

    expect(met.filter((text) => LOCAL_ADDRESS.test(text))).toEqual([]);
  });

  // The guards above would pass on a page that said nothing: here they meet the address where a
  // site has no canonical address to name it by, as a record from before 0.10.0 doesn't.
  it("still names a site known only by the address voicecap read as it did, with that address", async () => {
    const model = await demoModel();
    const html = renderSharePage(model, { fontCss: "" });

    expect(html).toContain("<h1>127.0.0.1:4848</h1>");
    expect(pageMeets(html)).toContain("Heard on this site: http://127.0.0.1:4848/, three ways");
    expect(pageMeets(html).filter((text) => LOCAL_ADDRESS.test(text))).not.toEqual([]);
    expect((await wordMeets(model)).filter((text) => LOCAL_ADDRESS.test(text))).not.toEqual([]);
  });
});
