/**
 * A run's NVDA log checked against its transcripts (checkRunAgainstLog): each NVDA session's copy,
 * named by the run's event log, against the steps its kept attempts read, the sessions added up, and
 * what isn't checked, with why. The comparison itself is in share-log-check.test.ts. The run here is
 * `keptLogsRun`: three NVDA sessions, a restart between the first two, and a second session of the
 * run that reads one more page. The version that first keeps NVDA's log, and the path of a copy, are
 * here too.
 */
import { describe, expect, it, vi } from "vitest";

import { gestureOf } from "../src/drivers/guidepup/nvda-log.js";
import { isCopyPath } from "../src/run/events.js";
import type { PassName, RunEvent, RunJson, StepRecord } from "../src/model.js";
import type * as LogCheckModule from "../src/share/log-check.js";
import { KEEPS_NVDA_LOG_FROM, keepsNvdaLog } from "../src/share/problems.js";
import { checkRunAgainstLog } from "../src/share/run-log-check.js";
import { failedAttempt } from "./helpers/share-data.js";
import {
  copyOf,
  keptLogsRun,
  type KeptLogs,
  pageEntries,
  PAGE_PASSES,
  timeOfDay,
} from "./helpers/nvda-log.js";

/** When the three NVDA sessions of the run started: the first two on 26 September, the third on 28. */
const STARTED = [
  "2026-09-26T14:02:56.681-05:00",
  "2026-09-26T14:04:45.729-05:00",
  "2026-09-28T09:00:05.310-05:00",
];

/** Every step of the run agrees, and 21 lines of speech are outside them (see keptLogsRun). */
const EVERY_STEP = {
  transcriptLines: 24,
  logLines: 24,
  agree: 24,
  onlyInLog: [],
  onlyInTranscripts: [],
  outside: 21,
};

type Input = Parameters<typeof checkRunAgainstLog>[0];

/** What the run's check is given. */
function inputFor(kept: KeptLogs): Input {
  return {
    run: kept.run,
    events: kept.log.events,
    copies: kept.copies,
    steps: (slug: string, pass: PassName): StepRecord[] | null =>
      kept.transcripts.steps(kept.run.id, slug, pass),
    gestureOf,
    pageName: (page) => page.label ?? page.url,
    redact: (text) => text.replaceAll("C:\\Users\\jane", "%USERPROFILE%"),
  };
}

/** The run's check, with the parts a test changes. */
function checkOf(kept: KeptLogs = keptLogsRun(), overrides: Partial<Input> = {}) {
  return checkRunAgainstLog({ ...inputFor(kept), ...overrides });
}

/**
 * checkRunAgainstLog, with the comparison it calls throwing `error` for every session, and the
 * module put back afterward.
 */
async function withComparisonThrowing<T>(
  error: (module: typeof LogCheckModule) => Error,
  use: (check: typeof checkRunAgainstLog) => T,
): Promise<T> {
  vi.resetModules();
  vi.doMock("../src/share/log-check.js", async (importOriginal) => {
    const actual = await importOriginal<typeof LogCheckModule>();
    return {
      ...actual,
      checkAgainstLog: () => {
        throw error(actual);
      },
    };
  });
  try {
    const { checkRunAgainstLog: check } = await import("../src/share/run-log-check.js");
    return use(check);
  } finally {
    vi.doUnmock("../src/share/log-check.js");
    vi.resetModules();
  }
}

/** The events without the ones `gone` picks. */
function without(kept: KeptLogs, gone: (event: RunEvent) => boolean): RunEvent[] {
  return kept.log.events.filter((event) => !gone(event));
}

/** The kept logs with the second NVDA session's stop, and so its copy's event, gone. */
function secondNeverStopped(kept: KeptLogs): RunEvent[] {
  return without(
    kept,
    (event) =>
      (event.type === "screen-reader-stopped" && event.pid === 54568) ||
      (event.type === "screen-reader-log" && event.file === "nvda-log/1-2.txt"),
  );
}

