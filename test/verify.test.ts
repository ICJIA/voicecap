import { existsSync } from "node:fs";
import { appendFile, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { addManualSession } from "../src/manual-add.js";
import type { ManualSessionJson, ReviewEntry, ReviewsFile, RunJson } from "../src/model.js";
import { addReview } from "../src/reviews/review.js";
import { runAudit, type RunAuditOptions } from "../src/run/audit.js";
import { UsageError } from "../src/util/errors.js";
import { sealOf } from "../src/util/hash.js";
import { createMemoryLogger } from "../src/util/log.js";
import { verifyHome } from "../src/verify.js";

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
const MATCHES = `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews checked: everything matches.`;

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
        { folder: FOLDER, runs: 1, incomplete: 0, manualSessions: 1, reviews: 2, problems: [] },
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
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews checked: 1 problem.`,
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
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews checked: 1 problem.`,
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
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews checked: 3 problems.`,
    ]);
    expect(result.problems).toBe(3);
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
      `${FOLDER}: 2 runs (0 incomplete), 1 manual session, 2 reviews checked: 1 problem.`,
    ]);
  });

  it("catches a run copied into another site's folder", async () => {
    const home = await copyOfHome();
    await mkdir(at(home, "dvfr.illinois.gov/2026-09-27"), { recursive: true });
    await cp(at(home, RUN), at(home, "dvfr.illinois.gov/2026-09-27/1102"), { recursive: true });
    expect((await verify(home)).lines).toEqual([
      MATCHES,
      `dvfr.illinois.gov/2026-09-27/1102: this run belongs at ${RUN}`,
      "dvfr.illinois.gov: 1 run (0 incomplete), 0 manual sessions, 0 reviews checked: 1 problem.",
    ]);
  });

  it("catches a manual session renamed to another time", async () => {
    const home = await copyOfHome();
    await rename(at(home, SESSION), at(home, `${FOLDER}/2026-09-25/2358_manual_home`));
    expect((await verify(home)).lines).toEqual([
      `${FOLDER}/2026-09-25/2358_manual_home: this manual session belongs at ${SESSION}`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews checked: 1 problem.`,
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
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews checked: 1 problem.`,
    ]);

    // A completed run relabeled incomplete, which would spare its files from being checked.
    const relabeled = await copyOfHome();
    await editJson<RunJson>(at(relabeled, `${RUN}/run.json`), (run) => {
      run.status = "incomplete";
    });
    expect((await verify(relabeled)).lines).toEqual([
      `${RUN}/run.json: changed since it was sealed`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews checked: 1 problem.`,
    ]);
  });

  it("catches a completed run's run.json replaced by a bare incomplete one", async () => {
    const home = await copyOfHome();
    await writeFile(at(home, `${RUN}/run.json`), `${JSON.stringify({ status: "incomplete" })}\n`);
    await appendFile(at(home, `${RUN}/pages/home/read.txt`), "An added line.\n");
    expect((await verify(home)).lines).toEqual([
      `${RUN}: not a readable run or manual session`,
      `${FOLDER}: 0 runs (0 incomplete), 1 manual session, 2 reviews checked: 1 problem.`,
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
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews checked: 1 problem.`,
    ]);

    // An earlier entry, changed: reported once, not also as a gap in the chain.
    const earlier = await copyOfHome();
    await editJson<ReviewsFile>(at(earlier, REVIEWS), (reviews) => {
      reviews.pages[FLAWED_KEY]![0]!.note = "Added afterwards";
    });
    expect((await verify(earlier)).lines).toEqual([
      `${REVIEWS}: entry 1 (${FLAWED}) changed since it was recorded`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews checked: 1 problem.`,
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
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews checked: 1 problem.`,
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
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 3 reviews checked: 1 problem.`,
    ]);
  });

  it("catches a deleted review", async () => {
    const home = await copyOfHome();
    await editJson<ReviewsFile>(at(home, REVIEWS), (reviews) => {
      reviews.pages[FLAWED_KEY]!.shift();
    });
    expect((await verify(home)).lines).toEqual([
      `${REVIEWS}: entry 1 is missing`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 1 review checked: 1 problem.`,
    ]);
  });

  it("catches a review moved to another page, and reviews swapped within a page", async () => {
    const moved = await copyOfHome();
    await editJson<ReviewsFile>(at(moved, REVIEWS), (reviews) => {
      reviews.pages[`${SITE}/`] = [reviews.pages[FLAWED_KEY]!.pop()!];
    });
    expect((await verify(moved)).lines).toEqual([
      `${REVIEWS}: entry 2 (${FLAWED}) is filed under another page (${SITE}/)`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews checked: 1 problem.`,
    ]);

    const swapped = await copyOfHome();
    await editJson<ReviewsFile>(at(swapped, REVIEWS), (reviews) => {
      reviews.pages[FLAWED_KEY]!.reverse();
    });
    expect((await verify(swapped)).lines).toEqual([
      `${REVIEWS}: the entries for ${FLAWED} are out of order (entry 2 comes before entry 1)`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews checked: 1 problem.`,
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
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 1 review checked: 1 problem.`,
    ]);

    // Two entries with one number: a copied entry, or a merge of two histories.
    const repeat = await copyOfHome();
    await editJson<ReviewsFile>(at(repeat, REVIEWS), (reviews) => {
      const entries = reviews.pages[FLAWED_KEY]!;
      entries.push(structuredClone(entries[1]!));
    });
    expect((await verify(repeat)).lines).toEqual([
      `${REVIEWS}: more than one entry is numbered 2`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 3 reviews checked: 1 problem.`,
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
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews checked: 1 problem.`,
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
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 1 review checked: 1 problem.`,
    ]);
  });

  it("catches an edited manual transcript", async () => {
    const home = await copyOfHome();
    await appendFile(at(home, `${SESSION}/session.txt`), "23:59:59      An added line\n");
    expect((await verify(home)).lines).toEqual([
      `${SESSION}/session.txt: changed since it was recorded (SHA-256 differs)`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews checked: 1 problem.`,
    ]);

    const deleted = await copyOfHome();
    await rm(at(deleted, `${SESSION}/session.txt`));
    expect((await verify(deleted)).lines).toEqual([
      `${SESSION}/session.txt: missing`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews checked: 1 problem.`,
    ]);
  });

  it("catches a changed raw copy", async () => {
    const home = await copyOfHome();
    await appendFile(at(home, `${SESSION}/raw/nvda-log.txt`), "An added line\r\n");
    expect((await verify(home)).lines).toEqual([
      `${SESSION}/raw/nvda-log.txt: changed since it was recorded (SHA-256 differs)`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews checked: 1 problem.`,
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
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 2 reviews checked: 3 problems.`,
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
      `${FOLDER}: 1 run (0 incomplete), 2 manual sessions, 2 reviews checked: 4 problems.`,
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
      `${FOLDER}: 2 runs (1 incomplete), 1 manual session, 3 reviews checked: 3 problems.`,
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
      `${FOLDER}: 2 runs (1 incomplete), 1 manual session, 2 reviews checked: everything matches.`,
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
      `${FOLDER}: 3 runs (1 incomplete), 1 manual session, 2 reviews checked: 1 problem.`,
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
      `${FOLDER}: 0 runs (0 incomplete), 0 manual sessions, 0 reviews checked: 5 problems.`,
    ]);

    const nullEntry = await copyOfHome();
    await editJson<{ pages: Record<string, unknown[]> }>(at(nullEntry, REVIEWS), (reviews) => {
      reviews.pages[FLAWED_KEY]!.push(null);
    });
    expect((await verify(nullEntry)).lines).toEqual([
      `${REVIEWS}: not a readable review history`,
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 0 reviews checked: 1 problem.`,
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
      `${FOLDER}: 2 runs (0 incomplete), 1 manual session, 2 reviews checked: everything matches.`,
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
      `${FOLDER}: 0 runs (0 incomplete), 1 manual session, 2 reviews checked: 1 problem.`,
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
      "dvfr.illinois.gov: 0 runs (0 incomplete), 1 manual session, 0 reviews checked: everything matches.";
    expect((await verify(home)).lines).toEqual([MATCHES, dvfr]);
    expect((await verify(home, "https://dvfr.illinois.gov")).lines).toEqual([dvfr]);
    expect((await verify(home, `${SITE}/flawed/`)).lines).toEqual([MATCHES]);
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
