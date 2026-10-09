/**
 * The facts the website's "Can I trust this?" page and its What's New page state (src/site/facts.ts).
 * Of voicecap: its version, from its package.json; each release with its date, first line, and
 * points, from its CHANGELOG (how that is read is in test/site-changelog.test.ts); and the facts its
 * release recorded (the release's own count of tests passed, the commits behind it, and where CI
 * runs), from release-facts.json. Of the records: how many sites and reports the website shows, how
 * many pages NVDA read in their current reports, how many files it publishes and leaves out, and
 * when the newest was shared.
 *
 * Every fact is read or counted, never typed, and one that isn't there is null, never a guess: a
 * release-facts.json that is missing, or isn't in the form publish.sh writes, gives "not recorded",
 * is never taken in part, and never throws. The files these tests read are the repository's own
 * package.json and CHANGELOG, read and not changed, and temporary ones made here and taken away
 * after.
 */
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ShareResult } from "../src/model.js";
import {
  parseReleaseFacts,
  readVoicecapFacts,
  recordFactsOf,
  voicecapFactsOf,
  type ReleaseFacts,
  type VoicecapFacts,
  type VoicecapRelease,
} from "../src/site/facts.js";
import type * as FactsModule from "../src/site/facts.js";
import type { PublishedReport, SiteContent } from "../src/site/render.js";
import {
  CONTENT,
  DEMO_REPORT,
  DVFR,
  DVFR_ADDRESS,
  DVFR_NEWEST,
  DVFR_OLDEST,
  EXAMPLE,
  EXAMPLE_REPORT,
  filesOf,
  published,
} from "./helpers/site-content.js";

/** The module under test, and the CHANGELOG's reader it imports, as files to copy (see `readFrom`). */
const MODULE = fileURLToPath(new URL("../src/site/facts.ts", import.meta.url));
const CHANGELOG_MODULE = fileURLToPath(new URL("../src/site/changelog.ts", import.meta.url));

/** A CHANGELOG as voicecap keeps one: the unreleased heading, then each release, newest first. */
const CHANGELOG = [
  "# Changelog",
  "",
  "All notable changes to voicecap are recorded here.",
  "",
  "## [Unreleased]",
  "",
  "## [0.13.1] - 2026-10-08",
  "",
  "### Changed",
  "",
  "- **The website's headings say more at a glance, and each site links to the site itself.** " +
    'The README\'s "The website: `voicecap site`" describes it.',
  '  - **Each site\'s name has "Visit the site" beside it:** a link to the site.',
  "",
  "## [0.10.0] - 2026-10-05",
  "",
  "Canonical site names: everything voicecap makes for readers names a site by its address.",
  "",
  "### Added",
  "",
  "- **Another thing.** Not the first line.",
  "",
  "## [0.4.1] - 2026-09-29",
  "",
  "- **`--sitemap` takes a sitemap's name or path**, such as `--sitemap sitemap.xml`.",
  "",
].join("\n");

/** What `CHANGELOG` comes to: how it's read is in test/site-changelog.test.ts. */
const RELEASES: VoicecapRelease[] = [
  {
    version: "0.13.1",
    date: "2026-10-08",
    headline: "The website's headings say more at a glance, and each site links to the site itself",
    items: [['Each site\'s name has "Visit the site" beside it']],
  },
  {
    version: "0.10.0",
    date: "2026-10-05",
    headline: "Canonical site names",
    items: [["Another thing"]],
  },
  {
    version: "0.4.1",
    date: "2026-09-29",
    headline: "--sitemap takes a sitemap's name or path",
    items: [],
  },
];

/** The facts publish.sh records, as release-facts.json holds them. */
const FILE_FACTS = {
  schema: 1,
  tests: { passed: 5012, skipped: 2, files: 125, system: "Windows" },
  commits: { count: 412, first: "2026-09-26" },
  ci: { systems: ["Ubuntu", "macOS", "Windows"], node: ["22", "24"] },
};

