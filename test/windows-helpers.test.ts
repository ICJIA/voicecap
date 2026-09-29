import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { chromium } from "playwright";
import { afterEach, describe, expect, it } from "vitest";

import { unsafePathMessage, unsafePathProblem } from "../src/drivers/guidepup/paths.js";
import {
  cleanupOrphans,
  keepAwake,
  listProcesses,
  ownNvdaPaths,
  parseComputerModel,
  parseNvdaProcesses,
  personsNvda,
  powershellCommand,
  powershellString,
  restartNvda,
  sessionLocked,
  startProcessScript,
  windowsSystemInfo,
} from "../src/drivers/guidepup/windows.js";

const temps: string[] = [];
const orphans: number[] = [];
afterEach(() => {
  // A browser that outlives its test keeps the test runner's output pipe open (Windows handle
  // inheritance), which would hang the run: make sure it's gone whatever the test did.
  for (const pid of orphans.splice(0)) {
    if (alive(pid)) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  }
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(process.platform !== "win32")("Windows helpers (real Windows)", () => {
  // Whether it's locked right now depends on the person at the computer (a real lock was checked
  // by hand); CI runners have no interactive desktop to ask about.
  it.skipIf(process.env.CI !== undefined)(
    "tell whether this Windows session is locked",
    async () => {
      expect([true, false]).toContain(await sessionLocked());
    },
  );

  it("keep Windows awake until released", async () => {
    const awake = keepAwake();
    try {
      expect(await awake.ready).toBe(true);
    } finally {
      awake.release();
    }
    await awake.ended; // the request ends with its helper
  });

  it("find running processes by image name", async () => {
    expect(await listProcesses("node.exe")).toContain(process.pid);
    expect(await listProcesses("no-such-program-for-voicecap.exe")).toEqual([]);
  });

  it("describe this Windows and its display language", () => {
    const info = windowsSystemInfo();
    expect(info.os).toMatch(/^Windows .*\(10\.0\.\d+\)$/);
    expect(info.uiLocale).toMatch(/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/);
  });

  it.skipIf(!existsSync(chromium.executablePath()))(
    "close a browser left running by a crashed run and delete its profile",
    async () => {
      const tmp = mkdtempSync(path.join(os.tmpdir(), "voicecap-orphan-test-"));
      temps.push(tmp);
      const profile = path.join(tmp, "voicecap-chrome-orphan");
      mkdirSync(profile);
      const orphan = spawn(
        chromium.executablePath(),
        [`--user-data-dir=${profile}`, "--headless=new", "about:blank"],
        { stdio: "ignore", detached: true },
      );
      orphan.unref();
      if (orphan.pid) orphans.push(orphan.pid);
      await delay(1500);
      expect(alive(orphan.pid ?? -1)).toBe(true);

      const notes = await cleanupOrphans(tmp, path.join(tmp, "no-nvda", "nvda.exe"));

      expect(notes).toContain("Closed 1 browser left by an earlier run.");
      expect(notes).toContain("Deleted 1 browser profile left by an earlier run.");
      expect(alive(orphan.pid ?? -1)).toBe(false);
      expect(existsSync(profile)).toBe(false);
    },
    30_000,
  );

  it("shut down Guidepup's NVDA when a crashed run left it running, and nobody else's", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "voicecap-orphan-test-"));
    temps.push(tmp);
    // A stand-in for Guidepup's nvda.exe: Windows' ping, copied into a fake Guidepup folder.
    const nvdaExe = path.join(tmp, "guidepup", "nvda.exe");
    mkdirSync(path.dirname(nvdaExe));
    copyFileSync(
      path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "PING.EXE"),
      nvdaExe,
    );
    const leftover = spawn(nvdaExe, ["-n", "60", "127.0.0.1"], { stdio: "ignore", detached: true });
    leftover.unref();
    if (leftover.pid) orphans.push(leftover.pid);
    await delay(500);
    expect(alive(leftover.pid ?? -1)).toBe(true);

    const notes = await cleanupOrphans(tmp, nvdaExe);

    expect(notes).toContain(
      `Shut down Guidepup's NVDA, which an earlier run left running (process ${leftover.pid}).`,
    );
    expect(alive(leftover.pid ?? -1)).toBe(false);
  }, 30_000);

  it("leave everything alone when nothing was left behind", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "voicecap-orphan-test-"));
    temps.push(tmp);
    expect(await cleanupOrphans(tmp, path.join(tmp, "no-nvda", "nvda.exe"))).toEqual([]);
  });

  it("say so when a program can't be started again because its file is gone", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "voicecap-restart-test-"));
    temps.push(tmp);
    // Not named nvda.exe, so Windows can't go looking for the person's real NVDA by that name.
    const gone = path.join(tmp, "gone", "voicecap-no-such-program.exe");
    await expect(restartNvda(gone)).rejects.toThrow("PowerShell didn't start it");
  });
});

