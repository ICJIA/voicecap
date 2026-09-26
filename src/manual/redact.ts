import type { LogEvent } from "./nvda-log.js";

/** Replaces typed characters, and NVDA's echo of them, in redacted transcripts. */
export const REDACTED_TEXT = "[typed text redacted]";

/** Stored in the session JSON whenever redaction ran. */
export const REDACTION_NOTE =
  "Typing was redacted by a heuristic, not a guarantee. Speech right after a focus key (Tab, " +
  "Shift+Tab and the other keys in config manual.focusKeys) is treated as a focus announcement; " +
  "while the latest announcement names an editable role (config manual.editableRoles, e.g. edit, " +
  "password edit), character keys and any speech after them are replaced until focus moves again. " +
  "NVDA's 'typed word' log entries also mark the keys before them as typing. It can miss typed " +
  "text when: NVDA's phrasing isn't English; a field is reached without its role being spoken, " +
  "or by mouse click (until a typed word is logged); pasted text is read back; an error message " +
  "or a page (e.g. search results) quotes the input; a field's value is read back when focus " +
  "returns to it; autocomplete suggestions are spoken; text comes from an IME; or the typing " +
  "happens in another application. Read the clean transcript before sharing it.";

export interface GestureInfo {
  /** e.g. "kb(desktop)"; "" when the identifier has no source prefix. */
  source: string;
  /** Lowercase, sorted (NVDA doesn't fix their order: inputCore.normalizeGestureIdentifier). */
  modifiers: string[];
  /** Lowercase main key name, e.g. "downarrow", "g", "space". */
  main: string;
  isKeyboard: boolean;
}

/**
 * Parse a gesture identifier as logged by inputCore ("kb(desktop):shift+g") or as written in
 * config ("shift+tab"). Keyboard identifiers are "kb(<layout>):<modifiers>+<main key>"
 * (keyboardHandler.KeyboardInputGesture._get_identifiers); the main key is a vkCodes name
 * ("downArrow", "space", "backspace"), a lowercase letter or digit, a punctuation character, or
 * "plus" for "+".
 */
export function parseGesture(identifier: string): GestureInfo {
  const colon = identifier.indexOf(":");
  const source = colon === -1 ? "" : identifier.slice(0, colon);
  const keys = colon === -1 ? identifier : identifier.slice(colon + 1);
  const parts = keys.split("+");
  const main = (parts.pop() ?? "").toLowerCase();
  return {
    source,
    modifiers: parts
      .map((part) => part.toLowerCase())
      .filter((part) => part !== "")
      .sort(),
    main,
    isKeyboard: source === "" || source.startsWith("kb"),
  };
}

/** The key name without its source prefix, as shown in transcripts: "kb(desktop):tab" → "tab". */
export function displayGesture(identifier: string): string {
  return /^kb(\([^)]*\))?:/.test(identifier)
    ? identifier.replace(/^kb(\([^)]*\))?:/, "")
    : identifier;
}

const EDITING_KEYS = new Set([
  "space",
  "plus",
  "backspace",
  "delete",
  "numpaddecimal",
  "numpadplus",
  "numpadminus",
  "numpadmultiply",
  "numpaddivide",
]);

/**
 * Keys that type or erase text: single characters (letters, digits, punctuation), space, "plus",
 * backspace, delete, and number-pad characters, alone or with Shift. AltGr (Control+Alt) also
 * types characters on many layouts, and Control+Backspace/Delete erase a word.
 */
export function isTypingKey(info: GestureInfo): boolean {
  if (!info.isKeyboard) return false;
  const { main, modifiers } = info;
  const characterLike =
    [...main].length === 1 || EDITING_KEYS.has(main) || /^numlocknumpad\d$/.test(main);
  if (!characterLike) return false;
  const others = modifiers.filter((modifier) => modifier !== "shift");
  if (others.length === 0) return true;
  const altGr = others.length === 2 && others.includes("alt") && others.includes("control");
  const wordErase =
    others.length === 1 && others[0] === "control" && ["backspace", "delete"].includes(main);
  return altGr || wordErase;
}

export interface TranscriptEntry {
  type: "key" | "speech";
  /** The (first) log event this entry stands for. */
  event: LogEvent;
  text: string;
  redacted: boolean;
}

export interface TypingOutcome {
  /** Keys and speech in order, without typed-word entries; consecutive redactions collapsed. */
  entries: TranscriptEntry[];
  /** Character keys typed while focus was in an editable field (whether or not redacted). */
  typingDetected: number;
  /**
   * Redaction markers in the transcript that replaced keys, and that replaced speech. These count
   * collapsed runs, not characters, so they don't reveal how long the typed text was.
   */
  redactedKeystrokes: number;
  redactedSpeech: number;
}

export interface TypingOptions {
  editableRoles: readonly string[];
  focusKeys: readonly string[];
  /** Replace typing (true), or only detect it for the warning (false). */
  redact: boolean;
}