/** What they come to, once read: the same, with no schema. */
const RELEASE_FACTS: ReleaseFacts = {
  tests: { passed: 5012, skipped: 2, files: 125, system: "Windows" },
  commits: { count: 412, first: "2026-09-26" },
  ci: { systems: ["Ubuntu", "macOS", "Windows"], node: ["22", "24"] },
};

describe("parseReleaseFacts", () => {
  it("takes only release facts it can trust", () => {
    expect(parseReleaseFacts(FILE_FACTS)).toEqual(RELEASE_FACTS);
  });

  it("accepts a count of 0, and a first commit on the calendar's last day", () => {
    const facts = {
      ...FILE_FACTS,
      tests: { ...FILE_FACTS.tests, passed: 0, skipped: 0 },
      commits: { count: 0, first: "2028-02-29" },
    };
    expect(parseReleaseFacts(facts)).toEqual({
      ...RELEASE_FACTS,
      tests: { ...RELEASE_FACTS.tests, passed: 0, skipped: 0 },
      commits: { count: 0, first: "2028-02-29" },
    });
  });

  it("gives only what it knows, in objects of its own, whatever else the file holds", () => {
    const foreign = {
      ...FILE_FACTS,
      version: "9.9.9",
      tests: { ...FILE_FACTS.tests, flaky: 3 },
      ci: { ...FILE_FACTS.ci, secret: "x" },
    };
    const facts = parseReleaseFacts(foreign);
    expect(facts).toEqual(RELEASE_FACTS);
    expect(facts?.ci.systems).not.toBe(foreign.ci.systems);
    expect(facts?.ci.node).not.toBe(foreign.ci.node);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["text", "text"],
    ["a number", 1],
    ["a list", [FILE_FACTS]],
    ["an empty object", {}],
    ["a schema of 2", { ...FILE_FACTS, schema: 2 }],
    ["a schema written as text", { ...FILE_FACTS, schema: "1" }],
    ["no schema", { tests: FILE_FACTS.tests, commits: FILE_FACTS.commits, ci: FILE_FACTS.ci }],
    ["no tests", { ...FILE_FACTS, tests: undefined }],
    ["tests that are a list", { ...FILE_FACTS, tests: [5012, 2, 125, "Windows"] }],
    ["no commits", { ...FILE_FACTS, commits: null }],
    ["no CI", { ...FILE_FACTS, ci: "Ubuntu" }],
    ["tests passed below 0", { ...FILE_FACTS, tests: { ...FILE_FACTS.tests, passed: -1 } }],
    [
      "tests passed with a fraction",
      { ...FILE_FACTS, tests: { ...FILE_FACTS.tests, passed: 1.5 } },
    ],
    ["tests passed as text", { ...FILE_FACTS, tests: { ...FILE_FACTS.tests, passed: "5012" } }],
    [
      "tests passed that aren't a number",
      { ...FILE_FACTS, tests: { ...FILE_FACTS.tests, passed: NaN } },
    ],
    [
      "tests passed that never end",
      { ...FILE_FACTS, tests: { ...FILE_FACTS.tests, passed: Infinity } },
    ],
    [
      "tests passed too big for a number to hold exactly",
      { ...FILE_FACTS, tests: { ...FILE_FACTS.tests, passed: 2 ** 53 } },
    ],
    ["tests passed of minus zero", { ...FILE_FACTS, tests: { ...FILE_FACTS.tests, passed: -0 } }],
    ["no tests passed given", { ...FILE_FACTS, tests: { ...FILE_FACTS.tests, passed: undefined } }],
    ["tests skipped below 0", { ...FILE_FACTS, tests: { ...FILE_FACTS.tests, skipped: -1 } }],
    [
      "tests skipped with a fraction",
      { ...FILE_FACTS, tests: { ...FILE_FACTS.tests, skipped: 0.5 } },
    ],
    ["test files as text", { ...FILE_FACTS, tests: { ...FILE_FACTS.tests, files: "125" } }],
    ["test files below 0", { ...FILE_FACTS, tests: { ...FILE_FACTS.tests, files: -125 } }],
    ["a commit count below 0", { ...FILE_FACTS, commits: { ...FILE_FACTS.commits, count: -1 } }],
    [
      "a commit count with a fraction",
      { ...FILE_FACTS, commits: { ...FILE_FACTS.commits, count: 412.5 } },
    ],
    ["a commit count as text", { ...FILE_FACTS, commits: { ...FILE_FACTS.commits, count: "412" } }],
    [
      "a first commit written another way",
      { ...FILE_FACTS, commits: { count: 412, first: "26 Sep" } },
    ],
    [
      "a first commit with a one-digit day",
      { ...FILE_FACTS, commits: { count: 412, first: "2026-09-6" } },
    ],
    [
      "a first commit with a time",
      { ...FILE_FACTS, commits: { count: 412, first: "2026-09-26T10:00" } },
    ],
    [
      "a first commit in a month there isn't",
      { ...FILE_FACTS, commits: { count: 412, first: "2026-13-01" } },
    ],
    [
      "a first commit on a day there isn't",
      { ...FILE_FACTS, commits: { count: 412, first: "2027-02-29" } },
    ],
    [
      "a first commit on a leap day of a year with none",
      { ...FILE_FACTS, commits: { count: 412, first: "2100-02-29" } },
    ],
    [
      "a first commit in a year before 100",
      { ...FILE_FACTS, commits: { count: 412, first: "0050-01-01" } },
    ],
    [
      "a first commit of no date at all",
      { ...FILE_FACTS, commits: { count: 412, first: "0000-00-00" } },
    ],
    [
      "a first commit that is a number",
      { ...FILE_FACTS, commits: { count: 412, first: 20260926 } },
    ],
    ["a system that isn't text", { ...FILE_FACTS, tests: { ...FILE_FACTS.tests, system: 11 } }],
    ["a system with no name", { ...FILE_FACTS, tests: { ...FILE_FACTS.tests, system: "" } }],
    ["a system of spaces", { ...FILE_FACTS, tests: { ...FILE_FACTS.tests, system: "   " } }],
    ["CI systems that are none", { ...FILE_FACTS, ci: { ...FILE_FACTS.ci, systems: [] } }],
    [
      "CI systems that aren't a list",
      { ...FILE_FACTS, ci: { ...FILE_FACTS.ci, systems: "Ubuntu" } },
    ],
    [
      "a CI system that isn't text",
      { ...FILE_FACTS, ci: { ...FILE_FACTS.ci, systems: ["Ubuntu", 1] } },
    ],
    [
      "a CI system with no name",
      { ...FILE_FACTS, ci: { ...FILE_FACTS.ci, systems: ["Ubuntu", ""] } },
    ],
    ["Node versions that are none", { ...FILE_FACTS, ci: { ...FILE_FACTS.ci, node: [] } }],
    ["Node versions that aren't a list", { ...FILE_FACTS, ci: { ...FILE_FACTS.ci, node: "22" } }],
    [
      "Node versions written as numbers",
      { ...FILE_FACTS, ci: { ...FILE_FACTS.ci, node: [22, 24] } },
    ],
    ["no Node versions given", { ...FILE_FACTS, ci: { systems: FILE_FACTS.ci.systems } }],
  ])("gives nothing for %s", (_name, value) => {
    expect(parseReleaseFacts(value)).toBeNull();
  });
});