describe("Windows helpers (what PowerShell says)", () => {
  it("read each nvda.exe's process id and path, with no path when Windows doesn't give one", () => {
    expect(parseNvdaProcesses("1234|C:\\Program Files (x86)\\NVDA\\nvda.exe\r\n5678|\r\n")).toEqual(
      [
        { pid: 1234, path: "C:\\Program Files (x86)\\NVDA\\nvda.exe" },
        { pid: 5678, path: null },
      ],
    );
  });

  it("find no nvda.exe when nothing is listed, and skip lines that aren't <pid>|<path>", () => {
    expect(parseNvdaProcesses("")).toEqual([]);
    expect(parseNvdaProcesses("WARNING: something else\r\n\r\n42|C:\\nvda\\nvda.exe\r\n")).toEqual([
      { pid: 42, path: "C:\\nvda\\nvda.exe" },
    ]);
  });

  const install = {
    build: "0.2.1-2026.2",
    cacheDir: "C:\\Users\\pat\\AppData\\Local\\guidepup",
    nvdaExe:
      "C:\\Users\\pat\\AppData\\Local\\guidepup\\nvda\\all\\0.2.1-2026.2\\extracted\\nvda.exe",
  };
  const OWN_NVDA = "C:\\Program Files (x86)\\NVDA\\nvda.exe";

  it("tell the person's own NVDA from Guidepup's, whatever the spelling, keeping one with no path", () => {
    const running = [
      { pid: 1, path: install.nvdaExe },
      {
        pid: 2,
        path: "c:/users/PAT/appdata/local/GUIDEPUP/nvda/all/0.2.1-2026.2/extracted/NVDA.EXE",
      },
      { pid: 3, path: OWN_NVDA },
      { pid: 4, path: null },
    ];
    expect(personsNvda(running, install.nvdaExe)).toEqual([
      { pid: 3, path: OWN_NVDA },
      { pid: 4, path: null },
    ]);
  });

  it("list where to start the person's own NVDA again from: each path once, none unknown", async () => {
    const running = [
      { pid: 1, path: install.nvdaExe },
      { pid: 2, path: OWN_NVDA },
      { pid: 3, path: null },
      { pid: 4, path: "C:\\PROGRAM FILES (X86)\\NVDA\\NVDA.EXE" },
      { pid: 5, path: "D:\\nvda-portable\\nvda.exe" },
    ];
    expect(await ownNvdaPaths(install, () => Promise.resolve(running))).toEqual([
      OWN_NVDA,
      "D:\\nvda-portable\\nvda.exe",
    ]);
  });

  it("name the computer by maker and model, leaving out a part Windows doesn't give", () => {
    expect(parseComputerModel("Dell Inc.|OptiPlex 7010\r\n")).toBe("Dell Inc. OptiPlex 7010");
    expect(parseComputerModel("|Virtual Machine\r\n")).toBe("Virtual Machine");
    expect(parseComputerModel("|\r\n")).toBeNull();
    expect(parseComputerModel("")).toBeNull();
  });

  it("don't repeat the maker when the model already starts with it", () => {
    expect(parseComputerModel("HP|HP EliteBook 840\r\n")).toBe("HP EliteBook 840");
    expect(parseComputerModel("HP|hp EliteBook 840\r\n")).toBe("hp EliteBook 840");
    expect(parseComputerModel("HP|HP\r\n")).toBe("HP");
    // Only a whole word counts: HPE isn't HP.
    expect(parseComputerModel("HP|HPE ProLiant DL380\r\n")).toBe("HP HPE ProLiant DL380");
  });

  it("start a program as a shortcut does, its path read as it is", () => {
    expect(startProcessScript(OWN_NVDA)).toBe(
      "Start-Process -FilePath 'C:\\Program Files (x86)\\NVDA\\nvda.exe'",
    );
    expect(startProcessScript("C:\\Users\\O'Brien\\NVDA portable\\nvda.exe")).toBe(
      "Start-Process -FilePath 'C:\\Users\\O''Brien\\NVDA portable\\nvda.exe'",
    );
  });

  it("quote a path for PowerShell so that it's read as it is", () => {
    expect(powershellString("C:\\Users\\O'Brien\\Chrome\\chrome.exe")).toBe(
      "'C:\\Users\\O''Brien\\Chrome\\chrome.exe'",
    );
  });

  it("have PowerShell answer in UTF-8, then run the script unchanged", () => {
    // Windows PowerShell writes to a pipe in the console's code page, which would garble "José".
    const script = `Get-CimInstance Win32_Process -Filter "Name='nvda.exe'" | ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)" }`;
    expect(powershellCommand(script)).toBe(
      "try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) } catch {}; " + script,
    );
  });

  it("double the curly quotes too, which PowerShell also reads as quotes", () => {
    expect(powershellString("C:\\Users\\O\u2019Brien\\\u2018x\u2019 \u201Ay\u201B")).toBe(
      "'C:\\Users\\O\u2019\u2019Brien\\\u2018\u2018x\u2019\u2019 \u201A\u201Ay\u201B\u201B'",
    );
  });
});

