/**
 * The evidence behind the page: what each run it draws on recorded (its facts, its event log, its
 * test environment, and its files' fingerprints), the walkthrough file that repeats it, the runs it
 * left out with what each did, and how the page says what a run's voicecap didn't record. Pure: it
 * works from records already read.
 */
import {
  SCREENSHOT_FILE,
  type EnvironmentRecord,
  type ListenerAnswer,
  type MachineRecord,
  type PageRecord,
  type PageSource,
  type PageStatus,
  type RunEvent,
  type RunJson,
  type SessionRecord,
} from "../model.js";
import { describeChanges, distinctEnvironments } from "../report/compare.js";
import { EVENT_LOG } from "../run/events.js";
import { siteFolder } from "../run/paths.js";
import { environmentLines } from "../transcripts/format.js";
import { formatCommand } from "../util/command-line.js";
import { clock, dateAndTime, names, pagePath, type Shown } from "./format.js";
import { keepsEventLog } from "./problems.js";
import { isFileHash, screenshotRecordOf } from "./records.js";
import { runBefore, type LeftOutReason, type Standing } from "./standing.js";
import { EVIDENCE_TEXT, TIMELINE_TEXT } from "./text.js";
import {
  isEventTime,
  restartsOf,
  timelinesOf,
  unloggedSessions,
  type EventWords,
  type SessionTimeline,
  type UnloggedSession,
} from "./timeline.js";
import { walkthroughJson, walkthroughOf, walkthroughProblem } from "./walkthrough.js";

/** A line of a run's evidence: what it is, and what the record says. */
export interface EvidenceRow {
  label: string;
  value: string;
}

/** A run's walkthrough file, as the page offers it to download. */
export interface WalkthroughDownload {
  /** "dvfr.illinois.gov_2026-09-29_1402_walkthrough.json": the site's name, the run, and what it is. */
  fileName: string;
  /** The file's bytes, in base64: what the page's link carries. */
  base64: string;
  /** The file's size, in bytes. */
  bytes: number;
  /** The command that writes the file from the run's record: "npx @icjia/voicecap walkthrough …". */
  get: string;
  /** The command that repeats the run from the file: "npx @icjia/voicecap --walkthrough <file>". */
  repeat: string;
}

/**
 * What the evidence says of a run's walkthrough file: the file, or why voicecap can't make one of
 * this run (a run beyond what the file's format holds, such as a step limit over 100,000), as a
 * sentence that ends with its period.
 */
export type RunWalkthrough = WalkthroughDownload | { problem: string };

export interface RunEvidence {
  /** The run's record exactly as its run.json holds it: its id, its seal, and its fingerprints. */
  run: RunJson;
  /**
   * When it started and finished, its pages, how many of them the page shows from it, NVDA
   * restarts, who ran it, and whether NVDA was heard in each session.
   */
  facts: EvidenceRow[];
  /**
   * The test environment (evidence D): who ran it, the computer, and the screen reader, browser, and
   * software, as its latest session recorded them. "Not recorded: this run used voicecap <v>." where
   * the run is from before voicecap recorded a part.
   */
  environment: EvidenceRow[];
  /**
   * Evidence A, the event log (from voicecap 0.11.0): each session's timeline, minute by minute and
   * to the millisecond, or what the page says in its place (see `timelineOf`).
   */
  timeline: SessionTimeline[] | { notRecorded: string };
  /**
   * The run's sessions that the timelines don't cover, each with what the page says where its
   * timeline would be: a run begun before voicecap kept the log (0.11.0) and finished with one that
   * does, say ("Session 1: not recorded: it used voicecap 0.10.0."). None when the page has no
   * timeline to show, since the part then says why once.
   */
  unlogged: UnloggedSession[];
  /** The run's screen reader, as its environment records it, which the timeline's chart names. */
  screenReader: string;
  /** Evidence C, NVDA's own log checked against the transcripts: no version records it yet. */
  nvdaLog: { notRecorded: string };
  /**
   * Every file the run's record lists, with its size and SHA-256: first the run's own, beside its
   * pages (its event log, from voicecap 0.11.0), whose page is "The run" (EVIDENCE_TEXT.theRun);
   * then page by page, a page's transcripts, then its screenshot, where its record has the file's
   * fingerprint.
   */
  fingerprints: { page: string; file: string; bytes: number; sha256: string }[];
  /**
   * The command that checks the originals: "npx @icjia/voicecap verify", which checks every site
   * in the home, so it names none.
   */
  verify: string;
  /**
   * The walkthrough file that repeats the run, exactly as `voicecap walkthrough` writes it of the
   * run's record, for the page to carry as a download and for the Word copy to say how to get.
   */
  walkthrough: RunWalkthrough;
}