interface WorkEntry extends TranscriptEntry {
  typingKey: boolean;
  /** Speech that followed a typing key and looks like an echo of it (see isEchoLike). */
  echo: boolean;
  /** Already counted in typingDetected. */
  counted: boolean;
}

interface Counts {
  typingDetected: number;
}

/**
 * Find (and optionally redact) text typed into editable fields. See REDACTION_NOTE for the
 * heuristic and its limits.
 */
export function processTyping(events: readonly LogEvent[], options: TypingOptions): TypingOutcome {
  const editableRoles = new Set(options.editableRoles.map((role) => role.toLowerCase()));
  const focusKeys = new Set(options.focusKeys.map((key) => signature(parseGesture(key))));
  const work: WorkEntry[] = [];
  const counts: Counts = { typingDetected: 0 };
  let inEditable = false;
  let afterFocusKey = false;
  let announced = false;
  let lastKeyTyping = false;

  const redactEntry = (entry: WorkEntry) => {
    if (!options.redact) return;
    entry.redacted = true;
    entry.text = REDACTED_TEXT;
  };

  for (const event of events) {
    if (event.type === "typed-word") {
      // speech.speakTypedCharacters logs a typed word only for characters typed into the focused
      // control, so the keys before it were typing even if no editable role was announced.
      claimTypingSpan(work, counts, redactEntry);
      inEditable = true;
      continue;
    }

    if (event.type === "key") {
      const info = parseGesture(event.text);
      const entry: WorkEntry = {
        type: "key",
        event,
        text: event.text,
        redacted: false,
        typingKey: false,
        echo: false,
        counted: false,
      };
      if (focusKeys.has(signature(info))) {
        afterFocusKey = true;
        announced = false;
        lastKeyTyping = false;
        work.push(entry);
        continue;
      }
      afterFocusKey = false;
      entry.typingKey = isTypingKey(info);
      lastKeyTyping = entry.typingKey;
      if (entry.typingKey && inEditable) {
        entry.counted = true;
        counts.typingDetected += 1;
        redactEntry(entry);
      }
      work.push(entry);
      continue;
    }

    const entry: WorkEntry = {
      type: "speech",
      event,
      text: event.text,
      redacted: false,
      typingKey: false,
      echo: false,
      counted: false,
    };
    if (afterFocusKey) {
      // A focus announcement: it decides whether focus is now in an editable field.
      const editable = (event.items ?? [event.text]).some((item) =>
        editableRoles.has(item.toLowerCase()),
      );
      inEditable = announced ? inEditable || editable : editable;
      announced = true;
    } else {
      entry.echo = lastKeyTyping && isEchoLike(event);
      if (inEditable) redactEntry(entry);
    }
    work.push(entry);
  }

  const entries = collapse(work);
  const markers = (type: TranscriptEntry["type"]) =>
    entries.filter((entry) => entry.redacted && entry.type === type).length;
  return {
    entries,
    typingDetected: counts.typingDetected,
    redactedKeystrokes: markers("key"),
    redactedSpeech: markers("speech"),
  };
}

/**
 * Walk back from a typed-word entry over the keys that typed the word and their echoes. The key
 * that ended the word (space, punctuation, Enter) was logged just before the typed word.
 */
function claimTypingSpan(
  work: WorkEntry[],
  counts: Counts,
  redactEntry: (entry: WorkEntry) => void,
): void {
  let index = work.length - 1;
  const last = work[index];
  if (last?.type === "key" && !last.typingKey) index -= 1;
  for (; index >= 0; index -= 1) {
    const entry = work[index]!;
    const typingRelated = entry.redacted || (entry.type === "key" ? entry.typingKey : entry.echo);
    if (!typingRelated) break;
    if (entry.type === "key" && entry.typingKey && !entry.counted) {
      entry.counted = true;
      counts.typingDetected += 1;
    }
    redactEntry(entry);
  }
}

/** Collapse runs of redacted entries into one, so the transcript doesn't reveal how much was typed. */
function collapse(work: readonly WorkEntry[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const { type, event, text, redacted } of work) {
    if (redacted && entries.at(-1)?.redacted) continue;
    entries.push({ type, event, text, redacted });
  }
  return entries;
}

/**
 * NVDA echoes a typed character as one item: the character, its symbol name ("space", "question
 * mark"), or "cap G" (speech.speakSpelling); a typed word is also one item. Browse-mode quick
 * navigation letters (h, k, ...) instead announce an element, usually with several items, so the
 * typed-word walk-back stops there instead of redacting them.
 */
function isEchoLike(event: LogEvent): boolean {
  const items = event.items ?? [event.text];
  if (items.length !== 1) return false;
  const item = items[0]!;
  return [...item].length <= 20 && item.split(" ").length <= 3;
}

function signature(info: GestureInfo): string {
  return [...info.modifiers, info.main].join("+");
}
