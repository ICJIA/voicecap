/**
 * The shareable page and its Word copy, written wherever the live report is: when a run completes,
 * and after a review, a manual session, and `voicecap report`. A file that can't be written is said
 * in a warning, and never fails any of them, or the file beside it. No real screen reader starts
 * here, and no Word: runs use the scripted driver, or replay a recorded run, and a Word copy is
 * read by unzipping it.
 */
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename as fsRename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { XMLValidator } from "fast-xml-parser";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { addManualSession } from "../src/manual-add.js";
import { addReview } from "../src/reviews/review.js";
import { runAudit } from "../src/run/audit.js";
import { regenerateLiveFiles, regenerateLiveReport } from "../src/run/live-report.js";
import { liveReportPath, shareDir, sharePath, shareWordPath } from "../src/run/paths.js";
import { readRunJson } from "../src/run/store.js";
import { renderWordCopy } from "../src/share/docx.js";
import type * as DocxModule from "../src/share/docx.js";
import { fontFaceCss } from "../src/share/fonts.js";
import type * as FontsModule from "../src/share/fonts.js";
import { renderSharePage } from "../src/share/html/document.js";
import type * as DocumentModule from "../src/share/html/document.js";
import { buildShareModel } from "../src/share/model.js";
import type * as ModelModule from "../src/share/model.js";
import { writeShareFiles } from "../src/share/write.js";
import { writeFileAtomic, type AtomicWriteOptions } from "../src/util/atomic-write.js";
import { formatCommand } from "../src/util/command-line.js";
import { createMemoryLogger, type Logger, type MemoryLogger } from "../src/util/log.js";
import { footerWords, paragraphsOf, propertyOf, unzipDocx } from "./helpers/docx.js";
import { config, options, outDir, SITE, setup, sitePages } from "./helpers/run-site.js";
import { ScriptedDriver } from "./helpers/scripted-driver.js";

// Every write goes through as it did, and is kept, so a test can see what was written how.
vi.mock("../src/util/atomic-write.js", async (importOriginal) => {
  const actual = await importOriginal<{
    writeFileAtomic: (
      file: string,
      data: string | Uint8Array,
      options?: AtomicWriteOptions,
    ) => Promise<void>;
  }>();
  return { ...actual, writeFileAtomic: vi.fn(actual.writeFileAtomic) };
});

// So do the model's builder, the page's fonts, and each file's renderer: a test can count their
// calls, or make one fail, and the other file still has to be written.
vi.mock("../src/share/model.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ModelModule>();
  return { ...actual, buildShareModel: vi.fn(actual.buildShareModel) };
});
vi.mock("../src/share/fonts.js", async (importOriginal) => {
  const actual = await importOriginal<typeof FontsModule>();
  return { ...actual, fontFaceCss: vi.fn(actual.fontFaceCss) };
});
vi.mock("../src/share/html/document.js", async (importOriginal) => {
  const actual = await importOriginal<typeof DocumentModule>();
  return { ...actual, renderSharePage: vi.fn(actual.renderSharePage) };
});
vi.mock("../src/share/docx.js", async (importOriginal) => {
  const actual = await importOriginal<typeof DocxModule>();
  return { ...actual, renderWordCopy: vi.fn(actual.renderWordCopy) };
});

afterEach(() => {
  // Back to going through, with no call kept and no failure waiting, whatever a test did.
  for (const made of [buildShareModel, fontFaceCss, renderSharePage, renderWordCopy]) {
    vi.mocked(made).mockReset();
  }
});

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const fixture = (...parts: string[]) => path.join(ROOT, "fixture", ...parts);

/** How a warning about each file begins, whatever the reason it couldn't be made or written. */
const PAGE_NOT_UPDATED = "The shareable page wasn't updated: ";
const WORD_NOT_UPDATED = "The Word copy wasn't updated: ";

