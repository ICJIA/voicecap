/**
 * shareReport, which `voicecap share` runs: the dated pair of copies it makes to send (the page and
 * its Word copy), the record it keeps of them in shares.json, and the line it gives for the email
 * that sends them. Each home is made with real scripted runs: a replay doesn't count. No real
 * screen reader starts here, and no Word: a Word copy is read by unzipping it.
 */
import { existsSync, readFileSync } from "node:fs";
import type * as FsPromises from "node:fs/promises";
import { mkdir, open, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { esc } from "../src/report/html.js";
import { runAudit } from "../src/run/audit.js";
import { ensureGitFiles } from "../src/run/git-files.js";
import type * as GitFilesModule from "../src/run/git-files.js";
import { shareDir, sharePath, sharesPath, shareWordPath } from "../src/run/paths.js";
import { renderWordCopy } from "../src/share/docx.js";
import type * as DocxModule from "../src/share/docx.js";
import { lineText } from "../src/share/line.js";
import { loadShareInput } from "../src/share/load.js";
import type * as LoadModule from "../src/share/load.js";
import { buildShareModel } from "../src/share/model.js";
import type * as ModelModule from "../src/share/model.js";
import {
  EMAIL_LIMIT_BYTES,
  shareReport,
  sizeLine,
  sizeWarning,
  type ShareReportOptions,
} from "../src/share/share.js";
import { appendShare, readShares } from "../src/share/shares.js";
import type * as SharesModule from "../src/share/shares.js";
import { EVIDENCE_TEXT, MAC_HASH, POWERSHELL_HASH, WORD_TEXT } from "../src/share/text.js";
import { UsageError } from "../src/util/errors.js";
import { sha256 } from "../src/util/hash.js";
import { createMemoryLogger, type Logger, type MemoryLogger } from "../src/util/log.js";
import { isoLocal } from "../src/util/time.js";
import { paragraphsOf, unzipDocx } from "./helpers/docx.js";
import { options as runOptions, outDir, setup, SITE, sitePages } from "./helpers/run-site.js";
import { ScriptedDriver } from "./helpers/scripted-driver.js";

// Every call goes through as it did, and is kept, so a test can count the calls, make one fail, or
// have something happen in the middle of it: the site's records are read, the model is built, the
// Word copy is made, the Git files are made, the entry is recorded, and a copy's file is opened or
// removed.
vi.mock("../src/share/load.js", async (importOriginal) => {
  const actual = await importOriginal<typeof LoadModule>();
  return { ...actual, loadShareInput: vi.fn(actual.loadShareInput) };
});
vi.mock("../src/share/model.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ModelModule>();
  return { ...actual, buildShareModel: vi.fn(actual.buildShareModel) };
});
vi.mock("../src/share/docx.js", async (importOriginal) => {
  const actual = await importOriginal<typeof DocxModule>();
  return { ...actual, renderWordCopy: vi.fn(actual.renderWordCopy) };
});
vi.mock("../src/share/shares.js", async (importOriginal) => {
  const actual = await importOriginal<typeof SharesModule>();
  return { ...actual, appendShare: vi.fn(actual.appendShare) };
});
vi.mock("../src/run/git-files.js", async (importOriginal) => {
  const actual = await importOriginal<typeof GitFilesModule>();
  return { ...actual, ensureGitFiles: vi.fn(actual.ensureGitFiles) };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return { ...actual, open: vi.fn(actual.open), rm: vi.fn(actual.rm) };
});

/** The homes these tests made, which are taken away after each. */
const homes: string[] = [];

afterEach(async () => {
  // Back to going through, with no call kept and no failure waiting, whatever a test did.
  for (const made of [
    loadShareInput,
    buildShareModel,
    renderWordCopy,
    appendShare,
    ensureGitFiles,
  ]) {
    vi.mocked(made).mockReset();
  }
  vi.mocked(open).mockReset();
  vi.mocked(rm).mockReset();
  await Promise.all(
    homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})),
  );
});

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const fixture = (...parts: string[]) => path.join(ROOT, "fixture", ...parts);

