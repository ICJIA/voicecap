import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import { inertText } from "../src/util/inert.js";

/** The characters inertText writes as an escape: all but a line break and a tab. */
const SPECIAL = /^[\p{Cc}\p{Cf}\u{2028}\u{2029}]$/u;

describe("inertText", () => {
  it("leaves plain text, a tab, and a line break as they are", () => {
    const text = "Skip to main content, link\n\tJosé, …, ⚑, 你好, 😀\n";
    expect(inertText(text)).toBe(text);
    expect(inertText("")).toBe("");
  });

  it("writes an escape sequence as text, with the escape as \\u{1b}", () => {
    expect(inertText("a\u{1b}[2Jb")).toBe("a\\u{1b}[2Jb");
    expect(inertText("Home\u{1b}]0;pwned\u{7}")).toBe("Home\\u{1b}]0;pwned\\u{7}");
  });

  // Each in the lower-case hex that walkthrough.ts's `shown` writes, with no zeros in front.
  it.each([
    ["NUL", "\u{0}", "\\u{0}"],
    ["BEL", "\u{7}", "\\u{7}"],
    ["backspace", "\u{8}", "\\u{8}"],
    ["vertical tab", "\u{b}", "\\u{b}"],
    ["form feed", "\u{c}", "\\u{c}"],
    ["a carriage return that isn't before a line feed", "\r", "\\u{d}"],
    ["ESC", "\u{1b}", "\\u{1b}"],
    ["DEL", "\u{7f}", "\\u{7f}"],
    ["NEL, a C1 control", "\u{85}", "\\u{85}"],
    ["CSI, the one-character control sequence introducer", "\u{9b}", "\\u{9b}"],
    ["a soft hyphen", "\u{ad}", "\\u{ad}"],
    ["a zero width space", "\u{200b}", "\\u{200b}"],
    ["a zero width joiner", "\u{200d}", "\\u{200d}"],
    ["a left-to-right mark", "\u{200e}", "\\u{200e}"],
    ["a right-to-left mark", "\u{200f}", "\\u{200f}"],
    ["a right-to-left override", "\u{202e}", "\\u{202e}"],
    ["a left-to-right embedding", "\u{202a}", "\\u{202a}"],
    ["a word joiner", "\u{2060}", "\\u{2060}"],
    ["a first strong isolate", "\u{2068}", "\\u{2068}"],
    ["a byte order mark", "\u{feff}", "\\u{feff}"],
    ["the line separator", "\u{2028}", "\\u{2028}"],
    ["the paragraph separator", "\u{2029}", "\\u{2029}"],
    ["a tag character, past the first 65,536", "\u{e0041}", "\\u{e0041}"],
  ])("writes %s as an escape", (_name, character, escape) => {
    expect(inertText(`a${character}b`)).toBe(`a${escape}b`);
  });

  it("leaves a symbol, an accent, a no-break space, and a variation selector as they are", () => {
    // None of them acts on a terminal, and a variation selector is a mark, not a format character.
    const text = "e\u{301} ⚑ → · © \u{a0}\u{fe0f}";
    expect(inertText(text)).toBe(text);
  });

  it("ends each CR LF as a line break, and writes any other carriage return as an escape", () => {
    expect(inertText("one\r\ntwo")).toBe("one\ntwo");
    expect(inertText("\r\n\r\n")).toBe("\n\n");
    // The first CR isn't before a line feed; the second is.
    expect(inertText("a\r\r\nb")).toBe("a\\u{d}\nb");
    // A line feed before a CR is two things: a line break, then a carriage return.
    expect(inertText("a\n\rb")).toBe("a\n\\u{d}b");
    expect(inertText("one\rtwo")).toBe("one\\u{d}two");
    expect(inertText("end\r")).toBe("end\\u{d}");
  });

  it("gives the same text when it's given its own result", () => {
    const once = inertText("a\u{1b}[2J\r\nb\r\u{202e}c\td\u{2028}e");
    expect(once).toBe("a\\u{1b}[2J\nb\\u{d}\\u{202e}c\td\\u{2028}e");
    expect(inertText(once)).toBe(once);
  });

  it("writes a half of a surrogate pair, which Node would show as U+FFFD, as it is", () => {
    const lone = `a${String.fromCharCode(0xd800)}b`;
    expect(inertText(lone)).toBe(lone);
  });

  // The class is the spec's: every control character (Cc), format character (Cf), and the line and
  // paragraph separators, but the line feed and the tab. Checked on every code point, so a format
  // character past the first 65,536 (the tag characters, the musical symbols' formatting) is in it.
  it("writes each control, format, and separator character as its escape, and changes no other", () => {
    const wrong: string[] = [];
    for (let code = 0; code <= 0x10ffff; code++) {
      // A half of a surrogate pair is no character of its own.
      if (code >= 0xd800 && code <= 0xdfff) continue;
      const character = String.fromCodePoint(code);
      const written = SPECIAL.test(character) && character !== "\n" && character !== "\t";
      const expected = written ? `\\u{${code.toString(16)}}` : character;
      if (inertText(character) !== expected) wrong.push(`U+${code.toString(16)}`);
    }
    expect(wrong).toEqual([]);
  });

  describe("a long text", () => {
    const LENGTH = 300_000;
    // The patterns look at one or two characters at a time, so any text is read in a time that
    // grows with its length: milliseconds here. A pattern that went back over what it had read, on
    // a long run of one kind of character, would take tens of seconds.
    const LIMIT_MS = 5_000;

    it.each<[name: string, text: string, expected: (text: string) => string]>([
      ["of carriage returns", "\r".repeat(LENGTH), () => "\\u{d}".repeat(LENGTH)],
      ["of CR LF pairs", "\r\n".repeat(LENGTH / 2), () => "\n".repeat(LENGTH / 2)],
      ["of line feeds", "\n".repeat(LENGTH), (text) => text],
      ["of escapes", "\u{1b}".repeat(LENGTH), () => "\\u{1b}".repeat(LENGTH)],
      ["of zero width joiners", "\u{200d}".repeat(LENGTH), () => "\\u{200d}".repeat(LENGTH)],
      ["of tag characters", "\u{e0041}".repeat(LENGTH), () => "\\u{e0041}".repeat(LENGTH)],
      ["of letters", "a".repeat(LENGTH), (text) => text],
      [
        "of all of them",
        "\r\n\u{1b}x\r".repeat(LENGTH / 4),
        () => "\n\\u{1b}x\\u{d}".repeat(LENGTH / 4),
      ],
    ])(
      "is read in linear time: %s",
      (_name, text, expected) => {
        const began = performance.now();
        const written = inertText(text);
        const took = performance.now() - began;
        expect(took).toBeLessThan(LIMIT_MS);
        expect(written).toBe(expected(text));
      },
      60_000,
    );
  });
});
