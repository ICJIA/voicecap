import { describe, expect, it } from "vitest";

import {
  ReprParseError,
  parseReprList,
  reprStrings,
  scavengeStrings,
} from "../src/manual/python-repr.js";

describe("parseReprList", () => {
  it("keeps string items in order and drops NVDA speech command objects", () => {
    const repr =
      "[CancellableSpeech (still valid), LangChangeCommand ('en_US'), 'Search this site', " +
      "'edit', BreakCommand(time=100), PitchCommand(offset=30), 'blank', PitchCommand(), " +
      "CharacterModeCommand(True), EndUtteranceCommand(), CallbackCommand(name=say-all:next), " +
      "BeepCommand(440, 50, left=50, right=50), SuppressUnicodeNormalizationCommand(True)]";
    expect(reprStrings(repr)).toEqual(["Search this site", "edit", "blank"]);
    const items = parseReprList(repr);
    expect(items.filter((item) => item.kind === "object")).toHaveLength(10);
    expect(items[1]).toEqual({ kind: "object", text: "LangChangeCommand ('en_US')" });
  });

  it("handles CancellableSpeech devInfo, whose angle brackets contain commas", () => {
    const repr =
      "[CancellableSpeech (still valid, devInfo< isCanceledCache: False, isValidCallback: True, " +
      "isValidCallbackDevInfo: isLast: True, previouslyHad: False >), 'Home', 'link']";
    expect(reprStrings(repr)).toEqual(["Home", "link"]);
  });

  it("handles Python's default repr and quoted arguments inside objects", () => {
    const repr =
      "[<speech.commands.ConfigProfileTriggerCommand object at 0x000001F4A2C3B510>, " +
      "WaveFileCommand('C:\\\\Program Files\\\\NVDA\\\\waves\\\\textError.wav'), " +
      "PhonemeCommand('ˈaɪ', text='I, me'), CallbackCommand(name=f(x, ')')), 'after']";
    expect(reprStrings(repr)).toEqual(["after"]);
  });

  it("decodes Python string escapes", () => {
    const repr =
      "['October\\xa01', 'it\\'s', \"The agency's\", 'tab\\there', 'line\\nbreak', " +
      "'back\\\\slash', 'right quote \\u2019', 'emoji \\U0001f600', 'bell\\x07', 'octal\\101', " +
      "'unknown \\q escape']";
    expect(reprStrings(repr)).toEqual([
      "October\u00a01",
      "it's",
      "The agency's",
      "tab\there",
      "line\nbreak",
      "back\\slash",
      "right quote \u2019",
      "emoji \u{1f600}",
      "bell\x07",
      "octalA",
      "unknown \\q escape",
    ]);
  });

  it("keeps brackets and commas that are inside strings", () => {
    expect(reprStrings("['a, b]', \"(c\", '<d>']")).toEqual(["a, b]", "(c", "<d>"]);
  });

  it("parses an empty list and tolerates whitespace", () => {
    expect(parseReprList("[]")).toEqual([]);
    expect(reprStrings("  [ 'a' ,  'b' ]  ")).toEqual(["a", "b"]);
  });

  it("rejects malformed input with a position", () => {
    expect(() => parseReprList("'a'")).toThrow(ReprParseError);
    expect(() => parseReprList("['unterminated")).toThrow(/unterminated string/);
    expect(() => parseReprList("['a' 'b']")).toThrow(/expected ','/);
    expect(() => parseReprList("[LangChangeCommand ('en_US'")).toThrow(ReprParseError);
  });
});

describe("scavengeStrings", () => {
  it("recovers the quoted text of a truncated repr", () => {
    expect(scavengeStrings("[LangChangeCommand ('en_US'), 'heading', 'level 1', 'Welc")).toEqual([
      "en_US",
      "heading",
      "level 1",
    ]);
  });
});