/**
 * The Word copy's warning when the OS says another program holds the file, with the code it gave:
 * what couldn't be done, when that happens, and what to do, which ends with the exact command. The
 * command names the site and the home, so that it runs as it is in a home of many sites, where
 * `report` refuses without `--site`, and in a home that `--out` gave. None of the OS's own words
 * are in it.
 */
const heldWarning = (code: string, siteDir: string): string =>
  `${WORD_NOT_UPDATED}current.docx couldn't be replaced (${code}). That happens while it's open in Word. If it is, close it, then run: ${formatCommand(["report", "--site", SITE, "--out", path.dirname(siteDir)])}`;

/** The Word copy's parts, read back by unzipping the file as it is on disk. */
async function wordCopy(siteDir: string) {
  return unzipDocx(await readFile(shareWordPath(siteDir)));
}

/** A site folder with one completed run of the scripted site's three pages. */
async function siteWithRun(): Promise<{ dir: string; site: string }> {
  const dir = await setup();
  const result = await runAudit(options(dir, new ScriptedDriver(sitePages())));
  expect(result.outcome).toBe("completed");
  return { dir, site: outDir(dir) };
}

/** A site folder where neither file can go: a file is in the place of their folder. */
async function blockShareFolder(site: string): Promise<void> {
  await rm(shareDir(site), { recursive: true, force: true });
  await mkdir(site, { recursive: true });
  await writeFile(shareDir(site), "A file where the folder would go.\n");
}

/** What a logger was told as warnings, in order. */
const warnings = (logger: MemoryLogger): string[] =>
  logger.entries.filter((entry) => entry.level === "warn").map((entry) => entry.message);

/**
 * What a logger was told about the files, as warnings, in order. A manual session warns of its own
 * things too, which are no concern here.
 */
const aboutFiles = (logger: MemoryLogger): string[] =>
  warnings(logger).filter(
    (message) => message.startsWith(PAGE_NOT_UPDATED) || message.startsWith(WORD_NOT_UPDATED),
  );

/**
 * Two warnings, and no others: the page's, then the Word copy's, each in its own words, with the
 * same reason, and no word about closing Word. That's what's said when neither file can be made or
 * written, since nothing says Word holds a file. Gives the reason.
 */
function expectNeitherUpdated(logger: MemoryLogger): string {
  const said = warnings(logger);
  expect(said).toHaveLength(2);
  const reason = said[0]?.slice(PAGE_NOT_UPDATED.length) ?? "";
  expect(reason).not.toBe("");
  expect(said).toEqual([`${PAGE_NOT_UPDATED}${reason}`, `${WORD_NOT_UPDATED}${reason}`]);
  return reason;
}

/**
 * A rename that refuses the Word copy with `error`, as Windows does a file Word has open. Any other
 * file is renamed as usual.
 */
const refusingTheWordCopy = (error: Error) => async (from: string, to: string) => {
  if (to.endsWith("current.docx")) throw error;
  await fsRename(from, to);
};

/**
 * The ways, besides a run's end, that voicecap writes the files again: a review, a manual session,
 * and the live report (`voicecap report`). Each is what does it, and what the page then shows.
 */
const WAYS: {
  way: string;
  shows: string | null;
  act: (dir: string, logger: Logger) => Promise<unknown>;
}[] = [
  {
    way: "a review",
    shows: "Two Read more links.",
    act: (dir, logger) =>
      addReview({
        page: "/resources",
        status: "issue",
        note: "Two Read more links.",
        reviewer: "Pat Reviewer",
        cwd: dir,
        env: {},
        logger,
        config: config(),
      }),
  },
  {
    way: "a manual session",
    shows: "Manual NVDA session, 25 September 2026, by Sam Tester",
    act: (dir, logger) =>
      addManualSession({
        file: fixture("manual", "nvda-io-log.txt"),
        page: "/",
        date: "2026-09-25",
        redactTyping: true,
        reviewer: "Sam Tester",
        cwd: dir,
        env: {},
        logger,
        config: config(),
      }),
  },
  {
    way: "the live report",
    shows: null,
    act: (dir, logger) =>
      regenerateLiveReport({ outDir: outDir(dir), config: config().config, logger }),
  },
];

