import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type * as GuidepupModule from "@guidepup/guidepup";
import { describe, expect, it } from "vitest";

import type { NvdaKey } from "../src/drivers/guidepup-nvda.js";
import { GuidepupNvda } from "../src/drivers/guidepup/nvda.js";
import {
  NVDA_LOG_FILE,
  VOICECAP_GESTURES,
  cleanNvdaLog,
  gestureOf,
} from "../src/drivers/guidepup/nvda-log.js";
import { parseNvdaLog, splitLogEntries } from "../src/manual/nvda-log.js";
import type { DriverCommand, RunJson, TranscriptJson } from "../src/model.js";
import { sealOf, sha256 } from "../src/util/hash.js";

/** The first line of every cleaned copy. */
const HEADER =
  "# NVDA's own log of one NVDA session in this run, as voicecap keeps it: NVDA's speech, " +
  "the keys voicecap pressed, and NVDA's warnings and errors. voicecap left out every other " +
  "key, every typed word, and what NVDA said after a key voicecap didn't press, and wrote " +
  "%USERPROFILE% for the home folder.";

const HOME = { home: "C:\\Users\\jane", platform: "win32" } as const;

const MAIN = "MainThread (4100)";
const HOOK = "winInputHook (5200)";
const KEY_CODEPATH = "inputCore.InputManager.executeGesture";
const SPEECH_CODEPATH = "speech.speech.speak";

/** One log entry, as NVDA writes it: a header line, then the lines of its message. */
function entry(
  level: string,
  codepath: string,
  time: string,
  thread: string,
  ...message: string[]
): string[] {
  return [`${level} - ${codepath} (${time}) - ${thread}:`, ...message];
}

const START = entry("INFO", "__main__", "09:00:00.100", MAIN, "Starting NVDA version 2026.2 AMD64");
const CONFIG_DIR = entry(
  "INFO",
  "core.main",
  "09:00:00.900",
  MAIN,
  String.raw`Config dir: C:\Users\jane\AppData\Local\guidepup\nvda\sessionUserConfig`,
);
// NVDA's own helper ends its messages with a blank line, which belongs to the entry.
const HELPER_WARNING = entry(
  "WARNING",
  "NVDAHelperLocal",
  "09:00:01.030",
  MAIN,
  String.raw`Thread 4100, build\x86_64\localWin10\oneCoreSpeech.cpp, ocSpeech_speak, 120:`,
  "Utterance was empty",
  "",
);
const REPORT_TITLE = entry("IO", KEY_CODEPATH, "09:00:02.001", HOOK, "Input: kb(laptop):NVDA+t");
const WINDOW_SPEECH = entry(
  "IO",
  SPEECH_CODEPATH,
  "09:00:02.104",
  MAIN,
  "Speaking [LangChangeCommand ('en_US'), 'Home - Google Chrome', 'window', CancellableSpeech (still valid)]",
);
const FOREGROUND = entry(
  "DEBUGWARNING",
  "IAccessibleHandler.internalWinEventHandler._shouldGetEvents",
  "09:00:02.500",
  MAIN,
  "Foreground took too long to change.",
);
const TYPED_A = entry("IO", KEY_CODEPATH, "09:00:03.000", HOOK, "Input: kb(desktop):a");
const TYPED_WORD = entry(
  "IO",
  "speech.speech.speakTypedCharacters",
  "09:00:03.010",
  MAIN,
  "typed word: hunter2",
);
const SHIFT_P = entry("IO", KEY_CODEPATH, "09:00:03.200", HOOK, "Input: kb(desktop):shift+p");
const FAILURE = entry(
  "ERROR",
  "_remoteClient.server.LocalRelayServer.acceptNewConnection",
  "09:00:04.000",
  "Thread-4 (run) (5800)",
  "Error accepting connection",
  "Traceback (most recent call last):",
  String.raw`  File "_remoteClient\server.pyc", line 385, in acceptNewConnection`,
  "ssl.SSLEOFError: [SSL: UNEXPECTED_EOF_WHILE_READING] EOF occurred in violation of protocol",
);
const DOWN = entry("IO", KEY_CODEPATH, "09:00:05.000", HOOK, "Input: kb(desktop):downArrow");
const HEADING_SPEECH = entry(
  "IO",
  SPEECH_CODEPATH,
  "09:00:05.120",
  MAIN,
  "Speaking [LangChangeCommand ('en_US'), 'heading', 'level 1', 'Welcome', CancellableSpeech (still valid)]",
);
const BRAILLE = entry(
  "IO",
  "braille.BrailleBuffer.update",
  "09:00:05.130",
  MAIN,
  "Braille regions text: ['h1 Welcome']",
);
const DEBUG = entry("DEBUG", "core.main", "09:00:05.500", MAIN, "Initializing the core");
const DEBUG_SPEECH = entry(
  "DEBUG",
  SPEECH_CODEPATH,
  "09:00:05.600",
  MAIN,
  "Speaking ['not at the input/output level']",
);
const CRITICAL = entry("CRITICAL", "core.main", "09:00:06.000", MAIN, "NVDA is shutting down");

