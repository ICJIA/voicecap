/**
 * What the tests of NVDA's own log on the page are made from: cleaned copies of NVDA's log written
 * as NVDA writes one (`copyOf`, `pageEntries`), a run of three NVDA sessions that keeps them as
 * voicecap 0.18.0 does (`keptLogsRun`), and the real run of 6 October 2026 in fixture/nvda-io-run
 * laid out as a site folder (`nvdaFixtureSite`).
 */
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { gestureOf } from "../../src/drivers/guidepup/nvda-log.js";
import type { DriverCommand, FileHash, RunEvent, RunJson } from "../../src/model.js";
import type { TranscriptStore } from "../../src/share/load.js";
import { MAIN_COMMAND } from "../../src/transcripts/format.js";
import { fileHash } from "../../src/transcripts/write.js";
import { sealOf } from "../../src/util/hash.js";
import { tempOutDir } from "./report-data.js";
import { LINES, LOG_HASH, loggedRun, storeOf, withOwnFiles } from "./share-model.js";

const DAY = 86_400_000;

/** "HH:MM:SS.mmm", as NVDA logs a time, for milliseconds since midnight. */
export function clockOf(ms: number): string {
  const time = ms % DAY;
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const hours = Math.floor(time / 3_600_000);
  const minutes = Math.floor(time / 60_000) % 60;
  const seconds = Math.floor(time / 1000) % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(time % 1000, 3)}`;
}

/** The time of day in a local ISO time ("2026-09-26T14:03:00.000-05:00"), in milliseconds. */
export function timeOfDay(iso: string): number {
  const [hours = "0", minutes = "0", seconds = "0"] = (iso.split("T")[1] ?? "")
    .slice(0, 12)
    .split(":");
  return (Number(hours) * 60 + Number(minutes)) * 60_000 + Math.round(Number(seconds) * 1000);
}

/** A key voicecap pressed, as NVDA logs it. */
export function keyAt(ms: number, gesture: string): string[] {
  return [
    `IO - inputCore.InputManager.executeGesture (${clockOf(ms)}) - winInputHook (5200):`,
    `Input: kb(desktop):${gesture}`,
  ];
}

/** What NVDA said, as it logs it: its text items, among the commands it adds. */
export function saidAt(ms: number, ...items: string[]): string[] {
  const texts = items.map((item) => `'${item.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`);
  return [
    `IO - speech.speech.speak (${clockOf(ms)}) - MainThread (4100):`,
    `Speaking [LangChangeCommand ('en_US'), ${[...texts, "CancellableSpeech (still valid)"].join(", ")}]`,
  ];
}

/** A cleaned copy of NVDA's log: a first line that says what it is, then its entries. */
export function copyOf(...entries: string[][]): string {
  return ["# NVDA's own log of one NVDA session in this run.", ...entries.flat(), ""].join("\n");
}

/** One pass of a page: the command its steps press, and what each said. */
export interface PassWords {
  command: DriverCommand;
  spoken: string[];
}

/** The three passes of the lines every page in memory has (share-model.ts's LINES), in order. */
export const PAGE_PASSES: PassWords[] = (["read", "headings", "tab"] as const).map((pass) => ({
  command: MAIN_COMMAND[pass],
  spoken: LINES[pass],
}));

/**
 * NVDA's entries for a page read in one attempt that began at `from` (milliseconds since midnight):
 * its passes one after another, each opened as voicecap opens a page (NVDA+T, with what NVDA says of
 * the window; Escape; Ctrl+Home, with the page's first line), then a key for each step and what NVDA
 * said after it. A step takes 1.2 s (storeOf's steps do), its key 0.27 s in and NVDA's words 40 ms
 * after that, as on the real run.
 */
export function pageEntries(from: number, passes: PassWords[] = PAGE_PASSES): string[][] {
  const entries: string[][] = [];
  passes.forEach((pass, index) => {
    const start = from + 2000 + index * 15_000;
    entries.push(
      keyAt(start, "NVDA+t"),
      saidAt(start + 3, "Example - Browser"),
      keyAt(start + 1000, "escape"),
      keyAt(start + 1260, "control+home"),
      saidAt(start + 1263, "Top of the page"),
    );
    const begin = start + 2300;
    pass.spoken.forEach((line, step) => {
      const pressed = begin + step * 1200 + 270;
      entries.push(keyAt(pressed, gestureOf(pass.command)!));
      entries.push(saidAt(pressed + 40, ...line.split(", ")));
    });
  });
  return entries;
}

/** A run that keeps NVDA's log, with what its page is made from. */
export interface KeptLogs {
  run: RunJson;
  log: { events: RunEvent[]; unreadable: number };
  /** The copies, by their path from the run's folder. */
  copies: Map<string, string>;
  transcripts: TranscriptStore;
}

