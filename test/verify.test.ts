import { existsSync } from "node:fs";
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addManualSession } from "../src/manual-add.js";
import type {
  ManualSessionJson,
  ReviewEntry,
  ReviewsFile,
  RunJson,
  SharesFile,
} from "../src/model.js";
import { addReview } from "../src/reviews/review.js";
import { runAudit, type RunAuditOptions } from "../src/run/audit.js";
import { shareDir, sharePath, sharesPath, shareWordPath } from "../src/run/paths.js";
import { shareReport, type ShareReportResult } from "../src/share/share.js";
import { fileHash } from "../src/transcripts/write.js";
import { UsageError } from "../src/util/errors.js";
import { sealOf, sha256 } from "../src/util/hash.js";
import { createMemoryLogger } from "../src/util/log.js";
import { verifyHome } from "../src/verify.js";
import { TINY_JPEG } from "./helpers/jpeg.js";
import { homeWithCountedRun, SITE as EXAMPLE_SITE } from "./helpers/run-site.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const fixture = (...parts: string[]) => path.join(ROOT, "fixture", ...parts);
const SITE = "http://127.0.0.1:4747";
/** The flawed page: its URL as the run lists it, and the key its reviews are filed under. */
const FLAWED = `${SITE}/flawed/`;
const FLAWED_KEY = `${SITE}/flawed`;

// Where the home built below keeps each record, relative to the home.
const FOLDER = "127.0.0.1_4747";
const RUN = `${FOLDER}/2026-09-27/1102`;
const SESSION = `${FOLDER}/2026-09-25/2357_manual_home`;
const REVIEWS = `${FOLDER}/reviews.json`;
const MATCHES = `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: everything matches.`;

/** A home made by voicecap's own commands; tests change copies of it, never the home itself. */
let untouched: string;

beforeAll(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "voicecap-verify-"));
  untouched = path.join(dir, "home");
  const common = { out: untouched, cwd: dir, env: {}, logger: createMemoryLogger() };
  const run = await runAudit({ ...common, ...replay(), now: () => new Date(2026, 8, 27, 11, 2) });
  expect(run.outcome).toBe("completed");
  await addManualSession({
    ...common,
    file: fixture("manual", "nvda-io-log.txt"),
    page: "/",
    date: "2026-09-25",
    reviewer: "Pat Reviewer",
  });
  await addReview({ ...common, page: "/flawed/", status: "reviewed", reviewer: "Pat Reviewer" });
  await addReview({
    ...common,
    page: "/flawed/",
    status: "issue",
    note: "Unlabeled button",
    reviewer: "Pat Reviewer",
  });
});

/** A run of the fixture site with the replay driver. */
function replay(): Pick<RunAuditOptions, "site" | "pages" | "replayFrom"> {
  return { site: SITE, pages: fixture("pages.json"), replayFrom: fixture("replay-run") };
}

/** A copy of the untouched home, to change. */
async function copyOfHome(): Promise<string> {
  const home = path.join(await mkdtemp(path.join(os.tmpdir(), "voicecap-verify-")), "home");
  await cp(untouched, home, { recursive: true });
  return home;
}

/** Options for running a command in a copied home: never the tester's VOICECAP_TRANSCRIPTS. */
function inHome(home: string) {
  return { out: home, cwd: path.dirname(home), env: {}, logger: createMemoryLogger() };
}

/** Start a run and interrupt it at once: an incomplete run, not sealed yet, at 2026-09-27/1200. */
async function interruptedRun(home: string): Promise<void> {
  const controller = new AbortController();
  controller.abort();
  const run = await runAudit({
    ...inHome(home),
    ...replay(),
    signal: controller.signal,
    now: () => new Date(2026, 8, 27, 12, 0),
  });
  expect(run.outcome).toBe("interrupted");
}

/** A path relative to the home, with forward slashes, as a path on this machine. */
function at(home: string, relative: string): string {
  return path.join(home, ...relative.split("/"));
}

/** Check the home as `voicecap verify` does, keeping every line it prints. */
async function verify(home: string, site?: string) {
  const logger = createMemoryLogger();
  const result = await verifyHome({ home, site, logger });
  return { result, lines: logger.entries.map((entry) => entry.message) };
}