/** What NVDA logs when it speaks some text. */
function spoken(text: string, time: string): string[] {
  const speech = `[LangChangeCommand ('en_US'), '${text}', CancellableSpeech (still valid)]`;
  return entry("IO", SPEECH_CODEPATH, time, MAIN, `Speaking ${speech}`);
}

/**
 * A person typing a word, as NVDA logs it: each key, then the character it speaks, and at the end
 * the word, and what it speaks for the word.
 */
function typing(word: string): string[][] {
  const characters = [...word].flatMap((character, n) => {
    const time = `09:01:00.${String(n * 100).padStart(3, "0")}`;
    const key = entry("IO", KEY_CODEPATH, time, HOOK, `Input: kb(desktop):${character}`);
    return [key, spoken(character, time)];
  });
  const typed = "speech.speech.speakTypedCharacters";
  return [
    ...characters,
    entry("IO", typed, "09:01:01.000", MAIN, `typed word: ${word}`),
    spoken(word, "09:01:01.010"),
  ];
}

/** A log as a session writes it: the entries cleaning keeps among those it drops, in order. */
const WHOLE_LOG = [
  START,
  CONFIG_DIR,
  HELPER_WARNING,
  REPORT_TITLE,
  WINDOW_SPEECH,
  FOREGROUND,
  TYPED_A,
  TYPED_WORD,
  SHIFT_P,
  ...typing("secret7"),
  FAILURE,
  DOWN,
  HEADING_SPEECH,
  BRAILLE,
  DEBUG,
  DEBUG_SPEECH,
  CRITICAL,
];
const KEPT = [HELPER_WARNING, REPORT_TITLE, WINDOW_SPEECH, FAILURE, DOWN, HEADING_SPEECH, CRITICAL];
const DROPPED = [START, CONFIG_DIR, FOREGROUND, TYPED_A, TYPED_WORD, SHIFT_P, BRAILLE, DEBUG];

/** A log as NVDA writes it on Windows: every line, the last one too, ends with CRLF. */
function nvdaWrites(entries: string[][]): string {
  return entries.flatMap((lines) => lines.map((line) => `${line}\r\n`)).join("");
}

function clean(...entries: string[][]): string {
  return cleanNvdaLog(nvdaWrites(entries), HOME);
}

/** The lines of a cleaned copy after its first line. */
function bodyOf(cleaned: string): string[] {
  return cleaned.split("\n").slice(1, -1);
}