describe("share/current.html and share/current.docx, written where report.html is", () => {
  it("are written beside report.html when a run completes", async () => {
    const dir = await setup();
    const logger = createMemoryLogger();

    const result = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), {
        logger,
        now: () => new Date(2026, 8, 27, 11, 2),
      }),
    );

    expect(result).toMatchObject({ outcome: "completed", exitCode: 0 });
    const site = outDir(dir);
    expect(existsSync(liveReportPath(site))).toBe(true);
    const page = await readFile(sharePath(site), "utf8");
    expect(page.startsWith("<!doctype html>\n")).toBe(true);
    expect(page).toContain(
      "<title>example.illinois.gov: how its pages read aloud with NVDA</title>",
    );
    // Dated by the run's clock, as the run's own times are.
    expect(page).toMatch(/Generated on 27 September 2026 at 11:02 \(UTC[−+]\d\d:\d\d\)\./);
    // Its fonts are inside it, and its pages are the run's.
    expect(page).toContain("data:font/woff2;base64,");
    for (const pagePath of ["/about", "/resources"]) {
      expect(page).toContain(`https://example.illinois.gov${pagePath}`);
    }
    // Written whole, with nothing left beside them.
    expect((await readdir(shareDir(site))).sort()).toEqual(["current.docx", "current.html"]);
    expect(logger.text("warn")).toBe("");
  });

  it("writes current.docx beside current.html when a run completes", async () => {
    const dir = await setup();
    const result = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    const word = path.join(result.siteDir, "share", "current.docx");

    const parts = await unzipDocx(await readFile(word));

    expect(XMLValidator.validate(parts.document)).toBe(true);
    expect(propertyOf(parts.core, "dc:title")).toBe(
      "example.illinois.gov: how its pages read aloud with NVDA",
    );
  });

  it.each(WAYS)("are rewritten by $way", async ({ act, shows }) => {
    const { dir, site } = await siteWithRun();
    // Gone, so only what comes next can write them.
    await rm(shareDir(site), { recursive: true, force: true });

    await act(dir, createMemoryLogger());

    const page = await readFile(sharePath(site), "utf8");
    expect(page.startsWith("<!doctype html>\n")).toBe(true);
    if (shows !== null) expect(page).toContain(shows);
    expect(XMLValidator.validate((await wordCopy(site)).document)).toBe(true);
  });

  // Review Focus 1: a Word copy that can't be written never fails a review, a manual session, or a
  // report, and the page is written all the same.
  it.each(WAYS)(
    "finishes $way, with the page written and a warning, when the Word copy can't be made",
    async ({ act }) => {
      const { dir, site } = await siteWithRun();
      await rm(shareDir(site), { recursive: true, force: true });
      vi.mocked(renderWordCopy).mockRejectedValueOnce(
        new Error("The document couldn't be packed."),
      );
      const logger = createMemoryLogger();

      await act(dir, logger);

      expect(await readFile(sharePath(site), "utf8")).toMatch(/^<!doctype html>/);
      expect(await readdir(shareDir(site))).toEqual(["current.html"]);
      expect(aboutFiles(logger)).toEqual([`${WORD_NOT_UPDATED}The document couldn't be packed.`]);
    },
  );

  it("completes the run, with the page written, and says why the Word copy wasn't, when it can't be made", async () => {
    const dir = await setup();
    vi.mocked(renderWordCopy).mockRejectedValueOnce(new Error("The document couldn't be packed."));
    const logger = createMemoryLogger();

    const result = await runAudit(options(dir, new ScriptedDriver(sitePages()), { logger }));

    // The run is done and sealed, and the exit code is the run's.
    expect(result).toMatchObject({ outcome: "completed", exitCode: 0 });
    expect((await readRunJson(outDir(dir), result.runId)).status).toBe("completed");
    expect(logger.text("info")).toContain(`Run ${result.runId} complete. Report: `);
    expect(warnings(logger)).toEqual([`${WORD_NOT_UPDATED}The document couldn't be packed.`]);
    expect(await readdir(shareDir(outDir(dir)))).toEqual(["current.html"]);
  });

  it("completes the run, and says so, when neither file can be written", async () => {
    const dir = await setup();
    const site = outDir(dir);
    await blockShareFolder(site);
    const logger = createMemoryLogger();

    const result = await runAudit(options(dir, new ScriptedDriver(sitePages()), { logger }));

    // The run is done and sealed, its report is written, and the exit code is the run's.
    expect(result).toMatchObject({ outcome: "completed", exitCode: 0 });
    expect((await readRunJson(site, result.runId)).status).toBe("completed");
    expect(existsSync(liveReportPath(site))).toBe(true);
    expect(logger.text("info")).toContain(`Run ${result.runId} complete. Report: `);
    // A warning for each file, the page's first, and the file that was in the way is as it was.
    expectNeitherUpdated(logger);
    expect(await readFile(shareDir(site), "utf8")).toBe("A file where the folder would go.\n");
  });
});