/**
 * What the page says where a run is from before voicecap recorded a kind of evidence: "Not
 * recorded: this run used voicecap 0.4.1.", or "an earlier version of voicecap" when the record
 * doesn't say which.
 */
export function notRecordedBy(version: string | null): string {
  const used = version === null ? "an earlier version of voicecap" : `voicecap ${version}`;
  return `Not recorded: this run used ${used}.`;
}

/**
 * Whether a run's voicecap records a screenshot of each page it loads: 0.11.0 and later, as it keeps
 * the event log. A page of such a run with none says why (SCREENSHOT_TEXT), and a page of an earlier
 * run says that run's voicecap didn't (`notRecordedBy`). An unknown version counts as an earlier one.
 */
export function keepsScreenshots(version: string | null): boolean {
  return keepsEventLog(version);
}

/** The voicecap version a session recorded, or null when it recorded no environment. */
function versionOfSession(session: SessionRecord | undefined): string | null {
  return session?.environment?.voicecap.version ?? null;
}

/** The voicecap version of a run's latest session with an environment. */
export function versionOf(run: RunJson): string | null {
  return versionOfSession(run.sessions.findLast((session) => session.environment !== null));
}

/** The voicecap version of the session that made a page's record, else the run's. */
export function sessionVersion(run: RunJson, session: number | undefined): string | null {
  const made = run.sessions.find((candidate) => candidate.n === session);
  return versionOfSession(made) ?? versionOf(run);
}

/** When a run began: its first session's start. */
export function runStart(run: RunJson): string {
  return run.sessions[0]?.startedAt ?? run.createdAt;
}

/** When a run finished: when it was completed, else when its last session ended. */
export function runEnd(run: RunJson): string {
  return run.completedAt ?? run.sessions.at(-1)?.endedAt ?? runStart(run);
}

/** A run's event log, as the loader read it: its events, and how many lines couldn't be read. */
export interface EventLog {
  events: RunEvent[];
  unreadable: number;
}

/**
 * The evidence of each run the standing draws on, the latest first. `recordOf` gives a run's record
 * as its run.json holds it; `redact` replaces the home folder in what the page shows. `site` is the
 * site as the page names it (its canonical address, else the address voicecap read), which the
 * commands and the walkthrough files' names take, and `shown` gives any other address as the page
 * shows it. A run's record, and the walkthrough file made of it, keep the address voicecap read.
 * `eventLog` gives a run's event log, when the page has it, and `words` what its events' words
 * need of the run.
 */
