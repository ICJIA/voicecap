import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveConfig } from "../src/config/load.js";
import {
  LOG_PRIVACY_WARNING,
  importManualSession,
  type ImportManualSessionOptions,
} from "../src/manual/import.js";
import { listManualSessions } from "../src/manual/list.js";
import { REDACTED_TEXT } from "../src/manual/redact.js";
import type { ManualSessionJson } from "../src/model.js";
import { UsageError } from "../src/util/errors.js";
import { sha256 } from "../src/util/hash.js";
import { createMemoryLogger, type MemoryLogger } from "../src/util/log.js";
import { isoLocal } from "../src/util/time.js";

const FIXTURE = fileURLToPath(new URL("../fixture/manual/nvda-io-log.txt", import.meta.url));
const PAGE = { url: "http://127.0.0.1:4747/", key: "http://127.0.0.1:4747/", slug: "home" };
const NOW = new Date(2026, 8, 26, 10, 15, 0);
// Explicit, so these tests don't depend on how the defaults evolve.
const config = resolveConfig({
  manual: {
    editableRoles: ["edit", "password edit", "editable", "combo box", "spin button", "protected"],
    focusKeys: ["tab", "shift+tab", "escape", "f6", "nvda+space"],
  },
});

const SPEECH_VIEWER = [
  "link  Skip to main content",
  "banner landmark  link  Voicecap Test Agency",
  "",
  "content info landmark  © 2026 Voicecap Test Agency",
].join("\r\n");

let tmp: string;
let outDir: string;
let logFile: string;
let logger: MemoryLogger;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "voicecap-manual-"));
  outDir = path.join(tmp, "transcripts");
  // Named like the file NVDA writes, to check the raw copy doesn't keep the .log extension.
  logFile = path.join(tmp, "nvda.log");
  await copyFile(FIXTURE, logFile);
  await utimes(logFile, NOW, new Date(2026, 8, 26, 0, 5, 0));
  logger = createMemoryLogger();
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function importLog(options: Partial<ImportManualSessionOptions> = {}) {
  return importManualSession({
    outDir,
    file: logFile,
    page: PAGE,
    reviewer: "Test Reviewer",
    config,
    logger,
    now: NOW,
    ...options,
  });
}

async function readJson(file: string): Promise<ManualSessionJson> {
  return JSON.parse(await readFile(file, "utf8")) as ManualSessionJson;
}