/**
 * The logged run (share-model.ts's `loggedRun`) as voicecap 0.18.0 keeps NVDA's log. It has three
 * NVDA sessions, as its event log tells: the first (26 September, 14:02:56 to 14:04:43) reads Home
 * in full and loses Apply to another window; the second (14:04:45 to 14:06:28) reads Apply again;
 * the third, 28 September, in the run's second session, reads Contact. Each stop is followed by a
 * `screen-reader-log` event that names the session's copy (nvda-log/1-1.txt, 1-2.txt, and 2-1.txt),
 * and the run's record lists the event log and the three copies.
 *
 * Every page's three passes are the lines in share-model.ts (8 steps), so the check has 24 steps,
 * and all agree. Each pass opens as voicecap opens a page, which NVDA speaks twice: 6 lines of
 * speech outside the steps for each copy. The first copy also has Calculator, said before Home was
 * read, and the speech of the thrown-out attempt at Apply: a key and two lines while Teams was in
 * front. So 9 lines of speech are outside the steps in the first copy, and 21 in all.
 */
export function keptLogsRun(): KeptLogs {
  const { run: logged, log } = loggedRun();
  const stops: RunEvent[] = log.events.filter((each) => each.type === "screen-reader-stopped");
  const names = ["nvda-log/1-1.txt", "nvda-log/1-2.txt", "nvda-log/2-1.txt"];
  const events: RunEvent[] = log.events.flatMap((each) => {
    const at = stops.indexOf(each);
    return at === -1
      ? [each]
      : [each, { at: each.at, type: "screen-reader-log", file: names[at]!, reason: null }];
  });
  const started = (url: string, attempt: number): number => {
    const found = events.find(
      (each) => each.type === "page-started" && each.page === url && each.attempt === attempt,
    );
    if (found === undefined) throw new Error(`The logged run never started ${url}.`);
    return timeOfDay(found.at);
  };
  const [home, apply, contact] = logged.pages.map((page) => page.url) as [string, string, string];
  // Another window was in front while the attempt at Apply that was thrown out ran.
  const thrown = timeOfDay("2026-09-26T14:04:10.000-05:00");
  const copies = new Map<string, string>([
    [
      names[0]!,
      copyOf(
        saidAt(started(home, 1) - 1500, "Calculator"),
        ...pageEntries(started(home, 1)),
        keyAt(thrown, "downArrow"),
        saidAt(thrown + 40, "Microsoft Teams", "window"),
        saidAt(thrown + 2000, "Re: salary review"),
      ),
    ],
    [names[1]!, copyOf(...pageEntries(started(apply, 2)))],
    [names[2]!, copyOf(...pageEntries(started(contact, 1)))],
  ]);
  const files: Record<string, FileHash> = {
    "events.jsonl": LOG_HASH,
    ...Object.fromEntries([...copies].map(([name, text]) => [name, fileHash(text)])),
  };
  return {
    run: usingVersion(withOwnFiles(logged, files), "0.18.0"),
    log: { events, unreadable: 0 },
    copies,
    transcripts: storeOf(),
  };
}

/** The run with every session's voicecap `version`, sealed again if it was sealed. */
export function usingVersion(run: RunJson, version: string): RunJson {
  const { seal: _seal, ...unsealed } = run;
  const sessions = unsealed.sessions.map((session) =>
    session.environment === null
      ? session
      : {
          ...session,
          environment: {
            ...session.environment,
            voicecap: { ...session.environment.voicecap, version },
          },
        },
  );
  const changed: RunJson = { ...unsealed, sessions };
  return run.seal === undefined ? changed : { ...changed, seal: sealOf(changed) };
}

const FIXTURE = fileURLToPath(new URL("../../fixture/nvda-io-run/", import.meta.url));

/** The real run of 6 October 2026: the demo's seven pages, and NVDA's cleaned log of its one session. */
export const NVDA_FIXTURE = {
  /** The run's id. */
  runId: "2026-10-06_0808",
  /** Its record, as the fixture has it: voicecap 0.11.0-rc.0, which kept no copy of NVDA's log. */
  record: async (): Promise<RunJson> =>
    JSON.parse(await readFile(path.join(FIXTURE, "run", "run.json"), "utf8")) as RunJson,
  /** NVDA's cleaned log of the session. */
  copy: (): Promise<string> => readFile(path.join(FIXTURE, "nvda-log", "1-1.txt"), "utf8"),
};

/** What `nvdaFixtureSite` lays out, and lets a test change before the run is sealed. */
export interface FixtureSiteParts {
  run: RunJson;
  /** The event log, line by line. */
  events: string[];
  /** The copy of NVDA's log, as the run lists it. */
  copy: string;
}