describe("voicecapFactsOf", () => {
  const changelog = [
    "## [Unreleased]",
    "",
    "## [0.13.2] - 2026-10-09",
    "",
    "- **The trust page.** Who built it.",
    "",
    "## [0.13.1] - 2026-10-08",
    "",
    "- **Banners.** More.",
    "",
  ].join("\n");

  it("says what it knows of voicecap", () => {
    expect(voicecapFactsOf({ version: "0.13.2" }, changelog, FILE_FACTS)).toEqual({
      version: "0.13.2",
      released: "2026-10-09",
      releases: [
        { version: "0.13.2", date: "2026-10-09", headline: "The trust page", items: [] },
        { version: "0.13.1", date: "2026-10-08", headline: "Banners", items: [] },
      ],
      release: RELEASE_FACTS,
    });
  });

  it("gives the date of the release that the package is, not the newest", () => {
    expect(voicecapFactsOf({ version: "0.13.1" }, changelog, FILE_FACTS).released).toBe(
      "2026-10-08",
    );
  });

  it("has no release date for a version the CHANGELOG lacks", () => {
    const facts = voicecapFactsOf({ version: "0.14.0" }, changelog, FILE_FACTS);
    expect(facts.released).toBeNull();
    expect(facts.version).toBe("0.14.0");
    expect(facts.releases).toHaveLength(2);
  });

  it("has no release date for a version whose entry has no date", () => {
    const facts = voicecapFactsOf({ version: "0.14.0" }, "## [0.14.0]\n\n- **Soon.**\n", null);
    expect(facts.released).toBeNull();
    expect(facts.releases).toEqual([]);
  });

  it("has no release date, and no releases, from no CHANGELOG", () => {
    const facts = voicecapFactsOf({ version: "0.13.2" }, "", FILE_FACTS);
    expect(facts.released).toBeNull();
    expect(facts.releases).toEqual([]);
    expect(facts.release).toEqual(RELEASE_FACTS);
  });

  it("has no release facts without a file of them, or from one it can't trust", () => {
    expect(voicecapFactsOf({ version: "0.13.2" }, changelog, undefined).release).toBeNull();
    expect(voicecapFactsOf({ version: "0.13.2" }, changelog, "text").release).toBeNull();
    expect(
      voicecapFactsOf({ version: "0.13.2" }, changelog, { ...FILE_FACTS, schema: 2 }).release,
    ).toBeNull();
  });

  it.each([
    ["a package of undefined", undefined],
    ["a package of null", null],
    ["a package of text", "0.13.2"],
    ["a package with no version", { name: "@icjia/voicecap" }],
    ["a version that isn't text", { version: 13 }],
    ["a version with nothing in it", { version: "" }],
  ])("refuses %s, as a package with no version is broken", (_name, packageJson) => {
    expect(() => voicecapFactsOf(packageJson, changelog, FILE_FACTS)).toThrow(/no version/);
  });
});