/** SITE's folder in the home, and the day the tests share on. */
const FOLDER = "example.illinois.gov";
const NOW = new Date(2027, 0, 15, 10, 0);
/** The first pair's name, without its extension: the folder's, then the day. */
const FIRST = `${FOLDER}_2027-01-15`;

/** A new home folder, taken away after the test. */
async function newHome(): Promise<string> {
  const dir = await setup();
  homes.push(dir);
  return dir;
}

/** What shares SITE's folder in `dir`'s home: the brief's options, and the logger they say it to. */
function sharing(dir: string): { logger: MemoryLogger; options: ShareReportOptions } {
  const logger = createMemoryLogger();
  return {
    logger,
    options: {
      out: path.join(dir, "transcripts"),
      site: SITE,
      reviewer: "Pat Lee",
      now: NOW,
      logger,
      cwd: dir,
      env: {},
    },
  };
}

/** A home with one completed, sealed, live run of the scripted site, and what shares it. */
async function homeWithRun() {
  const dir = await newHome();
  const run = await runAudit(runOptions(dir, new ScriptedDriver(sitePages())));
  expect(run.outcome).toBe("completed");
  return { dir, siteDir: outDir(dir), run, ...sharing(dir) };
}

/** A home whose only run is a replay, which doesn't count. */
async function homeWithReplay() {
  const dir = await newHome();
  const replay = "http://127.0.0.1:4747";
  const run = await runAudit({
    ...runOptions(dir, undefined),
    site: replay,
    pages: fixture("pages.json"),
    replayFrom: fixture("replay-run"),
  });
  expect(run.outcome).toBe("completed");
  return {
    siteDir: run.siteDir,
    options: { ...sharing(dir).options, site: replay },
  };
}

/** Leave `shares` as the record of what was shared, as a person or another program might have. */
async function plantRecord(siteDir: string, shares: unknown[]): Promise<void> {
  await mkdir(shareDir(siteDir), { recursive: true });
  await writeFile(sharesPath(siteDir), JSON.stringify({ schemaVersion: 1, shares }, null, 2));
}

/** What a folder holds, sorted. */
async function names(dir: string): Promise<string[]> {
  return (await readdir(dir)).sort();
}

/**
 * Have `file` appear while the copies are being made, as if another `voicecap share` had taken its
 * name since this one chose it. The Word copy's render is where it happens: after the names are
 * chosen and the page is rendered, and before any copy is written.
 */
async function takenMeanwhile(file: string): Promise<void> {
  const real = await vi.importActual<typeof DocxModule>("../src/share/docx.js");
  vi.mocked(renderWordCopy).mockImplementationOnce(async (model) => {
    await writeFile(file, "someone else's file");
    return real.renderWordCopy(model);
  });
}

