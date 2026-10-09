/**
 * The sentences of a run's part on NVDA's own log that are worked out from the check's results: the
 * three tiles, the lists of lines that differ, how much speech the check left out, and the steps that
 * weren't checked, each group with why. Both copies say them from here, so they can't say different
 * things (the page sets the tiles' numbers large; the Word copy says each tile as a line). What no
 * result changes is in text.ts (`NVDA_LOG_TEXT`). Each is a string, with no markup, and nothing
 * escaped. Pure.
 */
import { dateAndTime, count } from "./format.js";
import type { NvdaLogChecked } from "./run-evidence.js";
import type { NotChecked } from "./run-log-check.js";
import { NVDA_LOG_TEXT } from "./text.js";

/** Why some steps weren't checked, with no full stop: the run's own words, where its log gives some. */
function becauseOf({ why, detail }: NotChecked): string {
  if (why !== "reason") return NVDA_LOG_TEXT.because[why];
  const own = (detail ?? "").trim().replace(/[\s.]+$/, "");
  return own === "" ? NVDA_LOG_TEXT.because.none : own;
}

/**
 * Some steps that weren't checked, as a sentence: how many, the NVDA session they were read in when
 * they belong to one (by when it started), and why.
 */
export function notCheckedLine(item: NotChecked): string {
  const when = item.from === null ? null : dateAndTime(item.from);
  return NVDA_LOG_TEXT.notChecked(item.steps, when, becauseOf(item));
}

/**
 * What the part says when no step was checked at all: that the run kept no copy (the plan's
 * sentence), or that its copies aren't as it recorded them, when that is why for every group; one
 * sentence for any other single reason; and, for mixed reasons, that no step could be checked, then
 * each group's own. A run with no step to check says that.
 */
export function nothingCheckedLine(items: readonly NotChecked[]): string {
  const [first] = items;
  if (first === undefined) return NVDA_LOG_TEXT.noSteps;
  const alike = items.every(({ why }) => why === first.why);
  if (alike && first.why === "none") return NVDA_LOG_TEXT.noCopy;
  if (alike && first.why !== "reason") return NVDA_LOG_TEXT.notShown(becauseOf(first));
  return [NVDA_LOG_TEXT.noneChecked, ...items.map(notCheckedLine)].join(" ");
}

/**
 * What a run's part on NVDA's own log says of a check that was made, in the words both copies use:
 * the three tiles, that every line agrees when both lists are empty, the lists of the lines that
 * differ (none that is empty), how much speech the check left out, and the steps that weren't
 * checked. A line that differs is where it is, and its words as the log or the transcript has them.
 */
export interface NvdaLogWords {
  tiles: { big: string; label: string }[];
  /** "Every line agrees.", and, when some steps had no words, that. Null when a list has a line. */
  same: string | null;
  lists: { title: string; lines: { where: string; words: string }[] }[];
  outside: string;
  notChecked: string[];
}

export function nvdaLogWords(part: NvdaLogChecked): NvdaLogWords {
  const { tiles, lists, where, same, noWords, outside } = NVDA_LOG_TEXT;
  const asLines = (lines: NvdaLogChecked["onlyInLog"]) =>
    lines.map((line) => ({ where: where(line.page, line.pass, line.step), words: line.text }));
  const differing = [
    { title: lists.onlyInLog, lines: asLines(part.onlyInLog) },
    { title: lists.onlyInTranscripts, lines: asLines(part.onlyInTranscripts) },
  ].filter(({ lines }) => lines.length > 0);
  // With both lists empty, the lines the log lacks are steps that had no words, in the transcripts
  // and in the log alike: they are not in the second tile, and there's nothing to list for them.
  const empty = part.transcriptLines - part.logLines;
  return {
    tiles: [
      { big: count(part.transcriptLines), label: tiles.transcripts(part.transcriptLines) },
      { big: count(part.logLines), label: tiles.inLog(part.logLines) },
      { big: count(part.agree), label: tiles.agree(part.agree) },
    ],
    same: differing.length > 0 ? null : [same, ...(empty > 0 ? [noWords(empty)] : [])].join(" "),
    lists: differing,
    outside: outside(part.outside),
    notChecked: part.notChecked.map(notCheckedLine),
  };
}