describe("cleanNvdaLog: what it keeps", () => {
  it("keeps a speech entry, whole", () => {
    expect(bodyOf(clean(WINDOW_SPEECH))).toEqual(WINDOW_SPEECH);
  });

  it("keeps the keys voicecap presses, on either keyboard layout", () => {
    expect(bodyOf(clean(DOWN, REPORT_TITLE))).toEqual([...DOWN, ...REPORT_TITLE]);
  });

  it("keeps an error with its traceback, whole", () => {
    expect(FAILURE).toHaveLength(5);
    expect(bodyOf(clean(FAILURE))).toEqual(FAILURE);
  });

  it("keeps a warning and a critical entry, and a blank line that ends an entry", () => {
    expect(HELPER_WARNING.at(-1)).toBe("");
    expect(bodyOf(clean(HELPER_WARNING, CRITICAL))).toEqual([...HELPER_WARNING, ...CRITICAL]);
  });

  it("keeps a last entry that ends the file with no line end", () => {
    const raw = nvdaWrites([DOWN, FAILURE]).replace(/\r\n$/, "");
    expect(bodyOf(cleanNvdaLog(raw, HOME))).toEqual([...DOWN, ...FAILURE]);
  });

  it("keeps the entries in the order they were logged", () => {
    expect(clean(...WHOLE_LOG)).toBe(`${[HEADER, ...KEPT.flat()].join("\n")}\n`);
  });
});

describe("cleanNvdaLog: what it drops", () => {
  it("drops every other key, and every typed word", () => {
    const key = (time: string, ...message: string[]) =>
      entry("IO", KEY_CODEPATH, time, HOOK, ...message);
    const others = [
      TYPED_A,
      SHIFT_P,
      TYPED_WORD,
      key("09:00:03.300", "Input: kb(desktop):control+downArrow"),
      key("09:00:03.400", "Input: kb:h"),
      key("09:00:03.500", "Input: br(noBraille):tab"),
      // Only the exact key line is voicecap's key: a message with more in it is dropped whole.
      key("09:00:03.600", "Input: kb(desktop):tab", "something more"),
    ];
    expect(bodyOf(clean(...others))).toEqual([]);
  });

  it("drops informational, debugging, and other input/output entries", () => {
    expect(bodyOf(clean(...DROPPED, DEBUG_SPEECH))).toEqual([]);
  });

  it("leaves no typed word, and not the account name an INFO entry holds", () => {
    const cleaned = clean(...WHOLE_LOG);
    expect(cleaned).not.toContain("hunter2");
    expect(cleaned).not.toContain("secret7");
    expect(cleaned).not.toContain("jane");
    expect(cleaned.split("\n")).not.toContain("Input: kb(desktop):a");
    expect(cleaned.split("\n")).not.toContain("Input: kb(desktop):shift+p");
  });

  it("gives only its first line for a log with nothing to keep, or no log", () => {
    expect(clean(...DROPPED)).toBe(`${HEADER}\n`);
    expect(cleanNvdaLog("", HOME)).toBe(`${HEADER}\n`);
  });
});

// NVDA speaks each character a person types, and what it says after a key is in answer to that
// key, so speech counts as voicecap's only when the last key before it was voicecap's.
describe("cleanNvdaLog: what NVDA said after a key voicecap didn't press", () => {
  const calculator = spoken("Calculator", "09:00:00.200");

  it("drops each typed character's echo, the typed word, and what NVDA said for the word", () => {
    const typed = typing("secret7");
    expect(typed).toHaveLength(7 * 2 + 2);
    expect(bodyOf(clean(...typed))).toEqual([]);
  });

  it("keeps what NVDA said before any key, and again after a key voicecap pressed", () => {
    const entries = [calculator, ...typing("secret7"), DOWN, HEADING_SPEECH];
    expect(bodyOf(clean(...entries))).toEqual([...calculator, ...DOWN, ...HEADING_SPEECH]);
  });

  it("keeps what NVDA said after a voicecap key, up to the person's next key", () => {
    const echo = spoken("a", "09:00:03.050");
    expect(bodyOf(clean(DOWN, HEADING_SPEECH, TYPED_A, echo))).toEqual([
      ...DOWN,
      ...HEADING_SPEECH,
    ]);
  });

  it("counts every other key as the person's, whatever its form", () => {
    const keys = [
      ["Input: kb(desktop):control+downArrow"], // one of voicecap's, with a modifier
      ["Input: kb:h"], // the keyboard's generic form
      ["Input: br(noBraille):tab"], // another device
      ["Input: kb(desktop):tab", "something more"], // more than a key's line
    ];
    for (const message of keys) {
      const person = entry("IO", KEY_CODEPATH, "09:00:03.300", HOOK, ...message);
      expect(bodyOf(clean(DOWN, person, HEADING_SPEECH)), message.join(" / ")).toEqual(DOWN);
    }
  });

  it("keeps NVDA's warnings and errors after any key", () => {
    expect(bodyOf(clean(TYPED_A, FAILURE))).toEqual(FAILURE);
  });

  // A person's h can't be told from voicecap's: NVDA logs both as kb(desktop):h. The rest of the
  // word is what NVDA said after keys that aren't voicecap's.
  it("keeps the first letter of hunter2, which is voicecap's key for the next heading", () => {
    const [key, echo] = typing("hunter2");
    expect(bodyOf(clean(...typing("hunter2")))).toEqual([...key!, ...echo!]);
  });
});