export function evidenceOf(input: {
  standing: Standing;
  recordOf: (run: RunJson) => RunJson;
  site: string;
  shown: Shown;
  redact: (text: string) => string;
  eventLog: (run: RunJson) => EventLog | null;
  words: (run: RunJson) => EventWords;
}): RunEvidence[] {
  const { standing, site, shown, redact } = input;
  const before = standing.latest && runBefore(standing.counted, standing.latest);
  return standing.drawnOn.toReversed().map((run) => {
    const fromRun = standing.pages.filter((page) => page.shown?.run === run).length;
    const notRecorded = notRecordedBy(versionOf(run));
    const record = input.recordOf(run);
    const words = input.words(run);
    const log = input.eventLog(run);
    const timeline = timelineOf(run, log, words);
    const unlogged = Array.isArray(timeline) ? unloggedSessions(run, timeline) : [];
    // The restarts are the log's to count: where the page can't show the log, it says why here too,
    // and where the log covers only some sessions, it says which.
    const restarts = Array.isArray(timeline)
      ? restartsOf(log ?? { events: [] }, words, { timelines: timeline, unlogged })
      : timeline.notRecorded;
    return {
      run: record,
      facts: factsOf(run, fromRun, run === before, restarts),
      environment: environmentOf(run, redact, shown),
      timeline,
      unlogged,
      screenReader: words.screenReader,
      nvdaLog: { notRecorded },
      fingerprints: [
        ...ownFiles(run),
        ...run.pages.flatMap((page) => [
          ...Object.entries(page.files).map(([file, hash]) => ({
            page: pagePath(page.url),
            file,
            bytes: hash.bytes,
            sha256: hash.sha256,
          })),
          ...screenshotFile(page),
        ]),
      ],
      verify: formatCommand(["verify"]),
      walkthrough: walkthroughFor(record, site),
    };
  });
}

/**
 * The files a run's record lists beside its pages (RunJson.files: its event log), each as the run's.
 * Only an entry that is a file's fingerprint as voicecap writes one: `voicecap verify` reads a record
 * with any other as not voicecap's, and the page shows no size or fingerprint it doesn't have.
 */
function ownFiles(run: RunJson): RunEvidence["fingerprints"] {
  const files: unknown = run.files;
  if (typeof files !== "object" || files === null) return [];
  return Object.entries(files).flatMap(([file, hash]: [string, unknown]) =>
    isFileHash(hash)
      ? [{ page: EVIDENCE_TEXT.theRun, file, bytes: hash.bytes, sha256: hash.sha256 }]
      : [],
  );
}

/**
 * A page's screenshot as one of its run's files, when the page's record has the file's fingerprint
 * (a record of why there's none lists no file, and neither does one of no kind voicecap writes). The
 * record keeps it apart from the page's transcripts, so it's added to them here.
 */
function screenshotFile(page: PageRecord): RunEvidence["fingerprints"] {
  const shot = screenshotRecordOf(page);
  if (shot === undefined || shot === "unreadable" || "error" in shot) return [];
  return [
    { page: pagePath(page.url), file: SCREENSHOT_FILE, bytes: shot.bytes, sha256: shot.sha256 },
  ];
}

/** Why the page can't show the event log of a run whose voicecap keeps one (TIMELINE_TEXT.gaps). */
export type EventLogGap = keyof typeof TIMELINE_TEXT.gaps;

/**
 * Why the page can't show a run's event log, for a run whose voicecap keeps one (0.11.0 and later):
 * the log its record lists isn't as the run recorded it (missing, unreadable, or changed), and
 * `voicecap verify` names it; its record lists none, so the log couldn't be written; or no line of
 * it could be read. Null when the page shows the log, and for a run from before voicecap kept one,
 * which its evidence says as it says every part the run didn't record. The run's evidence and its
 * problems' records each give this reason, so they never say different things.
 */
export function eventLogGap(run: RunJson, log: EventLog | null): EventLogGap | null {
  if (log !== null) return log.events.some((event) => isEventTime(event.at)) ? null : "unreadable";
  if (run.files?.[EVENT_LOG] !== undefined) return "changed";
  return keepsEventLog(versionOf(run)) ? "unlisted" : null;
}

/**
 * A run's event log as the page shows it: a timeline of each of its sessions. Where the page can't,
 * it says why (`eventLogGap`), or, for a run from before voicecap kept the log, that it didn't.
 */
