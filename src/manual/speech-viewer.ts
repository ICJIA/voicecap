import { splitLines } from "./detect.js";
import { normalizeSpeechItem } from "./nvda-log.js";

export interface SpeechViewerUtterance {
  /** Text items, normalized like Guidepup's. */
  items: string[];
  /** The items joined with ", ", as in a run's transcripts. */
  text: string;
  /** 1-based line number in the capture. */
  line: number;
}

/**
 * Parse text copied from NVDA's Speech Viewer. speechViewer.appendSpeechSequence writes each
 * speech sequence (utterance) as one line, joining its text items with two spaces
 * (SPEECH_ITEM_SEPARATOR = "  ", SPEECH_SEQUENCE_SEPARATOR = "\n"). There are no timestamps and
 * no keystrokes.
 *
 * An item that itself contains two spaces in a row is split in two; Guidepup would instead
 * collapse the spaces. Blank lines (sequences without text) are skipped.
 */
export function parseSpeechViewer(text: string): SpeechViewerUtterance[] {
  const utterances: SpeechViewerUtterance[] = [];
  splitLines(text).forEach((raw, index) => {
    const items = raw
      .split(/ {2,}/)
      .map(normalizeSpeechItem)
      .filter((item) => item !== "");
    if (items.length > 0) utterances.push({ items, text: items.join(", "), line: index + 1 });
  });
  return utterances;
}