describe("cleanNvdaLog: the home folder", () => {
  const atHome = entry(
    "ERROR",
    "globalPluginHandler.listPlugins",
    "09:00:04.000",
    MAIN,
    "Traceback (most recent call last):",
    String.raw`  File "C:\Users\jane\AppData\Roaming\nvda\addons\x\globalPlugins\x.py", line 12, in run`,
    String.raw`OSError: [Errno 2] No such file or directory: 'C:\\Users\\jane\\Documents\\a.txt'`,
  );

  it("is written as %USERPROFILE%, in a traceback and in an error's repr", () => {
    expect(bodyOf(clean(atHome)).slice(-2)).toEqual([
      String.raw`  File "%USERPROFILE%\AppData\Roaming\nvda\addons\x\globalPlugins\x.py", line 12, in run`,
      String.raw`OSError: [Errno 2] No such file or directory: '%USERPROFILE%\\Documents\\a.txt'`,
    ]);
  });

  it("is written as ~ away from Windows, as redactHome writes it", () => {
    const failure = entry("ERROR", "x.y", "09:00:04.000", MAIN, "Traceback", "  File /home/jane/x");
    const options = { home: "/home/jane", platform: "linux" } as const;
    expect(bodyOf(cleanNvdaLog(nvdaWrites([failure]), options))).toEqual([
      failure[0],
      "Traceback",
      "  File ~/x",
    ]);
  });
});

describe("cleanNvdaLog: the copy", () => {
  it("starts with the line that says what it is", () => {
    expect(clean(...WHOLE_LOG).split("\n")[0]).toBe(HEADER);
  });

  it("holds exactly the kept entries", () => {
    const withoutLine = (text: string) =>
      splitLogEntries(text).map(({ line: _line, ...rest }) => rest);
    expect(withoutLine(clean(...WHOLE_LOG))).toEqual(withoutLine(KEPT.flat().join("\n")));
  });

  it("reads back through splitLogEntries and parseNvdaLog, which skip the first line", () => {
    const cleaned = clean(REPORT_TITLE, WINDOW_SPEECH);
    expect(splitLogEntries(cleaned).map((item) => item.line)).toEqual([2, 4]);
    const parsed = parseNvdaLog(cleaned);
    expect(parsed.entries).toBe(2);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.events.map((event) => [event.type, event.text])).toEqual([
      ["key", "kb(laptop):NVDA+t"],
      ["speech", "Home - Google Chrome, window"],
    ]);
    expect(parseNvdaLog(`${HEADER}\n`)).toMatchObject({ entries: 0, events: [] });
  });

  it("ends every line with \\n, whatever the raw log's line ends were", () => {
    const fromCrlf = clean(...WHOLE_LOG);
    const fromLf = cleanNvdaLog(WHOLE_LOG.flat().join("\n"), HOME);
    expect(fromCrlf).not.toContain("\r");
    expect(fromCrlf.endsWith("\n")).toBe(true);
    expect(fromLf).toBe(fromCrlf);
  });

  it("is not changed by cleaning it again", () => {
    const cleaned = clean(...WHOLE_LOG);
    expect(cleanNvdaLog(cleaned, HOME)).toBe(cleaned);
  });
});