describe("regenerateLiveFiles", () => {
  it("gives the report's path, the page's, and the Word copy's", async () => {
    const { site } = await siteWithRun();
    await rm(shareDir(site), { recursive: true, force: true });

    const files = await regenerateLiveFiles({
      outDir: site,
      config: DEFAULT_CONFIG,
      logger: createMemoryLogger(),
    });

    expect(files).toEqual({
      report: liveReportPath(site),
      share: sharePath(site),
      word: shareWordPath(site),
    });
    expect(existsSync(sharePath(site))).toBe(true);
    expect(existsSync(shareWordPath(site))).toBe(true);
  });

  it("gives the report's path alone, and a warning for each file, when neither can be written", async () => {
    const { site } = await siteWithRun();
    await blockShareFolder(site);
    const logger = createMemoryLogger();

    const files = await regenerateLiveFiles({ outDir: site, config: DEFAULT_CONFIG, logger });

    expect(files).toEqual({ report: liveReportPath(site), share: null, word: null });
    expectNeitherUpdated(logger);
  });

  it("gives the page's path, and null for the Word copy, with a warning, when it can't be made", async () => {
    const { site } = await siteWithRun();
    vi.mocked(renderWordCopy).mockRejectedValueOnce(new Error("The document couldn't be packed."));
    const logger = createMemoryLogger();

    const files = await regenerateLiveFiles({ outDir: site, config: DEFAULT_CONFIG, logger });

    expect(files).toEqual({ report: liveReportPath(site), share: sharePath(site), word: null });
    expect(logger.entries).toEqual([
      { level: "warn", message: `${WORD_NOT_UPDATED}The document couldn't be packed.` },
    ]);
  });

  it("writes nothing, and says there's no run yet, for a site with no completed run", async () => {
    const site = await mkdtemp(path.join(os.tmpdir(), "voicecap-share-"));
    const logger = createMemoryLogger();

    expect(await regenerateLiveFiles({ outDir: site, config: DEFAULT_CONFIG, logger })).toBeNull();

    expect(logger.entries).toEqual([
      { level: "info", message: "No completed run yet, so the report wasn't updated." },
    ]);
    expect(await readdir(site)).toEqual([]);
  });
});