describe("shareReport", () => {
  it("writes the dated pair, and records it", async () => {
    const { siteDir, run, options } = await homeWithRun();

    const { files, entry, pasteLine } = await shareReport(options);

    expect(files.map(({ name }) => name)).toEqual([`${FIRST}.html`, `${FIRST}.docx`]);
    for (const file of files) {
      const bytes = await readFile(file.path);
      expect({ bytes: bytes.length, sha256: sha256(bytes) }).toEqual({
        bytes: file.bytes,
        sha256: file.sha256,
      });
    }
    expect(entry).toMatchObject({
      seq: 1,
      prev: null,
      by: "Pat Lee",
      at: isoLocal(NOW),
      runs: [run.runId],
    });
    expect((await readShares(siteDir)).shares).toEqual([entry]);
    expect(pasteLine).toBe(
      `Fingerprints (SHA-256): ${files[0]!.name} ${files[0]!.sha256}; ${files[1]!.name} ${files[1]!.sha256}. To check a file you received: Get-FileHash <file> in PowerShell, or shasum -a 256 <file> on a Mac. PowerShell shows the same letters in capitals.`,
    );
  });

  it("gives each file's path in the site's share folder, with what the entry records of it", async () => {
    const { siteDir, options } = await homeWithRun();

    const { files, entry, siteDir: gave } = await shareReport(options);

    expect(gave).toBe(siteDir);
    expect(files.map(({ path: file }) => file)).toEqual([
      path.join(shareDir(siteDir), `${FIRST}.html`),
      path.join(shareDir(siteDir), `${FIRST}.docx`),
    ]);
    expect(files.map(({ path: _path, ...recorded }) => recorded)).toEqual(entry.files);
  });

  it("has each copy name itself and the other", async () => {
    const { options } = await homeWithRun();

    const { files } = await shareReport(options);

    expect(await readFile(files[0]!.path, "utf8")).toContain(
      `This file: <span class="mono">${FIRST}.html</span>. Its Word copy: <span class="mono">${FIRST}.docx</span>.`,
    );
    const { document } = await unzipDocx(await readFile(files[1]!.path));
    expect(paragraphsOf(document).at(-1)?.text).toBe(
      `This file: ${FIRST}.docx. Its web page: ${FIRST}.html.`,
    );
  });

  // Review Focus 4.
  it("numbers a second pair on the same day, and never changes the first", async () => {
    const { options } = await homeWithRun();

    const first = await shareReport(options);
    const before = await Promise.all(first.files.map(({ path: file }) => readFile(file)));
    const second = await shareReport(options);

    expect(second.files.map(({ name }) => name)).toEqual([`${FIRST}-2.html`, `${FIRST}-2.docx`]);
    expect(await Promise.all(first.files.map(({ path: file }) => readFile(file)))).toEqual(before);
    expect(second.entry).toMatchObject({ seq: 2, prev: first.entry.seal });
  });

  it("never takes a name the record has, even when its file is gone", async () => {
    const { options } = await homeWithRun();
    const first = await shareReport(options);
    await Promise.all(first.files.map(({ path: file }) => rm(file)));

    expect((await shareReport(options)).files[0]!.name).toBe(`${FIRST}-2.html`);
  });

  it("never writes over a file that's there, recorded or not", async () => {
    const { siteDir, options } = await homeWithRun();
    await mkdir(shareDir(siteDir), { recursive: true });
    await writeFile(path.join(shareDir(siteDir), `${FIRST}.docx`), "someone's own file");

    expect((await shareReport(options)).files[0]!.name).toBe(`${FIRST}-2.html`);
    expect(await readFile(path.join(shareDir(siteDir), `${FIRST}.docx`), "utf8")).toBe(
      "someone's own file",
    );
  });

  it("takes the first number whose names are free, past a folder, a file, and a record of each kind", async () => {
    const { siteDir, options } = await homeWithRun();
    // Anything by the name takes it: a folder here, a file nothing records there, and a name the
    // record has whose file is gone.
    await mkdir(path.join(shareDir(siteDir), `${FIRST}.html`));
    await writeFile(path.join(shareDir(siteDir), `${FIRST}-2.docx`), "a file nothing records");
    await plantRecord(siteDir, [
      {
        seq: 1,
        prev: null,
        at: isoLocal(NOW),
        by: "Sam Tester",
        runs: [],
        files: [{ name: `${FIRST}-3.html`, bytes: 1, sha256: "a".repeat(64) }],
        seal: "b".repeat(64),
      },
    ]);

    vi.mocked(buildShareModel).mockClear();

    const { files } = await shareReport(options);

    expect(files.map(({ name }) => name)).toEqual([`${FIRST}-4.html`, `${FIRST}-4.docx`]);
    // A pair that's taken from the start is passed over: no copy is made for it.
    expect(
      vi
        .mocked(buildShareModel)
        .mock.calls.map(([input]) => input.fileName)
        .filter((name) => name !== "current.html"),
    ).toEqual([`${FIRST}-4.html`]);
  });

  it("writes each copy, syncs it to disk, and closes it, before it goes on to the next", async () => {
    const { options } = await homeWithRun();
    const real = await vi.importActual<typeof FsPromises>("node:fs/promises");
    const steps: string[] = [];
    vi.mocked(open).mockImplementation(async (file, flags, mode) => {
      const handle = await real.open(file, flags, mode);
      const kind = path.extname(String(file)).slice(1);
      if (flags !== "wx" || (kind !== "html" && kind !== "docx")) return handle;
      steps.push(`open ${kind}`);
      // The same handle, which says each step it's asked to take.
      return new Proxy(handle, {
        get(target, property) {
          const value: unknown = Reflect.get(target, property, target);
          if (typeof value !== "function") return value;
          return (...args: unknown[]): unknown => {
            if (["writeFile", "sync", "close"].includes(String(property))) {
              steps.push(`${String(property)} ${kind}`);
            }
            return (value as (...called: unknown[]) => unknown).apply(target, args);
          };
        },
      });
    });

    await shareReport(options);

    expect(steps).toEqual([
      "open html",
      "writeFile html",
      "sync html",
      "close html",
      "open docx",
      "writeFile docx",
      "sync docx",
      "close docx",
    ]);
  });

  it("leaves current.html and current.docx as they were", async () => {
    const { siteDir, options } = await homeWithRun();
    const current = [sharePath(siteDir), shareWordPath(siteDir)];
    const before = await Promise.all(current.map((file) => readFile(file)));

    await shareReport(options);

    expect(await Promise.all(current.map((file) => readFile(file)))).toEqual(before);
  });

  it("makes the share folder, and the record, for a site that has none", async () => {
    const { siteDir, options } = await homeWithRun();
    await rm(shareDir(siteDir), { recursive: true, force: true });

    await shareReport(options);

    expect(await names(shareDir(siteDir))).toEqual([
      `${FIRST}.docx`,
      `${FIRST}.html`,
      "shares.json",
    ]);
  });

  it.each([
    ["just after midnight", new Date(2027, 0, 15, 0, 30)],
    ["just before midnight", new Date(2027, 0, 15, 23, 30)],
  ])("dates the pair by the local day, %s", async (_when, now) => {
    const { options } = await homeWithRun();

    const { files } = await shareReport({ ...options, now });

    expect(files.map(({ name }) => name)).toEqual([`${FIRST}.html`, `${FIRST}.docx`]);
  });

  it("records the runs the copies draw on, oldest first", async () => {
    const dir = await newHome();
    const first = await runAudit(
      runOptions(dir, new ScriptedDriver(sitePages()), { now: () => new Date(2027, 0, 14, 9, 0) }),
    );
    const second = await runAudit(
      runOptions(dir, new ScriptedDriver(sitePages()), { now: () => new Date(2027, 0, 14, 11, 0) }),
    );
    expect([first.runId, second.runId]).toEqual(["2027-01-14_0900", "2027-01-14_1100"]);

    const { entry } = await shareReport(sharing(dir).options);

    expect(entry.runs).toEqual([first.runId, second.runId]);
  });

  it("takes the name as a review does, when --reviewer gives none", async () => {
    const { options } = await homeWithRun();

    const { entry } = await shareReport({
      ...options,
      reviewer: null,
      env: { VOICECAP_REVIEWER: "Env Name" },
    });

    expect(entry.by).toBe("Env Name");
  });

  it("says what it made, with the paste line last", async () => {
    const { siteDir, logger, options } = await homeWithRun();

    const { files, pasteLine } = await shareReport(options);

    const page = files[0]!;
    const word = files[1]!;
    expect(logger.entries.filter(({ level }) => level !== "info")).toEqual([]);
    expect(logger.text("info").split("\n")).toEqual([
      `Shared ${FOLDER}, as of 15 January 2027: entry 1 in ${sharesPath(siteDir)}.`,
      `  ${page.path}`,
      `    ${sizeLine(page.bytes)}, SHA-256 ${page.sha256}`,
      `  ${word.path}`,
      `    ${sizeLine(word.bytes)}, SHA-256 ${word.sha256}`,
      "To paste into the email that sends them:",
      `  ${pasteLine}`,
    ]);
    // Each size is in KB or MB, with its bytes.
    expect(sizeLine(page.bytes)).toMatch(/^([\d,]+ KB|\d+\.\d MB) \([\d,]+ bytes\)$/);
    expect(sizeLine(word.bytes)).toMatch(/^([\d,]+ KB|\d+\.\d MB) \([\d,]+ bytes\)$/);
  });

  describe("the line for the email", () => {
    // What the sender pastes and what the copies tell their reader to run to check a file must be
    // one set of commands, or the email and the copies would send a reader two ways.
    it("names the commands the copies' own check names", async () => {
      const { options } = await homeWithRun();
      const check = `${POWERSHELL_HASH} in PowerShell, or ${MAC_HASH} on a Mac`;

      const { files, pasteLine } = await shareReport(options);

      expect(pasteLine).toContain(`To check a file you received: ${check}.`);
      // The words of both copies, from the same two commands...
      expect(lineText(EVIDENCE_TEXT.proves("voicecap verify"))).toContain(check);
      expect(lineText(WORD_TEXT.evidence.compare())).toContain(check);
      // ...and the copies as they were written.
      expect(await readFile(files[0]!.path, "utf8")).toContain(
        `<code>${esc(POWERSHELL_HASH)}</code> in PowerShell, or <code>${esc(MAC_HASH)}</code> on a Mac`,
      );
      const { document } = await unzipDocx(await readFile(files[1]!.path));
      expect(paragraphsOf(document).map(({ text }) => text)).toContainEqual(
        expect.stringContaining(check),
      );
    });

    // PowerShell's Get-FileHash prints a fingerprint in capitals, and every other place has it in
    // lower case: the copies, the record, and this line. So the line says the letters are the same.
    it("ends by saying PowerShell shows the same letters in capitals, with its own in lower case", async () => {
      const { options } = await homeWithRun();

      const { files, pasteLine } = await shareReport(options);

      const check = `${POWERSHELL_HASH} in PowerShell, or ${MAC_HASH} on a Mac`;
      expect(pasteLine.endsWith(`${check}. PowerShell shows the same letters in capitals.`)).toBe(
        true,
      );
      for (const { sha256: fingerprint } of files) {
        expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
        expect(pasteLine).toContain(fingerprint);
        expect(pasteLine).not.toContain(fingerprint.toUpperCase());
      }
    });
  });

  describe("when there's nothing it can share", () => {
    it("refuses when no run counts, and writes nothing", async () => {
      const { siteDir, options } = await homeWithReplay();
      const before = await names(shareDir(siteDir));

      const refused = shareReport(options);

      await expect(refused).rejects.toThrow(UsageError);
      await expect(refused).rejects.toThrow(
        `No completed, sealed, live run in ${siteDir} yet, so there's nothing to share. Replayed, interrupted, and unsealed runs don't count.`,
      );
      expect(existsSync(sharesPath(siteDir))).toBe(false);
      expect(await names(shareDir(siteDir))).toEqual(before);
    });

    it("refuses for want of a run before it reads the record, so a bad record isn't what it says", async () => {
      const { siteDir, options } = await homeWithReplay();
      await writeFile(sharesPath(siteDir), "{ not json");

      await expect(shareReport(options)).rejects.toThrow(/so there's nothing to share\./);
    });

    it("refuses a site folder with no run at all, and makes nothing", async () => {
      const { dir, options } = await homeWithRun();
      const nowhere = "https://no-runs.example.gov";

      await expect(shareReport({ ...options, site: nowhere })).rejects.toThrow(
        /There's no run in .* yet, so there's nothing to share\./,
      );

      expect(existsSync(path.join(dir, "transcripts", "no-runs.example.gov"))).toBe(false);
    });

    // Review Focus 5.
    it("refuses to share over a record it can't read, and writes no copy", async () => {
      const { siteDir, options } = await homeWithRun();
      await writeFile(sharesPath(siteDir), "{ not json");

      await expect(shareReport(options)).rejects.toThrow(
        /never overwrites the record of what was shared/,
      );

      expect(await names(shareDir(siteDir))).toEqual([
        "current.docx",
        "current.html",
        "shares.json",
      ]);
      expect(await readFile(sharesPath(siteDir), "utf8")).toBe("{ not json");
    });
  });

  describe("reading the record", () => {
    // Reading checks only that each entry is an object, so a record someone edited by hand may hold
    // an entry with anything in it. An entry that has no usable list of files names nothing.
    it("takes an entry it can't read the files of as naming nothing, and shares all the same", async () => {
      const { siteDir, options } = await homeWithRun();
      const taken = `${FIRST}.html`;
      const odd = [
        { seq: 1 },
        { seq: 2, files: taken },
        { seq: 3, files: { name: taken } },
        { seq: 4, files: [null, 7, taken, ["x"], {}, { name: 5 }, { bytes: 1 }] },
      ];
      await plantRecord(siteDir, odd);

      const { files, entry } = await shareReport(options);

      expect(files.map(({ name }) => name)).toEqual([`${FIRST}.html`, `${FIRST}.docx`]);
      expect(entry.seq).toBe(5);
      // What was there is as it was, and the new entry follows.
      const { shares } = await readShares(siteDir);
      expect(shares.slice(0, 4)).toEqual(odd);
      expect(shares).toHaveLength(5);
    });

    it("takes the name of each well-formed file an entry lists, and none of the odd ones beside them", async () => {
      const { siteDir, options } = await homeWithRun();
      await plantRecord(siteDir, [
        { seq: 1, files: [null, { name: 5 }, { name: `${FIRST}.docx` }, 7] },
      ]);

      const { files } = await shareReport(options);

      expect(files.map(({ name }) => name)).toEqual([`${FIRST}-2.html`, `${FIRST}-2.docx`]);
    });

    it("reads the site's records once, and builds the model for each pair of names it tries", async () => {
      const { siteDir, options } = await homeWithRun();
      // The first pair's Word copy is taken while the copies are being made.
      const raced = path.join(shareDir(siteDir), `${FIRST}.docx`);
      await takenMeanwhile(raced);
      vi.mocked(loadShareInput).mockClear();
      vi.mocked(buildShareModel).mockClear();

      const { files } = await shareReport(options);

      expect(files.map(({ name }) => name)).toEqual([`${FIRST}-2.html`, `${FIRST}-2.docx`]);
      expect(loadShareInput).toHaveBeenCalledTimes(1);
      // The first build is only to see that a run counts, with the names a current copy has.
      const tried = vi
        .mocked(buildShareModel)
        .mock.calls.map(([input]) => [input.fileName, input.wordName])
        .filter(([page]) => page !== "current.html");
      expect(tried).toEqual([
        [`${FIRST}.html`, `${FIRST}.docx`],
        [`${FIRST}-2.html`, `${FIRST}-2.docx`],
      ]);
    });
  });

  describe("when a name is taken while the copies are made", () => {
    it("takes the next number, and leaves the file that took the name as it was", async () => {
      const { siteDir, options } = await homeWithRun();
      const raced = path.join(shareDir(siteDir), `${FIRST}.docx`);
      await takenMeanwhile(raced);

      const { files, entry } = await shareReport(options);

      expect(files.map(({ name }) => name)).toEqual([`${FIRST}-2.html`, `${FIRST}-2.docx`]);
      expect(await readFile(raced, "utf8")).toBe("someone else's file");
      // The page this attempt wrote of the first pair is taken away: only what it wrote.
      expect(await names(shareDir(siteDir))).toEqual([
        "current.docx",
        "current.html",
        `${FIRST}-2.docx`,
        `${FIRST}-2.html`,
        `${FIRST}.docx`,
        "shares.json",
      ]);
      expect(entry.files.map(({ name }) => name)).toEqual([`${FIRST}-2.html`, `${FIRST}-2.docx`]);
      expect((await readShares(siteDir)).shares).toEqual([entry]);
      // The copies are made again for the new names, not the first pair's renamed.
      expect(await readFile(files[0]!.path, "utf8")).toContain(
        `This file: <span class="mono">${FIRST}-2.html</span>. Its Word copy: <span class="mono">${FIRST}-2.docx</span>.`,
      );
      const { document } = await unzipDocx(await readFile(files[1]!.path));
      expect(paragraphsOf(document).at(-1)?.text).toBe(
        `This file: ${FIRST}-2.docx. Its web page: ${FIRST}-2.html.`,
      );
    });

    it("takes the next number when the page's name is taken, with nothing of its own to remove", async () => {
      const { siteDir, options } = await homeWithRun();
      const raced = path.join(shareDir(siteDir), `${FIRST}.html`);
      await takenMeanwhile(raced);

      const { files } = await shareReport(options);

      expect(files.map(({ name }) => name)).toEqual([`${FIRST}-2.html`, `${FIRST}-2.docx`]);
      expect(await readFile(raced, "utf8")).toBe("someone else's file");
      expect(await names(shareDir(siteDir))).toEqual([
        "current.docx",
        "current.html",
        `${FIRST}-2.docx`,
        `${FIRST}-2.html`,
        `${FIRST}.html`,
        "shares.json",
      ]);
    });
  });

  describe("when it can't finish", () => {
    /** What the share folder holds with nothing shared: the live copies. */
    const NOTHING_SHARED = ["current.docx", "current.html"];

    it("takes its copies away, and gives the error, when the entry can't be recorded", async () => {
      const { siteDir, options } = await homeWithRun();
      vi.mocked(appendShare).mockRejectedValueOnce(new Error("The record is held."));

      await expect(shareReport(options)).rejects.toThrow("The record is held.");

      expect(await names(shareDir(siteDir))).toEqual(NOTHING_SHARED);
      expect(existsSync(sharesPath(siteDir))).toBe(false);
    });

    it("leaves what an earlier share recorded as it was, when a later entry can't be recorded", async () => {
      const { siteDir, options } = await homeWithRun();
      const first = await shareReport(options);
      const record = await readFile(sharesPath(siteDir));
      const before = await names(shareDir(siteDir));
      vi.mocked(appendShare).mockRejectedValueOnce(new Error("The record is held."));

      await expect(shareReport(options)).rejects.toThrow("The record is held.");

      expect(await readFile(sharesPath(siteDir))).toEqual(record);
      expect(await names(shareDir(siteDir))).toEqual(before);
      // And the earlier pair is as it was.
      for (const file of first.files) {
        expect(sha256(await readFile(file.path))).toBe(file.sha256);
      }
    });

    it("takes its copies away, and gives the error, when the home's Git files can't be made", async () => {
      const { siteDir, options } = await homeWithRun();
      vi.mocked(ensureGitFiles).mockRejectedValueOnce(new Error("The home is read-only."));

      await expect(shareReport(options)).rejects.toThrow("The home is read-only.");

      expect(await names(shareDir(siteDir))).toEqual(NOTHING_SHARED);
      expect(existsSync(sharesPath(siteDir))).toBe(false);
    });

    it("takes the page away, and gives the error, when the Word copy can't be written", async () => {
      const { siteDir, options } = await homeWithRun();
      const real = await vi.importActual<typeof FsPromises>("node:fs/promises");
      vi.mocked(open).mockImplementation((file, flags, mode) =>
        String(file).endsWith(".docx") && flags === "wx"
          ? Promise.reject(
              Object.assign(new Error("ENOSPC: no space left on device, open"), {
                code: "ENOSPC",
              }),
            )
          : real.open(file, flags, mode),
      );

      await expect(shareReport(options)).rejects.toThrow("ENOSPC: no space left on device");

      expect(await names(shareDir(siteDir))).toEqual(NOTHING_SHARED);
      expect(existsSync(sharesPath(siteDir))).toBe(false);
    });

    it("says which copy it couldn't take away, since nothing records it, and still gives the error", async () => {
      const { siteDir, logger, options } = await homeWithRun();
      vi.mocked(appendShare).mockRejectedValueOnce(new Error("The record is held."));
      // The first removal is refused, as when a program is holding the new file.
      vi.mocked(rm).mockRejectedValueOnce(
        Object.assign(new Error("EPERM: operation not permitted, unlink"), { code: "EPERM" }),
      );

      await expect(shareReport(options)).rejects.toThrow("The record is held.");

      const page = path.join(shareDir(siteDir), `${FIRST}.html`);
      expect(logger.entries.filter(({ level }) => level === "warn")).toEqual([
        {
          level: "warn",
          message: `Couldn't remove ${page}, which this share wrote and nothing records: EPERM: operation not permitted, unlink`,
        },
      ]);
      // The other was taken away all the same.
      expect(await names(shareDir(siteDir))).toEqual([...NOTHING_SHARED, `${FIRST}.html`].sort());
    });

    it("writes nothing, and says why, when the site's records can't be read", async () => {
      const { siteDir, options } = await homeWithRun();
      vi.mocked(loadShareInput).mockRejectedValueOnce(new Error("The records are held."));

      await expect(shareReport(options)).rejects.toThrow("The records are held.");

      expect(await names(shareDir(siteDir))).toEqual(NOTHING_SHARED);
    });
  });

  describe("a copy too big for most email", () => {
    it("is warned of, after the share is recorded, with its size in MB", async () => {
      const { siteDir, logger, options } = await homeWithRun();
      // Just over the limit: a Word copy of 21 MB.
      const big = 21 * 1024 * 1024;
      vi.mocked(renderWordCopy).mockResolvedValueOnce(new Uint8Array(big));
      // What the record held when each warning was said.
      const said: { warning: string; recorded: number }[] = [];
      const watching: Logger = {
        ...logger,
        warn: (warning) => {
          const record = JSON.parse(readFileSync(sharesPath(siteDir), "utf8")) as {
            shares: unknown[];
          };
          said.push({ warning, recorded: record.shares.length });
        },
      };

      const { files } = await shareReport({ ...options, logger: watching });

      expect(files[1]).toMatchObject({ name: `${FIRST}.docx`, bytes: big });
      expect(said).toEqual([
        {
          warning: `${FIRST}.docx is 21.0 MB, over 20 MB: too big for most email.`,
          recorded: 1,
        },
      ]);
      expect(logger.text("info")).toContain("21.0 MB (22,020,096 bytes), SHA-256 ");
    });

    it("isn't warned of at 20 MB, which is the limit and not over it", async () => {
      const { logger, options } = await homeWithRun();
      vi.mocked(renderWordCopy).mockResolvedValueOnce(new Uint8Array(EMAIL_LIMIT_BYTES));

      await shareReport(options);

      expect(logger.text("warn")).toBe("");
    });
  });
});

describe("sizeWarning", () => {
  it("warns when a copy is too big for most email", () => {
    expect(sizeWarning("x.html", 24_536_679)).toBe(
      "x.html is 23.4 MB, over 20 MB: too big for most email.",
    );
    expect(sizeWarning("x.html", EMAIL_LIMIT_BYTES)).toBeNull();
  });

  it("is for a file strictly over 20 MB", () => {
    expect(EMAIL_LIMIT_BYTES).toBe(20 * 1024 * 1024);
    expect(sizeWarning("x.docx", EMAIL_LIMIT_BYTES - 1)).toBeNull();
    expect(sizeWarning("x.docx", EMAIL_LIMIT_BYTES + 1)).toBe(
      "x.docx is 20.0 MB, over 20 MB: too big for most email.",
    );
  });
});

describe("sizeLine", () => {
  it.each([
    // Whole KB, rounded, and never under 1, with thousands separators, for as long as the rounded
    // KB is under 1,024.
    [0, "1 KB (0 bytes)"],
    [1, "1 KB (1 byte)"],
    [512, "1 KB (512 bytes)"],
    [317_440, "310 KB (317,440 bytes)"],
    [1_047_551, "1,023 KB (1,047,551 bytes)"],
    [1_048_063, "1,023 KB (1,048,063 bytes)"],
    // From there MB with one decimal: the switch is where the rounded KB reaches 1,024 (1,048,064
    // bytes, which is 1,023.5 KB), not at 1,048,576 bytes, so no size ever reads "1,024 KB".
    [1_048_064, "1.0 MB (1,048,064 bytes)"],
    [1_048_575, "1.0 MB (1,048,575 bytes)"],
    [1_048_576, "1.0 MB (1,048,576 bytes)"],
    [1_234_567, "1.2 MB (1,234,567 bytes)"],
    [24_536_679, "23.4 MB (24,536,679 bytes)"],
  ])("gives %i bytes as %s", (bytes, said) => {
    expect(sizeLine(bytes)).toBe(said);
  });

  it("never says 1,024 KB, and goes from KB to MB once, at 1,048,064 bytes", () => {
    // Every size from a way under the switch to a way over it.
    const lines: string[] = [];
    for (let bytes = 1_000_000; bytes <= 1_100_000; bytes++) lines.push(sizeLine(bytes));
    const unit = (line: string) => (line.includes(" KB (") ? "KB" : "MB");
    const first = lines.findIndex((line) => unit(line) === "MB");
    expect(1_000_000 + first).toBe(1_048_064);
    expect(lines.slice(0, first).every((line) => unit(line) === "KB")).toBe(true);
    expect(lines.slice(first).every((line) => unit(line) === "MB")).toBe(true);
    expect(lines.some((line) => /^1,?024 KB/.test(line))).toBe(false);
  });
});
