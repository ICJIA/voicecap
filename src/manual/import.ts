import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { VoicecapConfig } from "../config/schema.js";
import type { ManualEntry, ManualInputFormat, ManualSessionJson } from "../model.js";
import { manualSessionDir } from "../run/paths.js";
import { writeFileAtomic } from "../util/atomic-write.js";
import { UsageError, errorMessage } from "../util/errors.js";
import { sealOf, sha256 } from "../util/hash.js";
import { silentLogger, type Logger } from "../util/log.js";
import { isoLocal, localDate } from "../util/time.js";
import { voicecapVersion } from "../util/version.js";
import { decodeManualInput, detectManualFormat } from "./detect.js";
import {
  NO_IO_ENTRIES_MESSAGE,
  parseNvdaLog,
  parseTimeOfDay,
  selectWindow,
  type LogEvent,
} from "./nvda-log.js";
import { REDACTED_TEXT, REDACTION_NOTE, displayGesture, processTyping } from "./redact.js";
import { parseSpeechViewer } from "./speech-viewer.js";

/** Printed on every log import. */
export const LOG_PRIVACY_WARNING =
  "NVDA logs at Input/output level record every keystroke, including text typed into form and " +
  "password fields. Treat this log, and any raw copy voicecap keeps of it, as sensitive; " +
  "--redact-typing removes the typing it can detect.";

export interface ImportManualSessionOptions {
  /** The site's folder in the transcripts home. */
  outDir: string;
  /** Speech Viewer text or an NVDA log (nvda.log / nvda-old.log). */
  file: string;
  page: { url: string; key: string; slug: string };
  /** Already resolved by the caller (--reviewer, VOICECAP_REVIEWER, git, config). */
  reviewer: string;
  config: VoicecapConfig;
  /** Logs only: import from this time of day (HH:MM or HH:MM:SS). */
  from?: string | null;
  /** Logs only: import up to this time of day. */
  to?: string | null;
  /** Session date, YYYY-MM-DD. Defaults to the file's modification date. */
  date?: string | null;
  redactTyping?: boolean;
  /** Keep the raw copy even with --redact-typing. */
  keepRaw?: boolean;
  /** Don't copy the original; its SHA-256 is still recorded. */
  noRaw?: boolean;
  logger?: Logger;
  now?: Date;
}

export interface ManualImportResult {
  session: ManualSessionJson;
  /** Absolute paths of the files written. */
  files: { json: string; txt: string; raw: string | null };
}

/**
 * Import a hands-on NVDA session into its own dated folder (manualSessionDir): a clean transcript
 * (session.txt), the entries with metadata (session.json), and the unmodified original under raw/
 * (named after its format, so it never ends in .log, which many repositories ignore). Doesn't
 * regenerate the report.
 */
export async function importManualSession(
  options: ImportManualSessionOptions,
): Promise<ManualImportResult> {
  const logger = options.logger ?? silentLogger;
  const now = options.now ?? new Date();
  if (options.keepRaw && options.noRaw) {
    throw new UsageError("--keep-raw and --no-raw can't be used together.");
  }
  const dateOption = options.date ? parseDateOption(options.date) : null;
  const from = options.from ? parseTimeOfDay(options.from, "--from") : null;
  const to = options.to ? parseTimeOfDay(options.to, "--to") : null;

  let bytes: Buffer;
  let modified: Date;
  try {
    bytes = await readFile(options.file);
    modified = (await stat(options.file)).mtime;
  } catch (error) {
    throw new UsageError(`Can't read ${options.file}: ${errorMessage(error)}`, { cause: error });
  }
  const { text } = decodeManualInput(bytes);
  const format = detectManualFormat(text);
  const warnings: string[] = [];

  const parsed =
    format === "nvda-log"
      ? readLog(text, { from, to, dateOption, modified, options, logger, warnings })
      : readSpeechViewer(text, { from, to, dateOption, modified, options, logger });

  const { id, dir } = allocateManualSession(options.outDir, parsed.baseId, options.page.slug);
  const rawName = `${format}.txt`;
  let raw: ManualSessionJson["input"]["raw"];
  if (options.noRaw) {
    raw = { kept: false, reason: "no-raw" };
  } else if (options.redactTyping && !options.keepRaw) {
    raw = { kept: false, reason: "withheld-for-privacy" };
  } else {
    raw = { kept: true, path: `raw/${rawName}` };
    if (options.redactTyping) {
      const message =
        `--keep-raw keeps the unredacted log (raw/${rawName}) next to the redacted transcript, ` +
        "which defeats the redaction. Don't commit or share it.";
      logger.warn(message);
      warnings.push(message);
    }
  }

  const session: ManualSessionJson = {
    schemaVersion: 1,
    voicecap: voicecapVersion(),
    id,
    page: { url: options.page.url, key: options.page.key, slug: options.page.slug },
    input: {
      format,
      fileName: path.basename(options.file),
      sha256: sha256(bytes),
      bytes: bytes.length,
      raw,
    },
    session: parsed.session,
    nvdaVersion: parsed.nvdaVersion,
    importedAt: isoLocal(now),
    reviewer: options.reviewer,
    redaction: parsed.redaction,
    warnings,
    entries: parsed.entries,
  };

  const txt = renderManualSessionTxt(session);
  const txtBytes = Buffer.from(txt, "utf8");
  session.transcript = { sha256: sha256(txtBytes), bytes: txtBytes.length };
  session.seal = sealOf(session);

  const files = {
    json: path.join(dir, "session.json"),
    txt: path.join(dir, "session.txt"),
    raw: raw.kept ? path.join(dir, "raw", rawName) : null,
  };
  // The JSON is written last: listManualSessions only sees complete imports.
  if (files.raw) await writeFileAtomic(files.raw, bytes);
  await writeFileAtomic(files.txt, txt);
  await writeFileAtomic(files.json, `${JSON.stringify(session, null, 2)}\n`);
  return { session, files };
}