function timelineOf(
  run: RunJson,
  log: EventLog | null,
  words: EventWords,
): RunEvidence["timeline"] {
  const gap = eventLogGap(run, log);
  if (gap !== null) return { notRecorded: TIMELINE_TEXT.gaps[gap].part };
  return log === null
    ? { notRecorded: notRecordedBy(versionOf(run)) }
    : timelinesOf(run, log, words);
}

/**
 * A run's walkthrough file: made of the run's record as run.json holds it, so it is the very file
 * `voicecap walkthrough` writes (it says where voicecap read, which is where a repeat runs), and
 * named for the run and the site as the page names it: its host, made safe for a file name as a
 * site's folder is (`siteFolder`). voicecap never offers a file it would refuse to read back, so a
 * run beyond what the format holds (see `walkthroughProblem`) gets its reason instead, which is a
 * sentence already.
 *
 * It never throws: the file is an extra, and a run whose record can't be made into one (a completed
 * run with no time of completion, or a value JSON can't write) must not stop the page or its Word
 * copy, which were made of such a record before there were walkthrough files. That run says
 * voicecap couldn't read its record.
 */
function walkthroughFor(record: RunJson, site: string): RunWalkthrough {
  try {
    const walkthrough = walkthroughOf(record);
    const problem = walkthroughProblem(walkthrough);
    if (problem !== null) return { problem };
    const file = Buffer.from(walkthroughJson(walkthrough), "utf8");
    const fileName = `${siteFolder(site)}_${record.id}_walkthrough.json`;
    return {
      fileName,
      base64: file.toString("base64"),
      bytes: file.length,
      get: formatCommand(["walkthrough", "--site", site, "--run", record.id, fileName]),
      repeat: formatCommand(["--walkthrough", fileName]),
    };
  } catch {
    return { problem: EVIDENCE_TEXT.walkthrough.unreadable };
  }
}

/** A page's status in a run, in words that follow its count. */
const PAGE_STATUS: Record<PageStatus, string> = {
  done: "transcribed",
  failed: "failed",
  skipped: "skipped",
  pending: "not reached",
};

const ANSWERS: Record<ListenerAnswer, string> = {
  all: "Yes, the whole time",
  part: "Part of the time",
  no: "No",
};

/**
 * A run's facts. `restarts` is what the page says of NVDA's restarts: the event log counts them,
 * with why each was, and where the page has no log to count, it says why.
 */
function factsOf(
  run: RunJson,
  shown: number,
  isRunBefore: boolean,
  restarts: string,
): EvidenceRow[] {
  const version = versionOf(run);
  const statuses = (["done", "failed", "skipped", "pending"] as const).flatMap((status) => {
    const count = run.pages.filter((page) => page.status === status).length;
    return count > 0 ? [`${count} ${PAGE_STATUS[status]}`] : [];
  });
  const shownHere =
    shown > 0
      ? `${shown} ${shown === 1 ? "page" : "pages"}`
      : isRunBefore
        ? "None: the latest run is compared with it"
        : "None";
  return [
    { label: "Started", value: dateAndTime(runStart(run)) },
    { label: "Finished", value: dateAndTime(runEnd(run)) },
    { label: "Pages", value: statuses.length > 0 ? names(statuses) : "None" },
    { label: "Transcripts shown", value: shownHere },
    // Only the event log (evidence A) says when NVDA was started again, and why.
    { label: "NVDA restarts", value: restarts },
    { label: "Run by", value: ranBy(run, version) },
    ...statements(run),
  ];
}

/** Who ran a run's sessions, as the summary's "When and how" says it. */
function ranBy(run: RunJson, version: string | null): string {
  const named = [
    ...new Set(
      run.sessions.flatMap((session) => (session.reviewer ? [session.reviewer.name] : [])),
    ),
  ];
  if (named.length > 0) return names(named);
  // A session with no reviewer field is from before voicecap recorded who ran it; null had no name.
  if (run.sessions.some((session) => session.reviewer === null)) {
    return "Not recorded: no name was available when the run started.";
  }
  return notRecordedBy(version);
}