describe("readVoicecapFacts", () => {
  it("reads the package it runs from", async () => {
    const { version } = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    const facts = await readVoicecapFacts();
    expect(facts.version).toBe(version);
    // Only a built package holds release-facts.json, beside the build: the source tree never does.
    expect(facts.release).toBeNull();
    // Its CHANGELOG is the repository's, read from the package root.
    expect(facts.releases.map((release) => release.version)).toContain(version);
  });

  describe("in a package laid out as a published one", () => {
    let home: string;
    let packages = 0;

    beforeAll(async () => {
      home = await mkdtemp(path.join(tmpdir(), "voicecap-facts-"));
    });

    afterAll(async () => {
      await rm(home, { recursive: true, force: true });
    });

    /**
     * `readVoicecapFacts` of a copy of the module in a package of its own, made of `layout`: each
     * file's text at its path from the package's root, or null for a folder at that path. A
     * published package keeps the module at dist/site/facts.js, package.json and CHANGELOG.md at
     * its root, and the release's facts at dist/release-facts.json, beside dist/site/, and the
     * module reads the files beside it. No test builds a package, so this lays one out, with a
     * copy of the module and of the CHANGELOG's reader beside it (which import only types and each
     * other, so the two stand alone) to read it.
     */
    async function readFrom(layout: Record<string, string | null>): Promise<VoicecapFacts> {
      packages += 1;
      const root = path.join(home, `package-${packages}`);
      for (const [name, text] of Object.entries(layout)) {
        const target = path.join(root, name);
        await mkdir(text === null ? target : path.dirname(target), { recursive: true });
        if (text !== null) await writeFile(target, text);
      }
      const copy = path.join(root, "dist", "site", "facts.ts");
      await mkdir(path.dirname(copy), { recursive: true });
      await copyFile(MODULE, copy);
      await copyFile(CHANGELOG_MODULE, path.join(path.dirname(copy), "changelog.ts"));
      // Vite reads the nearest package.json when it resolves the module's import of its neighbor,
      // and the package's own may be broken on purpose (the module never reads this one).
      await writeFile(path.join(path.dirname(copy), "package.json"), "{}\n");
      const built = (await import(
        /* @vite-ignore */ pathToFileURL(copy).href
      )) as typeof FactsModule;
      return built.readVoicecapFacts();
    }

    /** The package's own files, for a test that changes one thing. */
    const PACKAGE = {
      "package.json": JSON.stringify({ version: "0.13.1" }),
      "CHANGELOG.md": CHANGELOG,
      "dist/release-facts.json": JSON.stringify(FILE_FACTS),
    };

    it("reads each of the three, the release's facts from beside the build", async () => {
      expect(await readFrom(PACKAGE)).toEqual({
        version: "0.13.1",
        released: "2026-10-08",
        releases: RELEASES,
        release: RELEASE_FACTS,
      });
    });

    it("reads the release's facts from dist/ and from nowhere else", async () => {
      const { "dist/release-facts.json": _built, ...without } = PACKAGE;
      const facts = await readFrom({
        ...without,
        // Beside the package.json, and beside the module: not where publish.sh writes them.
        "release-facts.json": JSON.stringify(FILE_FACTS),
        "dist/site/release-facts.json": JSON.stringify(FILE_FACTS),
      });
      expect(facts.release).toBeNull();
      expect(facts.version).toBe("0.13.1");
    });

    it.each([
      ["empty", ""],
      ["not JSON", "{ the tests passed"],
      ["JSON of something else", JSON.stringify(["5012 tests passed"])],
      ["the facts of another schema", JSON.stringify({ ...FILE_FACTS, schema: 2 })],
      [
        "the facts with a count that isn't whole",
        JSON.stringify({ ...FILE_FACTS, commits: { count: 1.5, first: "2026-09-26" } }),
      ],
      // A folder where the file should be: it can't be read as a file.
      ["a folder", null],
    ])("has no release facts when release-facts.json is %s", async (_name, text) => {
      const facts = await readFrom({ ...PACKAGE, "dist/release-facts.json": text });
      expect(facts.release).toBeNull();
      // Nothing else is lost with them.
      expect(facts.version).toBe("0.13.1");
      expect(facts.releases).toEqual(RELEASES);
    });

    it("has no release facts when release-facts.json is missing", async () => {
      const { "dist/release-facts.json": _built, ...without } = PACKAGE;
      const facts = await readFrom(without);
      expect(facts.release).toBeNull();
      expect(facts.version).toBe("0.13.1");
      expect(facts.releases).toEqual(RELEASES);
    });

    it("reads an empty CHANGELOG from a CHANGELOG that's missing", async () => {
      const { "CHANGELOG.md": _changelog, ...without } = PACKAGE;
      expect(await readFrom(without)).toEqual({
        version: "0.13.1",
        released: null,
        releases: [],
        release: RELEASE_FACTS,
      });
    });

    it("refuses a package with no package.json, as it is broken", async () => {
      const { "package.json": _package, ...without } = PACKAGE;
      await expect(readFrom(without)).rejects.toThrow(/ENOENT/);
    });

    it("refuses a package.json that isn't JSON", async () => {
      await expect(readFrom({ ...PACKAGE, "package.json": "{ version: 0.13.1 }" })).rejects.toThrow(
        SyntaxError,
      );
    });

    it("refuses a package.json with no version", async () => {
      const noVersion = JSON.stringify({ name: "@icjia/voicecap" });
      await expect(readFrom({ ...PACKAGE, "package.json": noVersion })).rejects.toThrow(
        /no version/,
      );
    });
  });
});

