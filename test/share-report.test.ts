/**
 * shareReport, which `voicecap share` runs: the dated pair of copies it makes to send (the page and
 * its Word copy), each run's walkthrough file beside them, the record it keeps of them in
 * shares.json, and the line it gives for the email that sends the pair. Each home is made with real
 * scripted runs (a replay doesn't count), or is a copy of the demo runs voicecap 0.4.1 recorded. No
 * real screen reader starts here, and no Word: a Word copy is read by unzipping it.
 */
import { existsSync, readFileSync } from "node:fs";
import type * as FsPromises from "node:fs/promises";
import { cp, mkdir, mkdtemp, open, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveConfig, type LoadedConfig } from "../src/config/load.js";
import type { RunJson } from "../src/model.js";
import { esc } from "../src/report/html.js";
import { runAudit } from "../src/run/audit.js";
import { ensureGitFiles } from "../src/run/git-files.js";
import type * as GitFilesModule from "../src/run/git-files.js";
import { runJsonPath, shareDir, sharePath, sharesPath, shareWordPath } from "../src/run/paths.js";
import { renderWordCopy } from "../src/share/docx.js";
import type * as DocxModule from "../src/share/docx.js";
import { sizeLine } from "../src/share/format.js";
import { lineText } from "../src/share/line.js";
import { loadShareInput } from "../src/share/load.js";
import type * as LoadModule from "../src/share/load.js";
import { buildShareModel } from "../src/share/model.js";
import type * as ModelModule from "../src/share/model.js";
import {
  EMAIL_LIMIT_BYTES,
  shareReport,
  sizeWarning,
  type ShareReportOptions,
} from "../src/share/share.js";
import { appendShare, readShares } from "../src/share/shares.js";
import type * as SharesModule from "../src/share/shares.js";
import { EVIDENCE_TEXT, MAC_HASH, POWERSHELL_HASH, WORD_TEXT } from "../src/share/text.js";
import { walkthroughJson, walkthroughOf } from "../src/share/walkthrough.js";
import { UsageError } from "../src/util/errors.js";
import { sealOf, sha256 } from "../src/util/hash.js";
import { createMemoryLogger, type Logger, type MemoryLogger } from "../src/util/log.js";
import { isoLocal } from "../src/util/time.js";
import { verifyHome } from "../src/verify.js";
import { paragraphsOf, unzipDocx } from "./helpers/docx.js";
import {
  homeWithCountedRun,
  options as runOptions,
  setup,
  SITE,
  sitePages,
} from "./helpers/run-site.js";
import { ScriptedDriver } from "./helpers/scripted-driver.js";
import { demoRun } from "./helpers/share-fixture.js";
import { DEMO_ROOT } from "./helpers/share-model.js";

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

/**
 * The demo runs voicecap 0.4.1 recorded on 29 September 2026 (test/fixtures/share/demo-2026-09-29),
 * as a home with one site's folder: 1315 and 1402 count, 1415 and 1419 were interrupted. They read
 * the demo at http://127.0.0.1:4848, and recorded no canonical address.
 */
const DEMO_HOME = path.join(ROOT, "test", "fixtures", "share", "demo-2026-09-29");
const DEMO_SITE = "http://127.0.0.1:4848";
const DEMO_FOLDER = "127.0.0.1_4848";
/**
 * The demo's first share's name, without its extension: the demo's canonical name, which
 * report.canonical gives it, then the day.
 */
const DEMO_FIRST = "voicecap.netlify.app_2027-01-15";
/** The two runs that count, oldest first. */
const RUN_1315 = "2026-09-29_1315";
const RUN_1402 = "2026-09-29_1402";

/** A walkthrough file's name beside the copies of `stem`: the stem, the run's id, and what it is. */
function walkthroughName(stem: string, run: string): string {
  return `${stem}_${run}_walkthrough.json`;
}

/**
 * The settings of a site whose canonical address `report.canonical` gives: what `voicecap share`
 * loads from a config file that says so.
 */
function configNaming(canonical: string): LoadedConfig {
  return { config: resolveConfig({ report: { canonical } }), file: null, sha256: "test-config" };
}

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
  const { dir, siteDir, run } = await homeWithCountedRun(await newHome());
  return { dir, siteDir, run, ...sharing(dir) };
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