describe("importing an NVDA log", () => {
  it("writes a clean transcript, the JSON, and an unmodified raw copy", async () => {
    const { session, files } = await importLog({ date: "2026-09-25" });
    const dir = path.join(outDir, "manual", "home");
    expect(session.id).toBe("2026-09-25_2357");
    expect(files).toEqual({
      json: path.join(dir, "2026-09-25_2357.json"),
      txt: path.join(dir, "2026-09-25_2357.txt"),
      raw: path.join(dir, "raw", "2026-09-25_2357.nvda-log.txt"),
    });
    expect(await readJson(files.json)).toEqual(session);

    const original = await readFile(logFile);
    expect(await readFile(files.raw!)).toEqual(original);
    expect(session.input).toEqual({
      format: "nvda-log",
      fileName: "nvda.log",
      sha256: sha256(original),
      bytes: original.length,
      raw: { kept: true, path: "raw/2026-09-25_2357.nvda-log.txt" },
    });
    expect(session.page).toEqual(PAGE);
    expect(session.reviewer).toBe("Test Reviewer");
    expect(session.importedAt).toBe(isoLocal(NOW));
    expect(session.nvdaVersion).toBe("2026.2");
    expect(session.redaction).toEqual({ applied: false, keystrokes: 0, speech: 0, note: null });
  });

  it("dates every entry, across midnight", async () => {
    const { session } = await importLog({ date: "2026-09-25" });
    expect(session.session).toEqual({
      date: "2026-09-25",
      dateSource: "option",
      start: "2026-09-25T23:57:43.410",
      end: "2026-09-26T00:01:40.281",
      from: null,
      to: null,
      crossesMidnight: true,
    });
    const enter = session.entries.find((entry) => entry.text === "kb(desktop):enter")!;
    expect(enter).toEqual({
      at: "2026-09-26T00:00:03.118",
      type: "key",
      text: "kb(desktop):enter",
    });
    expect(session.entries[0]).toEqual({
      at: "2026-09-25T23:57:43.410",
      type: "speech",
      text: "Voicecap Test Agency - Google Chrome",
    });
  });

  it("keeps only keys and speech", async () => {
    const { session } = await importLog({ date: "2026-09-25" });
    expect(new Set(session.entries.map((entry) => entry.type))).toEqual(new Set(["key", "speech"]));
    const texts = session.entries.map((entry) => entry.text).join("\n");
    expect(texts).not.toMatch(/Traceback|typed word|Command|Starting NVDA/);
  });

  it("renders each keystroke followed by what NVDA said, with date markers", async () => {
    const { files } = await importLog({ date: "2026-09-25" });
    const txt = await readFile(files.txt, "utf8");
    expect(txt).not.toContain("\r");
    const [header, body] = txt.split("\n\n") as [string, string];
    expect(header.split("\n").every((line) => line.startsWith("# "))).toBe(true);
    expect(header).toContain("# voicecap manual session: NVDA log");
    expect(header).toContain("# Page: http://127.0.0.1:4747/");
    expect(header).toContain(`# Input: nvda.log (NVDA log, `);
    expect(header).toContain("# Raw copy: raw/2026-09-25_2357.nvda-log.txt");
    expect(header).toContain(
      "# Session: 2026-09-25T23:57:43.410 to 2026-09-26T00:01:40.281 (crosses midnight)",
    );
    expect(header).toContain("# NVDA: 2026.2");
    expect(header).toContain("# Imported: " + isoLocal(NOW) + " by Test Reviewer");
    expect(body).toContain(
      "-- 2026-09-25 --\n23:57:43.410      Voicecap Test Agency - Google Chrome",
    );
    expect(body).toContain(
      "23:58:04.231  [downArrow]\n23:58:04.279      banner landmark, link, Voicecap Test Agency",
    );
    expect(body).toContain("-- 2026-09-26 --\n00:00:03.118  [enter]");
  });

  it("warns about privacy on every log import, and about typing it finds", async () => {
    const { session } = await importLog({ date: "2026-09-25" });
    expect(logger.text("warn")).toContain(LOG_PRIVACY_WARNING);
    expect(logger.text("warn")).toMatch(/typed into form fields.*--redact-typing/s);
    expect(session.warnings).toHaveLength(1);
    expect(session.warnings[0]).toMatch(/--redact-typing/);
    expect(session.entries.map((entry) => entry.text)).toContain("kb(desktop):g");
  });

  it("dates the session from the file's modification time, which marks its end", async () => {
    // Modified at 00:05 on the 26th, after one midnight crossing: the session began on the 25th.
    const { session } = await importLog();
    expect(session.session.date).toBe("2026-09-25");
    expect(session.session.dateSource).toBe("file-modified");
    expect(session.session.start).toBe("2026-09-25T23:57:43.410");
    expect(logger.text("info")).toMatch(
      /Session date 2026-09-25: from the file's modification time.*--date/s,
    );
  });

  it("imports part of a log with --from and --to, across midnight", async () => {
    const { session } = await importLog({ date: "2026-09-26", from: "23:59", to: "00:00:20" });
    expect(session.id).toBe("2026-09-26_0000");
    expect(session.session).toMatchObject({
      date: "2026-09-26",
      start: "2026-09-26T00:00:03.118",
      end: "2026-09-26T00:00:20.166",
      from: "23:59",
      to: "00:00:20",
      crossesMidnight: false,
    });
    expect(session.entries[0]!.text).toBe("kb(desktop):enter");
    expect(session.entries.every((entry) => entry.at!.startsWith("2026-09-26T00:00:"))).toBe(true);
  });

  it("rejects a window with nothing in it", async () => {
    await expect(importLog({ from: "01:00", to: "02:00" })).rejects.toThrow(
      /no input or speech between 01:00 and 02:00/,
    );
  });

  it("gives sessions with the same start their own names", async () => {
    const first = await importLog({ date: "2026-09-25" });
    const second = await importLog({ date: "2026-09-25", noRaw: true });
    const third = await importLog({ date: "2026-09-25" });
    expect([first.session.id, second.session.id, third.session.id]).toEqual([
      "2026-09-25_2357",
      "2026-09-25_2357-2",
      "2026-09-25_2357-3",
    ]);
    const listed = await listManualSessions(outDir);
    expect(listed.map((entry) => entry.json.id)).toEqual([
      "2026-09-25_2357",
      "2026-09-25_2357-2",
      "2026-09-25_2357-3",
    ]);
    expect(listed[0]!.rawPath).toBe("manual/home/raw/2026-09-25_2357.nvda-log.txt");
    expect(listed[1]!.rawPath).toBeNull();
  });

  it("with --no-raw, records the original's hash without copying it", async () => {
    const { session, files } = await importLog({ date: "2026-09-25", noRaw: true });
    expect(files.raw).toBeNull();
    expect(session.input.raw).toEqual({ kept: false, reason: "no-raw" });
    expect(session.input.sha256).toBe(sha256(await readFile(logFile)));
    expect(existsSync(path.join(outDir, "manual", "home", "raw"))).toBe(false);
    expect(await readFile(files.txt, "utf8")).toContain("# Raw copy: not kept (--no-raw)");
  });

  it("with --redact-typing, removes the typing and withholds the raw log", async () => {
    const { session, files } = await importLog({ date: "2026-09-25", redactTyping: true });
    expect(files.raw).toBeNull();
    expect(existsSync(path.join(outDir, "manual", "home", "raw"))).toBe(false);
    expect(session.input.raw).toEqual({ kept: false, reason: "withheld-for-privacy" });
    expect(session.input.sha256).toBe(sha256(await readFile(logFile)));
    expect(session.redaction.applied).toBe(true);
    expect(session.redaction.keystrokes).toBe(1);
    expect(session.redaction.speech).toBe(1);
    expect(session.redaction.note).toMatch(/heuristic/);
    expect(session.entries.filter((entry) => entry.redacted)).toEqual([
      { at: "2026-09-25T23:58:19.201", type: "key", text: REDACTED_TEXT, redacted: true },
      { at: "2026-09-26T00:00:04.020", type: "speech", text: REDACTED_TEXT, redacted: true },
    ]);
    const written = (await readFile(files.json, "utf8")) + (await readFile(files.txt, "utf8"));
    expect(written).not.toMatch(/deadlines|kb\(desktop\):g"/);
    expect(await readFile(files.txt, "utf8")).toContain(
      "# Raw copy: withheld for privacy (--redact-typing)",
    );
    expect(logger.text("warn")).toContain(LOG_PRIVACY_WARNING);
    expect(logger.text("warn")).not.toMatch(/typed into form fields/);
  });

  it("with --redact-typing --keep-raw, keeps the raw log and warns", async () => {
    const { session, files } = await importLog({
      date: "2026-09-25",
      redactTyping: true,
      keepRaw: true,
    });
    expect(files.raw).not.toBeNull();
    expect(session.input.raw).toEqual({ kept: true, path: "raw/2026-09-25_2357.nvda-log.txt" });
    expect(logger.text("warn")).toMatch(/--keep-raw keeps the unredacted log/);
    expect(session.warnings.join("\n")).toMatch(/defeats the redaction/);
  });

  it("rejects --keep-raw with --no-raw", async () => {
    await expect(importLog({ keepRaw: true, noRaw: true })).rejects.toThrow(UsageError);
  });

  it("explains a log without input/output entries", async () => {
    const infoOnly = path.join(tmp, "nvda-old.log");
    await writeFile(
      infoOnly,
      "INFO - __main__ (09:00:00.000) - MainThread (1):\r\nStarting NVDA version 2026.2 AMD64\r\n",
    );
    await expect(importLog({ file: infoOnly })).rejects.toThrow(
      /logging level probably wasn't set to Input\/output/,
    );
  });

  it("validates --date, --from, and --to", async () => {
    for (const date of ["2026-02-30", "09/25/2026", "2026-9-25"]) {
      await expect(importLog({ date })).rejects.toThrow(/--date must be a date as YYYY-MM-DD/);
    }
    await expect(importLog({ from: "25:00" })).rejects.toThrow(/--from must be a time of day/);
    await expect(importLog({ to: "noon" })).rejects.toThrow(/--to must be a time of day/);
  });

  it("reports a file it can't read", async () => {
    await expect(importLog({ file: path.join(tmp, "missing.log") })).rejects.toThrow(
      /Can't read .*missing\.log/,
    );
  });
});

describe("importing a Speech Viewer capture", () => {
  let captureFile: string;

  beforeEach(async () => {
    captureFile = path.join(tmp, "speech-viewer.txt");
    await writeFile(captureFile, SPEECH_VIEWER);
    await utimes(captureFile, NOW, new Date(2026, 8, 26, 14, 5, 30));
  });

  it("writes one utterance per line, named by the file's modification date and time", async () => {
    const { session, files } = await importLog({ file: captureFile });
    expect(session.id).toBe("2026-09-26_1405");
    expect(session.input).toMatchObject({
      format: "speech-viewer",
      fileName: "speech-viewer.txt",
      raw: { kept: true, path: "raw/2026-09-26_1405.speech-viewer.txt" },
    });
    expect(session.session).toEqual({
      date: "2026-09-26",
      dateSource: "file-modified",
      start: null,
      end: null,
      from: null,
      to: null,
      crossesMidnight: false,
    });
    expect(session.nvdaVersion).toBeNull();
    expect(session.entries).toEqual([
      { at: null, type: "speech", text: "link, Skip to main content" },
      { at: null, type: "speech", text: "banner landmark, link, Voicecap Test Agency" },
      { at: null, type: "speech", text: "content info landmark, © 2026 Voicecap Test Agency" },
    ]);
    const txt = await readFile(files.txt, "utf8");
    expect(txt).toContain("# voicecap manual session: Speech Viewer capture");
    expect(txt.split("\n\n")[1]).toBe(
      [
        "link, Skip to main content",
        "banner landmark, link, Voicecap Test Agency",
        "content info landmark, © 2026 Voicecap Test Agency",
        "",
      ].join("\n"),
    );
    expect(await readFile(files.raw!, "utf8")).toBe(SPEECH_VIEWER);
    expect(logger.text("warn")).toBe("");
  });

  it("uses --date with the file's modification time for the name", async () => {
    const { session } = await importLog({ file: captureFile, date: "2026-09-20" });
    expect(session.id).toBe("2026-09-20_1405");
    expect(session.session.dateSource).toBe("option");
  });

  it("rejects --from, --to, and --redact-typing, which need an NVDA log", async () => {
    await expect(importLog({ file: captureFile, from: "10:00" })).rejects.toThrow(
      /--from and --to apply only to NVDA logs/,
    );
    await expect(importLog({ file: captureFile, redactTyping: true })).rejects.toThrow(
      /--redact-typing needs the keystrokes/,
    );
    expect(existsSync(outDir)).toBe(false);
  });

  it("rejects a capture with no speech", async () => {
    await writeFile(captureFile, "\r\n\r\n");
    await expect(importLog({ file: captureFile })).rejects.toThrow(/contains no speech/);
  });
});

describe("the files on disk", () => {
  it("keep one folder per page", async () => {
    await importLog({ date: "2026-09-25" });
    await importLog({ date: "2026-09-25", page: { ...PAGE, slug: "flawed-0123456789" } });
    expect((await readdir(path.join(outDir, "manual"))).sort()).toEqual([
      "flawed-0123456789",
      "home",
    ]);
  });
});

describe("redaction with a --from / --to window", () => {
  /** A log where the password field is announced before the window and typed into inside it. */
  function passwordLog(): string {
    const key = (time: string, gesture: string) =>
      `IO - inputCore.InputManager.executeGesture (${time}) - winInputHook (7496):\r\nInput: kb(desktop):${gesture}`;
    const speak = (time: string, ...items: string[]) =>
      `IO - speech.speech.speak (${time}) - MainThread (5140):\r\nSpeaking [CancellableSpeech (still valid), LangChangeCommand ('en_US'), ${items
        .map((item) => `'${item}'`)
        .join(", ")}]`;
    return (
      [
        "INFO - __main__ (10:00:00.000) - MainThread (5140):\r\nStarting NVDA version 2026.2 x86",
        key("10:04:58.000", "tab"),
        speak("10:04:58.050", "Password", "password edit", "protected"),
        ...[..."hunter2"].flatMap((char, i) => [
          key(`10:05:0${i + 1}.000`, char),
          speak(`10:05:0${i + 1}.040`, "star"),
        ]),
        key("10:05:09.000", "tab"),
        speak("10:05:09.050", "Sign in", "button"),
      ].join("\r\n") + "\r\n"
    );
  }

  it("redacts typing into a field entered before the window starts", async () => {
    await writeFile(logFile, passwordLog());
    const { session, files } = await importLog({
      redactTyping: true,
      from: "10:05",
      date: "2026-09-26",
    });
    const texts = session.entries.map((entry) => entry.text);
    for (const char of "hunter2") expect(texts).not.toContain(char);
    expect(texts).toContain(REDACTED_TEXT);
    expect(session.redaction.keystrokes).toBeGreaterThan(0);
    const txt = await readFile(files.txt, "utf8");
    expect(txt).not.toMatch(/\[h\]|\[u\]|hunter/);
    expect(txt).toContain("Sign in, button");
  });

  it("warns about typing inside the window even when the field was entered before it", async () => {
    await writeFile(logFile, passwordLog());
    await importLog({ from: "10:05", date: "2026-09-26" });
    expect(logger.text("warn")).toMatch(/typed into form fields.*--redact-typing/s);
  });
});
