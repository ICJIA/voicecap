import type {
  DriverCommand,
  EnvironmentRecord,
  PageSource,
  PassName,
  StepRecord,
  StopReason,
  TranscriptJson,
} from "../model.js";
import { describePageUrls } from "../pages/describe.js";
import { sha256 } from "../util/hash.js";
import { formatDuration } from "../util/time.js";

/** The command each pass repeats. Other commands (setup steps) are labeled in the TXT body. */
export const MAIN_COMMAND: Record<PassName, DriverCommand> = {
  read: "nextLine",
  headings: "nextHeading",
  tab: "nextFocusable",
};

const COMMAND_LABEL: Record<DriverCommand, string> = {
  toTop: "to top",
  toBottom: "to bottom",
  nextLine: "next line",
  nextHeading: "next heading",
  nextFocusable: "tab",
};

const STOP_REASON_TEXT: Record<StopReason, string> = {
  "end-reached": "end reached",
  "no-next-heading": "no next heading",
  "left-document": "left the document",
  "repeat-limit": "repeat limit",
  "step-cap": "step cap",
  timeout: "timeout",
  error: "error",
};

/** Written for a step where the screen reader said nothing, so line N is always step N. */
export const NO_SPEECH = "[no speech]";

export function stopReasonText(reason: StopReason): string {
  return STOP_REASON_TEXT[reason];
}

/** One TXT body line: what was said, on one line, with setup steps labeled ("[to top] ..."). */
export function stepLine(step: StepRecord, pass: PassName): string {
  const text = step.spoken.replace(/\s*[\r\n]+\s*/g, " ").trim();
  const shown = text === "" ? NO_SPEECH : text;
  return step.command === MAIN_COMMAND[pass] ? shown : `[${COMMAND_LABEL[step.command]}] ${shown}`;
}

export function bodyLines(transcript: Pick<TranscriptJson, "steps" | "pass">): string[] {
  return transcript.steps.map((step) => stepLine(step, transcript.pass));
}

/** SHA-256 of a TXT body: the transcript's content without its header (which changes every run). */
export function contentSha256(lines: readonly string[]): string {
  return sha256(lines.map((line) => `${line}\n`).join(""));
}

/**
 * A TXT transcript: a header block (every line starts with "# ") so the file stands alone as
 * evidence, one blank line, then one line per step for skimming and diffing.
 */
export function renderTranscriptTxt(transcript: TranscriptJson): string {
  const header = headerLines(transcript).map((line) => `# ${line}`);
  return `${[...header, "", ...bodyLines(transcript)].join("\n")}\n`;
}

/** The step lines of a TXT transcript, without the header block. Tolerates CRLF line endings. */
export function extractBody(txt: string): string[] {
  const lines = txt.replace(/\r\n?/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const blank = lines.indexOf("");
  return blank === -1 ? lines : lines.slice(blank + 1);
}

export function headerLines(transcript: TranscriptJson): string[] {
  const { page, environment: env } = transcript;
  const lines = [`voicecap transcript: ${transcript.pass} pass`];
  if (transcript.replayed) {
    lines.push(`REPLAYED from ${env.replay?.from ?? "a recording"}: not a live NVDA session`);
  }
  lines.push(
    `Page: ${page.url}`,
    `Final URL: ${page.finalUrl}`,
    `Label: ${oneLine(page.label)}`,
    `Template: ${oneLine(page.template)}`,
    `Notes: ${oneLine(page.notes)}`,
    `Run: ${transcript.run} (started ${env.runStartedAt})`,
    `Captured: ${transcript.capturedAt}`,
    `Steps: ${transcript.stepCount} (stopped: ${stopReasonText(transcript.stopReason)})`,
    `Duration: ${formatDuration(transcript.durationMs)}`,
    `Errors: ${list(transcript.errors)}`,
    `Warnings: ${list(transcript.warnings)}`,
    ...environmentLines(env),
  );
  return lines;
}

/** Where the run's pages came from, as the header's "Page source" line says it. */
function describePageSource(source: PageSource): string {
  switch (source.kind) {
    case "sitemap":
      return `sitemap ${source.url}`;
    case "pages":
      return `page list ${source.file} (sha256 ${source.sha256})`;
    case "walkthrough":
      return `walkthrough ${source.file} from run ${source.run} (sha256 ${source.sha256})`;
    case "urls":
      return describePageUrls(source.urls);
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

/** The environment record as header lines; also used by the report. */
export function environmentLines(env: EnvironmentRecord): string[] {
  const source = describePageSource(env.pageSource);
  const reader = env.screenReader
    ? `${env.screenReader.name} ${env.screenReader.version} (build ${env.screenReader.build ?? "unknown"}, language ${env.screenReader.language ?? "unknown"})`
    : "none";
  const driver = env.replay
    ? `${env.driver.name} ${env.driver.version} (replaying ${env.replay.sourceDriver} run ${env.replay.sourceRun}; capture: ${env.capture})`
    : `${env.driver.name} ${env.driver.version} (capture: ${env.capture})`;
  return [
    `Page source: ${source}`,
    `Driver: ${driver}`,
    `Screen reader: ${reader}`,
    `Browser: ${env.browser ? `${env.browser.name} ${env.browser.version}` : "none"}`,
    `OS: ${env.os}`,
    `voicecap: ${env.voicecap.version} (config sha256 ${env.voicecap.configSha256})`,
    ...settingsLines(env.screenReader?.name ?? "Screen reader", env.screenReaderSettings),
  ];
}

/** Settings sections first in this order; any others follow alphabetically. */
const SETTINGS_ORDER = ["speech", "documentFormatting", "virtualBuffers", "keyboard"];

function settingsLines(readerName: string, settings: Record<string, unknown>): string[] {
  const rank = (key: string) => {
    const index = SETTINGS_ORDER.indexOf(key);
    return index === -1 ? SETTINGS_ORDER.length : index;
  };
  const sections = Object.keys(settings).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  if (sections.length === 0) return [`${readerName} settings: none recorded`];
  return sections.map((section) => {
    const pairs = flatten(settings[section]);
    return `${readerName} ${section}: ${pairs.length > 0 ? pairs.join(", ") : "(empty)"}`;
  });
}

function flatten(value: unknown, prefix = ""): string[] {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value)
      .sort()
      .flatMap((key) =>
        flatten((value as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key),
      );
  }
  const rendered = JSON.stringify(value) ?? "undefined";
  return [prefix ? `${prefix}=${rendered}` : rendered];
}

/**
 * A field on one line: each run of spaces that holds a line break becomes one space, then the ends
 * are trimmed; "-" for nothing. Each run is found once, so the time is linear in the text's length.
 * A single pattern for a line break with the spaces around it searches again from each space of a
 * run that has no line break: a label of 150,000 spaces took seconds that way, and a walkthrough
 * file, which can come from anyone, can hold millions.
 */
function oneLine(value: string | undefined): string {
  const text = (value ?? "").replace(/\s+/g, (run) => (/[\r\n]/.test(run) ? " " : run)).trim();
  return text === "" ? "-" : text;
}

function list(items: readonly string[]): string {
  return items.length === 0 ? "none" : items.map((item) => oneLine(item)).join("; ");
}