describe("NVDA's log file", () => {
  it("is named nvda.log", () => {
    expect(NVDA_LOG_FILE).toBe("nvda.log");
  });
});

/**
 * What NVDA logs, after kb(desktop): or kb(laptop):, when the driver presses each of its keys.
 * Guidepup's key objects don't carry these names, so they're written here. A key added to the
 * driver's key map without its gesture here fails this file's type check, and its test.
 */
const GESTURE_OF_KEY: Record<NvdaKey, string> = {
  reportTitle: "NVDA+t",
  exitFocusMode: "escape",
  nextLine: "downArrow",
  nextHeading: "h",
  tab: "tab",
  toTop: "control+home",
  toBottom: "control+end",
};

/** A key command of the fake Guidepup below: the gesture it names, or the keys that make it. */
interface FakeKey {
  gesture?: string;
  keyCode?: string[];
  modifiers?: string[];
}

/** Guidepup's NVDA, where each key command names the gesture NVDA logs for it. */
function fakeGuidepup(): typeof GuidepupModule {
  const key = (gesture: string): FakeKey => ({ gesture });
  return {
    nvda: {
      version: "0.2.1-2026.2",
      keyboardCommands: {
        reportTitle: key("NVDA+t"),
        exitFocusMode: key("escape"),
        moveToNext: key("downArrow"),
        moveToNextHeading: key("h"),
        readNextFocusableItem: key("tab"),
        // Keys the driver doesn't use: a key map that took one by mistake would name another
        // gesture.
        moveToPrevious: key("upArrow"),
        moveToPreviousHeading: key("shift+h"),
      },
    },
    WindowsKeyCodes: { Home: "home", End: "end" },
    WindowsModifiers: { Control: "control" },
  } as unknown as typeof GuidepupModule;
}

function gestureOfKey(command: FakeKey): string {
  return command.gesture ?? [...(command.modifiers ?? []), ...(command.keyCode ?? [])].join("+");
}

describe("voicecap's gestures", () => {
  const install = { build: "0.2.1-2026.2", cacheDir: "C:\\guidepup", nvdaExe: "nvda.exe" };

  it("are exactly those of the keys the NVDA driver presses", () => {
    // The driver's key map is private to it: read it as the driver uses it.
    const { commands } = new GuidepupNvda(fakeGuidepup(), install) as unknown as {
      commands: Record<string, FakeKey>;
    };
    expect(Object.keys(commands).sort()).toEqual(Object.keys(GESTURE_OF_KEY).sort());
    for (const [key, gesture] of Object.entries(GESTURE_OF_KEY)) {
      expect(gestureOfKey(commands[key]!), key).toBe(gesture);
    }
    expect([...VOICECAP_GESTURES].sort()).toEqual(Object.values(GESTURE_OF_KEY).sort());
  });

  it("have no duplicates", () => {
    expect(new Set(VOICECAP_GESTURES).size).toBe(VOICECAP_GESTURES.length);
  });

  it("are the keys of the steps' commands, which gestureOf names", () => {
    const steps = ["nextLine", "nextHeading", "nextFocusable", "toTop", "toBottom"] as const;
    expect(steps.map((command) => gestureOf(command))).toEqual([
      "downArrow",
      "h",
      "tab",
      "control+home",
      "control+end",
    ]);
    for (const command of steps) expect(VOICECAP_GESTURES).toContain(gestureOf(command));
  });

  it("have no key for any other command", () => {
    expect(gestureOf("openPage" as DriverCommand)).toBeNull();
    expect(gestureOf("toString" as DriverCommand)).toBeNull();
    expect(gestureOf("" as DriverCommand)).toBeNull();
  });
});

const FIXTURE_DIR = fileURLToPath(new URL("../fixture/nvda-io-run/", import.meta.url));
const readFixtureLog = () => readFileSync(path.join(FIXTURE_DIR, "nvda-log", "1-1.txt"), "utf8");
const fixtureFiles = () =>
  readdirSync(FIXTURE_DIR, { recursive: true, withFileTypes: true })
    .filter((item) => item.isFile())
    .map((item) => path.join(item.parentPath, item.name));