/**
 * What the person running each session said when asked whether they heard NVDA speaking. It was
 * asked as the session ended: the record keeps when, but not the second the question appeared, so
 * the page says only that. A session that never started the screen reader read no pages, and wasn't
 * asked.
 */
function statements(run: RunJson): EvidenceRow[] {
  const sessions = run.sessions.filter((session) => session.environment !== null);
  if (sessions.length === 0) {
    return [{ label: "Whether NVDA was heard", value: notRecordedBy(versionOf(run)) }];
  }
  return sessions.map((session) => ({
    label:
      sessions.length === 1
        ? "Whether NVDA was heard"
        : `Whether NVDA was heard, session ${session.n}`,
    value: statementOf(session),
  }));
}

function statementOf(session: SessionRecord): string {
  const { listener, reviewer } = session;
  if (listener === undefined) {
    // voicecap began asking, and recording the computer, in the same version: a session with its
    // computer recorded was asked if it could be, and has no answer to keep.
    return session.environment?.machine === undefined
      ? notRecordedBy(versionOfSession(session))
      : "Not recorded: the session ended without an answer.";
  }
  const by = reviewer ? ` by ${reviewer.name}` : "";
  return `${ANSWERS[listener.answer]}. Asked as the session ended, and answered at ${clock(listener.answeredAt)}${by}.`;
}

/**
 * A page source with the addresses it names as the page shows them: the sitemap's, or each page
 * given with --page. A page list and a walkthrough file are named by their files, which hold no
 * address of the site.
 */