interface ReadContext {
  from: ReturnType<typeof parseTimeOfDay> | null;
  to: ReturnType<typeof parseTimeOfDay> | null;
  dateOption: string | null;
  modified: Date;
  options: ImportManualSessionOptions;
  logger: Logger;
}

interface ReadResult {
  baseId: string;
  session: ManualSessionJson["session"];
  nvdaVersion: string | null;
  redaction: ManualSessionJson["redaction"];
  entries: ManualEntry[];
}

function readLog(text: string, context: ReadContext & { warnings: string[] }): ReadResult {
  const { from, to, dateOption, modified, options, logger, warnings } = context;
  const parsed = parseNvdaLog(text);
  warnings.push(...parsed.warnings);
  const isTranscribed = (event: LogEvent) => event.type === "key" || event.type === "speech";
  if (!parsed.events.some(isTranscribed)) throw new UsageError(NO_IO_ENTRIES_MESSAGE);
  logger.warn(LOG_PRIVACY_WARNING);

  const selected = selectWindow(parsed.events, parsed.startMs ?? 0, from, to);
  const inWindow = new Set(selected);
  const shown = selected.filter(isTranscribed);
  const first = shown[0];
  const last = shown.at(-1);
  if (!first || !last) {
    throw new UsageError(
      `The log has no input or speech between ${from?.text ?? "its start"} and ${to?.text ?? "its end"}.`,
    );
  }

  // Log timestamps are times of day only (logHandler.Formatter.formatTime). Anchor them to a date:
  // --date is the session's start date; the modification date is the date of the log's last entry.
  let dayZero: string;
  if (dateOption) {
    dayZero = addDays(dateOption, -first.day);
  } else {
    dayZero = addDays(localDate(modified), -parsed.crossings);
    logger.info(
      `Session date ${addDays(dayZero, first.day)}: from the file's modification time ` +
        `(${isoLocal(modified)}), which marks the end of the log. If the file was copied or ` +
        "edited since, import it again with --date YYYY-MM-DD.",
    );
  }
  const at = (event: LogEvent) => `${addDays(dayZero, event.day)}T${event.time}`;

  const redact = Boolean(options.redactTyping);
  // Track focus across the whole log, then apply the --from/--to window: a field entered before
  // the window starts is still a field, and what's typed into it must still be redacted.
  const typingOptions = {
    editableRoles: options.config.manual.editableRoles,
    focusKeys: options.config.manual.focusKeys,
  };
  const detected = processTyping(parsed.events, { ...typingOptions, redact: true });
  const typing = redact
    ? detected
    : processTyping(parsed.events, { ...typingOptions, redact: false });
  const entries = typing.entries.filter((entry) => inWindow.has(entry.event));
  const typingInWindow = detected.entries.some(
    (entry) => entry.redacted && inWindow.has(entry.event),
  );
  if (!redact && typingInWindow) {
    const message =
      "This log seems to contain text typed into form fields, which may include passwords or " +
      "personal data. The clean transcript and the raw copy keep it. Import it again with " +
      "--redact-typing, and never commit an unredacted log.";
    logger.warn(message);
    warnings.push(message);
  }
  const markers = (type: "key" | "speech") =>
    entries.filter((entry) => entry.redacted && entry.type === type).length;

  return {
    baseId: `${addDays(dayZero, first.day)}_${first.time.slice(0, 2)}${first.time.slice(3, 5)}`,
    session: {
      date: addDays(dayZero, first.day),
      dateSource: dateOption ? "option" : "file-modified",
      start: at(first),
      end: at(last),
      from: from?.text ?? null,
      to: to?.text ?? null,
      crossesMidnight: last.day > first.day,
    },
    nvdaVersion: parsed.nvdaVersion,
    redaction: {
      applied: redact,
      keystrokes: markers("key"),
      speech: markers("speech"),
      note: redact ? REDACTION_NOTE : null,
    },
    entries: entries.map((entry) => ({
      at: at(entry.event),
      type: entry.type,
      text: entry.text,
      ...(entry.redacted ? { redacted: true } : {}),
    })),
  };
}