describe("the fixture's cleaned copy of a real NVDA log", () => {
  it("says what it is on its first line, and ends its lines with \\n", () => {
    const text = readFixtureLog();
    expect(text.split("\n")[0]).toBe(HEADER);
    expect(text).not.toContain("\r");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("holds no account name", () => {
    expect(readFixtureLog().toLowerCase()).not.toContain("cschw");
  });

  it("holds no key but voicecap's", () => {
    const keys = splitLogEntries(readFixtureLog()).filter((e) => e.message.startsWith("Input: "));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const gesture = /^Input: kb\((?:desktop|laptop)\):(.+)$/.exec(key.message)?.[1];
      expect(VOICECAP_GESTURES, key.message).toContain(gesture);
    }
  });

  it("still has the raw log's 392 speech entries and 267 keys, all of them voicecap's", () => {
    const entries = splitLogEntries(readFixtureLog());
    const count = (prefix: string) =>
      entries.filter((e) => e.level === "IO" && e.message.startsWith(prefix)).length;
    expect(count("Speaking ")).toBe(392);
    expect(count("Input: kb(desktop):")).toBe(267);
    expect(count("typed word: ")).toBe(0);
  });

  it("holds nothing but speech, voicecap's keys, and warnings and errors", () => {
    const kinds = splitLogEntries(readFixtureLog()).map((e) =>
      e.level === "IO" ? e.message.split(" ", 1)[0] : e.level,
    );
    expect(new Set(kinds)).toEqual(new Set(["Speaking", "Input:", "WARNING", "ERROR"]));
  });

  it("is its own cleaned copy: cleaning it again changes nothing", () => {
    const text = readFixtureLog();
    expect(cleanNvdaLog(text, HOME)).toBe(text);
  });
});

describe("the fixture's files", () => {
  it("is the run's records and the cleaned log, and no raw log, screenshot, or report", () => {
    const relative = fixtureFiles().map((file) =>
      path.relative(FIXTURE_DIR, file).split(path.sep).join("/"),
    );
    expect(relative).toContain("run/run.json");
    expect(relative).toContain("run/events.jsonl");
    expect(relative).toContain("nvda-log/1-1.txt");
    expect(relative.filter((file) => /\.(log|jpg|html)$/.test(file))).toEqual([]);
    // Seven pages, each with three passes, each kept as TXT and as JSON.
    expect(relative.filter((file) => file.startsWith("run/pages/"))).toHaveLength(7 * 3 * 2);
  });

  it("holds no account name, in any file", () => {
    for (const file of fixtureFiles()) {
      expect(readFileSync(file, "utf8").toLowerCase(), file).not.toContain("cschw");
    }
  });

  it("is the run as voicecap wrote it: its seal and its event log's hash still hold", () => {
    const read = (name: string) => readFileSync(path.join(FIXTURE_DIR, "run", name));
    const run = JSON.parse(read("run.json").toString("utf8")) as RunJson;
    expect(sealOf(run)).toBe(run.seal);
    expect(sha256(read("events.jsonl"))).toBe(run.files?.["events.jsonl"]?.sha256);
  });

  // The first Tab on each page goes to the browser, not through NVDA, so NVDA logs no key for it.
  it("has one more Tab step for each page than the log has tab keys", () => {
    const transcripts = fixtureFiles().filter((file) => file.endsWith(`${path.sep}tab.json`));
    expect(transcripts).toHaveLength(7);
    const steps = transcripts.flatMap(
      (file) => (JSON.parse(readFileSync(file, "utf8")) as TranscriptJson).steps,
    );
    const tabSteps = steps.filter((step) => step.command === "nextFocusable").length;
    const entries = splitLogEntries(readFixtureLog());
    const tabKeys = entries.filter((e) => e.message === "Input: kb(desktop):tab").length;
    expect([tabSteps, tabKeys]).toEqual([41, 34]);
    expect(tabSteps - tabKeys).toBe(transcripts.length);
  });
});