/** The run with a change made to every page's record. */
function withPages(
  run: RunJson,
  change: (page: RunJson["pages"][number]) => RunJson["pages"][number],
) {
  return { ...run, pages: run.pages.map(change) };
}

describe("the version that first keeps NVDA's log", () => {
  it("is 0.17.0, and a run of it, its release candidates, and every later version keeps it", () => {
    expect(KEEPS_NVDA_LOG_FROM).toBe("0.17.0");
    for (const version of ["0.17.0", "0.17.0-rc.0", "0.17.1", "0.18.0", "0.100.0", "1.0.0"]) {
      expect(keepsNvdaLog(version), version).toBe(true);
    }
  });

  it("is not a run of an earlier version, nor one that doesn't say which", () => {
    for (const version of ["0.16.9", "0.14.0", "0.12.0", "0.11.0-rc.0", "0.4.1", "0.9.0"]) {
      expect(keepsNvdaLog(version), version).toBe(false);
    }
    expect(keepsNvdaLog(null)).toBe(false);
    expect(keepsNvdaLog("")).toBe(false);
    expect(keepsNvdaLog("latest")).toBe(false);
  });
});

describe("isCopyPath", () => {
  it("accepts the path of a copy as a run names it: nvda-log/<session>-<n>.txt", () => {
    for (const file of ["nvda-log/1-1.txt", "nvda-log/2-1.txt", "nvda-log/12-34.txt"]) {
      expect(isCopyPath(file), file).toBe(true);
    }
  });

  it("accepts nothing else, so a record can't send a read anywhere else", () => {
    for (const file of [
      "events.jsonl",
      "nvda-log/0-1.txt",
      "nvda-log/01-1.txt",
      "nvda-log/1-0.txt",
      "nvda-log/1-1.txt.bak",
      "nvda-log/1-1.TXT",
      "nvda-log/../events.jsonl",
      "nvda-log/../../1-1.txt",
      "nvda-log/a/1-1.txt",
      "nvda-log/1-1.txt/",
      "nvda-log\\1-1.txt",
      "../nvda-log/1-1.txt",
      "/nvda-log/1-1.txt",
      "pages/nvda-log/1-1.txt",
      "",
    ]) {
      expect(isCopyPath(file), file).toBe(false);
    }
  });
});

