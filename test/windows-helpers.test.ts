import { execFile, spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { chromium } from "playwright";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { unsafePathMessage, unsafePathProblem } from "../src/drivers/guidepup/paths.js";
import {
  cleanupOrphans,
  foregroundWindow,
  keepAwake,
  listProcesses,
  nvdaProcesses,
  ownNvdaPaths,
  parseComputerModel,
  parseForegroundWindow,
  parseNvdaProcesses,
  parseWindowsMachine,
  personsNvda,
  powershellCommand,
  powershellString,
  readNvdaLog,
  restartAfterScript,
  restartNvda,
  sessionLocked,
  startedNvda,
  startProcessScript,
  windowsMachineProbe,
  windowsSystemInfo,
} from "../src/drivers/guidepup/windows.js";
import { collectMachineRecord, nodeMachineFacts } from "../src/run/machine-record.js";

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

/**
 * Runs a script as voicecap's PowerShell helpers do; resolves when it's done, with what it printed
 * and its errors.
 */
function runPowershell(script: string): Promise<{ stdout: string; stderr: string; at: number }> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", powershellCommand(script)],
      { windowsHide: true, timeout: 60_000 },
      (error, stdout, stderr) => {
        if (error?.killed) reject(new Error("PowerShell didn't finish within a minute"));
        else resolve({ stdout, stderr, at: Date.now() });
      },
    );
  });
}