function sourceShown(source: PageSource, shown: Shown): PageSource {
  switch (source.kind) {
    case "sitemap":
      return { ...source, url: shown(source.url) };
    case "urls":
      return { ...source, urls: source.urls.map(shown) };
    case "pages":
    case "walkthrough":
      return source;
    default: {
      // A kind this version doesn't know, from a later voicecap: shown as it was recorded.
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

/**
 * The test environment, from the run's latest session with one: who ran it, the computer, then the
 * screen reader, browser, driver, voicecap, and page source as a transcript's header lists them,
 * with the page source's addresses as the page shows them.
 */
function environmentOf(
  run: RunJson,
  redact: (text: string) => string,
  shown: Shown,
): EvidenceRow[] {
  const version = versionOf(run);
  const environment = run.sessions.findLast((session) => session.environment !== null)?.environment;
  if (!environment) {
    return [{ label: "Test environment", value: notRecordedBy(version) }];
  }
  const rows: EvidenceRow[] = [
    { label: "Run by", value: ranBy(run, version) },
    ...computerRows(environment, notRecordedBy(version)),
    ...environmentLines({
      ...environment,
      pageSource: sourceShown(environment.pageSource, shown),
    })
      .filter((line) => !line.startsWith("OS: "))
      .map((line) => {
        const colon = line.indexOf(": ");
        return colon === -1
          ? { label: line, value: "" }
          : { label: line.slice(0, colon), value: redact(line.slice(colon + 2)) };
      }),
  ];
  const distinct = distinctEnvironments(run);
  const [first] = distinct;
  const last = distinct.at(-1);
  if (first && last && distinct.length > 1) {
    rows.push({
      label: "Changed during the run",
      value: redact(`${describeChanges(first, last).join("; ")}.`),
    });
  }
  return rows;
}

/** Said of a part of the computer the system wouldn't report. */
const NOT_REPORTED = "Not reported by the system";

/** The computer a session ran on, as recorded from voicecap 0.6.0 on (MachineRecord). */
function computerRows(environment: EnvironmentRecord, notRecorded: string): EvidenceRow[] {
  const { machine } = environment;
  const row = (label: string, value: (recorded: MachineRecord) => string): EvidenceRow => ({
    label,
    value: machine ? value(machine) : notRecorded,
  });
  return [
    // Every version records the operating system as one line of text; 0.6.0 on, in detail.
    {
      label: "Operating system",
      value: machine
        ? [machine.os.name, machine.os.build && `build ${machine.os.build}`, machine.os.arch]
            .filter(Boolean)
            .join(", ")
        : environment.os,
    },
    row("Processor", ({ cpu }) =>
      [
        cpu.name,
        cpu.baseMhz === null ? null : `${(cpu.baseMhz / 1000).toFixed(2)} GHz base`,
        cpu.physicalCores === null ? null : count(cpu.physicalCores, "core"),
        count(cpu.logicalProcessors, "logical processor"),
      ]
        .filter(Boolean)
        .join(", "),
    ),
    row("Memory", ({ memoryBytes }) => `${(memoryBytes / 2 ** 30).toFixed(1)} GB`),
    row("Display", ({ display }) =>
      display === null
        ? NOT_REPORTED
        : `${display.width} × ${display.height}` +
          (display.refreshHz === null ? "" : ` at ${display.refreshHz} Hz`) +
          (display.scalePercent === null ? "" : `, ${display.scalePercent}% scaling`),
    ),
    row("Browser window", ({ browserWindow }) =>
      browserWindow === null
        ? "None: a replay opens no browser"
        : `${browserWindow.width} × ${browserWindow.height}`,
    ),
    row(
      "Time zone",
      ({ timeZone, utcOffset }) => `${timeZone} (UTC${utcOffset} as the session started)`,
    ),
    row("Display language", ({ language }) => language ?? NOT_REPORTED),
    row(
      "Software",
      ({ software }) =>
        `Node.js ${software.node}, voicecap ${software.voicecap}, Guidepup ${software.guidepup ?? "not found"}, Playwright ${software.playwright ?? "not found"}`,
    ),
  ];
}

function count(amount: number, thing: string): string {
  return `${amount} ${amount === 1 ? thing : `${thing}s`}`;
}

/**
 * What a run left out did, in words that follow its id. An unsealed run is said to be from before
 * voicecap sealed runs only when its version says so: every version from 0.3.0 seals a run as it
 * completes.
 */
const LEFT_OUT: Record<LeftOutReason, (run: RunJson, processed: number) => string> = {
  replayed: () => "replayed, so it never counts as a live result",
  interrupted: (run, processed) => `interrupted after ${processed} of ${run.pages.length} pages`,
  unfinished: (run, processed) => `not finished: ${processed} of ${run.pages.length} pages`,
  unsealed: (run) =>
    beforeSeals(versionOf(run))
      ? "completed without a seal (recorded before voicecap sealed runs)"
      : "completed without a seal",
};

/** Whether a run's voicecap is older than 0.3.0, the first to seal runs. Unknown is not. */
function beforeSeals(version: string | null): boolean {
  const match = version === null ? null : /^(\d+)\.(\d+)\./.exec(version);
  return match !== null && Number(match[1]) === 0 && Number(match[2]) < 3;
}

/**
 * Every run the standing leaves out, and every run whose record couldn't be read (`unreadable`, by
 * id), oldest first, each as one line that starts with its id: "2026-09-29_1415: interrupted after
 * 1 of 7 pages", "2026-09-25_0900: its record couldn't be read".
 */
export function leftOutOf(
  standing: Standing,
  unreadable: string[] = [],
): { id: string; text: string }[] {
  const left = standing.leftOut.map(({ run, reason, processed }) => ({
    id: run.id,
    text: `${run.id}: ${LEFT_OUT[reason](run, processed)}`,
  }));
  const unread = unreadable.map((id) => ({ id, text: `${id}: its record couldn't be read` }));
  // A run's id begins with its date and time, so it orders the two lists as one.
  return [...left, ...unread].sort((a, b) => a.id.localeCompare(b.id));
}