function readSpeechViewer(text: string, context: ReadContext): ReadResult {
  const { from, to, dateOption, modified, options, logger } = context;
  const file = path.basename(options.file);
  if (from || to) {
    throw new UsageError(
      `--from and --to apply only to NVDA logs, and ${file} looks like Speech Viewer text (it has no timestamps).`,
    );
  }
  if (options.redactTyping) {
    throw new UsageError(
      `--redact-typing needs the keystrokes in an NVDA log, and ${file} looks like Speech Viewer ` +
        "text. If it contains typed text, remove it by hand before importing.",
    );
  }
  const utterances = parseSpeechViewer(text);
  if (utterances.length === 0) throw new UsageError(`${file} contains no speech to import.`);
  const date = dateOption ?? localDate(modified);
  if (!dateOption) {
    logger.info(
      `Session date ${date}: from the file's modification time (${isoLocal(modified)}). If the ` +
        "file was copied or edited since, import it again with --date YYYY-MM-DD.",
    );
  }
  const hhmm = `${pad(modified.getHours())}${pad(modified.getMinutes())}`;
  return {
    baseId: `${date}_${hhmm}`,
    session: {
      date,
      dateSource: dateOption ? "option" : "file-modified",
      start: null,
      end: null,
      from: null,
      to: null,
      crossesMidnight: false,
    },
    nvdaVersion: null,
    redaction: { applied: false, keystrokes: 0, speech: 0, note: null },
    entries: utterances.map((utterance) => ({ at: null, type: "speech", text: utterance.text })),
  };
}

const FORMAT_LABEL: Record<ManualInputFormat, string> = {
  "nvda-log": "NVDA log",
  "speech-viewer": "Speech Viewer capture",
};

/**
 * The clean transcript: a header block ("# " lines) so the file stands alone, a blank line, then
 * for logs each keystroke (in brackets) followed by what NVDA said in response, with times and a
 * marker line whenever the date changes; for Speech Viewer, one utterance per line.
 */
export function renderManualSessionTxt(session: ManualSessionJson): string {
  const { input, session: when, redaction } = session;
  const isLog = input.format === "nvda-log";
  const raw = input.raw.kept
    ? input.raw.path
    : input.raw.reason === "no-raw"
      ? "not kept (--no-raw)"
      : "withheld for privacy (--redact-typing)";
  const keys = session.entries.filter((entry) => entry.type === "key").length;
  const speech = session.entries.length - keys;
  const header = [
    `voicecap manual session: ${FORMAT_LABEL[input.format]}`,
    `Page: ${session.page.url}`,
    `Input: ${input.fileName} (${FORMAT_LABEL[input.format]}, ${input.bytes} bytes, sha256 ${input.sha256})`,
    `Raw copy: ${raw}`,
    `Session date: ${when.date} (${when.dateSource === "option" ? "from --date" : "from the file's modification time"})`,
    isLog
      ? `Session: ${when.start ?? "?"} to ${when.end ?? "?"}${when.crossesMidnight ? " (crosses midnight)" : ""}`
      : "Session: no timestamps (Speech Viewer)",
    ...(isLog
      ? [
          `Window: ${when.from || when.to ? `${when.from ?? "start"} to ${when.to ?? "end"}` : "whole log"}`,
        ]
      : []),
    `NVDA: ${session.nvdaVersion ?? "unknown"}`,
    `Imported: ${session.importedAt} by ${session.reviewer}`,
    `Redaction: ${
      redaction.applied
        ? `applied (${redaction.keystrokes} keystroke and ${redaction.speech} speech markers; heuristic, see the JSON's redaction.note)`
        : "not applied"
    }`,
    isLog ? `Entries: ${keys} keystrokes, ${speech} speech` : `Entries: ${speech} utterances`,
    `Warnings: ${session.warnings.length === 0 ? "none" : session.warnings.length}`,
  ].map((line) => `# ${line}`);

  const body: string[] = [];
  if (isLog) {
    let date = "";
    for (const entry of session.entries) {
      const [day = "", time = ""] = (entry.at ?? "").split("T");
      if (day !== date) {
        body.push(`-- ${day} --`);
        date = day;
      }
      if (entry.type === "key") {
        body.push(`${time}  ${entry.redacted ? REDACTED_TEXT : `[${displayGesture(entry.text)}]`}`);
      } else {
        body.push(`${time}      ${entry.text}`);
      }
    }
  } else {
    body.push(...session.entries.map((entry) => entry.text));
  }
  return `${[...header, "", ...body].join("\n")}\n`;
}

/**
 * A free folder for a hands-on session: baseId's folder (manualSessionDir), or baseId-2, baseId-3,
 * ... for the first one that doesn't exist yet. A second import of the same session (same page,
 * same start time) gets its own folder instead of overwriting the first.
 */
export function allocateManualSession(
  siteDir: string,
  baseId: string,
  slug: string,
): { id: string; dir: string } {
  for (let n = 1; ; n += 1) {
    const id = n === 1 ? baseId : `${baseId}-${n}`;
    const dir = manualSessionDir(siteDir, id, slug);
    if (!existsSync(dir)) return { id, dir };
  }
}

function parseDateOption(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return value.trim();
  }
  throw new UsageError(`--date must be a date as YYYY-MM-DD (got "${value}").`);
}

/** Calendar arithmetic on YYYY-MM-DD, independent of time zones and daylight saving. */
function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