async function editJson<T>(file: string, edit: (value: T) => void): Promise<void> {
  const value = JSON.parse(await readFile(file, "utf8")) as T;
  edit(value);
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

describe("verifyHome", () => {
  it("passes a home nobody touched", async () => {
    const { result, lines } = await verify(untouched);
    expect(result).toEqual({
      sites: [
        {
          folder: FOLDER,
          runs: 1,
          incomplete: 0,
          manualSessions: 1,
          reviews: 2,
          shares: 0,
          problems: [],
        },
      ],
      problems: 0,
    });
    expect(lines).toEqual([MATCHES]);
  });

  it("catches an edited transcript", async () => {
    const home = await copyOfHome();
    await appendFile(at(home, `${RUN}/pages/home/read.txt`), "An added line.\n");
    const { result, lines } = await verify(home);
    expect(lines).toEqual([
      `${RUN}/pages/home/read.txt: changed since it was recorded (SHA-256 differs)`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);
    expect(result.problems).toBe(1);
    expect(result.sites[0]?.problems).toEqual([
      `${RUN}/pages/home/read.txt: changed since it was recorded (SHA-256 differs)`,
    ]);

    // An edit that keeps the file's size.
    const sameSize = await copyOfHome();
    const headings = at(sameSize, `${RUN}/pages/home/headings.txt`);
    const text = await readFile(headings, "utf8");
    expect(text.startsWith("# voicecap")).toBe(true);
    await writeFile(headings, `%${text.slice(1)}`);
    expect((await verify(sameSize)).lines).toEqual([
      `${RUN}/pages/home/headings.txt: changed since it was recorded (SHA-256 differs)`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);
  });

  it("catches a missing transcript and an unrecorded file", async () => {
    const home = await copyOfHome();
    await rm(at(home, `${RUN}/pages/home/tab.txt`));
    await writeFile(at(home, `${RUN}/pages/home/extra.txt`), "Not written by voicecap.\n");
    await mkdir(at(home, `${RUN}/pages/extra-page`));
    await writeFile(at(home, `${RUN}/pages/extra-page/read.txt`), "Nor was this.\n");
    const { result, lines } = await verify(home);
    expect(lines).toEqual([
      `${RUN}/pages/extra-page/read.txt: not recorded by the run`,
      `${RUN}/pages/home/extra.txt: not recorded by the run`,
      `${RUN}/pages/home/tab.txt: missing`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 3 problems.`,
    ]);
    expect(result.problems).toBe(3);
  });

  describe("a page's screenshot", () => {
    const SHOT = `${RUN}/pages/home/screenshot.jpg`;
    const TAKEN_AT = "2026-09-27T11:02:05.000-05:00";
    const ONE_PROBLEM = `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`;
    const recorded = { ...fileHash(TINY_JPEG), takenAt: TAKEN_AT, width: 16, height: 12 };

    /** A copy of the home, with the record of the page in folder `slug` changed, and the run sealed again. */
    async function changingPage(slug: string, edit: (page: RunJson["pages"][number]) => void) {
      const home = await copyOfHome();
      await editJson<RunJson>(at(home, `${RUN}/run.json`), (run) => {
        edit(run.pages.find((page) => page.slug === slug)!);
        run.seal = sealOf(run);
      });
      return home;
    }

    /** A copy of the home whose home page has a screenshot, in its folder and in its record. */
    async function withScreenshot(): Promise<string> {
      const home = await changingPage("home", (page) => {
        page.screenshot = recorded;
      });
      await writeFile(at(home, SHOT), TINY_JPEG);
      return home;
    }

    it("finds nothing wrong with one that's as the run recorded it", async () => {
      expect((await verify(await withScreenshot())).lines).toEqual([MATCHES]);
    });

    it("names one that was edited, whether or not its size changed", async () => {
      const added = await withScreenshot();
      await appendFile(at(added, SHOT), "An added byte.");
      expect((await verify(added)).lines).toEqual([
        `${SHOT}: changed since it was recorded (SHA-256 differs)`,
        ONE_PROBLEM,
      ]);

      const sameSize = await withScreenshot();
      const bytes = await readFile(at(sameSize, SHOT));
      bytes[bytes.length - 3] = (bytes[bytes.length - 3] ?? 0) ^ 0xff;
      await writeFile(at(sameSize, SHOT), bytes);
      expect((await verify(sameSize)).lines).toEqual([
        `${SHOT}: changed since it was recorded (SHA-256 differs)`,
        ONE_PROBLEM,
      ]);
    });

    it("names one that was removed", async () => {
      const home = await withScreenshot();
      await rm(at(home, SHOT));
      expect((await verify(home)).lines).toEqual([`${SHOT}: missing`, ONE_PROBLEM]);
    });

    it("names a file the run doesn't record, as it does any", async () => {
      // A page with no screenshot in its record, and one whose record says why it has none.
      for (const screenshot of [undefined, { error: "timed out", takenAt: TAKEN_AT }]) {
        const home = await changingPage("home", (page) => {
          if (screenshot) page.screenshot = screenshot;
        });
        await writeFile(at(home, SHOT), TINY_JPEG);
        expect((await verify(home)).lines).toEqual([
          `${SHOT}: not recorded by the run`,
          ONE_PROBLEM,
        ]);
      }
    });

    it("finds nothing wrong with a record of why there's none", async () => {
      const home = await changingPage("home", (page) => {
        page.screenshot = { error: "timed out", takenAt: TAKEN_AT };
      });
      expect((await verify(home)).lines).toEqual([MATCHES]);
    });

    it("is filed in its own page's folder", async () => {
      // The flawed page records one, with no file in its folder; the file is in the home page's.
      const flawed = "flawed-68c5de39bc";
      const home = await changingPage(flawed, (page) => {
        page.screenshot = recorded;
      });
      await writeFile(at(home, SHOT), TINY_JPEG);
      expect((await verify(home)).lines).toEqual([
        `${RUN}/pages/${flawed}/screenshot.jpg: missing`,
        `${SHOT}: not recorded by the run`,
        `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 2 problems.`,
      ]);
    });
  });

  it("checks the event log its run recorded", async () => {
    const run = JSON.parse(await readFile(at(untouched, `${RUN}/run.json`), "utf8")) as RunJson;
    expect(Object.keys(run.files ?? {})).toEqual(["events.jsonl"]);
    expect(existsSync(at(untouched, `${RUN}/events.jsonl`))).toBe(true);
  });

  it("catches an edited event log", async () => {
    const home = await copyOfHome();
    await appendFile(
      at(home, `${RUN}/events.jsonl`),
      '{"at":"2026-09-27T11:03:00.000-05:00","type":"computer-locked"}\n',
    );
    const { result, lines } = await verify(home);
    expect(lines).toEqual([
      `${RUN}/events.jsonl: changed since it was recorded (SHA-256 differs)`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);
    expect(result.problems).toBe(1);
  });

  it("catches a missing event log", async () => {
    const home = await copyOfHome();
    await rm(at(home, `${RUN}/events.jsonl`));
    expect((await verify(home)).lines).toEqual([
      `${RUN}/events.jsonl: missing`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);
  });

  it("passes a run from before the event log, and catches a log added to it", async () => {
    const home = await copyOfHome();
    // A run from before voicecap 0.11.0: no log in its folder, none recorded, sealed without one.
    await rm(at(home, `${RUN}/events.jsonl`));
    await editJson<RunJson>(at(home, `${RUN}/run.json`), (run) => {
      delete run.files;
      run.seal = sealOf(run);
    });
    expect((await verify(home)).lines).toEqual([MATCHES]);

    // A log the run doesn't record is one nothing vouches for.
    await writeFile(
      at(home, `${RUN}/events.jsonl`),
      '{"at":"2026-09-27T11:03:00.000-05:00","type":"computer-locked"}\n',
    );
    expect((await verify(home)).lines).toEqual([
      `${RUN}/events.jsonl: not recorded by the run`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);
  });

  // The cleaned copies of NVDA's own log that a run keeps (from voicecap 0.17.0), one for each time
  // its NVDA quit: nvda-log/<session>-<n>.txt, recorded in run.files beside the event log.
  describe("a run's copies of NVDA's log", () => {
    const COPY = `${RUN}/nvda-log/1-1.txt`;
    const LOG =
      "# A cleaned copy of NVDA's log.\nIO - speech.speech.speak:\nSpeaking ['Welcome']\n";

    /** A copy of the home, whose run has kept `LOG` as nvda-log/1-1.txt and recorded it, sealed. */
    async function homeWithCopy(): Promise<string> {
      const home = await copyOfHome();
      await mkdir(at(home, `${RUN}/nvda-log`));
      await writeFile(at(home, COPY), LOG);
      await editJson<RunJson>(at(home, `${RUN}/run.json`), (run) => {
        run.files = { ...run.files, "nvda-log/1-1.txt": fileHash(LOG) };
        run.seal = sealOf(run);
      });
      return home;
    }

    const ONE_PROBLEM = `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`;

    it("passes a copy as the run recorded it", async () => {
      const home = await homeWithCopy();
      expect((await verify(home)).lines).toEqual([MATCHES]);
    });

    it("catches a copy that was edited", async () => {
      const home = await homeWithCopy();
      await appendFile(at(home, COPY), "Speaking ['Something said']\n");
      const { result, lines } = await verify(home);
      expect(lines).toEqual([
        `${COPY}: changed since it was recorded (SHA-256 differs)`,
        ONE_PROBLEM,
      ]);
      expect(result.problems).toBe(1);
    });

    it("catches a copy that was removed", async () => {
      const home = await homeWithCopy();
      await rm(at(home, COPY));
      expect((await verify(home)).lines).toEqual([`${COPY}: missing`, ONE_PROBLEM]);
      // The folder gone with it says the same.
      await rm(at(home, `${RUN}/nvda-log`), { recursive: true });
      expect((await verify(home)).lines).toEqual([`${COPY}: missing`, ONE_PROBLEM]);
    });

    it("catches a copy the run doesn't record, which nothing vouches for", async () => {
      const home = await homeWithCopy();
      await writeFile(at(home, `${RUN}/nvda-log/1-2.txt`), LOG);
      expect((await verify(home)).lines).toEqual([
        `${RUN}/nvda-log/1-2.txt: not recorded by the run`,
        ONE_PROBLEM,
      ]);
    });

    it("catches a file the run doesn't record, at any depth in the folder", async () => {
      const home = await homeWithCopy();
      await mkdir(at(home, `${RUN}/nvda-log/more`));
      await writeFile(at(home, `${RUN}/nvda-log/more/2-1.txt`), LOG);
      expect((await verify(home)).lines).toEqual([
        `${RUN}/nvda-log/more/2-1.txt: not recorded by the run`,
        ONE_PROBLEM,
      ]);
    });

    it("catches a folder of copies in a run that records none", async () => {
      // A run from before voicecap kept them, or one that kept none, with a copy put in its folder.
      const home = await copyOfHome();
      await mkdir(at(home, `${RUN}/nvda-log`));
      await writeFile(at(home, COPY), LOG);
      expect((await verify(home)).lines).toEqual([`${COPY}: not recorded by the run`, ONE_PROBLEM]);
    });

    it("reports each problem with a copy in the order of the files' paths, the event log's first", async () => {
      const home = await homeWithCopy();
      await appendFile(at(home, COPY), "An added line\n");
      await writeFile(at(home, `${RUN}/nvda-log/1-2.txt`), LOG);
      await appendFile(at(home, `${RUN}/events.jsonl`), "\n");
      expect((await verify(home)).lines).toEqual([
        `${RUN}/events.jsonl: changed since it was recorded (SHA-256 differs)`,
        `${COPY}: changed since it was recorded (SHA-256 differs)`,
        `${RUN}/nvda-log/1-2.txt: not recorded by the run`,
        `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 3 problems.`,
      ]);
    });

    it("doesn't mind the files an operating system leaves in the folder", async () => {
      const home = await homeWithCopy();
      await writeFile(at(home, `${RUN}/nvda-log/.DS_Store`), "Finder's view settings");
      await writeFile(at(home, `${RUN}/nvda-log/Thumbs.db`), "Explorer's thumbnails");
      await writeFile(at(home, `${RUN}/nvda-log/desktop.ini`), "[.ShellClassInfo]\r\n");
      expect((await verify(home)).lines).toEqual([MATCHES]);
    });

    it("doesn't check the copies of a run that isn't sealed yet", async () => {
      // An incomplete run's files can change until it's completed and sealed: it's listed only.
      const home = await copyOfHome();
      await interruptedRun(home);
      const incomplete = `${FOLDER}/2026-09-27/1200`;
      await mkdir(at(home, `${incomplete}/nvda-log`));
      await writeFile(at(home, `${incomplete}/nvda-log/1-1.txt`), LOG);
      expect((await verify(home)).lines).toEqual([
        `${incomplete}: incomplete run, not sealed yet`,
        `${FOLDER}: 2 runs (1 incomplete), 1 manual session, 2 reviews, 0 shares checked: everything matches.`,
      ]);
    });
  });

  it("checks each file a run records beside its pages, in a folder or not", async () => {
    const home = await copyOfHome();
    const notes = "Kept with the run.\n";
    await mkdir(at(home, `${RUN}/extra`));
    await writeFile(at(home, `${RUN}/extra/notes.txt`), notes);
    await editJson<RunJson>(at(home, `${RUN}/run.json`), (run) => {
      run.files = { ...run.files, "extra/notes.txt": fileHash(notes) };
      run.seal = sealOf(run);
    });
    expect((await verify(home)).lines).toEqual([MATCHES]);

    await appendFile(at(home, `${RUN}/extra/notes.txt`), "An added line.\n");
    expect((await verify(home)).lines).toEqual([
      `${RUN}/extra/notes.txt: changed since it was recorded (SHA-256 differs)`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);

    await rm(at(home, `${RUN}/extra`), { recursive: true });
    expect((await verify(home)).lines).toEqual([
      `${RUN}/extra/notes.txt: missing`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);
  });

  it("reads no file a run names outside its own folder", async () => {
    const home = await copyOfHome();
    const outside = "Not part of the run.\n";
    await writeFile(at(home, `${FOLDER}/outside.txt`), outside);
    await editJson<RunJson>(at(home, `${RUN}/run.json`), (run) => {
      run.files = { ...run.files, "../../outside.txt": fileHash(outside) };
      run.seal = sealOf(run);
    });
    expect((await verify(home)).lines).toEqual([
      `${RUN}: not a readable run or manual session`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);
  });

  it("doesn't mind the files an operating system leaves in folders", async () => {
    const home = await copyOfHome();
    await writeFile(at(home, `${RUN}/pages/home/.DS_Store`), "Finder's view settings");
    await writeFile(at(home, `${RUN}/pages/Thumbs.db`), "Explorer's thumbnails");
    await writeFile(
      at(home, `${RUN}/pages/flawed-68c5de39bc/desktop.ini`),
      "[.ShellClassInfo]\r\n",
    );
    expect((await verify(home)).lines).toEqual([MATCHES]);
  });

  // A copied or moved record keeps its seal; only where it is gives it away.
  it("catches a run copied into another dated folder", async () => {
    const home = await copyOfHome();
    await mkdir(at(home, `${FOLDER}/2026-09-28`));
    await cp(at(home, RUN), at(home, `${FOLDER}/2026-09-28/1102`), { recursive: true });
    expect((await verify(home)).lines).toEqual([
      `${FOLDER}/2026-09-28/1102: this run belongs at ${RUN}`,
      `${FOLDER}: 2 runs (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);
  });

  it("catches a run copied into another site's folder", async () => {
    const home = await copyOfHome();
    await mkdir(at(home, "dvfr.illinois.gov/2026-09-27"), { recursive: true });
    await cp(at(home, RUN), at(home, "dvfr.illinois.gov/2026-09-27/1102"), { recursive: true });
    expect((await verify(home)).lines).toEqual([
      MATCHES,
      `dvfr.illinois.gov/2026-09-27/1102: this run belongs at ${RUN}`,
      "dvfr.illinois.gov: 1 run (0 incomplete), 0 manual sessions, 0 reviews, 0 shares checked: 1 problem.",
    ]);
  });

  it("catches a manual session renamed to another time", async () => {
    const home = await copyOfHome();
    await rename(at(home, SESSION), at(home, `${FOLDER}/2026-09-25/2358_manual_home`));
    expect((await verify(home)).lines).toEqual([
      `${FOLDER}/2026-09-25/2358_manual_home: this manual session belongs at ${SESSION}`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);
  });

  it("catches an edited run.json", async () => {
    const home = await copyOfHome();
    await editJson<RunJson>(at(home, `${RUN}/run.json`), (run) => {
      run.pages[0]!.files["read.txt"]!.sha256 = "0".repeat(64);
    });
    // Just the one problem: the files aren't checked against hashes from a changed record.
    expect((await verify(home)).lines).toEqual([
      `${RUN}/run.json: changed since it was sealed`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);

    // A completed run relabeled incomplete, which would spare its files from being checked.
    const relabeled = await copyOfHome();
    await editJson<RunJson>(at(relabeled, `${RUN}/run.json`), (run) => {
      run.status = "incomplete";
    });
    expect((await verify(relabeled)).lines).toEqual([
      `${RUN}/run.json: changed since it was sealed`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);
  });

  it("catches a key named __proto__ added to run.json, as any other added key", async () => {
    const home = await copyOfHome();
    const file = at(home, `${RUN}/run.json`);
    // Into the file's text: in an object literal, __proto__ would set the prototype instead.
    const text = await readFile(file, "utf8");
    await writeFile(file, text.replace(/^\{/, '{\n  "__proto__": { "status": "incomplete" },'));
    expect((await verify(home)).lines).toEqual([
      `${RUN}/run.json: changed since it was sealed`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);
  });

  it("catches a completed run's run.json replaced by a bare incomplete one", async () => {
    const home = await copyOfHome();
    await writeFile(at(home, `${RUN}/run.json`), `${JSON.stringify({ status: "incomplete" })}\n`);
    await appendFile(at(home, `${RUN}/pages/home/read.txt`), "An added line.\n");
    expect((await verify(home)).lines).toEqual([
      `${RUN}: not a readable run or manual session`,
      `${FOLDER}: 0 runs (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);
  });

  it("catches a changed newest review", async () => {
    const home = await copyOfHome();
    await editJson<ReviewsFile>(at(home, REVIEWS), (reviews) => {
      const newest = reviews.pages[FLAWED_KEY]![1]!;
      expect(newest.status).toBe("issue");
      newest.status = "reviewed";
    });
    expect((await verify(home)).lines).toEqual([
      `${REVIEWS}: entry 2 (${FLAWED}) changed since it was recorded`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);

    // An earlier entry, changed: reported once, not also as a gap in the chain.
    const earlier = await copyOfHome();
    await editJson<ReviewsFile>(at(earlier, REVIEWS), (reviews) => {
      reviews.pages[FLAWED_KEY]![0]!.note = "Added afterwards";
    });
    expect((await verify(earlier)).lines).toEqual([
      `${REVIEWS}: entry 1 (${FLAWED}) changed since it was recorded`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);
  });

  it("catches a review entry stripped of its seal", async () => {
    const home = await copyOfHome();
    await editJson<ReviewsFile>(at(home, REVIEWS), (reviews) => {
      delete reviews.pages[FLAWED_KEY]![0]!.seal;
    });
    // Once, as changed: not also as missing from the chain, or as a broken link to entry 2.
    expect((await verify(home)).lines).toEqual([
      `${REVIEWS}: entry 1 (${FLAWED}) changed since it was recorded`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);
  });

  it("catches a review entry forged outside the chain", async () => {
    const home = await copyOfHome();
    await editJson<ReviewsFile>(at(home, REVIEWS), (reviews) => {
      // Sealed by the forger, with no seq or prev: it would become the page's current status.
      const forged: ReviewEntry = {
        status: "fixed",
        reviewer: "Pat Reviewer",
        at: "2026-09-27T18:00:00-05:00",
        note: null,
        run: "2026-09-27_1102",
        url: FLAWED,
        files: {},
        content: {},
      };
      forged.seal = sealOf(forged);
      reviews.pages[FLAWED_KEY]!.push(forged);
    });
    expect((await verify(home)).lines).toEqual([
      `${REVIEWS}: an entry for ${FLAWED} at 2026-09-27T18:00:00-05:00 is outside the chain (no seq)`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 3 reviews, 0 shares checked: 1 problem.`,
    ]);
  });

  it("catches a deleted review", async () => {
    const home = await copyOfHome();
    await editJson<ReviewsFile>(at(home, REVIEWS), (reviews) => {
      reviews.pages[FLAWED_KEY]!.shift();
    });
    expect((await verify(home)).lines).toEqual([
      `${REVIEWS}: entry 1 is missing`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 1 review, 0 shares checked: 1 problem.`,
    ]);
  });

  it("catches a review moved to another page, and reviews swapped within a page", async () => {
    const moved = await copyOfHome();
    await editJson<ReviewsFile>(at(moved, REVIEWS), (reviews) => {
      reviews.pages[`${SITE}/`] = [reviews.pages[FLAWED_KEY]!.pop()!];
    });
    expect((await verify(moved)).lines).toEqual([
      `${REVIEWS}: entry 2 (${FLAWED}) is filed under another page (${SITE}/)`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);

    const swapped = await copyOfHome();
    await editJson<ReviewsFile>(at(swapped, REVIEWS), (reviews) => {
      reviews.pages[FLAWED_KEY]!.reverse();
    });
    expect((await verify(swapped)).lines).toEqual([
      `${REVIEWS}: the entries for ${FLAWED} are out of order (entry 2 comes before entry 1)`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);
  });

  it("catches gaps and repeats in the review chain", async () => {
    const gap = await copyOfHome();
    await addReview({
      ...inHome(gap),
      page: "/flawed/",
      status: "fixed",
      reviewer: "Pat Reviewer",
    });
    await editJson<ReviewsFile>(at(gap, REVIEWS), (reviews) => {
      reviews.pages[FLAWED_KEY]!.splice(0, 2);
    });
    expect((await verify(gap)).lines).toEqual([
      `${REVIEWS}: entries 1 to 2 are missing`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 1 review, 0 shares checked: 1 problem.`,
    ]);

    // Two entries with one number: a copied entry, or a merge of two histories.
    const repeat = await copyOfHome();
    await editJson<ReviewsFile>(at(repeat, REVIEWS), (reviews) => {
      const entries = reviews.pages[FLAWED_KEY]!;
      entries.push(structuredClone(entries[1]!));
    });
    expect((await verify(repeat)).lines).toEqual([
      `${REVIEWS}: more than one entry is numbered 2`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 3 reviews, 0 shares checked: 1 problem.`,
    ]);
  });

  it("catches a review chain relinked by hand, even with the edited entry's seal recomputed", async () => {
    const resealed = await copyOfHome();
    await editJson<ReviewsFile>(at(resealed, REVIEWS), (reviews) => {
      const first = reviews.pages[FLAWED_KEY]![0]!;
      first.note = "Changed afterwards";
      first.seal = sealOf(first);
    });
    expect((await verify(resealed)).lines).toEqual([
      `${REVIEWS}: entry 2 doesn't follow entry 1`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);

    // The first entry deleted, and the second renumbered and resealed to take its place.
    const renumbered = await copyOfHome();
    await editJson<ReviewsFile>(at(renumbered, REVIEWS), (reviews) => {
      const entries = reviews.pages[FLAWED_KEY]!;
      entries.shift();
      entries[0]!.seq = 1;
      entries[0]!.seal = sealOf(entries[0]!);
    });
    expect((await verify(renumbered)).lines).toEqual([
      `${REVIEWS}: entry 1 follows an entry that isn't there`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 1 review, 0 shares checked: 1 problem.`,
    ]);
  });

  it("catches an edited manual transcript", async () => {
    const home = await copyOfHome();
    await appendFile(at(home, `${SESSION}/session.txt`), "23:59:59      An added line\n");
    expect((await verify(home)).lines).toEqual([
      `${SESSION}/session.txt: changed since it was recorded (SHA-256 differs)`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);

    const deleted = await copyOfHome();
    await rm(at(deleted, `${SESSION}/session.txt`));
    expect((await verify(deleted)).lines).toEqual([
      `${SESSION}/session.txt: missing`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);
  });

  it("catches a changed raw copy", async () => {
    const home = await copyOfHome();
    await appendFile(at(home, `${SESSION}/raw/nvda-log.txt`), "An added line\r\n");
    expect((await verify(home)).lines).toEqual([
      `${SESSION}/raw/nvda-log.txt: changed since it was recorded (SHA-256 differs)`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);
  });

  it("catches a manual session folder that also holds a run.json", async () => {
    const home = await copyOfHome();
    await appendFile(at(home, `${SESSION}/session.txt`), "23:59:59      An added line\n");
    await writeFile(
      at(home, `${SESSION}/run.json`),
      `${JSON.stringify({ status: "incomplete" })}\n`,
    );
    // Both records are checked: the run.json isn't one voicecap wrote, and session.txt changed.
    expect((await verify(home)).lines).toEqual([
      `${SESSION}: holds both a run and a manual session`,
      `${SESSION}: not a readable run or manual session`,
      `${SESSION}/session.txt: changed since it was recorded (SHA-256 differs)`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 3 problems.`,
    ]);
  });

  it("checks both records in a run folder that also holds a decoy session.json", async () => {
    const home = await copyOfHome();
    await appendFile(at(home, `${RUN}/pages/home/read.txt`), "An added line.\n");
    // A decoy that seals itself and has every field a session has.
    const decoy = JSON.parse(
      await readFile(at(home, `${SESSION}/session.json`), "utf8"),
    ) as ManualSessionJson;
    decoy.id = "2026-09-27_1102";
    decoy.page = { ...decoy.page, slug: "decoy" };
    decoy.seal = sealOf(decoy);
    await writeFile(at(home, `${RUN}/session.json`), `${JSON.stringify(decoy, null, 2)}\n`);
    // Neither record hides the other, and each counts in its own total.
    expect((await verify(home)).lines).toEqual([
      `${RUN}: holds both a run and a manual session`,
      `${RUN}/pages/home/read.txt: changed since it was recorded (SHA-256 differs)`,
      `${RUN}: this manual session belongs at ${FOLDER}/2026-09-27/1102_manual_decoy`,
      `${RUN}/session.txt: missing`,
      `${FOLDER}: 1 run (0 incomplete), 2 manual sessions, 2 reviews, 0 shares checked: 4 problems.`,
    ]);
  });

  it("doesn't mind a raw copy that isn't there", async () => {
    const home = await copyOfHome();
    await rm(at(home, `${SESSION}/raw`), { recursive: true });
    expect((await verify(home)).lines).toEqual([MATCHES]);
  });

  it("counts unsealed records as problems, and lists incomplete runs, which aren't", async () => {
    const home = await copyOfHome();
    await editJson<RunJson>(at(home, `${RUN}/run.json`), (run) => {
      delete run.seal;
    });
    await editJson<ManualSessionJson>(at(home, `${SESSION}/session.json`), (session) => {
      delete session.seal;
    });
    // An entry from before seals: no seq, prev, or seal.
    const older: ReviewEntry = {
      status: "reviewed",
      reviewer: "Pat Reviewer",
      at: "2026-09-20T10:00:00-05:00",
      note: null,
      run: "2026-09-20_1000",
      url: FLAWED,
      files: {},
      content: {},
    };
    await editJson<ReviewsFile>(at(home, REVIEWS), (reviews) => {
      reviews.pages[FLAWED_KEY]!.unshift(older);
    });
    await interruptedRun(home);

    const { result, lines } = await verify(home);
    expect(lines).toEqual([
      `${SESSION}/session.json: not sealed (written before voicecap 0.3.0), so it can't be checked`,
      `${RUN}/run.json: not sealed (written before voicecap 0.3.0), so it can't be checked`,
      `${REVIEWS}: an entry for ${FLAWED} at 2026-09-20T10:00:00-05:00 is not sealed (written before voicecap 0.3.0), so it can't be checked`,
      `${FOLDER}/2026-09-27/1200: incomplete run, not sealed yet`,
      `${FOLDER}: 2 runs (1 incomplete), 1 manual session, 3 reviews, 0 shares checked: 3 problems.`,
    ]);
    expect(result.sites[0]).toMatchObject({ runs: 2, incomplete: 1, manualSessions: 1 });
    expect(result.problems).toBe(3);
  });

  it("lists an incomplete run, which isn't a problem", async () => {
    const home = await copyOfHome();
    await interruptedRun(home);
    const { result, lines } = await verify(home);
    expect(lines).toEqual([
      `${FOLDER}/2026-09-27/1200: incomplete run, not sealed yet`,
      `${FOLDER}: 2 runs (1 incomplete), 1 manual session, 2 reviews, 0 shares checked: everything matches.`,
    ]);
    expect(result.problems).toBe(0);
  });

  it("catches an incomplete run that isn't where its id and site put it", async () => {
    const home = await copyOfHome();
    await interruptedRun(home);
    await mkdir(at(home, `${FOLDER}/2026-09-28`));
    await cp(at(home, `${FOLDER}/2026-09-27/1200`), at(home, `${FOLDER}/2026-09-28/1200`), {
      recursive: true,
    });
    expect((await verify(home)).lines).toEqual([
      `${FOLDER}/2026-09-28/1200: this run belongs at ${FOLDER}/2026-09-27/1200`,
      `${FOLDER}/2026-09-27/1200: incomplete run, not sealed yet`,
      `${FOLDER}: 3 runs (1 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);
  });

  it("reports records it can't read, instead of skipping them", async () => {
    const home = await copyOfHome();
    await writeFile(at(home, `${RUN}/run.json`), "{ not json");
    await rename(at(home, `${SESSION}/session.json`), at(home, `${SESSION}/session.json.bak`));
    await mkdir(at(home, `${FOLDER}/2026-09-27/stray`));
    // JSON, but not a run: no seal, and no status voicecap writes.
    await mkdir(at(home, `${FOLDER}/2026-09-27/1300`));
    await writeFile(at(home, `${FOLDER}/2026-09-27/1300/run.json`), "{}\n");
    await writeFile(at(home, REVIEWS), "{ not json");
    expect((await verify(home)).lines).toEqual([
      `${SESSION}: not a readable run or manual session`,
      `${RUN}: not a readable run or manual session`,
      `${FOLDER}/2026-09-27/1300: not a readable run or manual session`,
      `${FOLDER}/2026-09-27/stray: not a readable run or manual session`,
      `${REVIEWS}: not a readable review history`,
      `${FOLDER}: 0 runs (0 incomplete), 0 manual sessions, 0 reviews, 0 shares checked: 5 problems.`,
    ]);

    const nullEntry = await copyOfHome();
    await editJson<{ pages: Record<string, unknown[]> }>(at(nullEntry, REVIEWS), (reviews) => {
      reviews.pages[FLAWED_KEY]!.push(null);
    });
    expect((await verify(nullEntry)).lines).toEqual([
      `${REVIEWS}: not a readable review history`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 0 reviews, 0 shares checked: 1 problem.`,
    ]);
  });

  it("reads a run whose name has _manual_ in it as a run", async () => {
    const home = await copyOfHome();
    const named = await runAudit({
      ...inHome(home),
      ...replay(),
      runName: "manual_check",
      now: () => new Date(2026, 8, 27, 12, 0),
    });
    expect(named.runDir).toBe(at(home, `${FOLDER}/2026-09-27/1200_manual_check`));
    expect((await verify(home)).lines).toEqual([
      `${FOLDER}: 2 runs (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: everything matches.`,
    ]);
  });

  it("catches a folder outside the dated folders, where its records would go unchecked", async () => {
    const home = await copyOfHome();
    await rename(at(home, `${FOLDER}/2026-09-27`), at(home, `${FOLDER}/2026-09-27.old`));
    // voicecap's own compare/ folder, and dot-folders, belong in a site folder.
    await mkdir(at(home, `${FOLDER}/compare/2026-09-26_0900__2026-09-27_1102`), {
      recursive: true,
    });
    await mkdir(at(home, `${FOLDER}/.cache`));
    expect((await verify(home)).lines).toEqual([
      `${FOLDER}/2026-09-27.old: an unexpected folder; runs and manual sessions live in date folders`,
      `${FOLDER}: 0 runs (0 incomplete), 1 manual session, 2 reviews, 0 shares checked: 1 problem.`,
    ]);
  });

  it("checks every site folder in the home, or the one --site names", async () => {
    const home = await copyOfHome();
    await addManualSession({
      ...inHome(home),
      file: fixture("manual", "nvda-io-log.txt"),
      site: "https://dvfr.illinois.gov",
      page: "/faq/",
      date: "2026-09-25",
      reviewer: "Pat Reviewer",
    });
    // Neither Git's folder nor voicecap 0.2.0's runs/ is a site.
    await mkdir(path.join(home, ".git", "objects"), { recursive: true });
    await mkdir(path.join(home, "runs", "2026-09-26_1405"), { recursive: true });
    await writeFile(path.join(home, "runs", "2026-09-26_1405", "run.json"), "{}\n");

    const dvfr =
      "dvfr.illinois.gov: 0 runs (0 incomplete), 1 manual session, 0 reviews, 0 shares checked: everything matches.";
    expect((await verify(home)).lines).toEqual([MATCHES, dvfr]);
    expect((await verify(home, "https://dvfr.illinois.gov")).lines).toEqual([dvfr]);
    expect((await verify(home, `${SITE}/flawed/`)).lines).toEqual([MATCHES]);
  });

  it("takes a site's canonical address for --site: the folder whose run recorded it", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "voicecap-verify-"));
    const home = path.join(dir, "home");
    const run = await runAudit({
      out: home,
      cwd: dir,
      env: {},
      logger: createMemoryLogger(),
      ...replay(),
      canonical: "https://dvfr.illinois.gov/",
      now: () => new Date(2026, 8, 27, 11, 2),
    });
    expect(run.outcome).toBe("completed");

    // The address the run read and the address people visit find the one folder.
    const matches = `${FOLDER}: 1 run (0 incomplete), 0 manual sessions, 0 reviews, 0 shares checked: everything matches.`;
    expect((await verify(home, SITE)).lines).toEqual([matches]);
    expect((await verify(home, "https://dvfr.illinois.gov/")).lines).toEqual([matches]);
    expect((await verify(home, "https://dvfr.illinois.gov")).lines).toEqual([matches]);
    // An address no run recorded has no folder to check, as before.
    await expect(verify(home, "https://i2i.illinois.gov/")).rejects.toThrow(
      `${home} has no i2i.illinois.gov folder, so there's nothing to check.`,
    );
  });

  it("leaves the owner's own folders at the home's top alone", async () => {
    const home = await copyOfHome();
    await mkdir(path.join(home, "notes"));
    await writeFile(path.join(home, "notes", "README.md"), "# Notes on the audit\n");
    expect((await verify(home)).lines).toEqual([MATCHES]);
  });

  it("leaves the shareable page's folder alone", async () => {
    const home = await copyOfHome();
    // The run, the manual session, and the reviews that made this home each wrote the page.
    expect(existsSync(at(home, `${FOLDER}/share/current.html`))).toBe(true);
    expect((await verify(home)).lines).toEqual([MATCHES]);
  });

  it("stops when there's nothing to check", async () => {
    const refusal = async (options: Parameters<typeof verifyHome>[0]) => {
      const error: unknown = await verifyHome(options).then(
        () => null,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(UsageError);
      return (error as UsageError).message;
    };
    const logger = createMemoryLogger();
    expect(await refusal({ home: untouched, site: "https://i2i.illinois.gov", logger })).toBe(
      `${untouched} has no i2i.illinois.gov folder, so there's nothing to check.`,
    );
    expect(await refusal({ home: untouched, site: "C:/Program Files/Git/faq", logger })).toMatch(
      /--site "C:\/Program Files\/Git\/faq" looks like a Windows path/,
    );
    const empty = path.join(await mkdtemp(path.join(os.tmpdir(), "voicecap-verify-")), "home");
    expect(await refusal({ home: empty, logger })).toBe(
      `${empty} has no site folders yet, so there's nothing to check.`,
    );
    expect(logger.entries).toEqual([]);
  });
});

/** shares.json as a person might leave it: each entry holds whatever they put there. */
interface LooseShares {
  schemaVersion: 1;
  shares: Record<string, unknown>[];
}

describe("verifyHome, and what was shared", () => {
  // The scripted site's folder, and the names of the two pairs of copies, shared on the same day.
  // Beside each pair is the walkthrough file of the one run (named for it, so known once it's run).
  const EXAMPLE = "example.illinois.gov";
  const SHARE = `${EXAMPLE}/share`;
  const SHARES_JSON = `${SHARE}/shares.json`;
  const FIRST = `${EXAMPLE}_2027-01-15`;
  const SECOND = `${FIRST}-2`;
  const PAGE_1 = `${FIRST}.html`;
  const WORD_1 = `${FIRST}.docx`;
  const PAGE_2 = `${SECOND}.html`;
  const WORD_2 = `${SECOND}.docx`;
  /** When an entry made by hand says it was made. */
  const LATER = "2027-01-16T09:00:00-06:00";

  /** Homes these tests copy, and what shared them: the site shared nothing, once, and twice. */
  let nothing: string;
  let once: string;
  let twice: string;
  let first: ShareReportResult;
  let second: ShareReportResult;
  /** The walkthrough file beside the first pair, and beside the second. */
  let walkthrough1: string;
  let walkthrough2: string;
  /** Every folder made here, taken away at the end. */
  const folders: string[] = [];

  /** A copy of a home, to change: the home, and the site's folder in it. */
  async function copyOf(source: string) {
    const root = await mkdtemp(path.join(os.tmpdir(), "voicecap-verify-shares-"));
    folders.push(root);
    const home = path.join(root, "transcripts");
    await cp(source, home, { recursive: true });
    return { home, siteDir: path.join(home, EXAMPLE) };
  }

  beforeAll(async () => {
    const { dir, run } = await homeWithCountedRun();
    folders.push(dir);
    walkthrough1 = `${FIRST}_${run.runId}_walkthrough.json`;
    walkthrough2 = `${SECOND}_${run.runId}_walkthrough.json`;
    twice = path.join(dir, "transcripts");
    const options = {
      out: twice,
      site: EXAMPLE_SITE,
      reviewer: "Pat Lee",
      now: new Date(2027, 0, 15, 10, 0),
      logger: createMemoryLogger(),
      cwd: dir,
      env: {},
    };
    nothing = (await copyOf(twice)).home;
    first = await shareReport(options);
    once = (await copyOf(twice)).home;
    second = await shareReport(options);
    expect([...first.files, ...second.files].map(({ name }) => name)).toEqual([
      PAGE_1,
      WORD_1,
      walkthrough1,
      PAGE_2,
      WORD_2,
      walkthrough2,
    ]);
  });

  afterAll(async () => {
    // A folder that can't be taken away (a scanner has a file open, say) is left, not a failure.
    await Promise.all(
      folders.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})),
    );
  });

  /** A file in a site's share/ folder. */
  const inShare = (siteDir: string, name: string) => path.join(shareDir(siteDir), name);

  /** Every problem found in the home's only site. */
  async function problemsIn(home: string): Promise<string[]> {
    return (await verifyHome({ home, logger: createMemoryLogger() })).sites[0]!.problems;
  }

  /** Change shares.json's entries as a person could, with anything in them. */
  const editEntries = (siteDir: string, edit: (entries: Record<string, unknown>[]) => void) =>
    editJson<LooseShares>(sharesPath(siteDir), (record) => edit(record.shares));

  /** An entry's seal made right for what it holds now, as one who changed it and sealed it again. */
  const reseal = (entry: Record<string, unknown>) => {
    entry.seal = sealOf(entry);
  };

  it("counts the shares, and finds nothing wrong with copies as they were sent", async () => {
    const { home } = await copyOf(twice);
    const logger = createMemoryLogger();
    const { sites, problems } = await verifyHome({ home, logger });
    expect(problems).toBe(0);
    expect(sites[0]).toMatchObject({ shares: 2 });
    expect(logger.entries.at(-1)?.message).toBe(
      "example.illinois.gov: 1 run (0 incomplete), 0 manual sessions, 0 reviews, 2 shares checked: everything matches.",
    );
  });

  // Review Focus 5.
  it("names a sent copy that was edited, and one that's gone", async () => {
    const { home, siteDir } = await copyOf(twice);
    const logger = createMemoryLogger();
    await appendFile(inShare(siteDir, PAGE_1), " ");
    await rm(inShare(siteDir, WORD_2));
    expect((await verifyHome({ home, logger })).sites[0]!.problems).toEqual([
      `${SHARE}/${PAGE_1}: changed since it was recorded (SHA-256 differs)`,
      `${SHARE}/${WORD_2}: missing`,
    ]);
  });

  it("names an entry that was edited, and doesn't go by what it says of its files", async () => {
    const { home, siteDir } = await copyOf(twice);
    const logger = createMemoryLogger();
    await editJson<SharesFile>(sharesPath(siteDir), (record) => {
      record.shares[0]!.by = "Someone Else";
    });
    await rm(inShare(siteDir, PAGE_1));
    expect((await verifyHome({ home, logger })).sites[0]!.problems).toEqual([
      `${SHARES_JSON}: share 1 (${first.entry.at}) changed since it was recorded`,
    ]);
  });

  it("names an entry that was removed, and the copies nothing records any more", async () => {
    const { home, siteDir } = await copyOf(twice);
    const logger = createMemoryLogger();
    await editJson<SharesFile>(sharesPath(siteDir), (record) => {
      record.shares.shift();
    });
    expect((await verifyHome({ home, logger })).sites[0]!.problems).toEqual([
      `${SHARES_JSON}: entry 1 is missing`,
      `${SHARE}/${WORD_1}: not recorded in shares.json`,
      `${SHARE}/${PAGE_1}: not recorded in shares.json`,
      `${SHARE}/${walkthrough1}: not recorded in shares.json`,
    ]);
  });

  it("names a copy that nothing records", async () => {
    const { home, siteDir } = await copyOf(twice);
    const logger = createMemoryLogger();
    await writeFile(path.join(shareDir(siteDir), "example.illinois.gov_2027-02-01.html"), "<p>");
    expect((await verifyHome({ home, logger })).sites[0]!.problems).toEqual([
      `${SHARE}/example.illinois.gov_2027-02-01.html: not recorded in shares.json`,
    ]);
  });

  it("says when the record can't be read, and names the copies it can no longer vouch for", async () => {
    const { home, siteDir } = await copyOf(twice);
    const logger = createMemoryLogger();
    await writeFile(sharesPath(siteDir), "{");
    expect((await verifyHome({ home, logger })).sites[0]!.problems[0]).toBe(
      `${SHARES_JSON}: not a readable record of what was shared`,
    );
  });

  it("leaves current.html and current.docx alone", async () => {
    const { home, siteDir } = await copyOf(twice);
    const logger = createMemoryLogger();
    await appendFile(sharePath(siteDir), " ");
    await appendFile(shareWordPath(siteDir), " ");
    expect((await verifyHome({ home, logger })).problems).toBe(0);
    // They're written again from the records, so they needn't be there either.
    await rm(sharePath(siteDir));
    await rm(shareWordPath(siteDir));
    expect((await verifyHome({ home, logger })).problems).toBe(0);
  });

  describe("the count of shares", () => {
    it("says '1 share' for one", async () => {
      const { home } = await copyOf(once);
      const logger = createMemoryLogger();
      const { sites, problems } = await verifyHome({ home, logger });
      expect(problems).toBe(0);
      expect(sites[0]).toMatchObject({ shares: 1 });
      expect(logger.entries.at(-1)?.message).toBe(
        "example.illinois.gov: 1 run (0 incomplete), 0 manual sessions, 0 reviews, 1 share checked: everything matches.",
      );
    });

    it("has no shares and no problem when share/ holds only the shareable page and its Word copy", async () => {
      const { home, siteDir } = await copyOf(nothing);
      expect((await readdir(shareDir(siteDir))).sort()).toEqual(["current.docx", "current.html"]);
      const logger = createMemoryLogger();
      const { sites } = await verifyHome({ home, logger });
      expect(sites[0]).toMatchObject({ shares: 0, problems: [] });
      expect(logger.entries.map((entry) => entry.message)).toEqual([
        "example.illinois.gov: 1 run (0 incomplete), 0 manual sessions, 0 reviews, 0 shares checked: everything matches.",
      ]);
    });

    it("has no shares and no problem when the site has no share/ folder, or a file where it would be", async () => {
      const { home, siteDir } = await copyOf(nothing);
      await rm(shareDir(siteDir), { recursive: true });
      expect((await verifyHome({ home, logger: createMemoryLogger() })).sites[0]).toMatchObject({
        shares: 0,
        problems: [],
      });

      await writeFile(shareDir(siteDir), "not a folder");
      expect((await verifyHome({ home, logger: createMemoryLogger() })).sites[0]).toMatchObject({
        shares: 0,
        problems: [],
      });
    });
  });

  describe("the record", () => {
    it.each([
      ["text that isn't JSON", "{"],
      ["an entry that isn't an object", JSON.stringify({ schemaVersion: 1, shares: [null] })],
      ["a schemaVersion that isn't 1", JSON.stringify({ schemaVersion: 2, shares: [] })],
    ])(
      "says it can't be read, and names every copy as one nothing records, when it's %s",
      async (_what, text) => {
        const { home, siteDir } = await copyOf(twice);
        const logger = createMemoryLogger();
        await writeFile(sharesPath(siteDir), text);
        const { sites } = await verifyHome({ home, logger });
        expect(sites[0]).toMatchObject({ shares: 0 });
        // Its own line first, then each copy, by name.
        expect(sites[0]!.problems).toEqual([
          `${SHARES_JSON}: not a readable record of what was shared`,
          `${SHARE}/${WORD_2}: not recorded in shares.json`,
          `${SHARE}/${PAGE_2}: not recorded in shares.json`,
          `${SHARE}/${walkthrough2}: not recorded in shares.json`,
          `${SHARE}/${WORD_1}: not recorded in shares.json`,
          `${SHARE}/${PAGE_1}: not recorded in shares.json`,
          `${SHARE}/${walkthrough1}: not recorded in shares.json`,
        ]);
        expect(logger.entries.at(-1)?.message).toBe(
          "example.illinois.gov: 1 run (0 incomplete), 0 manual sessions, 0 reviews, 0 shares checked: 7 problems.",
        );
      },
    );

    it("takes a record that isn't there as one with no entries, so every copy is one nothing records", async () => {
      const { home, siteDir } = await copyOf(twice);
      await rm(sharesPath(siteDir));
      const { sites } = await verifyHome({ home, logger: createMemoryLogger() });
      expect(sites[0]).toMatchObject({ shares: 0 });
      expect(sites[0]!.problems).toEqual([
        `${SHARE}/${WORD_2}: not recorded in shares.json`,
        `${SHARE}/${PAGE_2}: not recorded in shares.json`,
        `${SHARE}/${walkthrough2}: not recorded in shares.json`,
        `${SHARE}/${WORD_1}: not recorded in shares.json`,
        `${SHARE}/${PAGE_1}: not recorded in shares.json`,
        `${SHARE}/${walkthrough1}: not recorded in shares.json`,
      ]);
    });

    it("names the entry after one that was changed and sealed again, which no longer follows it", async () => {
      const { home, siteDir } = await copyOf(twice);
      await editEntries(siteDir, (entries) => {
        entries[0]!.by = "Someone Else";
        reseal(entries[0]!);
      });
      expect(await problemsIn(home)).toEqual([`${SHARES_JSON}: entry 2 doesn't follow entry 1`]);
    });

    it("names the entries that are missing from the chain, and any numbered twice", async () => {
      const gap = await copyOf(twice);
      await editEntries(gap.siteDir, (entries) => {
        entries[1]!.seq = 4;
        reseal(entries[1]!);
      });
      expect(await problemsIn(gap.home)).toEqual([`${SHARES_JSON}: entries 2 to 3 are missing`]);

      // A copied entry, or a merge of two histories.
      const repeat = await copyOf(twice);
      await editEntries(repeat.siteDir, (entries) => {
        entries.push(structuredClone(entries[1]!));
      });
      const { sites } = await verifyHome({ home: repeat.home, logger: createMemoryLogger() });
      expect(sites[0]).toMatchObject({ shares: 3 });
      expect(sites[0]!.problems).toEqual([`${SHARES_JSON}: more than one entry is numbered 2`]);
    });

    it("names an entry renumbered to take the place of one that was removed", async () => {
      const { home, siteDir } = await copyOf(twice);
      await editEntries(siteDir, (entries) => {
        entries.shift();
        entries[0]!.seq = 1;
        reseal(entries[0]!);
      });
      expect(await problemsIn(home)).toEqual([
        `${SHARES_JSON}: entry 1 follows an entry that isn't there`,
        `${SHARE}/${WORD_1}: not recorded in shares.json`,
        `${SHARE}/${PAGE_1}: not recorded in shares.json`,
        `${SHARE}/${walkthrough1}: not recorded in shares.json`,
      ]);
    });

    it("names an entry that lost its seal as changed, once, and goes by none of its files", async () => {
      const { home, siteDir } = await copyOf(twice);
      await editEntries(siteDir, (entries) => {
        delete entries[0]!.seal;
      });
      await appendFile(inShare(siteDir, PAGE_1), " ");
      // Not also as missing from the chain, as an entry that entry 2 doesn't follow, or as changed
      // copies: the files it names are still copies the record has.
      expect(await problemsIn(home)).toEqual([
        `${SHARES_JSON}: share 1 (${first.entry.at}) changed since it was recorded`,
      ]);
    });

    it("names an entry that is sealed but has no seq: it's outside the chain, and its files are checked", async () => {
      const { home, siteDir } = await copyOf(twice);
      const extra = "example.illinois.gov_2027-02-01.html";
      const bytes = Buffer.from("<p>");
      await writeFile(inShare(siteDir, extra), bytes);
      // Sealed by whoever made it, with no seq or prev: no check of either would reach it.
      const forged = {
        at: LATER,
        by: "Pat Lee",
        runs: [],
        files: [{ name: extra, bytes: bytes.length, sha256: sha256(bytes) }],
      };
      await editEntries(siteDir, (entries) => {
        entries.push({ ...forged, seal: sealOf(forged) });
      });
      const { sites } = await verifyHome({ home, logger: createMemoryLogger() });
      expect(sites[0]).toMatchObject({ shares: 3 });
      expect(sites[0]!.problems).toEqual([
        `${SHARES_JSON}: a share at ${LATER} is outside the chain (no seq)`,
      ]);

      await appendFile(inShare(siteDir, extra), " ");
      expect(await problemsIn(home)).toEqual([
        `${SHARES_JSON}: a share at ${LATER} is outside the chain (no seq)`,
        `${SHARE}/${extra}: changed since it was recorded (SHA-256 differs)`,
      ]);
    });

    it.each<[string, unknown]>([
      ["0", 0],
      ["-1", -1],
      ["a fraction", 2.5],
      ["text", "2"],
      ["null", null],
    ])(
      "names an entry that matches its seal as outside the chain when its seq is %s",
      async (_what, seq) => {
        const { home, siteDir } = await copyOf(twice);
        await editEntries(siteDir, (entries) => {
          entries[1]!.seq = seq;
          reseal(entries[1]!);
        });
        expect(await problemsIn(home)).toEqual([
          `${SHARES_JSON}: a share at ${second.entry.at} is outside the chain (no seq)`,
        ]);
      },
    );

    it("names an entry with no seq and no seal by its time, as changed", async () => {
      const { home, siteDir } = await copyOf(twice);
      await editEntries(siteDir, (entries) => {
        entries.push({ at: LATER, by: "Pat Lee", runs: [], files: [] });
      });
      expect(await problemsIn(home)).toEqual([
        `${SHARES_JSON}: a share at ${LATER} changed since it was recorded`,
      ]);
    });

    it("names an entry whose time can't be made into text as a share, and goes on", async () => {
      const { home, siteDir } = await copyOf(twice);
      await editEntries(siteDir, (entries) => {
        // An object whose toString isn't a function: String can't make text of it. The entry
        // changed, so it's named, and its time is no part of the name.
        entries[0]!.at = { toString: 1 };
      });
      expect(await problemsIn(home)).toEqual([
        `${SHARES_JSON}: a share changed since it was recorded`,
      ]);
    });
  });

  describe("the copies an entry records", () => {
    it("names a copy whose recorded size is wrong, as well as one whose fingerprint is", async () => {
      const { home, siteDir } = await copyOf(twice);
      await editEntries(siteDir, (entries) => {
        const [page] = entries[1]!.files as { bytes: number }[];
        page!.bytes += 1;
        reseal(entries[1]!);
      });
      expect(await problemsIn(home)).toEqual([
        `${SHARE}/${PAGE_2}: changed since it was recorded (SHA-256 differs)`,
      ]);
    });

    it.each<[string, unknown]>([
      ["text", "x"],
      ["an object", { name: PAGE_2 }],
      ["null", null],
      ["left out", undefined],
      ["items that aren't objects", [null, 7, "x"]],
      ["items with no size or fingerprint", [{ name: "a.html" }]],
      ["a size that is text", [{ name: "a.html", bytes: "5", sha256: "a" }]],
      ["a name that isn't text", [{ name: 5, bytes: 1, sha256: "a" }]],
    ])(
      "says one line for an entry that matches its seal when its files are %s",
      async (_what, files) => {
        const { home, siteDir } = await copyOf(twice);
        await editEntries(siteDir, (entries) => {
          entries[1]!.files = files;
          reseal(entries[1]!);
        });
        expect(await problemsIn(home)).toEqual([
          `${SHARES_JSON}: share 2 (${second.entry.at}) lists its files in a form voicecap can't read`,
          // It names none of the copies it was made with, so nothing records them.
          `${SHARE}/${WORD_2}: not recorded in shares.json`,
          `${SHARE}/${PAGE_2}: not recorded in shares.json`,
          `${SHARE}/${walkthrough2}: not recorded in shares.json`,
        ]);
      },
    );

    it("goes by none of an entry's files when one is in a form it can't read, but its good names are recorded", async () => {
      const { home, siteDir } = await copyOf(twice);
      await editEntries(siteDir, (entries) => {
        const [page] = entries[1]!.files as unknown[];
        entries[1]!.files = [page, null];
        reseal(entries[1]!);
      });
      // The page it names is changed, and isn't read.
      await appendFile(inShare(siteDir, PAGE_2), " ");
      expect(await problemsIn(home)).toEqual([
        `${SHARES_JSON}: share 2 (${second.entry.at}) lists its files in a form voicecap can't read`,
        `${SHARE}/${WORD_2}: not recorded in shares.json`,
        `${SHARE}/${walkthrough2}: not recorded in shares.json`,
      ]);
    });

    it.each([
      ["an empty name", ""],
      ["the folder itself", "."],
      ["the folder above", ".."],
      ["a file in the folder above", "../x.html"],
      ["a file in the folder above, with a backslash", "..\\x.html"],
      ["a file in a folder", "sub/x.html"],
      ["a file in a folder, with a backslash", "sub\\x.html"],
      ["a path from the top", "/x.html"],
      ["a path on a drive", "C:\\x.html"],
      ["a name with a null character in it", "x\0y.html"],
    ])("never reads what an entry that matches its seal names as %s", async (_what, name) => {
      const { home, siteDir } = await copyOf(twice);
      await editEntries(siteDir, (entries) => {
        (entries[1]!.files as unknown[]).push({ name, bytes: 3, sha256: sha256("<p>") });
        reseal(entries[1]!);
      });
      expect(await problemsIn(home)).toEqual([
        `${SHARES_JSON}: share 2 (${second.entry.at}) names "${name}", which isn't a file in share/`,
      ]);
    });

    it("doesn't read a file outside share/, though it's there and an entry records it", async () => {
      const { home, siteDir } = await copyOf(twice);
      const outside = path.join(siteDir, "x.html");
      await writeFile(outside, "<p>");
      await editEntries(siteDir, (entries) => {
        (entries[1]!.files as unknown[]).push({
          name: "../x.html",
          bytes: 3,
          sha256: sha256("<p>"),
        });
        reseal(entries[1]!);
      });
      // Changed since it was recorded: it would be named for that, if it were read.
      await writeFile(outside, "<p>, changed");
      expect(await problemsIn(home)).toEqual([
        `${SHARES_JSON}: share 2 (${second.entry.at}) names "../x.html", which isn't a file in share/`,
      ]);
    });

    it("puts the lines for an entry's files where the entry has them, among the lines for the others'", async () => {
      const { home, siteDir } = await copyOf(twice);
      await editEntries(siteDir, (entries) => {
        const [page, word] = entries[1]!.files as unknown[];
        const outside = { name: "../x.html", bytes: 3, sha256: sha256("<p>") };
        entries[1]!.files = [page, outside, word];
        reseal(entries[1]!);
      });
      await appendFile(inShare(siteDir, PAGE_1), " ");
      await appendFile(inShare(siteDir, PAGE_2), " ");
      await rm(inShare(siteDir, WORD_2));
      expect(await problemsIn(home)).toEqual([
        `${SHARE}/${PAGE_1}: changed since it was recorded (SHA-256 differs)`,
        `${SHARE}/${PAGE_2}: changed since it was recorded (SHA-256 differs)`,
        `${SHARES_JSON}: share 2 (${second.entry.at}) names "../x.html", which isn't a file in share/`,
        `${SHARE}/${WORD_2}: missing`,
        // The entry no longer lists its walkthrough file, so nothing records it.
        `${SHARE}/${walkthrough2}: not recorded in shares.json`,
      ]);

      const unreadable = await copyOf(twice);
      await editEntries(unreadable.siteDir, (entries) => {
        entries[1]!.files = "x";
        reseal(entries[1]!);
      });
      await appendFile(inShare(unreadable.siteDir, PAGE_1), " ");
      expect(await problemsIn(unreadable.home)).toEqual([
        `${SHARE}/${PAGE_1}: changed since it was recorded (SHA-256 differs)`,
        `${SHARES_JSON}: share 2 (${second.entry.at}) lists its files in a form voicecap can't read`,
        `${SHARE}/${WORD_2}: not recorded in shares.json`,
        `${SHARE}/${PAGE_2}: not recorded in shares.json`,
        `${SHARE}/${walkthrough2}: not recorded in shares.json`,
      ]);
    });
  });

  // 0.10.0: an entry records the root of the site its copies are named for. Entries from before
  // have none, and a record holds both.
  describe("the site an entry records", () => {
    /**
     * Entries as voicecap wrote them before 0.10.0: with no site, sealed again over what they hold,
     * and each chained to the one before it.
     */
    function asBefore(entries: Record<string, unknown>[]): void {
      let prev: unknown = null;
      for (const entry of entries) {
        delete entry.site;
        entry.prev = prev;
        reseal(entry);
        prev = entry.seal;
      }
    }

    it("finds nothing wrong with entries from before 0.10.0, which record no site", async () => {
      const { home, siteDir } = await copyOf(twice);
      await editEntries(siteDir, (entries) => {
        // Made now, each has one: this takes it away, as if it were never there.
        expect(entries.map((entry) => entry.site)).toEqual(
          Array(2).fill("https://example.illinois.gov/"),
        );
        asBefore(entries);
        expect(entries.map((entry) => "site" in entry)).toEqual([false, false]);
      });

      const logger = createMemoryLogger();
      const { sites, problems } = await verifyHome({ home, logger });

      expect(problems).toBe(0);
      expect(sites[0]).toMatchObject({ shares: 2, problems: [] });
      expect(logger.entries.at(-1)?.message).toBe(
        "example.illinois.gov: 1 run (0 incomplete), 0 manual sessions, 0 reviews, 2 shares checked: everything matches.",
      );
    });

    it("finds nothing wrong with a record of an entry from before 0.10.0 and one after it", async () => {
      const { home, siteDir } = await copyOf(twice);
      await editEntries(siteDir, (entries) => {
        asBefore(entries.slice(0, 1));
        // The second still follows it, and records its site.
        entries[1]!.prev = entries[0]!.seal;
        reseal(entries[1]!);
        expect("site" in entries[1]!).toBe(true);
      });
      expect(await problemsIn(home)).toEqual([]);
    });

    it.each<[string, string]>([
      ["a canonical address", "https://dvfr.illinois.gov/"],
      ["a root with a path", "https://voicecap.netlify.app/demo-site/"],
      ["a root with a port", "https://staging.dvfr.org:8443/"],
      // What a share records when no canonical address is known: the address voicecap read.
      ["the address of a copy on this computer", "http://127.0.0.1:4848/"],
      ["an IPv6 address", "http://[::1]:4848/"],
    ])("finds nothing wrong with a site that is %s", async (_what, site) => {
      const { home, siteDir } = await copyOf(twice);
      await editEntries(siteDir, (entries) => {
        entries[1]!.site = site;
        reseal(entries[1]!);
      });
      expect(await problemsIn(home)).toEqual([]);
    });

    it.each<[string, string]>([
      ["text that isn't an address", "example.illinois.gov"],
      ["an address with another scheme", "ftp://example.illinois.gov/"],
      ["an address with no slash on the end", "https://example.illinois.gov"],
      ["the address of a page", "https://example.illinois.gov/about"],
      ["an address with a query", "https://example.illinois.gov/?x=1"],
      ["an address with a login in it", "https://pat:secret@example.illinois.gov/"],
      ["an address written in capitals", "HTTPS://Example.illinois.gov/"],
      ["empty", ""],
    ])("names an entry that matches its seal when its site is %s", async (_what, site) => {
      const { home, siteDir } = await copyOf(twice);
      await editEntries(siteDir, (entries) => {
        entries[1]!.site = site;
        reseal(entries[1]!);
      });
      // The line shows the site as JSON writes it, so that nothing in it is taken for the line's
      // own words, and says what a site looks like.
      expect(await problemsIn(home)).toEqual([
        `${SHARES_JSON}: share 2 (${second.entry.at}) names ${JSON.stringify(site)} as its site, which isn't a site's root address, such as https://dvfr.illinois.gov/`,
      ]);
    });

    it.each<[string, unknown]>([
      ["a number", 7],
      ["true", true],
      ["null", null],
      ["a list", ["https://example.illinois.gov/"]],
      ["an object", { url: "https://example.illinois.gov/" }],
    ])(
      "says one line for an entry that matches its seal when its site is %s, which isn't text",
      async (_what, site) => {
        const { home, siteDir } = await copyOf(twice);
        await editEntries(siteDir, (entries) => {
          entries[1]!.site = site;
          reseal(entries[1]!);
        });
        expect(await problemsIn(home)).toEqual([
          `${SHARES_JSON}: share 2 (${second.entry.at}) lists its site in a form voicecap can't read`,
        ]);
      },
    );

    it("names an entry's site before its files, and checks the files all the same", async () => {
      const { home, siteDir } = await copyOf(twice);
      await editEntries(siteDir, (entries) => {
        entries[1]!.site = "not an address";
        reseal(entries[1]!);
      });
      await appendFile(inShare(siteDir, PAGE_2), " ");
      expect(await problemsIn(home)).toEqual([
        `${SHARES_JSON}: share 2 (${second.entry.at}) names "not an address" as its site, which isn't a site's root address, such as https://dvfr.illinois.gov/`,
        `${SHARE}/${PAGE_2}: changed since it was recorded (SHA-256 differs)`,
      ]);
    });

    it("goes by no site of an entry that changed: it's named as changed, once", async () => {
      const { home, siteDir } = await copyOf(twice);
      await editEntries(siteDir, (entries) => {
        // Not sealed again, so the seal no longer holds, and the site is no part of the verdict.
        entries[1]!.site = "not an address";
      });
      expect(await problemsIn(home)).toEqual([
        `${SHARES_JSON}: share 2 (${second.entry.at}) changed since it was recorded`,
      ]);
    });
  });

  // 0.12.3: what the copies say of the site, which the website's card shows. A share made before
  // has none, and needs none.
  describe("the result an entry records", () => {
    it.each<[string, unknown]>([
      ["that nothing needs attention", { pages: 9, read: 9, problems: 0, problemPages: 0 }],
      ["a problem on every page", { pages: 32, read: 32, problems: 1, problemPages: 32 }],
      [
        "problems on a page, and pages not read",
        { pages: 9, read: 7, problems: 3, problemPages: 1 },
      ],
      ["no page at all", { pages: 0, read: 0, problems: 0, problemPages: 0 }],
    ])("finds nothing wrong with a result that says %s", async (_what, result) => {
      const { home, siteDir } = await copyOf(twice);
      await editEntries(siteDir, (entries) => {
        entries[1]!.result = result;
        reseal(entries[1]!);
      });
      expect(await problemsIn(home)).toEqual([]);
    });

    it.each<[string, unknown]>([
      ["a number", 7],
      ["null", null],
      ["a list", [9, 9, 0, 0]],
      ["missing a count", { pages: 9, read: 9, problems: 0 }],
      ["a count that is text", { pages: "9", read: 9, problems: 0, problemPages: 0 }],
      ["a count that isn't whole", { pages: 9.5, read: 9, problems: 0, problemPages: 0 }],
      ["a count below 0", { pages: 9, read: -1, problems: 0, problemPages: 0 }],
      ["more pages read than there are", { pages: 9, read: 10, problems: 0, problemPages: 0 }],
      [
        "problems on more pages than there are",
        { pages: 9, read: 9, problems: 2, problemPages: 10 },
      ],
      ["pages with a problem, and no problem", { pages: 9, read: 9, problems: 0, problemPages: 2 }],
    ])(
      "says one line for an entry that matches its seal when its result is %s",
      async (_what, result) => {
        const { home, siteDir } = await copyOf(twice);
        await editEntries(siteDir, (entries) => {
          entries[1]!.result = result;
          reseal(entries[1]!);
        });
        expect(await problemsIn(home)).toEqual([
          `${SHARES_JSON}: share 2 (${second.entry.at}) lists its result in a form voicecap can't read`,
        ]);
      },
    );

    it("names an entry's result after its site, before its files, and checks the files all the same", async () => {
      const { home, siteDir } = await copyOf(twice);
      await editEntries(siteDir, (entries) => {
        entries[1]!.site = "not an address";
        entries[1]!.result = "all good";
        reseal(entries[1]!);
      });
      await appendFile(inShare(siteDir, PAGE_2), " ");
      expect(await problemsIn(home)).toEqual([
        `${SHARES_JSON}: share 2 (${second.entry.at}) names "not an address" as its site, which isn't a site's root address, such as https://dvfr.illinois.gov/`,
        `${SHARES_JSON}: share 2 (${second.entry.at}) lists its result in a form voicecap can't read`,
        `${SHARE}/${PAGE_2}: changed since it was recorded (SHA-256 differs)`,
      ]);
    });

    it("goes by no result of an entry that changed: it's named as changed, once", async () => {
      const { home, siteDir } = await copyOf(twice);
      await editEntries(siteDir, (entries) => {
        // Not sealed again, so the seal no longer holds, and the result is no part of the verdict.
        entries[1]!.result = "all good";
      });
      expect(await problemsIn(home)).toEqual([
        `${SHARES_JSON}: share 2 (${second.entry.at}) changed since it was recorded`,
      ]);
    });
  });

  describe("what share/ holds that no entry names", () => {
    it("doesn't mind the files an operating system leaves, or a name that starts with a dot", async () => {
      const { home, siteDir } = await copyOf(twice);
      for (const name of [".DS_Store", "Thumbs.db", "desktop.ini", ".hidden.html"]) {
        await writeFile(inShare(siteDir, name), "left by a program");
      }
      await mkdir(inShare(siteDir, ".cache"));
      expect(await problemsIn(home)).toEqual([]);
    });

    // Someone reading a copy that was sent, in Word, has it open when they run verify.
    it("doesn't mind the owner file Word keeps beside a copy that's open", async () => {
      const { home, siteDir } = await copyOf(twice);
      // What Word writes beside example.illinois.gov_2027-01-15.docx, which is recorded.
      await writeFile(
        inShare(siteDir, "~$ample.illinois.gov_2027-01-15.docx"),
        "Word's owner file",
      );
      expect(await problemsIn(home)).toEqual([]);
    });

    it("still names a file Word didn't write, whatever its name has in it", async () => {
      const { home, siteDir } = await copyOf(twice);
      // The name has to start with ~$ to be Word's: ~$ inside it, or a ~ alone, is just a name.
      for (const name of ["ordinary.docx", "x~$y.docx", "~notes.docx"]) {
        await writeFile(inShare(siteDir, name), "<p>");
      }
      expect(await problemsIn(home)).toEqual([
        `${SHARE}/ordinary.docx: not recorded in shares.json`,
        `${SHARE}/x~$y.docx: not recorded in shares.json`,
        `${SHARE}/~notes.docx: not recorded in shares.json`,
      ]);
    });

    it("names each folder, with the copies nothing records, by name", async () => {
      const { home, siteDir } = await copyOf(twice);
      await mkdir(inShare(siteDir, "b-folder"));
      await writeFile(inShare(siteDir, "c.html"), "<p>");
      await writeFile(inShare(siteDir, "a.html"), "<p>");
      await writeFile(inShare(siteDir, "Z.html"), "<p>");
      // By name as every list in verify is: as the letters are ordered in code, capitals first,
      // whatever order the folder lists them in.
      expect(await problemsIn(home)).toEqual([
        `${SHARE}/Z.html: not recorded in shares.json`,
        `${SHARE}/a.html: not recorded in shares.json`,
        `${SHARE}/b-folder: an unexpected folder`,
        `${SHARE}/c.html: not recorded in shares.json`,
      ]);
    });

    it("names a folder in the place of a copy an entry records, as a folder and as a copy that's gone", async () => {
      const { home, siteDir } = await copyOf(twice);
      await rm(inShare(siteDir, PAGE_2));
      await mkdir(inShare(siteDir, PAGE_2));
      expect(await problemsIn(home)).toEqual([
        `${SHARE}/${PAGE_2}: missing`,
        `${SHARE}/${PAGE_2}: an unexpected folder`,
      ]);
    });

    it("doesn't take a copy as not recorded when any entry names it, however the entry is changed", async () => {
      const { home, siteDir } = await copyOf(twice);
      await editEntries(siteDir, (entries) => {
        entries[1]!.by = "Someone Else";
      });
      expect(await problemsIn(home)).toEqual([
        `${SHARES_JSON}: share 2 (${second.entry.at}) changed since it was recorded`,
      ]);
    });
  });

  it("gives the record's lines first, then each recorded file, then what nothing records", async () => {
    const { home, siteDir } = await copyOf(twice);
    await editEntries(siteDir, (entries) => {
      // Entry 1 removed, and an entry with no seq or seal added...
      entries.shift();
      entries.push({ at: LATER, by: "Pat Lee", runs: [], files: [] });
    });
    // ...a copy of the one that's left gone, and copies nothing records, a folder among them.
    await rm(inShare(siteDir, WORD_2));
    await mkdir(inShare(siteDir, "b-folder"));
    await writeFile(inShare(siteDir, "a.html"), "<p>");
    expect(await problemsIn(home)).toEqual([
      `${SHARES_JSON}: a share at ${LATER} changed since it was recorded`,
      `${SHARES_JSON}: entry 1 is missing`,
      `${SHARE}/${WORD_2}: missing`,
      `${SHARE}/a.html: not recorded in shares.json`,
      `${SHARE}/b-folder: an unexpected folder`,
      `${SHARE}/${WORD_1}: not recorded in shares.json`,
      `${SHARE}/${PAGE_1}: not recorded in shares.json`,
      `${SHARE}/${walkthrough1}: not recorded in shares.json`,
    ]);
  });
});