/** `report`, with what its share said of the site. */
function saying(report: PublishedReport, result: ShareResult): PublishedReport {
  return { ...report, result };
}

/** What a share says when NVDA read all of its `pages`, with `problems` left to fix. */
function readAll(pages: number, problems: number): ShareResult {
  return { pages, read: pages, problems, problemPages: problems };
}

/**
 * The test's content, each site's current report saying what it found: 9 pages read, no problem,
 * and 32 read, 1 problem (on 32 pages, so that the problems and the pages with problems are two
 * numbers a count can take for the other). The first site's older report says something else,
 * which isn't counted.
 */
const WITH_RESULTS: SiteContent = {
  demo: DEMO_REPORT,
  sites: [
    {
      name: DVFR,
      folders: [DVFR],
      reports: [
        saying(DVFR_NEWEST, { pages: 9, read: 9, problems: 0, problemPages: 0 }),
        saying(DVFR_OLDEST, { pages: 5, read: 4, problems: 3, problemPages: 2 }),
      ],
      address: DVFR_ADDRESS,
    },
    {
      name: EXAMPLE,
      folders: [EXAMPLE],
      reports: [saying(EXAMPLE_REPORT, { pages: 32, read: 32, problems: 1, problemPages: 32 })],
    },
  ],
};

/** A content of the one site, with these reports, newest first, and no demo. */
function siteOf(...reports: PublishedReport[]): SiteContent {
  return { demo: null, sites: [{ name: DVFR, folders: [DVFR], reports }] };
}