describe("Guidepup's folder, when NVDA can't start from it", () => {
  const install = {
    build: "0.2.1-2026.2",
    cacheDir: "C:\\Users\\Jane Doe\\AppData\\Local\\guidepup",
    nvdaExe:
      "C:\\Users\\Jane Doe\\AppData\\Local\\guidepup\\nvda\\all\\0.2.1-2026.2\\extracted\\nvda.exe",
  };
  const whatsWrong =
    "Guidepup's NVDA is in C:\\Users\\Jane Doe\\AppData\\Local\\guidepup, and that path has a space in it. Guidepup can't start NVDA from such a path (it runs nvda.exe through the Windows command shell without quoting its path).";

  it("says what's wrong, and how to fix it step by step", () => {
    expect(unsafePathProblem(install)).toEqual({
      whatsWrong,
      fix: [
        "Choose a folder whose path has only letters, digits, and - _ . in its names, set GUIDEPUP_SCREEN_READERS_PATH to it, and install NVDA there. In Git Bash: mkdir -p /c/guidepup && setx GUIDEPUP_SCREEN_READERS_PATH 'C:\\guidepup'",
        "Open a new terminal and run: npx @icjia/voicecap setup",
      ],
    });
  });

  it("names a character the command shell treats specially", () => {
    const problem = unsafePathProblem({
      ...install,
      cacheDir: "C:\\Users\\R&D\\AppData\\Local\\guidepup",
    });
    expect(problem?.whatsWrong).toContain(
      'Guidepup\'s NVDA is in C:\\Users\\R&D\\AppData\\Local\\guidepup, and that path has "&" in it.',
    );
  });

  it("finds nothing wrong with a folder NVDA can start from", () => {
    const safe = { ...install, cacheDir: "C:\\Users\\pat\\AppData\\Local\\guidepup" };
    expect(unsafePathProblem(safe)).toBeNull();
    expect(unsafePathMessage(safe)).toBeNull();
  });

  it("says the same in one message, worded as it always has been", () => {
    expect(unsafePathMessage(install)).toBe(
      [
        whatsWrong,
        "Choose a folder whose path has only letters, digits, and - _ . in its names, set GUIDEPUP_SCREEN_READERS_PATH to it, and install NVDA there. In Git Bash:",
        "  mkdir -p /c/guidepup && setx GUIDEPUP_SCREEN_READERS_PATH 'C:\\guidepup'",
        "then open a new terminal and run: npx @icjia/voicecap setup",
      ].join("\n"),
    );
  });
});
