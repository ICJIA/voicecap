/**
 * A tokenizer for the Python repr of a speech sequence, as NVDA logs it:
 *
 *   Speaking [CancellableSpeech (still valid), LangChangeCommand ('en_US'), 'Search this site', 'edit']
 *
 * (speech.speech.speak: `log.io("Speaking %r" % speechSequence)`). Items are str literals or
 * speech command objects. The command reprs come from speech/commands.py and eventHandler.py, e.g.
 * `LangChangeCommand ('en_US')`, `CharacterModeCommand(True)`, `EndUtteranceCommand()`,
 * `BreakCommand(time=100)`, `PitchCommand(offset=30)`, `CallbackCommand(name=...)`,
 * `BeepCommand(440, 50, left=50, right=50)`, `CancellableSpeech (still valid, devInfo< ... >)`,
 * and Python's default `<speech.commands.ConfigProfileTriggerCommand object at 0x...>`.
 */

export type ReprItem = { kind: "string"; value: string } | { kind: "object"; text: string };

export class ReprParseError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
    this.name = "ReprParseError";
  }
}

const CLOSERS: Record<string, string> = { "(": ")", "[": "]", "{": "}", "<": ">" };

/** Parse `[item, item, ...]`. Throws ReprParseError on malformed input. */
export function parseReprList(text: string): ReprItem[] {
  let i = skipSpace(text, 0);
  if (text[i] !== "[") throw new ReprParseError("expected '['", i);
  i = skipSpace(text, i + 1);
  const items: ReprItem[] = [];
  if (text[i] === "]") return items;
  for (;;) {
    const start = i;
    const literal = matchStringStart(text, i);
    if (literal) {
      const { value, end } = readString(text, literal.quoteAt, literal.raw);
      items.push({ kind: "string", value });
      i = end;
    } else {
      i = skipObject(text, i);
      const objectText = text.slice(start, i).trim();
      if (objectText === "") throw new ReprParseError("empty item", start);
      items.push({ kind: "object", text: objectText });
    }
    i = skipSpace(text, i);
    if (text[i] === ",") {
      i = skipSpace(text, i + 1);
      // Python never emits a trailing comma in a list repr, but tolerate one.
      if (text[i] === "]") return items;
      continue;
    }
    if (text[i] === "]") return items;
    throw new ReprParseError(`expected ',' or ']' but found ${describe(text[i])}`, i);
  }
}

/** The text items of a repr list, in order; command objects are dropped. */
export function reprStrings(text: string): string[] {
  return parseReprList(text).flatMap((item) => (item.kind === "string" ? [item.value] : []));
}

/**
 * Best-effort fallback for a malformed or truncated repr: every quoted string, in order. Quoted
 * arguments of command objects (e.g. the 'en_US' in LangChangeCommand ('en_US')) are included
 * too, so use this only when parseReprList throws.
 */
export function scavengeStrings(text: string): string[] {
  const values: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      try {
        const { value, end } = readString(text, i, false);
        values.push(value);
        i = end;
        continue;
      } catch {
        break;
      }
    }
    i += 1;
  }
  return values;
}

function skipSpace(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i]!)) i += 1;
  return i;
}

/** A string literal starts here: optional prefix letters (r, b, u, f), then a quote. */
function matchStringStart(text: string, i: number): { quoteAt: number; raw: boolean } | null {
  let j = i;
  let raw = false;
  while (j < text.length && j - i < 2 && /[rRbBuUfF]/.test(text[j]!)) {
    if (text[j] === "r" || text[j] === "R") raw = true;
    j += 1;
  }
  const ch = text[j];
  if (ch === "'" || ch === '"') return { quoteAt: j, raw };
  return null;
}

function readString(text: string, quoteAt: number, raw: boolean): { value: string; end: number } {
  const quote = text[quoteAt]!;
  let out = "";
  let i = quoteAt + 1;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === quote) return { value: out, end: i + 1 };
    if (ch !== "\\") {
      out += ch;
      i += 1;
      continue;
    }
    const next = text[i + 1];
    if (next === undefined) break;
    if (raw) {
      out += ch + next;
      i += 2;
      continue;
    }
    const escaped = readEscape(text, i);
    out += escaped.value;
    i = escaped.end;
  }
  throw new ReprParseError("unterminated string literal", quoteAt);
}

const SIMPLE_ESCAPES: Record<string, string> = {
  "\\": "\\",
  "'": "'",
  '"': '"',
  a: "\x07",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
  "\n": "",
};

/** One escape sequence starting at text[i] === "\\". Unknown escapes keep the backslash, as Python does. */
function readEscape(text: string, i: number): { value: string; end: number } {
  const kind = text[i + 1]!;
  const simple = SIMPLE_ESCAPES[kind];
  if (simple !== undefined) return { value: simple, end: i + 2 };
  const hexLength = kind === "x" ? 2 : kind === "u" ? 4 : kind === "U" ? 8 : 0;
  if (hexLength > 0) {
    const hex = text.slice(i + 2, i + 2 + hexLength);
    if (hex.length === hexLength && /^[0-9a-fA-F]+$/.test(hex)) {
      const codePoint = Number.parseInt(hex, 16);
      if (codePoint <= 0x10ffff)
        return { value: String.fromCodePoint(codePoint), end: i + 2 + hexLength };
    }
    throw new ReprParseError(`invalid \\${kind} escape`, i);
  }
  const octal = /^[0-7]{1,3}/.exec(text.slice(i + 1, i + 4));
  if (octal) {
    return {
      value: String.fromCodePoint(Number.parseInt(octal[0], 8)),
      end: i + 1 + octal[0].length,
    };
  }
  return { value: `\\${kind}`, end: i + 2 };
}

/**
 * Skip a command object's repr up to the next top-level ',' or ']', honoring nested brackets
 * (including the angle brackets of default reprs and CancellableSpeech's devInfo<...>) and
 * quoted strings inside it.
 */
function skipObject(text: string, i: number): number {
  const stack: string[] = [];
  while (i < text.length) {
    const ch = text[i]!;
    if (stack.length === 0 && (ch === "," || ch === "]")) return i;
    if (ch === "'" || ch === '"') {
      i = readString(text, i, false).end;
      continue;
    }
    const closer = CLOSERS[ch];
    if (closer !== undefined) {
      stack.push(closer);
    } else if (ch === stack.at(-1)) {
      stack.pop();
    } else if (ch === ")" || ch === "}" || (ch === "]" && stack.length > 0)) {
      throw new ReprParseError(`unbalanced ${describe(ch)}`, i);
    }
    i += 1;
  }
  throw new ReprParseError("unterminated list", i);
}

function describe(ch: string | undefined): string {
  return ch === undefined ? "end of text" : `'${ch}'`;
}