describe("checkRunAgainstLog", () => {
  it("checks each NVDA session's steps against the copy its event names, and adds them up", () => {
    expect(checkOf()).toEqual({ check: EVERY_STEP, notChecked: [] });
  });

  it("pairs a copy with a session by the event that names it, never by the copy's number", () => {
    const kept = keptLogsRun();
    // The first two stops name each other's copy: Home is read against Apply's, and Apply against Home's.
    const swapped = kept.log.events.map((event) => {
      if (event.type !== "screen-reader-log") return event;
      if (event.file === "nvda-log/1-1.txt") return { ...event, file: "nvda-log/1-2.txt" };
      if (event.file === "nvda-log/1-2.txt") return { ...event, file: "nvda-log/1-1.txt" };
      return event;
    });
    const { check } = checkOf(kept, { events: swapped });

    // Neither session's copy has its own page's keys, so all 16 steps are only in the transcripts;
    // the third session is as it was.
    expect(check?.transcriptLines).toBe(24);
    expect(check?.agree).toBe(8);
    expect(check?.onlyInTranscripts.map((each) => each.page)).toEqual([
      ...Array<string>(8).fill("Home"),
      ...Array<string>(8).fill("Apply"),
    ]);
    expect(check?.onlyInLog).toEqual([]);
  });

  it("keeps a copy the log doesn't name out of the check", () => {
    const kept = keptLogsRun();
    // The first session's stop has no copy named, though its copy is there.
    const events = without(
      kept,
      (event) => event.type === "screen-reader-log" && event.file === "nvda-log/1-1.txt",
    );

    expect(checkOf(kept, { events })).toEqual({
      check: { ...EVERY_STEP, transcriptLines: 16, logLines: 16, agree: 16, outside: 12 },
      notChecked: [{ steps: 8, from: STARTED[0], why: "none", detail: null }],
    });
  });

  it("gives a session with no copy the reason its event gives, and checks the others", () => {
    const kept = keptLogsRun();
    const events = kept.log.events.map((event) =>
      event.type === "screen-reader-log" && event.file === "nvda-log/1-2.txt"
        ? { ...event, file: null, reason: "NVDA's log wasn't there." }
        : event,
    );

    expect(checkOf(kept, { events })).toEqual({
      check: { ...EVERY_STEP, transcriptLines: 16, logLines: 16, agree: 16, outside: 15 },
      notChecked: [
        { steps: 8, from: STARTED[1], why: "reason", detail: "NVDA's log wasn't there." },
      ],
    });
  });

  it("replaces the home folder in a reason", () => {
    const kept = keptLogsRun();
    const events = kept.log.events.map((event) =>
      event.type === "screen-reader-log" && event.file === "nvda-log/1-2.txt"
        ? { ...event, file: null, reason: "EBUSY: C:\\Users\\jane\\AppData\\Local\\Temp\\nvda.log" }
        : event,
    );
    const { notChecked } = checkOf(kept, { events });

    expect(notChecked[0]?.detail).toBe("EBUSY: %USERPROFILE%\\AppData\\Local\\Temp\\nvda.log");
  });

  it("says a session that ended without stopping NVDA kept no copy", () => {
    const kept = keptLogsRun();

    expect(checkOf(kept, { events: secondNeverStopped(kept) })).toEqual({
      check: { ...EVERY_STEP, transcriptLines: 16, logLines: 16, agree: 16, outside: 15 },
      notChecked: [{ steps: 8, from: STARTED[1], why: "none", detail: null }],
    });
  });

  it("says a copy that isn't among those read isn't as the run recorded it, when the run's record lists it", () => {
    const kept = keptLogsRun();
    const copies = new Map(kept.copies);
    copies.delete("nvda-log/1-2.txt");

    // Listed and not read: missing or changed on disk, which voicecap verify names.
    expect(checkOf(kept, { copies })).toEqual({
      check: { ...EVERY_STEP, transcriptLines: 16, logLines: 16, agree: 16, outside: 15 },
      notChecked: [{ steps: 8, from: STARTED[1], why: "altered", detail: null }],
    });
  });

  it("says the run's record doesn't list a copy the event log names, when it doesn't", () => {
    const kept = keptLogsRun();
    const copies = new Map(kept.copies);
    copies.delete("nvda-log/1-2.txt");
    // The record has no line of the copy, so voicecap verify, which goes by the record, never looks
    // for it: the copy can't be said to be one verify names.
    const { ["nvda-log/1-2.txt"]: _unlisted, ...files } = kept.run.files ?? {};
    const run = { ...kept.run, files };

    expect(checkOf(kept, { run, copies })).toEqual({
      check: { ...EVERY_STEP, transcriptLines: 16, logLines: 16, agree: 16, outside: 15 },
      notChecked: [{ steps: 8, from: STARTED[1], why: "unlisted", detail: null }],
    });
    // A path that is an object's own property name, with no file of it listed, isn't listed.
    const named = kept.log.events.map((event) =>
      event.type === "screen-reader-log" && event.file === "nvda-log/1-2.txt"
        ? { ...event, file: "constructor" }
        : event,
    );
    expect(checkOf(kept, { events: named }).notChecked).toEqual([
      { steps: 8, from: STARTED[1], why: "unlisted", detail: null },
    ]);
  });

  it("doesn't check a session whose copy has no speech in it, which lists no mismatch", () => {
    const kept = keptLogsRun();
    // NVDA's logging level was below input and output: the copy has a warning at most.
    const copies = new Map(kept.copies);
    copies.set(
      "nvda-log/1-2.txt",
      copyOf([
        "WARNING - core.main (14:05:00.000) - MainThread (4100):",
        "Something NVDA warned of, with no speech.",
      ]),
    );
    const result = checkOf(kept, { copies });

    expect(result.notChecked).toEqual([
      { steps: 8, from: STARTED[1], why: "silent", detail: null },
    ]);
    expect(result.check).toMatchObject({
      transcriptLines: 16,
      onlyInLog: [],
      onlyInTranscripts: [],
    });
  });

  it("doesn't check a run that kept only the first thing NVDA said for each step", () => {
    const kept = keptLogsRun();
    const run = { ...kept.run, settings: { ...kept.run.settings, capture: "initial" as const } };

    expect(checkOf(kept, { run })).toEqual({
      check: null,
      notChecked: STARTED.map((from) => ({ steps: 8, from, why: "initial", detail: null })),
    });
  });

  it("doesn't check a session whose pages' times can't be read, and checks the others", () => {
    const kept = keptLogsRun();
    // More than a millisecond's digits: voicecap writes three.
    const events = kept.log.events.map((event) =>
      event.type === "page-started" && event.attempt === 2
        ? { ...event, at: "2026-09-26T14:04:48.0000000-05:00" }
        : event,
    );
    const result = checkOf(kept, { events });

    expect(result.notChecked).toEqual([{ steps: 8, from: STARTED[1], why: "times", detail: null }]);
    expect(result.check).toMatchObject({ transcriptLines: 16, agree: 16 });
  });

  it("knows the comparison's own refusal by its kind, whatever its words say", async () => {
    // Words nothing like the comparison's own: each session is still counted as not checked.
    const result = await withComparisonThrowing(
      ({ CantCheckError }) => new CantCheckError("Reworded, with nothing of the words it had."),
      (check) => check(inputFor(keptLogsRun())),
    );

    expect(result).toEqual({
      check: null,
      notChecked: STARTED.map((from) => ({ steps: 8, from, why: "times", detail: null })),
    });
  });

  it("lets any other error out, even one in the words the comparison's own refusal uses", async () => {
    const thrown = withComparisonThrowing(
      () => new Error("NVDA's log can't be checked: but not by the comparison."),
      (check) => check(inputFor(keptLogsRun())),
    );

    await expect(thrown).rejects.toThrow("NVDA's log can't be checked: but not by the comparison.");
  });

  it("lists a step that differs under its page, pass, and step, in both lists", () => {
    const kept = keptLogsRun();
    const copies = new Map(kept.copies);
    // NVDA said "Grant" where the transcripts have "Grants": in Apply's read and headings passes.
    copies.set(
      "nvda-log/1-2.txt",
      kept.copies.get("nvda-log/1-2.txt")!.replaceAll("'Grants'", "'Grant'"),
    );
    const result = checkOf(kept, { copies });

    expect(result.notChecked).toEqual([]);
    expect(result.check).toMatchObject({ transcriptLines: 24, logLines: 24, agree: 22 });
    expect(result.check?.onlyInLog).toEqual([
      { page: "Apply", pass: "read", step: 2, text: "heading, level 1, Grant" },
      { page: "Apply", pass: "headings", step: 1, text: "heading, level 1, Grant" },
    ]);
    expect(result.check?.onlyInTranscripts).toEqual([
      { page: "Apply", pass: "read", step: 2, text: "heading, level 1, Grants" },
      { page: "Apply", pass: "headings", step: 1, text: "heading, level 1, Grants" },
    ]);
  });

  it("gives a failed attempt's window to the NVDA session it began in, and no other", () => {
    const kept = keptLogsRun();
    // A failed attempt at Contact, in the third session. Its time of day is when Home was read in
    // the first session's copy: if that copy were given the window, it would set Home's speech aside.
    const run = withPages(kept.run, (page) =>
      page.label === "Contact"
        ? {
            ...page,
            failedAttempts: [
              failedAttempt({
                n: 1,
                startedAt: "2026-09-28T14:03:10.000-05:00",
                endedAt: "2026-09-28T14:03:40.000-05:00",
              }),
            ],
          }
        : page,
    );

    expect(checkOf(kept, { run })).toEqual({ check: EVERY_STEP, notChecked: [] });
  });

  it("ignores a failed attempt whose times can't be read, and checks all the same", () => {
    const kept = keptLogsRun();
    const run = withPages(kept.run, (page) =>
      page.label === "Apply"
        ? {
            ...page,
            failedAttempts: [
              ...(page.failedAttempts ?? []),
              failedAttempt({ n: 3, startedAt: "yesterday", endedAt: "today" }),
            ],
          }
        : page,
    );

    expect(checkOf(kept, { run })).toEqual({ check: EVERY_STEP, notChecked: [] });
  });

  it("leaves a page whose attempt the event log doesn't show unchecked, and the others checked", () => {
    const kept = keptLogsRun();
    // Contact's page-finished is lost from the log.
    const events = without(
      kept,
      (event) => event.type === "page-finished" && event.page.endsWith("/contact/"),
    );
    const result = checkOf(kept, { events });

    expect(result.notChecked).toEqual([{ steps: 8, from: null, why: "placed", detail: null }]);
    expect(result.check).toMatchObject({ transcriptLines: 16, agree: 16 });
  });

  it("leaves a pass whose steps can't be read unchecked, with the steps its record counts", () => {
    const kept = keptLogsRun();
    const result = checkOf(kept, {
      steps: (slug, pass) =>
        slug.startsWith("home") && pass === "tab"
          ? null
          : kept.transcripts.steps(kept.run.id, slug, pass),
    });

    expect(result.notChecked).toEqual([{ steps: 2, from: null, why: "unread", detail: null }]);
    expect(result.check).toMatchObject({ transcriptLines: 22, logLines: 22, agree: 22 });
  });

  it("leaves a pass whose steps are not steps unchecked, as it does an unreadable one", () => {
    const kept = keptLogsRun();
    const result = checkOf(kept, {
      steps: (slug, pass) =>
        slug.startsWith("home") && pass === "tab"
          ? ([{ n: 1, command: "nextFocusable", spoken: 7 }] as unknown as StepRecord[])
          : kept.transcripts.steps(kept.run.id, slug, pass),
    });

    expect(result.notChecked).toEqual([{ steps: 2, from: null, why: "unread", detail: null }]);
  });

  it("makes a session of a log with no start or stop of NVDA, as a test driver writes it", () => {
    const kept = keptLogsRun();
    // Only Home, and a log with no NVDA start or stop: its pages, then the copy's event.
    const run = { ...kept.run, pages: kept.run.pages.slice(0, 1) };
    const events = kept.log.events.filter(
      (event) =>
        (event.type === "page-started" || event.type === "page-finished") &&
        event.page === run.pages[0]!.url,
    );
    const first = kept.log.events.find((event) => event.type === "screen-reader-log")!;
    const result = checkOf(kept, { run, events: [...events, first] });

    expect(result.notChecked).toEqual([]);
    expect(result.check).toMatchObject({ transcriptLines: 8, logLines: 8, agree: 8 });
  });

  it("makes a session of each stretch of pages that a copy ends, and of each voicecap session, when the log has no NVDA starts or stops", () => {
    const kept = keptLogsRun();
    // What a driver that records no start or stop of its screen reader leaves: the sessions' starts,
    // the pages, and a copy's event at each stop (the failed attempt at Apply has no end event here).
    const events = without(
      kept,
      (event) =>
        !["run-started", "page-started", "page-finished", "screen-reader-log"].includes(event.type),
    );

    expect(events.map((event) => event.type)).toContain("screen-reader-log");
    expect(checkOf(kept, { events })).toEqual({ check: EVERY_STEP, notChecked: [] });
  });

  it("ends a session at the start of a voicecap session, so one that was killed isn't joined by the next one's pages", () => {
    const kept = keptLogsRun();
    // The first voicecap session was killed after Home, with no copy; the second read Contact.
    const run = { ...kept.run, pages: [kept.run.pages[0]!, kept.run.pages[2]!] };
    const events = without(
      kept,
      (event) =>
        (event.type === "screen-reader-log" && event.file !== "nvda-log/2-1.txt") ||
        !["run-started", "page-started", "page-finished", "screen-reader-log"].includes(
          event.type,
        ) ||
        ("page" in event && event.page.endsWith("/apply/")),
    );
    const result = checkOf(kept, { run, events });

    expect(result.notChecked).toEqual([
      { steps: 8, from: "2026-09-26T14:03:00.000-05:00", why: "none", detail: null },
    ]);
    expect(result.check).toEqual({
      ...EVERY_STEP,
      transcriptLines: 8,
      logLines: 8,
      agree: 8,
      outside: 6,
    });
  });

  it("keeps the first copy event of a session when a stray one follows it", () => {
    const kept = keptLogsRun();
    const events = kept.log.events.flatMap((event) =>
      event.type === "screen-reader-log" && event.file === "nvda-log/1-1.txt"
        ? [event, { ...event, file: null, reason: "Once more." }]
        : [event],
    );

    expect(checkOf(kept, { events })).toEqual({ check: EVERY_STEP, notChecked: [] });
  });

  it("leaves out an event whose time isn't a time, as a line of the log that couldn't be read", () => {
    const kept = keptLogsRun();
    const events = kept.log.events.map((event) =>
      event.type === "page-finished" && event.page.endsWith("/contact/")
        ? { ...event, at: "last Tuesday" }
        : event,
    );
    const result = checkOf(kept, { events });

    expect(result.notChecked).toEqual([{ steps: 8, from: null, why: "placed", detail: null }]);
    expect(result.check).toMatchObject({ transcriptLines: 16, agree: 16 });
  });

  it("takes the latest start of a page before its end for the kept attempt, as an attempt Ctrl+C stopped has a start and no end", () => {
    const kept = keptLogsRun();
    // The first attempt at Apply began in the first NVDA session and never ended or failed, and the
    // second began in the second: Apply was read there, with the second copy.
    const events = without(kept, (event) => event.type === "page-failed");

    expect(checkOf(kept, { events })).toEqual({ check: EVERY_STEP, notChecked: [] });
  });

  it("takes a page's passes in the order its run read them", () => {
    const kept = keptLogsRun();
    const [home] = kept.run.pages;
    // Home read in the Tab pass first, then the read pass, then the headings: the run's setting.
    const run = {
      ...kept.run,
      pages: [home!],
      settings: { ...kept.run.settings, passes: ["tab", "read", "headings"] as PassName[] },
    };
    const began = kept.log.events.find(
      (event) => event.type === "page-started" && event.page === home!.url,
    )!;
    const [read, headings, tab] = PAGE_PASSES;
    const copies = new Map([
      ["nvda-log/1-1.txt", copyOf(...pageEntries(timeOfDay(began.at), [tab!, read!, headings!]))],
    ]);

    expect(checkOf(kept, { run, copies })).toEqual({
      check: { ...EVERY_STEP, transcriptLines: 8, logLines: 8, agree: 8, outside: 6 },
      notChecked: [],
    });
  });

  it("replaces the home folder in the words of a line that differs", () => {
    const kept = keptLogsRun();
    // The transcript has a path in it that the log doesn't: the page never shows the account's name.
    const result = checkOf(kept, {
      steps: (slug, pass) =>
        kept.transcripts
          .steps(kept.run.id, slug, pass)
          ?.map((step) =>
            slug === "home" && pass === "read" && step.n === 2
              ? { ...step, spoken: "Saved in C:\\Users\\jane\\Documents" }
              : step,
          ) ?? null,
    });

    expect(result.check?.onlyInTranscripts).toEqual([
      { page: "Home", pass: "read", step: 2, text: "Saved in %USERPROFILE%\\Documents" },
    ]);
    expect(JSON.stringify(result)).not.toContain("jane");
  });

  it("checks nothing for a run with no steps", () => {
    const kept = keptLogsRun();
    const run = withPages(kept.run, (page) => ({ ...page, status: "failed" as const }));

    expect(checkOf(kept, { run })).toEqual({ check: null, notChecked: [] });
  });
});