describe("recordFactsOf", () => {
  it("counts the records' facts", () => {
    const facts = recordFactsOf(WITH_RESULTS);
    expect(facts.sites).toBe(2);
    // The demo's report isn't a site's: the first site has two, the second has one.
    expect(facts.reports).toBe(3);
    // 9 + 32 pages read of 9 + 32, and 0 + 1 problems, from the two current reports only: the
    // older report's 5 pages, 4 read, and 3 problems are not in it.
    expect(facts.reading).toEqual({ read: 41, pages: 41, problems: 1, sitesCounted: 2 });
    // The demo's 3 files, the first site's 3 and 1, and the second's 4.
    expect(facts.files.published).toBe(11);
    expect(facts.files.published).toBe(new Set(filesOf(CONTENT).map(({ href }) => href)).size);
    // The first site's older Word copy changed, and the second site's is missing.
    expect(facts.files.leftOut).toBe(2);
    expect(facts.newest).toBe(DVFR_NEWEST.at);
  });

  it("counts each file once, however many of the reports name it", () => {
    const sharedAgain = {
      ...DVFR_OLDEST,
      files: [...DVFR_OLDEST.files, published("page", DVFR, `${DVFR}_2026-10-03.html`, 324)],
    };
    // The newest report's 3 files, and the older one's own, with the page that both name.
    expect(recordFactsOf(siteOf(DVFR_NEWEST, sharedAgain)).files.published).toBe(4);
  });

  it("counts a file by where it's published, so two folders' files of one name are two", () => {
    const named = (report: PublishedReport, folder: string): PublishedReport => ({
      ...report,
      files: [published("page", folder, "current.html", 1)],
      notPublished: [],
    });
    const facts = recordFactsOf({
      demo: null,
      sites: [
        { name: DVFR, folders: [DVFR], reports: [named(DVFR_OLDEST, DVFR)] },
        { name: EXAMPLE, folders: [EXAMPLE], reports: [named(EXAMPLE_REPORT, EXAMPLE)] },
      ],
    });
    expect(facts.files.published).toBe(2);
  });

  it("counts what the demo shows too: its files, what was left out of it, and its time", () => {
    const demo: PublishedReport = {
      ...DEMO_REPORT,
      at: "2026-10-05T08:00:00-05:00",
      notPublished: [{ name: "127.0.0.1_4848_2026-09-29_summary.pdf", reason: "missing" }],
    };
    const facts = recordFactsOf({ ...CONTENT, demo });
    expect(facts.files.published).toBe(11);
    expect(facts.files.leftOut).toBe(3);
    expect(facts.newest).toBe("2026-10-05T08:00:00-05:00");
    expect(facts.reports).toBe(3);
    const without = recordFactsOf({ ...CONTENT, demo: null });
    expect(without.files.published).toBe(8);
    expect(without.files.leftOut).toBe(2);
    expect(without.newest).toBe(DVFR_NEWEST.at);
  });

  it("takes the newest by the time each was shared, not by how its text sorts", () => {
    // 23:30 in the evening at UTC-5 is 04:30 the next day at UTC: later than 01:00 at UTC that day,
    // though "2026-10-03" sorts before "2026-10-04".
    const evening = { ...DVFR_OLDEST, at: "2026-10-03T23:30:00-05:00" };
    const night = { ...DVFR_NEWEST, at: "2026-10-04T01:00:00+00:00" };
    expect(recordFactsOf(siteOf(night, evening)).newest).toBe("2026-10-03T23:30:00-05:00");
    expect(recordFactsOf(siteOf(evening, night)).newest).toBe("2026-10-03T23:30:00-05:00");
  });

  it("leaves out a time it can't read when it names the newest", () => {
    const unreadable = { ...DVFR_NEWEST, at: "the other day" };
    expect(recordFactsOf(siteOf(unreadable, DVFR_OLDEST)).newest).toBe(DVFR_OLDEST.at);
    expect(recordFactsOf(siteOf(DVFR_OLDEST, unreadable)).newest).toBe(DVFR_OLDEST.at);
    expect(recordFactsOf(siteOf(unreadable)).newest).toBeNull();
  });

  it("counts a site's current report only, and only one that says it counted pages", () => {
    // The first site's current report has no result (a share from before 0.12.3), and its older one
    // has: not counted, as it isn't current. The second site's current report counted no pages.
    const noResultYet = {
      name: DVFR,
      folders: [DVFR],
      reports: [DVFR_NEWEST, saying(DVFR_OLDEST, readAll(5, 3))],
    };
    const countedNone = {
      name: EXAMPLE,
      folders: [EXAMPLE],
      reports: [saying(EXAMPLE_REPORT, { pages: 0, read: 0, problems: 0, problemPages: 0 })],
    };
    expect(recordFactsOf({ demo: null, sites: [noResultYet, countedNone] }).reading).toBeNull();
    // Were the second site's current report to count 4 pages, it would be the only site counted.
    const countedFour = { ...countedNone, reports: [saying(EXAMPLE_REPORT, readAll(4, 2))] };
    expect(recordFactsOf({ demo: null, sites: [noResultYet, countedFour] }).reading).toEqual({
      read: 4,
      pages: 4,
      problems: 2,
      sitesCounted: 1,
    });
  });

  it("counts the pages NVDA didn't read as they are", () => {
    const result = { pages: 10, read: 7, problems: 2, problemPages: 3 };
    expect(recordFactsOf(siteOf(saying(DVFR_NEWEST, result))).reading).toEqual({
      read: 7,
      pages: 10,
      problems: 2,
      sitesCounted: 1,
    });
  });

  it("counts a site with no report as a site, and nothing else", () => {
    const facts = recordFactsOf({
      demo: null,
      sites: [
        { name: DVFR, folders: [DVFR], reports: [] },
        { name: EXAMPLE, folders: [EXAMPLE], reports: [EXAMPLE_REPORT] },
      ],
    });
    expect(facts.sites).toBe(2);
    expect(facts.reports).toBe(1);
    expect(facts.reading).toBeNull();
  });

  it("does not change the content it counts", () => {
    const before = structuredClone(WITH_RESULTS);
    recordFactsOf(WITH_RESULTS);
    expect(WITH_RESULTS).toEqual(before);
  });

  it("says when the records have nothing to count", () => {
    expect(recordFactsOf({ demo: null, sites: [] })).toEqual({
      sites: 0,
      reports: 0,
      reading: null,
      files: { published: 0, leftOut: 0 },
      newest: null,
    });
    // CONTENT as it is has no results: shares from before 0.12.3.
    const facts = recordFactsOf(CONTENT);
    expect(facts.reading).toBeNull();
    expect(facts.sites).toBe(2);
    expect(facts.reports).toBe(3);
  });
});