/** The script foregroundWindow() has PowerShell run, which nothing here runs against the desktop. */
async function foregroundScript(): Promise<string> {
  let script = "";
  await foregroundWindow((asked) => {
    script = asked;
    return Promise.resolve("");
  });
  return script;
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
  // The first Add-Type in a fresh Windows session starts the C# compiler cold: about a second on
  // the Windows PC, but from 4 seconds to over a minute on GitHub's Windows runners (measured
  // 2026-09-29 and 30, when the keep-awake test, the first to compile, failed at 30 and then 60
  // seconds). Compiling once here, with room to spare, leaves each test below timing its own helper.
  beforeAll(() => {
    spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Add-Type -TypeDefinition 'public static class VoicecapWarmUp { }'",
      ],
      { windowsHide: true, timeout: 170_000 },
    );
  }, 180_000);

  // Whether it's locked right now depends on the person at the computer (a real lock was checked
  // by hand); CI runners have no interactive desktop to ask about.
  it.skipIf(process.env.CI !== undefined)(
    "tell whether this Windows session is locked",
    async () => {
      expect([true, false]).toContain(await sessionLocked());
    },
  );

  // Its helper compiles a little C# (Add-Type) before it answers: about a second on the Windows
  // PC. On GitHub's Windows runners, compiling first, it took 4 to 27 seconds when it passed.
  it("keep Windows awake until released", async () => {
    const awake = keepAwake();
    try {
      expect(await awake.ready).toBe(true);
    } finally {
      awake.release();
    }
    await awake.ended; // the request ends with its helper
  }, 60_000);

  it("find running processes by image name", async () => {
    expect(await listProcesses("node.exe")).toContain(process.pid);
    expect(await listProcesses("no-such-program-for-voicecap.exe")).toEqual([]);
  });

  // The lookup of the window in front is checked for real only at the PC, and a typo in it would
  // fail every lookup: each lost foreground would read as one voicecap couldn't name the program of.
  // These two read no window and never ask which one is in front.
  it("compile the C# the lookup of the window in front uses, and ask it about no window", async () => {
    // The script's first statement is its Add-Type, with the C# in single quotes (it has none of its
    // own). HostedProcess is asked about the null window, which it must take for no window: user32's
    // EnumChildWindows takes a null parent for every top-level window, those of the desktop.
    const compile = /^Add-Type [^']*'[^']*';/.exec(await foregroundScript())?.[0] ?? "";
    expect(compile).not.toBe("");
    const answer = await runPowershell(
      `${compile} [Voicecap.Front]::HostedProcess([IntPtr]::Zero, 0)`,
    );
    expect(answer.stdout.trim(), answer.stderr).toBe("0");
  }, 60_000);

  it("parse the script of the lookup of the window in front as PowerShell, and run none of it", async () => {
    const answer = await runPowershell(
      [
        "$errors = $null;",
        `[void][System.Management.Automation.Language.Parser]::ParseInput(${powershellString(await foregroundScript())}, [ref]$null, [ref]$errors);`,
        "$errors | ForEach-Object { $_.Message }; 'parsed'",
      ].join(" "),
    );
    expect(answer.stdout.trim(), answer.stderr).toBe("parsed");
  }, 60_000);

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

  // One start of PowerShell, with four CIM queries and two registry reads: about 2 seconds on the
  // Windows PC.
  it("read this computer's details for the run's record", async () => {
    const record = await collectMachineRecord(windowsMachineProbe(), nodeMachineFacts());
    expect(record.os.name).toMatch(/^Windows /);
    expect(record.os.build).toMatch(/^10\.0\.\d+\.\d+$/);
    expect(record.cpu.logicalProcessors).toBeGreaterThanOrEqual(1);
    expect(record.cpu.physicalCores).toBeGreaterThanOrEqual(1);
    expect(record.language).toMatch(/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/);
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

  it("find Guidepup's NVDA among the person's, whatever the spelling of its path", () => {
    const running = [
      { pid: 3, path: OWN_NVDA },
      { pid: 4, path: null },
      {
        pid: 2,
        path: "c:/users/PAT/appdata/local/GUIDEPUP/nvda/all/0.2.1-2026.2/extracted/NVDA.EXE",
      },
    ];
    expect(startedNvda(running, install.nvdaExe)).toBe(2);
    // Should two run from that path, it's the first listed.
    expect(startedNvda([{ pid: 1, path: install.nvdaExe }, ...running], install.nvdaExe)).toBe(1);
  });

  it("find no started NVDA when none runs from Guidepup's path, or none runs", () => {
    // A process whose path Windows doesn't give isn't taken for it.
    const persons = [
      { pid: 3, path: OWN_NVDA },
      { pid: 4, path: null },
    ];
    expect(startedNvda(persons, install.nvdaExe)).toBeNull();
    expect(startedNvda([], install.nvdaExe)).toBeNull();
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

  // What the lookup of the window in front prints: one line of JSON, from ConvertTo-Json.
  it("read the process, the program, and the title of the window in front from PowerShell's answer", () => {
    expect(
      parseForegroundWindow(
        '{"pid":4242,"program":"Microsoft Teams","title":"Chat | Microsoft Teams"}\r\n',
      ),
    ).toEqual({ pid: 4242, program: "Microsoft Teams", title: "Chat | Microsoft Teams" });
  });

  it("read no window in front from an answer that's empty, null, or isn't an object", () => {
    const answers = [
      "",
      " \r\n",
      "null",
      "7",
      "true",
      '"Microsoft Teams"',
      "[]",
      '[{"pid":4242,"program":"Microsoft Teams","title":"Chat"}]',
      "Add-Type : Cannot add type. Compilation errors occurred.",
    ];
    for (const answer of answers) expect(parseForegroundWindow(answer), answer).toBeNull();
  });

  it("read no window in front when the program is missing, empty, or not a name", () => {
    const programs = [
      '""',
      '"   "',
      "null",
      "7",
      "true",
      '["Microsoft Teams"]',
      '{"name":"Teams"}',
    ];
    for (const program of programs) {
      const answer = `{"pid":4242,"program":${program},"title":"Chat | Microsoft Teams"}`;
      expect(parseForegroundWindow(answer), answer).toBeNull();
    }
    expect(parseForegroundWindow('{"pid":4242,"title":"Chat | Microsoft Teams"}')).toBeNull();
    expect(parseForegroundWindow("{}")).toBeNull();
  });

  it("read no window in front when the process isn't a whole number above zero, or is missing", () => {
    // Zero is what Windows gives when it can't name the window's owner.
    const ids = ["0", "-1", "-4242", "0.5", "4242.5", '"4242"', "null", "true", "[4242]", "{}"];
    for (const id of ids) {
      const answer = `{"pid":${id},"program":"Microsoft Teams","title":"Chat | Microsoft Teams"}`;
      expect(parseForegroundWindow(answer), answer).toBeNull();
    }
    const missing = '{"program":"Microsoft Teams","title":"Chat | Microsoft Teams"}';
    expect(parseForegroundWindow(missing)).toBeNull();
  });

  it("read the smallest and the largest process id, a DWORD", () => {
    for (const pid of [1, 4, 4_294_967_295]) {
      const answer = `{"pid":${pid},"program":"Microsoft Teams","title":"Chat"}`;
      expect(parseForegroundWindow(answer)).toEqual({
        pid,
        program: "Microsoft Teams",
        title: "Chat",
      });
    }
  });

  it("read a window in front with no title as one with an empty title", () => {
    const none = { pid: 4242, program: "Microsoft Teams", title: "" };
    const answer = (title: string) => `{"pid":4242,"program":"Microsoft Teams"${title}}`;
    expect(parseForegroundWindow(answer(""))).toEqual(none);
    expect(parseForegroundWindow(answer(',"title":null'))).toEqual(none);
    expect(parseForegroundWindow(answer(',"title":""'))).toEqual(none);
    expect(parseForegroundWindow(answer(',"title":7'))).toEqual(none);
  });

  it("leave out the spaces round a program's name and a window's title", () => {
    const answer = '{"pid":4242,"program":"  Microsoft Teams ","title":" Chat "}';
    expect(parseForegroundWindow(answer)).toEqual({
      pid: 4242,
      program: "Microsoft Teams",
      title: "Chat",
    });
  });

  // The Windows 11 Notepad is a packaged app, and its file's description is its file's name.
  it("leave the .exe off a program that's named by its file, whatever its letter case", () => {
    const front = (program: string) =>
      parseForegroundWindow(JSON.stringify({ pid: 4242, program, title: "Untitled - Notepad" }));
    expect(front("Notepad.exe")).toEqual({
      pid: 4242,
      program: "Notepad",
      title: "Untitled - Notepad",
    });
    expect(front("NOTEPAD.EXE")?.program).toBe("NOTEPAD");
    expect(front("Notepad.Exe")?.program).toBe("Notepad");
    // The spaces round it, and between the name and the .exe, go too.
    expect(front("  Notepad.exe ")?.program).toBe("Notepad");
    expect(front("Windows Notepad .exe")?.program).toBe("Windows Notepad");
    // Only the ending goes, and only once.
    expect(front("notepad.exe.exe")?.program).toBe("notepad.exe");
  });

  it("keep a program's name that doesn't end in .exe, and a title that does", () => {
    const names = [
      "Microsoft Teams",
      "Application Frame Host",
      "Windows Explorer",
      "Notepad",
      "exe",
      "Notepadexe",
      "Notepad.exe Viewer",
      "Notepad.exe.config",
    ];
    for (const program of names) {
      const answer = JSON.stringify({ pid: 4242, program, title: "Chat" });
      expect(parseForegroundWindow(answer)?.program, program).toBe(program);
    }
    const title = "setup.exe - Properties";
    const answer = JSON.stringify({ pid: 4242, program: "Notepad.exe", title });
    expect(parseForegroundWindow(answer)).toEqual({ pid: 4242, program: "Notepad", title });
  });

  it("read no window in front when the program is only an .exe, whatever its case or spaces", () => {
    for (const program of [".exe", ".EXE", ".Exe", " .exe ", "  .exe"]) {
      const answer = JSON.stringify({ pid: 4242, program, title: "Untitled - Notepad" });
      expect(parseForegroundWindow(answer), answer).toBeNull();
    }
  });

  it("look for the app a Store app's window hosts, and still answer with the window's own process", async () => {
    const script = await foregroundScript();
    // A Store app's window belongs to the frame host, ApplicationFrameHost.exe, and the app's own
    // process owns a window below it.
    expect(script).toContain("EnumChildWindows");
    expect(script).toContain("HostedProcess");
    expect(script).toContain("ApplicationFrameHost.exe");
    // The answer's process is still the window's own, the frame host's: the driver tells its own
    // browser's window by it.
    expect(script).toContain("pid = $id");
    // Still no asking what the program was told to open.
    expect(script).not.toMatch(/CommandLine|Win32_Process/i);
  });

  it("read the characters JSON's escapes stand for, as PowerShell writes an apostrophe as \\u0027", () => {
    const answer =
      '{"pid":4242,"program":"Pat\\u0027s \\"Notes\\"","title":"Caf\\u00e9 \\u2013 menu"}';
    expect(parseForegroundWindow(answer)).toEqual({
      pid: 4242,
      program: 'Pat\'s "Notes"',
      title: "Café – menu",
    });
  });

  it("ask PowerShell once which window is in front, and give what it answers", async () => {
    const asked: string[] = [];
    const found = await foregroundWindow((script) => {
      asked.push(script);
      return Promise.resolve(
        '{"pid":4242,"program":"Microsoft Teams","title":"Chat | Microsoft Teams"}\r\n',
      );
    });
    expect(found).toEqual({
      pid: 4242,
      program: "Microsoft Teams",
      title: "Chat | Microsoft Teams",
    });
    expect(asked).toHaveLength(1);
  });

  it("find the window in front through user32, and name its program by its file's description", async () => {
    const asked: string[] = [];
    await foregroundWindow((script) => {
      asked.push(script);
      return Promise.resolve("");
    });
    const script = asked[0] ?? "";
    for (const call of ["GetForegroundWindow", "GetWindowThreadProcessId", "GetWindowText"]) {
      expect(script, call).toContain(call);
    }
    expect(script).toContain("[System.Diagnostics.FileVersionInfo]::GetVersionInfo");
    expect(script).toContain(".FileDescription");
    // The process name, when the file says nothing.
    expect(script).toContain("Get-Process");
    // The process that owns the window is in the answer: the driver tells its own browser by it.
    expect(script).toContain("pid = $id");
    // It asks for the program and the title, not for what the program was told to open.
    expect(script).not.toMatch(/CommandLine|Win32_Process/i);
  });

  it("find no window in front when PowerShell fails, or says nothing that is one", async () => {
    const answers = [
      () => Promise.reject(new Error("PowerShell didn't answer")),
      () => {
        throw new Error("spawn powershell.exe ENOENT");
      },
      () => Promise.resolve(""),
      () => Promise.resolve("Add-Type : Cannot add type."),
      () => Promise.resolve('{"pid":6048,"program":null,"title":"Program Manager"}'),
      // A window Windows can't name an owner for: Get-Process finds an Idle process for pid 0.
      () => Promise.resolve('{"pid":0,"program":"Idle","title":""}'),
    ];
    for (const answer of answers) expect(await foregroundWindow(answer)).toBeNull();
  });

  // The lookup is part of a step: a PowerShell that's slow to start mustn't hold the step up.
  it("find no window in front once PowerShell has taken 10 seconds, and not before", async () => {
    vi.useFakeTimers();
    try {
      let settled = false;
      const lookup = foregroundWindow(() => new Promise<string>(() => {})).then((found) => {
        settled = true;
        return found;
      });
      await vi.advanceTimersByTimeAsync(9_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
      expect(await lookup).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("give the answer of a PowerShell that answered in time, and leave no timer running", async () => {
    vi.useFakeTimers();
    try {
      const lookup = foregroundWindow(async () => {
        await new Promise((resolve) => setTimeout(resolve, 9_000));
        return '{"pid":4242,"program":"Microsoft Teams","title":"Chat"}';
      });
      await vi.advanceTimersByTimeAsync(9_000);
      expect(await lookup).toEqual({ pid: 4242, program: "Microsoft Teams", title: "Chat" });
      // A timer left running would keep voicecap from exiting for the rest of the 10 seconds.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
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

  // What the probe's script printed on the Windows PC on 2026-09-30.
  const sample =
    '{"caption":"Microsoft Windows 11 Pro","displayVersion":"25H2","version":"10.0.26200","ubr":9550,"cpuMhz":2400,"cores":20,"width":3440,"height":1440,"refresh":59,"dpi":106,"language":"en-US"}';

  it("reads the computer's details from PowerShell's answer", () => {
    expect(parseWindowsMachine(sample)).toEqual({
      os: { name: "Windows 11 Pro 25H2", build: "10.0.26200.9550" },
      cpu: { baseMhz: 2400, physicalCores: 20 },
      // AppliedDPI 106 of 96 is 110%, rounded.
      display: { width: 3440, height: 1440, refreshHz: 59, scalePercent: 110 },
      language: "en-US",
    });
    const noDisplay = sample.replace(
      /"width":3440,"height":1440,"refresh":59,/,
      '"width":null,"height":null,"refresh":null,',
    );
    expect(parseWindowsMachine(noDisplay).display).toBeNull();
  });

  it("has no scaling without AppliedDPI, and no refresh rate Windows doesn't give", () => {
    expect(parseWindowsMachine(sample.replace('"dpi":106', '"dpi":null')).display).toEqual({
      width: 3440,
      height: 1440,
      refreshHz: 59,
      scalePercent: null,
    });
    expect(parseWindowsMachine(sample.replace('"refresh":59', '"refresh":null')).display).toEqual({
      width: 3440,
      height: 1440,
      refreshHz: null,
      scalePercent: 110,
    });
  });

  // Win32_VideoController's CurrentRefreshRate is 0 or 1 for the hardware's default rate, and
  // 4294967295 when the rate is unknown: none of them is a rate.
  it("has no refresh rate for Windows's readings that aren't one", () => {
    const refresh = (rate: number) =>
      parseWindowsMachine(sample.replace('"refresh":59', `"refresh":${rate}`)).display?.refreshHz;
    expect([0, 1, 4294967295, 1001, 59.5].map(refresh)).toEqual([null, null, null, null, 59.5]);
    expect([2, 24, 60, 144, 240, 1000].map(refresh)).toEqual([2, 24, 60, 144, 240, 1000]);
  });

  it("rounds the scaling to a whole percent of 96 dots per inch", () => {
    const scale = (dpi: number) =>
      parseWindowsMachine(sample.replace('"dpi":106', `"dpi":${dpi}`)).display?.scalePercent;
    expect([96, 120, 144, 168, 192].map(scale)).toEqual([100, 125, 150, 175, 200]);
  });

  it("leaves out what PowerShell gave no answer for, or left out altogether", () => {
    const nothing = {
      os: { name: "Windows", build: null },
      cpu: { baseMhz: null, physicalCores: null },
      display: null,
      language: null,
    };
    const nulls =
      '{"caption":null,"displayVersion":null,"version":null,"ubr":null,"cpuMhz":null,"cores":null,"width":null,"height":null,"refresh":null,"dpi":null,"language":null}';
    expect(parseWindowsMachine(nulls)).toEqual(nothing);
    expect(parseWindowsMachine("{}")).toEqual(nothing);
    expect(parseWindowsMachine("null")).toEqual(nothing);
    // A blank language, or a number that isn't one, is no answer either.
    const blank = sample
      .replace('"language":"en-US"', '"language":""')
      .replace('"cores":20', '"cores":0');
    expect(parseWindowsMachine(blank)).toMatchObject({
      cpu: { baseMhz: 2400, physicalCores: null },
      language: null,
    });
  });

  it("joins the update revision to the version, when Windows has one", () => {
    const build = (ubr: string) => parseWindowsMachine(sample.replace('"ubr":9550', ubr)).os.build;
    expect(build('"ubr":9550')).toBe("10.0.26200.9550");
    expect(build('"ubr":0')).toBe("10.0.26200.0");
    expect(build('"ubr":null')).toBe("10.0.26200");
  });

  it("drops only a leading Microsoft from the caption, and adds the display version if there is one", () => {
    const server = sample
      .replace("Microsoft Windows 11 Pro", "Microsoft Windows Server 2022 Datacenter")
      .replace("25H2", "21H2");
    expect(parseWindowsMachine(server).os.name).toBe("Windows Server 2022 Datacenter 21H2");
    expect(parseWindowsMachine(sample.replace("Microsoft ", "")).os.name).toBe(
      "Windows 11 Pro 25H2",
    );
    expect(parseWindowsMachine(sample.replace('"25H2"', "null")).os.name).toBe("Windows 11 Pro");
  });

  it("fails on an answer that isn't JSON", () => {
    expect(() => parseWindowsMachine("Get-CimInstance : Access denied")).toThrow();
  });

  it("asks PowerShell once for the computer's details, however many parts are read", async () => {
    const asked: string[] = [];
    const probe = windowsMachineProbe((script) => {
      asked.push(script);
      return Promise.resolve(sample);
    });
    expect(asked).toEqual([]); // nothing is asked until a part is read
    const parts = await Promise.all([probe.os(), probe.cpu(), probe.display(), probe.language()]);
    expect(parts).toEqual([
      { name: "Windows 11 Pro 25H2", build: "10.0.26200.9550" },
      { baseMhz: 2400, physicalCores: 20 },
      { width: 3440, height: 1440, refreshHz: 59, scalePercent: 110 },
      "en-US",
    ]);
    await probe.display();
    expect(asked).toHaveLength(1);
  });

  it("fails each part, on its own, when PowerShell doesn't answer", async () => {
    const probe = windowsMachineProbe(() => Promise.reject(new Error("PowerShell didn't answer")));
    await expect(probe.os()).rejects.toThrow("PowerShell didn't answer");
    await expect(probe.cpu()).rejects.toThrow("PowerShell didn't answer");
    await expect(probe.display()).rejects.toThrow("PowerShell didn't answer");
    await expect(probe.language()).rejects.toThrow("PowerShell didn't answer");
  });

  // A PowerShell that didn't answer once (busy, or slow to start) may the next time: a later
  // session asks again, and keeps the answer once there is one.
  it("asks PowerShell again after it didn't answer, and not once it has", async () => {
    const answers = [
      () => Promise.reject(new Error("PowerShell didn't answer")),
      () => Promise.resolve("Get-CimInstance : Access denied"),
      () => Promise.resolve(sample),
    ];
    let asked = 0;
    const probe = windowsMachineProbe(() => answers[asked++]!());
    await expect(probe.os()).rejects.toThrow("PowerShell didn't answer");
    // An answer that isn't JSON is no answer either.
    await expect(probe.os()).rejects.toThrow();
    await expect(probe.os()).resolves.toEqual({
      name: "Windows 11 Pro 25H2",
      build: "10.0.26200.9550",
    });
    await expect(probe.language()).resolves.toBe("en-US");
    expect(asked).toBe(3);
  });

  it("asks for nothing that names the computer, its maker or model, or the account", async () => {
    const asked: string[] = [];
    await windowsMachineProbe((script) => {
      asked.push(script);
      return Promise.resolve(sample);
    }).os();
    expect(asked[0]).toContain("Win32_OperatingSystem");
    expect(asked[0]).not.toMatch(
      /ComputerName|Win32_ComputerSystem|CSName|Manufacturer|Model\b|USERNAME|RegisteredUser|hostname/i,
    );
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

  it("says what's wrong, and how to fix it one command to a step", () => {
    expect(unsafePathProblem(install)).toEqual({
      whatsWrong,
      fix: [
        "Choose a folder whose path has only letters, digits, and - _ . in its names. These steps use C:\\guidepup.",
        `Make the folder, if it isn't there yet: mkdir "C:\\guidepup"`,
        `Tell Guidepup to use it: setx GUIDEPUP_SCREEN_READERS_PATH "C:\\guidepup"`,
        "Open a new terminal and install NVDA there: npx @icjia/voicecap setup",
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

  it("says the same in one message, the steps numbered, each on a line of its own", () => {
    expect(unsafePathMessage(install)).toBe(
      [
        whatsWrong,
        "How to fix:",
        "  1. Choose a folder whose path has only letters, digits, and - _ . in its names. These steps use C:\\guidepup.",
        `  2. Make the folder, if it isn't there yet: mkdir "C:\\guidepup"`,
        `  3. Tell Guidepup to use it: setx GUIDEPUP_SCREEN_READERS_PATH "C:\\guidepup"`,
        "  4. Open a new terminal and install NVDA there: npx @icjia/voicecap setup",
      ].join("\n"),
    );
  });

  // The steps are shown wrapped, so a command inside a sentence breaks in the middle, and the
  // sentence's comma or period gets copied after it. So each command ends a step of its own, and
  // double quotes make the commands the same in PowerShell and Git Bash: no step names a terminal
  // (Windows PowerShell 5.1 has no &&, so none chains commands with it either).
  it("ends each command's step with the command, and names no terminal", () => {
    const steps = unsafePathProblem(install)?.fix ?? [];
    const message = unsafePathMessage(install) ?? "";
    expect(steps).toHaveLength(4);
    for (const step of steps.slice(1)) expect(step).not.toMatch(/[.,;:!?]$/);
    for (const text of [...steps, ...message.split("\n").slice(1)]) {
      expect(text).not.toMatch(/PowerShell|Git Bash|&&|\bthen\b/);
    }
  });
});

// NVDA writes its log to nvda.log in the temp folder, and moves the last one to nvda-old.log
// whenever it starts. voicecap reads nvda.log once its own NVDA has quit; these use a folder of
// their own, never the real temp folder's log.
describe("reading NVDA's own log", () => {
  function tempFolder(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "voicecap-nvda-log-"));
    temps.push(dir);
    return dir;
  }

  it("reads nvda.log in the folder, and no other file", async () => {
    const dir = tempFolder();
    writeFileSync(
      path.join(dir, "nvda.log"),
      "IO - speech.speech.speak:\nSpeaking ['Welcome ©']\n",
    );
    writeFileSync(path.join(dir, "nvda-old.log"), "The log of the NVDA before.\n");
    await expect(readNvdaLog(dir)).resolves.toBe(
      "IO - speech.speech.speak:\nSpeaking ['Welcome ©']\n",
    );
  });

  it("reads it as NVDA writes it, in UTF-8, and decodes it as an imported log is", async () => {
    const dir = tempFolder();
    writeFileSync(path.join(dir, "nvda.log"), Buffer.from("\ufeffSpeaking ['Café']\r\n", "utf8"));
    // A byte order mark isn't part of the text.
    await expect(readNvdaLog(dir)).resolves.toBe("Speaking ['Café']\r\n");
  });

  it("gives null when there is no log, whatever else is in the folder", async () => {
    const dir = tempFolder();
    await expect(readNvdaLog(dir)).resolves.toBeNull();
    writeFileSync(path.join(dir, "nvda-old.log"), "The log of the NVDA before.\n");
    await expect(readNvdaLog(dir)).resolves.toBeNull();
    // A folder that isn't there has no log either.
    await expect(readNvdaLog(path.join(dir, "missing"))).resolves.toBeNull();
  });

  it("gives an empty log as empty text, which is for the caller to judge", async () => {
    const dir = tempFolder();
    writeFileSync(path.join(dir, "nvda.log"), "");
    await expect(readNvdaLog(dir)).resolves.toBe("");
  });

  it("fails, saying why, when the log can't be read", async () => {
    const dir = tempFolder();
    // A folder where the file goes: nothing can be read from it.
    mkdirSync(path.join(dir, "nvda.log"));
    await expect(readNvdaLog(dir)).rejects.toThrow(/EISDIR/);
  });
});
