/**
 * The evidence behind the page: what each run it draws on recorded (its facts, its test
 * environment, and its files' fingerprints), the runs it left out with what each did, and how the
 * page says what a run's voicecap didn't record. Pure: it works from records already read.
 */
import type {
  EnvironmentRecord,
  ListenerAnswer,
  MachineRecord,
  PageStatus,
  RunJson,
  SessionRecord,
} from "../model.js";
import { describeChanges, distinctEnvironments } from "../report/compare.js";
import { environmentLines } from "../transcripts/format.js";
import { clock, longDate, names, pagePath } from "./format.js";
import { runBefore, type LeftOutReason, type Standing } from "./standing.js";

/** A line of a run's evidence: what it is, and what the record says. */
export interface EvidenceRow {
  label: string;
  value: string;
}

export interface RunEvidence {
  /** The run's record exactly as its run.json holds it: its id, its seal, and its fingerprints. */
  run: RunJson;
  /**
   * When it started and finished, its pages, how many of them the page shows from it, NVDA
   * restarts, who ran it, and the listener's statement for each session.
   */
  facts: EvidenceRow[];
  /**
   * The test environment (evidence D): who ran it, the computer, and the screen reader, browser, and
   * software, as its latest session recorded them. "Not recorded: this run used voicecap <v>." where
   * the run is from before voicecap recorded a part.
   */
  environment: EvidenceRow[];
  /** Evidence A, the event log minute by minute: no version records it yet. */
  timeline: { notRecorded: string };
  /** Evidence C, NVDA's own log checked against the transcripts: no version records it yet. */
  nvdaLog: { notRecorded: string };
  /** Every file the run's record lists, page by page: its size and SHA-256. */
  fingerprints: { page: string; file: string; bytes: number; sha256: string }[];
  /** The command that checks the originals: "npx @icjia/voicecap verify --site <site>". */
  verify: string;
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

/**
 * The evidence of each run the standing draws on, the latest first. `recordOf` gives a run's record
 * as its run.json holds it; `redact` replaces the home folder in what the page shows.
 */
export function evidenceOf(input: {
  standing: Standing;
  recordOf: (run: RunJson) => RunJson;
  site: string;
  redact: (text: string) => string;
}): RunEvidence[] {
  const { standing, site, redact } = input;
  const before = standing.latest && runBefore(standing.counted, standing.latest);
  return standing.drawnOn.toReversed().map((run) => {
    const shown = standing.pages.filter((page) => page.shown?.run === run).length;
    const notRecorded = notRecordedBy(versionOf(run));
    return {
      run: input.recordOf(run),
      facts: factsOf(run, shown, run === before),
      environment: environmentOf(run, redact),
      timeline: { notRecorded },
      nvdaLog: { notRecorded },
      fingerprints: run.pages.flatMap((page) =>
        Object.entries(page.files).map(([file, hash]) => ({
          page: pagePath(page.url),
          file,
          bytes: hash.bytes,
          sha256: hash.sha256,
        })),
      ),
      verify: `npx @icjia/voicecap verify --site ${site}`,
    };
  });
}

/** A page's status in a run, in words that follow its count. */
const PAGE_STATUS: Record<PageStatus, string> = {
  done: "transcribed",
  failed: "failed",
  skipped: "skipped",
  pending: "not reached",
};

const ANSWERS: Record<ListenerAnswer, string> = {
  all: "Yes, all of them",
  part: "Part of them",
  no: "No",
};

function factsOf(run: RunJson, shown: number, isRunBefore: boolean): EvidenceRow[] {
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
    { label: "Started", value: when(runStart(run)) },
    { label: "Finished", value: when(runEnd(run)) },
    { label: "Pages", value: statuses.length > 0 ? names(statuses) : "None" },
    { label: "Transcripts shown", value: shownHere },
    // Only the event log (evidence A) will say when NVDA was started again, and why.
    { label: "NVDA restarts", value: notRecordedBy(version) },
    { label: "Run by", value: ranBy(run, version) },
    ...statements(run),
  ];
}

/** "29 September 2026, 14:02". */
function when(time: string): string {
  return `${longDate(time)}, ${clock(time)}`;
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
 * What the person running each session said when asked whether they listened. It was asked as the
 * session ended: the record keeps when, but not the second the question appeared, so the page says
 * only that. A session that never started the screen reader read no pages, and wasn't asked.
 */
function statements(run: RunJson): EvidenceRow[] {
  const sessions = run.sessions.filter((session) => session.environment !== null);
  if (sessions.length === 0) {
    return [{ label: "The listener's statement", value: notRecordedBy(versionOf(run)) }];
  }
  return sessions.map((session) => ({
    label:
      sessions.length === 1
        ? "The listener's statement"
        : `The listener's statement, session ${session.n}`,
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
 * The test environment, from the run's latest session with one: who ran it, the computer, then the
 * screen reader, browser, driver, voicecap, and page source as a transcript's header lists them.
 */
function environmentOf(run: RunJson, redact: (text: string) => string): EvidenceRow[] {
  const version = versionOf(run);
  const environment = run.sessions.findLast((session) => session.environment !== null)?.environment;
  if (!environment) {
    return [{ label: "Test environment", value: notRecordedBy(version) }];
  }
  const rows: EvidenceRow[] = [
    { label: "Run by", value: ranBy(run, version) },
    ...computerRows(environment, notRecordedBy(version)),
    ...environmentLines(environment)
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