describe("writeShareFiles", () => {
  it("writes the site's page and its Word copy, and gives their paths", async () => {
    const { site } = await siteWithRun();
    await rm(shareDir(site), { recursive: true, force: true });
    const logger = createMemoryLogger();

    const files = await writeShareFiles({ siteDir: site, config: DEFAULT_CONFIG, logger });

    expect(files).toEqual({ page: sharePath(site), word: shareWordPath(site) });
    expect(await readFile(sharePath(site), "utf8")).toContain("how its pages read aloud");
    expect(XMLValidator.validate((await wordCopy(site)).document)).toBe(true);
    expect((await readdir(shareDir(site))).sort()).toEqual(["current.docx", "current.html"]);
    expect(logger.entries).toEqual([]);
  });

  it("writes the whole page and the whole Word copy, each in one call to writeFileAtomic", async () => {
    const { site } = await siteWithRun();
    vi.mocked(writeFileAtomic).mockClear();

    await writeShareFiles({ siteDir: site, config: DEFAULT_CONFIG, logger: createMemoryLogger() });

    const writesTo = (file: string) =>
      vi.mocked(writeFileAtomic).mock.calls.filter(([written]) => written === file);
    const pageWrites = writesTo(sharePath(site));
    expect(pageWrites).toHaveLength(1);
    expect(pageWrites[0]?.[1]).toBe(await readFile(sharePath(site), "utf8"));
    // The page waits as long as a write does for a program that holds its file.
    expect(pageWrites[0]?.[2]?.retryForMs).toBeUndefined();
    const wordWrites = writesTo(shareWordPath(site));
    expect(wordWrites).toHaveLength(1);
    const bytes = wordWrites[0]?.[1];
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(bytes as Uint8Array).equals(await readFile(shareWordPath(site)))).toBe(true);
    // The Word copy waits a second: a person may have it open, and no one waits longer on that.
    expect(wordWrites[0]?.[2]?.retryForMs).toBe(1000);
  });

  it("builds the model once, and makes both files from it", async () => {
    const { site } = await siteWithRun();
    for (const made of [buildShareModel, renderSharePage, renderWordCopy]) {
      vi.mocked(made).mockClear();
    }

    await writeShareFiles({ siteDir: site, config: DEFAULT_CONFIG, logger: createMemoryLogger() });

    expect(buildShareModel).toHaveBeenCalledTimes(1);
    const built = vi.mocked(buildShareModel).mock.results[0];
    expect(built?.type).toBe("return");
    expect(renderSharePage).toHaveBeenCalledTimes(1);
    expect(renderWordCopy).toHaveBeenCalledTimes(1);
    expect(vi.mocked(renderSharePage).mock.calls[0]?.[0]).toBe(built?.value);
    expect(vi.mocked(renderWordCopy).mock.calls[0]?.[0]).toBe(built?.value);
  });

  it("dates both files from the time it's given", async () => {
    const { site } = await siteWithRun();

    await writeShareFiles({
      siteDir: site,
      config: DEFAULT_CONFIG,
      logger: createMemoryLogger(),
      now: new Date(2027, 0, 5, 9, 30),
    });

    const page = await readFile(sharePath(site), "utf8");
    expect(page).toContain("As of <b>5 January 2027</b>");
    expect(page).toMatch(/Generated on 5 January 2027 at 09:30 \(UTC[−+]\d\d:\d\d\)\./);
    // The Word copy says the same day in each page's footer, and the same minute at its end.
    const { document, footer } = await wordCopy(site);
    expect(footerWords(footer)[0]).toBe("example.illinois.gov, as of 5 January 2027. Page ");
    expect(paragraphsOf(document).map(({ text }) => text)).toContainEqual(
      expect.stringMatching(/^Generated on 5 January 2027 at 09:30 \(UTC[−+]\d\d:\d\d\)\./),
    );
  });

  it("takes the site's name from the config", async () => {
    const { site } = await siteWithRun();

    await writeShareFiles({
      siteDir: site,
      config: { ...DEFAULT_CONFIG, report: { ...DEFAULT_CONFIG.report, siteName: "The agency" } },
      logger: createMemoryLogger(),
    });

    expect(await readFile(sharePath(site), "utf8")).toContain(
      "<title>The agency: how its pages read aloud with NVDA</title>",
    );
    expect(propertyOf((await wordCopy(site)).core, "dc:title")).toBe(
      "The agency: how its pages read aloud with NVDA",
    );
  });

  // Where neither HOME (USERPROFILE on Windows) nor the account's entry gives one, Node throws.
  it("writes both files where Node can't find a home folder, which leaves nothing to replace", async () => {
    const dir = await setup();
    const homedir = vi.spyOn(os, "homedir").mockImplementation(() => {
      throw new Error("A system error occurred: uv_os_homedir returned ENOENT");
    });
    try {
      const logger = createMemoryLogger();

      const result = await runAudit(options(dir, new ScriptedDriver(sitePages()), { logger }));

      expect(result.outcome).toBe("completed");
      expect(logger.text("warn")).toBe("");
      expect(await readFile(sharePath(outDir(dir)), "utf8")).toContain("how its pages read aloud");
      expect(XMLValidator.validate((await wordCopy(outDir(dir))).document)).toBe(true);
    } finally {
      homedir.mockRestore();
    }
  });

  it("says nothing, writes nothing, and gives null for a site with no run to share", async () => {
    const empty = await mkdtemp(path.join(os.tmpdir(), "voicecap-share-"));
    const nowhere = path.join(empty, "no-such-site");
    const logger = createMemoryLogger();

    expect(await writeShareFiles({ siteDir: empty, config: DEFAULT_CONFIG, logger })).toBeNull();
    expect(await writeShareFiles({ siteDir: nowhere, config: DEFAULT_CONFIG, logger })).toBeNull();

    // Not a failure: there's just nothing yet.
    expect(logger.entries).toEqual([]);
    expect(await readdir(empty)).toEqual([]);
  });

  it("gives null for both, with a warning for each, when neither can be written, and never throws", async () => {
    const { site } = await siteWithRun();
    await blockShareFolder(site);
    const logger = createMemoryLogger();

    const files = await writeShareFiles({ siteDir: site, config: DEFAULT_CONFIG, logger });

    expect(files).toEqual({ page: null, word: null });
    expectNeitherUpdated(logger);
  });

  it("gives null for both, with a warning for each, when the site's records can't be made into either", async () => {
    const { site } = await siteWithRun();
    // A damaged review history: voicecap refuses to read it rather than show less than there is.
    await writeFile(path.join(site, "reviews.json"), "{ not json");
    const logger = createMemoryLogger();

    const files = await writeShareFiles({ siteDir: site, config: DEFAULT_CONFIG, logger });

    expect(files).toEqual({ page: null, word: null });
    expectNeitherUpdated(logger);
  });

  describe("when something fails before either file can be made", () => {
    it("says so for each file, with one reason, when the site's runs can't be listed", async () => {
      const folder = await mkdtemp(path.join(os.tmpdir(), "voicecap-share-"));
      // A file where the site's folder would be: its runs can't be read.
      const notAFolder = path.join(folder, "example.illinois.gov");
      await writeFile(notAFolder, "A file where the site's folder would go.\n");
      const logger = createMemoryLogger();

      const files = await writeShareFiles({ siteDir: notAFolder, config: DEFAULT_CONFIG, logger });

      expect(files).toEqual({ page: null, word: null });
      expectNeitherUpdated(logger);
      expect(await readdir(folder)).toEqual(["example.illinois.gov"]);
    });

    it.each([
      { what: "an error", error: new Error("The model couldn't be built.") },
      {
        // The Word copy was never tried, so no file of Word's was refused: no advice about Word.
        what: "a held file's error code",
        error: Object.assign(new Error("EBUSY: resource busy or locked, open 'run.json'"), {
          code: "EBUSY",
        }),
      },
    ])(
      "says so for each file, with the reason alone, when the model fails with $what",
      async ({ error }) => {
        const { site } = await siteWithRun();
        for (const made of [renderSharePage, renderWordCopy]) vi.mocked(made).mockClear();
        vi.mocked(buildShareModel).mockImplementationOnce(() => {
          throw error;
        });
        const logger = createMemoryLogger();

        const files = await writeShareFiles({ siteDir: site, config: DEFAULT_CONFIG, logger });

        expect(files).toEqual({ page: null, word: null });
        expect(expectNeitherUpdated(logger)).toBe(error.message);
        // Neither file was tried.
        expect(renderSharePage).not.toHaveBeenCalled();
        expect(renderWordCopy).not.toHaveBeenCalled();
      },
    );
  });

  // Review Focus 1: current.docx open in Word.
  it("writes the page, and says so plainly, when Word holds current.docx", async () => {
    const { site } = await siteWithRun();
    const wordBefore = await readFile(shareWordPath(site));
    // As Node says it: its code, its words, and the temporary file's name.
    const held = Object.assign(
      new Error(
        `EPERM: operation not permitted, rename '${path.join(site, "share", ".current.docx.700.83820691.tmp")}' -> '${shareWordPath(site)}'`,
      ),
      { code: "EPERM" },
    );
    const rename = refusingTheWordCopy(held);
    const logger = createMemoryLogger();
    const started = Date.now();

    const files = await writeShareFiles({
      siteDir: site,
      config: DEFAULT_CONFIG,
      logger,
      rename,
      now: new Date(2027, 0, 5, 9, 30),
    });

    expect(files).toEqual({ page: path.join(site, "share", "current.html"), word: null });
    expect(Date.now() - started).toBeLessThan(5000);
    // In plain words, the code in parentheses, none of Node's, and the exact command to run.
    expect(logger.text("warn")).toBe(heldWarning("EPERM", site));
    expect(logger.text("warn")).not.toContain("operation not permitted");
    // The page is the new one. The Word copy is as it was, with no half-written file beside it.
    expect(await readFile(sharePath(site), "utf8")).toContain("As of <b>5 January 2027</b>");
    expect((await readFile(shareWordPath(site))).equals(wordBefore)).toBe(true);
    expect((await readdir(shareDir(site))).sort()).toEqual(["current.docx", "current.html"]);
  });

  it.each(["EBUSY", "EACCES"])(
    "ends the Word copy's warning by saying to close Word when %s holds the file",
    async (code) => {
      const { site } = await siteWithRun();
      const held = Object.assign(new Error(`${code}: the file is held by another program`), {
        code,
      });
      const logger = createMemoryLogger();

      const files = await writeShareFiles({
        siteDir: site,
        config: DEFAULT_CONFIG,
        logger,
        rename: refusingTheWordCopy(held),
      });

      expect(files).toEqual({ page: sharePath(site), word: null });
      expect(logger.entries).toEqual([{ level: "warn", message: heldWarning(code, site) }]);
    },
  );

  it.each([
    {
      what: "another code",
      error: Object.assign(new Error("ENOSPC: no space left on device, rename"), {
        code: "ENOSPC",
      }),
    },
    { what: "no code", error: new Error("no room") },
  ])("gives no advice about Word when the Word copy fails with $what", async ({ error }) => {
    const { site } = await siteWithRun();
    const logger = createMemoryLogger();

    const files = await writeShareFiles({
      siteDir: site,
      config: DEFAULT_CONFIG,
      logger,
      rename: refusingTheWordCopy(error),
    });

    expect(files).toEqual({ page: sharePath(site), word: null });
    expect(logger.entries).toEqual([{ level: "warn", message: WORD_NOT_UPDATED + error.message }]);
  });

  it("writes the Word copy once Word lets go of current.docx within a second", async () => {
    const { site } = await siteWithRun();
    await rm(shareDir(site), { recursive: true, force: true });
    let refused = 0;
    const rename = async (from: string, to: string) => {
      if (to.endsWith("current.docx") && refused < 3) {
        refused++;
        throw Object.assign(new Error("EBUSY: resource busy or locked, rename"), {
          code: "EBUSY",
        });
      }
      await fsRename(from, to);
    };
    const logger = createMemoryLogger();

    const files = await writeShareFiles({ siteDir: site, config: DEFAULT_CONFIG, logger, rename });

    expect(refused).toBe(3);
    expect(files).toEqual({ page: sharePath(site), word: shareWordPath(site) });
    expect(XMLValidator.validate((await wordCopy(site)).document)).toBe(true);
    expect(logger.entries).toEqual([]);
  });

  it("writes the Word copy when the page can't be written", async () => {
    const { site } = await siteWithRun();
    await rm(shareDir(site), { recursive: true, force: true });
    const rename = async (from: string, to: string) => {
      if (to.endsWith("current.html")) throw new Error("no room");
      await fsRename(from, to);
    };
    const logger = createMemoryLogger();

    const files = await writeShareFiles({ siteDir: site, config: DEFAULT_CONFIG, logger, rename });

    expect(files).toEqual({ page: null, word: path.join(site, "share", "current.docx") });
    expect(logger.text("warn")).toBe("The shareable page wasn't updated: no room");
    // Only the Word copy is there, and it's whole.
    expect(await readdir(shareDir(site))).toEqual(["current.docx"]);
    expect(XMLValidator.validate((await wordCopy(site)).document)).toBe(true);
  });

  it.each([
    {
      what: "its fonts can't be read",
      // A page's file that's held gets no advice about Word.
      error: Object.assign(new Error("EPERM: operation not permitted, open 'plex.woff2'"), {
        code: "EPERM",
      }),
      fail: (error: Error) => vi.mocked(fontFaceCss).mockRejectedValueOnce(error),
    },
    {
      what: "its markup can't be made",
      error: new Error("The page's markup couldn't be made."),
      fail: (error: Error) =>
        vi.mocked(renderSharePage).mockImplementationOnce(() => {
          throw error;
        }),
    },
  ])("writes the Word copy, and says why the page wasn't, when $what", async ({ error, fail }) => {
    const { site } = await siteWithRun();
    await rm(shareDir(site), { recursive: true, force: true });
    fail(error);
    const logger = createMemoryLogger();

    const files = await writeShareFiles({ siteDir: site, config: DEFAULT_CONFIG, logger });

    expect(files).toEqual({ page: null, word: shareWordPath(site) });
    expect(logger.entries).toEqual([{ level: "warn", message: PAGE_NOT_UPDATED + error.message }]);
    expect(await readdir(shareDir(site))).toEqual(["current.docx"]);
    expect(XMLValidator.validate((await wordCopy(site)).document)).toBe(true);
  });

  it("writes the page, and says why the Word copy wasn't, when it can't be made", async () => {
    const { site } = await siteWithRun();
    await rm(shareDir(site), { recursive: true, force: true });
    vi.mocked(renderWordCopy).mockRejectedValueOnce(new Error("The document couldn't be packed."));
    const logger = createMemoryLogger();

    const files = await writeShareFiles({ siteDir: site, config: DEFAULT_CONFIG, logger });

    expect(files).toEqual({ page: sharePath(site), word: null });
    expect(logger.entries).toEqual([
      { level: "warn", message: `${WORD_NOT_UPDATED}The document couldn't be packed.` },
    ]);
    expect(await readdir(shareDir(site))).toEqual(["current.html"]);
  });

  it("gives a site whose only run was a replay files that say no live run counts yet", async () => {
    // As CI's smoke test runs it: a replay of the fixture's recorded run.
    const dir = await setup();
    const result = await runAudit({
      ...options(dir, undefined),
      site: "http://127.0.0.1:4747",
      pages: fixture("pages.json"),
      replayFrom: fixture("replay-run"),
    });
    expect(result.outcome).toBe("completed");

    const page = await readFile(sharePath(result.siteDir), "utf8");

    expect(page).toContain("No live run counts yet");
    expect(page).toContain("data:font/woff2;base64,");
    // Nothing counts, so there's nothing for the fingerprint check to carry.
    expect(page).not.toContain('id="fp-data"');
    // The Word copy is there too, as CI's smoke test looks for it, and says so.
    const { document } = await wordCopy(result.siteDir);
    expect(XMLValidator.validate(document)).toBe(true);
    expect(paragraphsOf(document).map(({ text }) => text)).toContainEqual(
      expect.stringContaining("No live run counts yet"),
    );
  });
});
