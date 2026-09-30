import { execFile, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
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
  nvdaProcesses,
  ownNvdaPaths,
  parseComputerModel,
  parseNvdaProcesses,
  personsNvda,
  powershellCommand,
  powershellString,
  restartAfterScript,
  restartNvda,
  sessionLocked,
  startProcessScript,
  windowsSystemInfo,
} from "../src/drivers/guidepup/windows.js";

const temps: string[] = [];
const orphans: number[] = [];
const standIns: ChildProcess[] = [];
afterEach(async () => {
  // A stand-in may have left this user no right to it but terminate; Node's own handle still ends
  // it. Its folder can go once it has exited.
  await Promise.all(standIns.splice(0).map(stop));
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

function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill();
  });
}

/**
 * A stand-in for a running nvda.exe: Windows' ping, copied as nvda.exe into a new folder whose
 * name starts with `prefix`, and started from its full, long-form path. With `-n 60`, it runs for
 * about a minute.
 */
function startStandInNvda(
  prefix: string,
  args: string[] = ["-n", "60", "127.0.0.1"],
): { pid: number; exe: string; child: ChildProcess } {
  const tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), prefix)));
  temps.push(tmp);
  const exe = path.join(tmp, "nvda.exe");
  copyFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "PING.EXE"), exe);
  const child = spawn(exe, args, { stdio: "ignore" });
  standIns.push(child);
  if (child.pid === undefined) throw new Error(`The stand-in ${exe} didn't start.`);
  return { pid: child.pid, exe, child };
}

/** Runs a script as voicecap's PowerShell helpers do; resolves when it's done, with its errors. */
function runPowershell(script: string): Promise<{ stderr: string; at: number }> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", powershellCommand(script)],
      { windowsHide: true, timeout: 60_000 },
      (error, _stdout, stderr) => {
        if (error?.killed) reject(new Error("PowerShell didn't finish within a minute"));
        else resolve({ stderr, at: Date.now() });
      },
    );
  });
}

/**
 * Leaves this user only the limited query right to a process (with synchronize and terminate), as
 * Windows does to a program at a higher integrity level, such as an installed NVDA with UI Access:
 * its path can be asked for, but not its memory or its full information.
 */
function lockDown(pid: number): void {
  const script = [
    "Add-Type -Namespace VoicecapTest -Name Acl -MemberDefinition '",
    '[DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);',
    '[DllImport("advapi32.dll")] public static extern uint SetSecurityInfo(IntPtr handle, int objectType, uint securityInfo, IntPtr owner, IntPtr group, byte[] dacl, IntPtr sacl);',
    '[DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);',
    "';",
    "$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value;",
    // PROCESS_QUERY_LIMITED_INFORMATION 0x1000, SYNCHRONIZE 0x100000, PROCESS_TERMINATE 0x1.
    '$descriptor = New-Object Security.AccessControl.RawSecurityDescriptor "D:(A;;0x101001;;;$sid)";',
    "$dacl = New-Object byte[] $descriptor.DiscretionaryAcl.BinaryLength;",
    "$descriptor.DiscretionaryAcl.GetBinaryForm($dacl, 0);",
    // WRITE_DAC, then SE_KERNEL_OBJECT (6) and DACL_SECURITY_INFORMATION (4).
    `$handle = [VoicecapTest.Acl]::OpenProcess(0x40000, $false, ${pid});`,
    "if ($handle -eq [IntPtr]::Zero) { exit 2 }",
    "$result = [VoicecapTest.Acl]::SetSecurityInfo($handle, 6, 4, [IntPtr]::Zero, [IntPtr]::Zero, $dacl, [IntPtr]::Zero);",
    "[void][VoicecapTest.Acl]::CloseHandle($handle);",
    "exit $result",
  ].join(" ");
  const done = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  if (done.status !== 0) {
    throw new Error(`Couldn't lock down process ${pid} (exit ${done.status}): ${done.stderr}`);
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

  it("read the path of an nvda.exe whose memory Windows won't let voicecap read, as for an installed NVDA", async () => {
    const nvda = startStandInNvda("voicecap-nvda-test-");
    lockDown(nvda.pid);
    expect(await nvdaProcesses()).toContainEqual({ pid: nvda.pid, path: nvda.exe });
  }, 30_000);

  it("read an nvda.exe's path with letters outside ASCII as they are", async () => {
    const nvda = startStandInNvda("voicecap-nvda-é-test-");
    expect(await nvdaProcesses()).toContainEqual({ pid: nvda.pid, path: nvda.exe });
  }, 30_000);

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

  it("start the person's NVDA again only once Guidepup's NVDA has quit, as voicecap exits", async () => {
    // A stand-in for Guidepup's NVDA that quits in about 2 seconds, and a person's NVDA whose file
    // is gone, so the start fails (and opens no window) wherever it happens.
    const guidepup = startStandInNvda("voicecap-restart-test-", ["-n", "3", "127.0.0.1"]);
    const exited = new Promise<number>((resolve) => {
      guidepup.child.once("exit", () => resolve(Date.now()));
    });
    const gone = path.join(path.dirname(guidepup.exe), "gone", "voicecap-no-such-program.exe");
    const tried = await runPowershell(restartAfterScript(gone, guidepup.exe, 20));
    expect(tried.stderr).toContain("StartProcessCommand"); // it tried, and the file is gone
    expect(tried.at).toBeGreaterThanOrEqual(await exited);
  }, 30_000);

  it("start it anyway once the wait for Guidepup's NVDA has run out", async () => {
    const guidepup = startStandInNvda("voicecap-restart-test-");
    const gone = path.join(path.dirname(guidepup.exe), "gone", "voicecap-no-such-program.exe");
    const began = Date.now();
    const tried = await runPowershell(restartAfterScript(gone, guidepup.exe, 1));
    expect(tried.stderr).toContain("StartProcessCommand"); // it tried, and the file is gone
    expect(tried.at - began).toBeLessThan(15_000);
    expect(guidepup.child.exitCode).toBeNull(); // still running: the start didn't wait for it
  }, 30_000);

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