/**
 * The real run of 6 October 2026 (fixture/nvda-io-run) as a site folder voicecap 0.18.0 could have
 * made: the run in its folder, NVDA's cleaned log of its one session as nvda-log/1-1.txt, a
 * `screen-reader-log` event after NVDA's stop that names it, and the run's record, which lists the
 * event log and the copy and is sealed again. `change` edits any of them first.
 *
 * The fixture's own run is from voicecap 0.11.0-rc.0, so its record lists no copy and its log has
 * no such event; the run says it used `version` (by default 0.18.0). With `unlisted`, the copy is
 * written but the record doesn't list it. With `inHome`, the site's folder is in a transcripts home
 * of its own, named for the address voicecap read (127.0.0.1_4848), as the commands find a site;
 * `home` is that home. The site's latest.txt names the run.
 */
export async function nvdaFixtureSite(
  options: {
    version?: string;
    change?: (parts: FixtureSiteParts) => void;
    unlisted?: boolean;
    inHome?: boolean;
  } = {},
): Promise<{ siteDir: string; runId: string; runFolder: string; home: string }> {
  const home = await tempOutDir();
  const siteDir = options.inHome === true ? path.join(home, "127.0.0.1_4848") : home;
  const runFolder = path.join(siteDir, "2026-10-06", "0808");
  await mkdir(path.dirname(runFolder), { recursive: true });
  await cp(path.join(FIXTURE, "run"), runFolder, { recursive: true });

  const record = await NVDA_FIXTURE.record();
  const lines = (await readFile(path.join(runFolder, "events.jsonl"), "utf8"))
    .split("\n")
    .filter((line) => line !== "");
  const stop = lines.findIndex((line) => line.includes('"screen-reader-stopped"'));
  lines.splice(
    stop + 1,
    0,
    '{"at":"2026-10-06T08:14:41.010-05:00","type":"screen-reader-log","file":"nvda-log/1-1.txt","reason":null}',
  );
  const parts: FixtureSiteParts = { run: record, events: lines, copy: await NVDA_FIXTURE.copy() };
  options.change?.(parts);

  const events = `${parts.events.join("\n")}\n`;
  await writeFile(path.join(runFolder, "events.jsonl"), events);
  await mkdir(path.join(runFolder, "nvda-log"), { recursive: true });
  await writeFile(path.join(runFolder, "nvda-log", "1-1.txt"), parts.copy);
  const files = {
    "events.jsonl": fileHash(events),
    ...(options.unlisted === true ? {} : { "nvda-log/1-1.txt": fileHash(parts.copy) }),
  };
  const { seal: _seal, ...unsealed } = parts.run;
  const run = usingVersion({ ...unsealed, files }, options.version ?? "0.18.0");
  const sealed: RunJson = { ...run, seal: sealOf(run) };
  await writeFile(path.join(runFolder, "run.json"), `${JSON.stringify(sealed, null, 2)}\n`);
  await writeFile(path.join(siteDir, "latest.txt"), `${NVDA_FIXTURE.runId}\n`);
  return { siteDir, runId: NVDA_FIXTURE.runId, runFolder, home };
}

/**
 * Another run of the same pages in the fixture's site folder, on `day` at 09:00, copied from the
 * fixture's run with no event log and no copy of NVDA's log. Returns the new run's id.
 */
async function addRunOn(siteDir: string, day: string): Promise<string> {
  const first = path.join(siteDir, "2026-10-06", "0808");
  const other = path.join(siteDir, day, "0900");
  await mkdir(path.dirname(other), { recursive: true });
  await cp(first, other, { recursive: true });
  await rm(path.join(other, "events.jsonl"));
  await rm(path.join(other, "nvda-log"), { recursive: true, force: true });
  const {
    seal: _seal,
    files: _files,
    ...record
  } = JSON.parse(await readFile(path.join(other, "run.json"), "utf8")) as RunJson;
  const changed: RunJson = {
    ...record,
    id: `${day}_0900`,
    createdAt: `${day}T09:00:00-05:00`,
    completedAt: `${day}T09:06:00-05:00`,
    sessions: record.sessions.map((session) => ({
      ...session,
      startedAt: `${day}T09:00:00-05:00`,
      endedAt: `${day}T09:06:00-05:00`,
    })),
  };
  await writeFile(
    path.join(other, "run.json"),
    `${JSON.stringify({ ...changed, seal: sealOf(changed) }, null, 2)}
`,
  );
  return changed.id;
}

/**
 * A later run of the same pages (2026-10-07_0900), with no copy of NVDA's log. It is the latest run,
 * so the page shows its transcripts, and the fixture's run is the run before: drawn on, but with none
 * of its pages shown.
 */
export const addLaterRun = (siteDir: string): Promise<string> => addRunOn(siteDir, "2026-10-07");

/**
 * An earlier run of the same pages (2026-10-05_0900), with no copy of NVDA's log. The fixture's run
 * is the latest, and this the run before it: drawn on, with none of its pages shown.
 */
export const addEarlierRun = (siteDir: string): Promise<string> => addRunOn(siteDir, "2026-10-05");
