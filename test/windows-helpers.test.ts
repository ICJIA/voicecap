import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { chromium } from "playwright";
import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupOrphans,
  keepAwake,
  listProcesses,
  sessionLocked,
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
});