/**
 * A copy of the demo runs, as a home that's taken away after the test, and what shares its site, on
 * a fixed day, with "Test Reviewer" sharing. The runs read the demo at an IP address and recorded no
 * canonical address, so the share names it by report.canonical, as the README says to: without one,
 * it would be refused (see Ruling P13a's tests).
 */
async function demoHome() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "voicecap-share-"));
  homes.push(dir);
  const home = path.join(dir, "transcripts");
  await cp(DEMO_HOME, home, { recursive: true });
  const { logger, options } = sharing(dir);
  return {
    home,
    siteDir: path.join(home, DEMO_FOLDER),
    logger,
    options: {
      ...options,
      site: DEMO_SITE,
      reviewer: "Test Reviewer",
      config: configNaming(DEMO_ROOT),
    },
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

    expect(files.map(({ name }) => name)).toEqual([
      `${FIRST}.html`,
      `${FIRST}.docx`,
      walkthroughName(FIRST, run.runId),
    ]);
    for (const file of files) {
      const bytes = await readFile(file.path);
      expect({ bytes: bytes.length, sha256: sha256(bytes) }).toEqual({
        bytes: file.bytes,
        sha256: file.sha256,
      });
    }
    // The site the scripted runs read names no canonical address, so the copies are named for the
    // host voicecap read, as before 0.10.0, and the entry says so, as a root.
    expect(entry).toMatchObject({
      seq: 1,
      prev: null,
      by: "Pat Lee",
      at: isoLocal(NOW),
      site: "https://example.illinois.gov/",
      runs: [run.runId],
    });
    expect((await readShares(siteDir)).shares).toEqual([entry]);
    expect(pasteLine).toBe(
      `Fingerprints (SHA-256): ${files[0]!.name} ${files[0]!.sha256}; ${files[1]!.name} ${files[1]!.sha256}. To check a file you received: Get-FileHash <file> in PowerShell, or shasum -a 256 <file> on a Mac. PowerShell shows the same letters in capitals.`,
    );
  });

  it("gives each file's path in the site's share folder, with what the entry records of it", async () => {
    const { siteDir, run, options } = await homeWithRun();

    const { files, entry, siteDir: gave } = await shareReport(options);

    expect(gave).toBe(siteDir);
    expect(files.map(({ path: file }) => file)).toEqual([
      path.join(shareDir(siteDir), `${FIRST}.html`),
      path.join(shareDir(siteDir), `${FIRST}.docx`),
      path.join(shareDir(siteDir), walkthroughName(FIRST, run.runId)),
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
    const { run, options } = await homeWithRun();

    const first = await shareReport(options);
    const before = await Promise.all(first.files.map(({ path: file }) => readFile(file)));
    const second = await shareReport(options);

    expect(second.files.map(({ name }) => name)).toEqual([
      `${FIRST}-2.html`,
      `${FIRST}-2.docx`,
      walkthroughName(`${FIRST}-2`, run.runId),
    ]);
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
    const { siteDir, run, options } = await homeWithRun();
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

    expect(files.map(({ name }) => name)).toEqual([
      `${FIRST}-4.html`,
      `${FIRST}-4.docx`,
      walkthroughName(`${FIRST}-4`, run.runId),
    ]);
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
      if (flags !== "wx" || !["html", "docx", "json"].includes(kind)) return handle;
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
      "open json",
      "writeFile json",
      "sync json",
      "close json",
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
    const { siteDir, run, options } = await homeWithRun();
    await rm(shareDir(siteDir), { recursive: true, force: true });

    await shareReport(options);

    expect(await names(shareDir(siteDir))).toEqual([
      `${FIRST}.docx`,
      `${FIRST}.html`,
      walkthroughName(FIRST, run.runId),
      "shares.json",
    ]);
  });

  it.each([
    ["just after midnight", new Date(2027, 0, 15, 0, 30)],
    ["just before midnight", new Date(2027, 0, 15, 23, 30)],
  ])("dates the pair by the local day, %s", async (_when, now) => {
    const { run, options } = await homeWithRun();

    const { files } = await shareReport({ ...options, now });

    expect(files.map(({ name }) => name)).toEqual([
      `${FIRST}.html`,
      `${FIRST}.docx`,
      walkthroughName(FIRST, run.runId),
    ]);
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
    const walkthrough = files[2]!;
    expect(logger.entries.filter(({ level }) => level !== "info")).toEqual([]);
    expect(logger.text("info").split("\n")).toEqual([
      `Shared ${FOLDER}, as of 15 January 2027: entry 1 in ${sharesPath(siteDir)}.`,
      `  ${page.path}`,
      `    ${sizeLine(page.bytes)}, SHA-256 ${page.sha256}`,
      `  ${word.path}`,
      `    ${sizeLine(word.bytes)}, SHA-256 ${word.sha256}`,
      `  ${walkthrough.path}`,
      `    ${sizeLine(walkthrough.bytes)}, SHA-256 ${walkthrough.sha256}`,
      "To paste into the email that sends the page and its Word copy:",
      `  ${pasteLine}`,
    ]);
    // Each size is in KB or MB, with its bytes.
    expect(sizeLine(page.bytes)).toMatch(/^([\d,]+ KB|\d+\.\d MB) \([\d,]+ bytes\)$/);
    expect(sizeLine(word.bytes)).toMatch(/^([\d,]+ KB|\d+\.\d MB) \([\d,]+ bytes\)$/);
    expect(sizeLine(walkthrough.bytes)).toMatch(/^([\d,]+ KB|\d+\.\d MB) \([\d,]+ bytes\)$/);
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
      // The page and its Word copy are what the line names: not the walkthrough file after them.
      for (const { sha256: fingerprint } of files.slice(0, 2)) {
        expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
        expect(pasteLine).toContain(fingerprint);
        expect(pasteLine).not.toContain(fingerprint.toUpperCase());
      }
    });
  });

  // The runs the copies draw on are the demo's 1315 and 1402, so each share has two walkthrough files.
  describe("each run's walkthrough file", () => {
    it("writes each run's walkthrough file beside the page and its Word copy, and records it", async () => {
      const { siteDir, options } = await demoHome();

      const { entry } = await shareReport(options);

      expect(entry.files.map(({ name }) => name)).toEqual([
        `${DEMO_FIRST}.html`,
        `${DEMO_FIRST}.docx`,
        walkthroughName(DEMO_FIRST, RUN_1315),
        walkthroughName(DEMO_FIRST, RUN_1402),
      ]);
      // Only a walkthrough file has a run, and as its last key: the other two have no such key.
      expect(entry.files.map((file) => Object.keys(file))).toEqual([
        ["name", "bytes", "sha256"],
        ["name", "bytes", "sha256"],
        ["name", "bytes", "sha256", "run"],
        ["name", "bytes", "sha256", "run"],
      ]);
      expect(entry.files.slice(2).map(({ run }) => run)).toEqual([RUN_1315, RUN_1402]);
      // Each is the file `voicecap walkthrough` writes of its run, whole on disk and as recorded.
      for (const [file, time] of [
        [entry.files[2]!, "1315"],
        [entry.files[3]!, "1402"],
      ] as const) {
        const bytes = await readFile(path.join(shareDir(siteDir), file.name));
        expect(bytes.toString("utf8")).toBe(walkthroughJson(walkthroughOf(demoRun(time))));
        expect({ bytes: file.bytes, sha256: file.sha256 }).toEqual({
          bytes: bytes.length,
          sha256: sha256(bytes),
        });
      }
      expect((await readShares(siteDir)).shares).toEqual([entry]);
    });

    it("numbers every file of a second share the same day", async () => {
      const { options } = await demoHome();
      await shareReport(options);

      const { entry } = await shareReport(options);

      const second = `${DEMO_FIRST}-2`;
      expect(entry.files.map(({ name }) => name)).toEqual([
        `${second}.html`,
        `${second}.docx`,
        walkthroughName(second, RUN_1315),
        walkthroughName(second, RUN_1402),
      ]);
    });

    it("takes the next number when a walkthrough file's name is taken", async () => {
      const { siteDir, options } = await demoHome();
      const taken = path.join(shareDir(siteDir), walkthroughName(DEMO_FIRST, RUN_1315));
      await mkdir(shareDir(siteDir), { recursive: true });
      await writeFile(taken, "someone's own file");
      vi.mocked(buildShareModel).mockClear();

      const { entry } = await shareReport(options);

      const second = `${DEMO_FIRST}-2`;
      expect(entry.files.map(({ name }) => name)).toEqual([
        `${second}.html`,
        `${second}.docx`,
        walkthroughName(second, RUN_1315),
        walkthroughName(second, RUN_1402),
      ]);
      expect(await readFile(taken, "utf8")).toBe("someone's own file");
      // The first number is passed over from the start: no copy is made for it.
      expect(
        vi
          .mocked(buildShareModel)
          .mock.calls.map(([input]) => input.fileName)
          .filter((name) => name !== "current.html"),
      ).toEqual([`${second}.html`]);
    });

    it("shares no walkthrough file of a run that can't have one, and says why", async () => {
      const { siteDir, logger, options } = await demoHome();
      // A label with an escape in it, which a walkthrough file never holds. The run is sealed again,
      // so that the edit leaves it a sealed run, as `verify` finds one.
      const file = runJsonPath(siteDir, "2026-09-29_1315");
      const run = JSON.parse(await readFile(file, "utf8")) as RunJson;
      run.pages[0]!.label = "Home\u{1b}[2J";
      run.seal = sealOf(run);
      await writeFile(file, `${JSON.stringify(run, null, 2)}\n`);

      const { entry } = await shareReport(options);

      expect(entry.files.map(({ name }) => name)).toEqual([
        `${DEMO_FIRST}.html`,
        `${DEMO_FIRST}.docx`,
        walkthroughName(DEMO_FIRST, RUN_1402),
      ]);
      // The run still counts, so it's still one the copies draw on.
      expect(entry.runs).toEqual([RUN_1315, RUN_1402]);
      expect(logger.entries.filter(({ level }) => level === "warn")).toEqual([
        {
          level: "warn",
          message:
            "Run 2026-09-29_1315's walkthrough file can't be made, so it isn't shared: page 1's label has a control character in it.",
        },
      ]);
    });

    it("names only the page and its Word copy in the line to paste", async () => {
      const { options } = await demoHome();

      const { files, pasteLine } = await shareReport(options);

      // The walkthrough files are written all the same.
      expect(files.map(({ name }) => name)).toContain(walkthroughName(DEMO_FIRST, RUN_1402));
      expect(pasteLine).not.toContain("_walkthrough.json");
      const [page, word] = files;
      expect(pasteLine).toContain(
        `Fingerprints (SHA-256): ${page!.name} ${page!.sha256}; ${word!.name} ${word!.sha256}. To check a file you received:`,
      );
    });

    it("leaves a home that verify finds whole", async () => {
      const { home, options } = await demoHome();

      const { entry } = await shareReport(options);

      // What verify checks includes the walkthrough files, each as recorded.
      expect(entry.files).toHaveLength(4);
      const result = await verifyHome({ home, logger: createMemoryLogger() });
      expect(result.problems).toBe(0);
      expect(result.sites[0]).toMatchObject({ shares: 1, problems: [] });
    });
  });

  // Added in 0.10.0. What's sent is named for what readers know the site by, never for the address
  // voicecap read: the demo's runs read a copy at http://127.0.0.1:4848, and the demo's canonical
  // address is https://voicecap.netlify.app/demo-site/.
  describe("the site's canonical address", () => {
    /** The day the demo is shared on, and the name its copies are given for it. */
    const ON = new Date(2026, 8, 30, 10, 0);
    const STEM = "voicecap.netlify.app_2026-09-30";

    it("names the copies after the canonical name, in the site's own folder", async () => {
      const { siteDir, options } = await demoHome();

      const { files } = await shareReport({ ...options, now: ON, config: configNaming(DEMO_ROOT) });

      expect(files.map(({ name }) => name)).toEqual([
        `${STEM}.html`,
        `${STEM}.docx`,
        walkthroughName(STEM, RUN_1315),
        walkthroughName(STEM, RUN_1402),
      ]);
      // The folder is named for the address voicecap read, as it always is: only the copies' names
      // change, and none of them leads with that address.
      expect(files.map(({ path: file }) => path.dirname(file))).toEqual(
        files.map(() => shareDir(siteDir)),
      );
      for (const { name } of files) expect(name).not.toContain("127.0.0.1");
      expect(await names(shareDir(siteDir))).toEqual(
        [...files.map(({ name }) => name), "shares.json"].sort(),
      );
    });

    // The footer says where each copy is named: it showed the address voicecap read when the copies
    // were named for the site's folder.
    it("has the page's footer and the Word copy's name the copies as shared", async () => {
      const { options } = await demoHome();

      const { files } = await shareReport({ ...options, now: ON, config: configNaming(DEMO_ROOT) });

      const page = await readFile(files[0]!.path, "utf8");
      expect(page).toContain(
        `This file: <span class="mono">${STEM}.html</span>. Its Word copy: <span class="mono">${STEM}.docx</span>.`,
      );
      const { document } = await unzipDocx(await readFile(files[1]!.path));
      expect(paragraphsOf(document).at(-1)?.text).toBe(
        `This file: ${STEM}.docx. Its web page: ${STEM}.html.`,
      );
    });

    it("keeps -2 for a second share that day, with every file of it named so", async () => {
      const { options } = await demoHome();
      const canonical = { ...options, now: ON, config: configNaming(DEMO_ROOT) };
      await shareReport(canonical);

      const { files, entry } = await shareReport(canonical);

      const second = `${STEM}-2`;
      expect(files.map(({ name }) => name)).toEqual([
        `${second}.html`,
        `${second}.docx`,
        walkthroughName(second, RUN_1315),
        walkthroughName(second, RUN_1402),
      ]);
      expect(entry.seq).toBe(2);
      expect(await readFile(files[0]!.path, "utf8")).toContain(
        `This file: <span class="mono">${second}.html</span>. Its Word copy: <span class="mono">${second}.docx</span>.`,
      );
    });

    it("numbers the copies of each name on its own, so a share made before the name was known isn't one of them", async () => {
      const { siteDir, options } = await demoHome();
      // A share made before 0.10.0, which named its copies for the folder the same day, and
      // recorded no site.
      const before = ["html", "docx"].map((kind) => `${DEMO_FOLDER}_2026-09-30.${kind}`);
      await mkdir(shareDir(siteDir), { recursive: true });
      for (const name of before) await writeFile(path.join(shareDir(siteDir), name), name);
      await plantRecord(siteDir, [
        {
          seq: 1,
          prev: null,
          at: "2026-09-30T08:00:00-05:00",
          by: "Sam Tester",
          runs: [RUN_1315, RUN_1402],
          files: before.map((name) => ({ name, bytes: name.length, sha256: sha256(name) })),
          seal: "b".repeat(64),
        },
      ]);

      const after = await shareReport({ ...options, now: ON, config: configNaming(DEMO_ROOT) });

      expect(after.files[0]!.name).toBe(`${STEM}.html`);
      expect(after.entry.seq).toBe(2);
    });

    it("records the canonical address as the entry's site, sealed with the rest of the entry", async () => {
      const { siteDir, options } = await demoHome();

      const { entry } = await shareReport({ ...options, now: ON, config: configNaming(DEMO_ROOT) });

      expect(entry.site).toBe(DEMO_ROOT);
      expect(Object.keys(entry)).toEqual([
        "seq",
        "prev",
        "at",
        "by",
        "site",
        "runs",
        "files",
        "seal",
      ]);
      // The seal holds, and covers the site: an entry that named another site has another seal.
      expect(entry.seal).toBe(sealOf(entry));
      expect(sealOf({ ...entry, site: "https://elsewhere.example.org/" })).not.toBe(entry.seal);
      // The record has it as it was made.
      const record = JSON.parse(await readFile(sharesPath(siteDir), "utf8")) as {
        shares: object[];
      };
      expect(record.shares).toEqual([entry]);
      expect(Object.keys(record.shares[0]!)).toEqual(Object.keys(entry));
    });

    it("records the address voicecap read, as a root, for a site read at a name people visit, with no canonical address", async () => {
      const { options } = await homeWithRun();

      const { entry, files } = await shareReport(options);

      // Its copies are named as they were before 0.10.0: by the host voicecap read, which is the
      // site's name. One read at an IP address or a local address is refused (Ruling P13a).
      expect(entry.site).toBe("https://example.illinois.gov/");
      expect(files[0]!.name).toBe(`${FIRST}.html`);
    });

    it("names the copies after the root the latest run recorded, when the config names none", async () => {
      const dir = await newHome();
      const run = await runAudit(
        runOptions(dir, new ScriptedDriver(sitePages()), {
          canonical: "https://dvfr.illinois.gov/",
        }),
      );
      expect(run.outcome).toBe("completed");

      const { files, entry } = await shareReport(sharing(dir).options);

      const stem = "dvfr.illinois.gov_2027-01-15";
      expect(entry.site).toBe("https://dvfr.illinois.gov/");
      expect(files.map(({ name }) => name)).toEqual([
        `${stem}.html`,
        `${stem}.docx`,
        walkthroughName(stem, run.runId),
      ]);
    });

    it.each([
      ["a path", DEMO_ROOT, DEMO_ROOT, "voicecap.netlify.app"],
      [
        "a port",
        "https://staging.dvfr.org:8443/",
        "https://staging.dvfr.org:8443/",
        "staging.dvfr.org_8443",
      ],
      [
        "no scheme, and capitals",
        "Dvfr.Illinois.gov",
        "https://dvfr.illinois.gov/",
        "dvfr.illinois.gov",
      ],
    ])(
      "names the copies after the host of the root the config gives, as a folder is: with %s",
      async (_what, given, site, prefix) => {
        const { run, options } = await homeWithRun();

        const { files, entry } = await shareReport({ ...options, config: configNaming(given) });

        // The entry has the whole root, and the copies only its host and port.
        expect(entry.site).toBe(site);
        const stem = `${prefix}_2027-01-15`;
        expect(files.map(({ name }) => name)).toEqual([
          `${stem}.html`,
          `${stem}.docx`,
          walkthroughName(stem, run.runId),
        ]);
      },
    );

    it("keeps the line to paste in the form it had, and what it prints naming the folder", async () => {
      const { siteDir, logger, options } = await demoHome();

      const { files, pasteLine } = await shareReport({
        ...options,
        now: ON,
        config: configNaming(DEMO_ROOT),
      });

      const [page, word] = files;
      expect(pasteLine).toBe(
        `Fingerprints (SHA-256): ${STEM}.html ${page!.sha256}; ${STEM}.docx ${word!.sha256}. To check a file you received: ${POWERSHELL_HASH} in PowerShell, or ${MAC_HASH} on a Mac. PowerShell shows the same letters in capitals.`,
      );
      // Terminal output keeps the address voicecap read: the folder the copies are in.
      expect(logger.text("info").split("\n")[0]).toBe(
        `Shared ${DEMO_FOLDER}, as of 30 September 2026: entry 1 in ${sharesPath(siteDir)}.`,
      );
    });

    it("leaves a home that verify finds whole", async () => {
      const { home, options } = await demoHome();

      await shareReport({ ...options, now: ON, config: configNaming(DEMO_ROOT) });

      const result = await verifyHome({ home, logger: createMemoryLogger() });
      expect(result.problems).toBe(0);
      expect(result.sites[0]).toMatchObject({ shares: 1, problems: [] });
    });
  });

  // Ruling P13a. A share is recorded for good, and the website publishes every one, so a site with no
  // canonical address, read at an IP address or a local address, is refused before anything is
  // written: such an address is never a site's name. The demo runs voicecap 0.4.1 recorded are such
  // a site: they read http://127.0.0.1:4848, and recorded no canonical address.
  describe("a site read at an IP address or a local address, with no canonical address", () => {
    /** Each file under `dir`, by its path from `dir`, with its SHA-256, and each folder. */
    async function treeOf(dir: string): Promise<Record<string, string>> {
      const tree: Record<string, string> = {};
      for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
        const full = path.join(entry.parentPath, entry.name);
        tree[path.relative(dir, full)] = entry.isDirectory()
          ? "a folder"
          : sha256(await readFile(full));
      }
      return tree;
    }

    /** What a refused share says: a UsageError, which this checks it is. */
    async function refusalOf(sharing: Promise<unknown>): Promise<string> {
      const error = await sharing.then(
        () => undefined,
        (rejected: unknown) => rejected,
      );
      expect(error).toBeInstanceOf(UsageError);
      return (error as UsageError).message;
    }

    const refusal = (host: string) =>
      `voicecap won't share a site by an IP address or a local address (${host}). Give it the address people visit: set report.canonical in a voicecap config in a folder of the site's own, and share from that folder; or run it again with --canonical <address>.`;

    it("is refused, with what to do, and nothing is written", async () => {
      const { home, siteDir, logger, options } = await demoHome();
      const before = await treeOf(path.dirname(home));

      const message = await refusalOf(shareReport({ ...options, config: undefined }));

      expect(message).toBe(refusal("127.0.0.1:4848"));
      // No share/ folder, no record, no copies, and no Git files: the home is as it was.
      expect(existsSync(shareDir(siteDir))).toBe(false);
      expect(existsSync(sharesPath(siteDir))).toBe(false);
      expect(await treeOf(path.dirname(home))).toEqual(before);
      expect(logger.entries).toEqual([]);
    });

    it("is refused for a site read at localhost, by the host and port it read", async () => {
      const { home, logger, options } = await demoHome();
      // The demo's runs, as if they had read the copy at localhost:4848: each sealed again.
      const copy = path.join(home, "localhost_4848");
      await cp(path.join(home, DEMO_FOLDER), copy, { recursive: true });
      await rm(path.join(home, DEMO_FOLDER), { recursive: true });
      for (const time of ["1315", "1402", "1415", "1419"]) {
        const file = runJsonPath(copy, `2026-09-29_${time}`);
        const run = JSON.parse(await readFile(file, "utf8")) as RunJson;
        run.site = "http://localhost:4848";
        if (run.seal !== undefined) run.seal = sealOf(run);
        await writeFile(file, `${JSON.stringify(run, null, 2)}\n`);
      }
      const before = await treeOf(path.dirname(home));

      const message = await refusalOf(
        shareReport({ ...options, site: "http://localhost:4848", config: undefined }),
      );

      expect(message).toBe(refusal("localhost:4848"));
      expect(await treeOf(path.dirname(home))).toEqual(before);
      expect(logger.entries).toEqual([]);
    });

    it("is shared once report.canonical names it, and named so", async () => {
      const { siteDir, options } = await demoHome();

      const { entry } = await shareReport({ ...options, config: configNaming(DEMO_ROOT) });

      expect(entry.site).toBe(DEMO_ROOT);
      expect(entry.files[0]!.name).toBe(`${DEMO_FIRST}.html`);
      expect((await readShares(siteDir)).shares).toEqual([entry]);
    });

    it("is refused before it reads the record of what was shared, which it never touches", async () => {
      const { siteDir, options } = await demoHome();
      await mkdir(shareDir(siteDir), { recursive: true });
      await writeFile(sharesPath(siteDir), "{ not json");

      await expect(shareReport({ ...options, config: undefined })).rejects.toThrow(
        refusal("127.0.0.1:4848"),
      );
      expect(await readFile(sharesPath(siteDir), "utf8")).toBe("{ not json");
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
      const { siteDir, run, options } = await homeWithRun();
      const taken = `${FIRST}.html`;
      const odd = [
        { seq: 1 },
        { seq: 2, files: taken },
        { seq: 3, files: { name: taken } },
        { seq: 4, files: [null, 7, taken, ["x"], {}, { name: 5 }, { bytes: 1 }] },
      ];
      await plantRecord(siteDir, odd);

      const { files, entry } = await shareReport(options);

      expect(files.map(({ name }) => name)).toEqual([
        `${FIRST}.html`,
        `${FIRST}.docx`,
        walkthroughName(FIRST, run.runId),
      ]);
      expect(entry.seq).toBe(5);
      // What was there is as it was, and the new entry follows.
      const { shares } = await readShares(siteDir);
      expect(shares.slice(0, 4)).toEqual(odd);
      expect(shares).toHaveLength(5);
    });

    it("takes the name of each well-formed file an entry lists, and none of the odd ones beside them", async () => {
      const { siteDir, run, options } = await homeWithRun();
      await plantRecord(siteDir, [
        { seq: 1, files: [null, { name: 5 }, { name: `${FIRST}.docx` }, 7] },
      ]);

      const { files } = await shareReport(options);

      expect(files.map(({ name }) => name)).toEqual([
        `${FIRST}-2.html`,
        `${FIRST}-2.docx`,
        walkthroughName(`${FIRST}-2`, run.runId),
      ]);
    });

    it("reads the site's records once, and builds the model for each pair of names it tries", async () => {
      const { siteDir, run, options } = await homeWithRun();
      // The first pair's Word copy is taken while the copies are being made.
      const raced = path.join(shareDir(siteDir), `${FIRST}.docx`);
      await takenMeanwhile(raced);
      vi.mocked(loadShareInput).mockClear();
      vi.mocked(buildShareModel).mockClear();

      const { files } = await shareReport(options);

      expect(files.map(({ name }) => name)).toEqual([
        `${FIRST}-2.html`,
        `${FIRST}-2.docx`,
        walkthroughName(`${FIRST}-2`, run.runId),
      ]);
      expect(loadShareInput).toHaveBeenCalledTimes(1);
      // The first build, with the names a current copy has, is to see that a run counts, and it
      // also gives each run's walkthrough bytes.
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
      const { siteDir, run, options } = await homeWithRun();
      const raced = path.join(shareDir(siteDir), `${FIRST}.docx`);
      await takenMeanwhile(raced);

      const { files, entry } = await shareReport(options);

      const second = [
        `${FIRST}-2.html`,
        `${FIRST}-2.docx`,
        walkthroughName(`${FIRST}-2`, run.runId),
      ];
      expect(files.map(({ name }) => name)).toEqual(second);
      expect(await readFile(raced, "utf8")).toBe("someone else's file");
      // The page this attempt wrote of the first pair is taken away: only what it wrote.
      expect(await names(shareDir(siteDir))).toEqual([
        "current.docx",
        "current.html",
        `${FIRST}-2.docx`,
        `${FIRST}-2.html`,
        walkthroughName(`${FIRST}-2`, run.runId),
        `${FIRST}.docx`,
        "shares.json",
      ]);
      expect(entry.files.map(({ name }) => name)).toEqual(second);
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
      const { siteDir, run, options } = await homeWithRun();
      const raced = path.join(shareDir(siteDir), `${FIRST}.html`);
      await takenMeanwhile(raced);

      const { files } = await shareReport(options);

      expect(files.map(({ name }) => name)).toEqual([
        `${FIRST}-2.html`,
        `${FIRST}-2.docx`,
        walkthroughName(`${FIRST}-2`, run.runId),
      ]);
      expect(await readFile(raced, "utf8")).toBe("someone else's file");
      expect(await names(shareDir(siteDir))).toEqual([
        "current.docx",
        "current.html",
        `${FIRST}-2.docx`,
        `${FIRST}-2.html`,
        walkthroughName(`${FIRST}-2`, run.runId),
        `${FIRST}.html`,
        "shares.json",
      ]);
    });

    it("takes the next number when a walkthrough file's name is taken, and takes away the page and Word copy it had written", async () => {
      const { siteDir, run, options } = await homeWithRun();
      const raced = path.join(shareDir(siteDir), walkthroughName(FIRST, run.runId));
      await takenMeanwhile(raced);

      const { files } = await shareReport(options);

      expect(files.map(({ name }) => name)).toEqual([
        `${FIRST}-2.html`,
        `${FIRST}-2.docx`,
        walkthroughName(`${FIRST}-2`, run.runId),
      ]);
      expect(await readFile(raced, "utf8")).toBe("someone else's file");
      // The first attempt wrote the page and the Word copy before it found the name taken: both gone.
      expect(await names(shareDir(siteDir))).toEqual([
        "current.docx",
        "current.html",
        `${FIRST}-2.docx`,
        `${FIRST}-2.html`,
        walkthroughName(`${FIRST}-2`, run.runId),
        walkthroughName(FIRST, run.runId),
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

    it("takes away what it wrote when a copy's write fails partway", async () => {
      const { siteDir, options } = await demoHome();
      await shareReport(options);
      const before = {
        held: await names(shareDir(siteDir)),
        record: await readFile(sharesPath(siteDir)),
      };
      // The Word copy's file is made, and then the disk fills: half of it is written, and the rest
      // can't be. The page was written before it, and the copies after it never are.
      const real = await vi.importActual<typeof FsPromises>("node:fs/promises");
      vi.mocked(open).mockImplementation(async (file, flags, mode) => {
        const handle = await real.open(file, flags, mode);
        if (!String(file).endsWith(".docx") || flags !== "wx") return handle;
        return new Proxy(handle, {
          get(target, property) {
            const value: unknown = Reflect.get(target, property, target);
            if (typeof value !== "function") return value;
            if (property === "writeFile") {
              return async (data: Uint8Array) => {
                await target.write(data.subarray(0, Math.floor(data.length / 2)));
                throw Object.assign(new Error("ENOSPC: no space left on device, write"), {
                  code: "ENOSPC",
                });
              };
            }
            return (...args: unknown[]): unknown =>
              (value as (...called: unknown[]) => unknown).apply(target, args);
          },
        });
      });

      await expect(shareReport(options)).rejects.toThrow("ENOSPC: no space left on device, write");

      // None of the failed share's copies are left, the page and the half of the Word copy included,
      // and the record is the first share's, byte for byte.
      expect(await names(shareDir(siteDir))).toEqual(before.held);
      expect(await readFile(sharesPath(siteDir))).toEqual(before.record);
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
