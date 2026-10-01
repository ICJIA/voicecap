import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import {
  windowsReadiness,
  type WindowsReadinessDeps,
} from "../src/drivers/guidepup/readiness-windows.js";
import { loadPlatformReadiness, type ReadinessOptions } from "../src/drivers/readiness.js";
import { ForegroundError, type EnvironmentInfo } from "../src/drivers/types.js";
import { InterruptedError } from "../src/passes/steps.js";
import type { LiveCheck } from "../src/readiness/live-check.js";
import type { Check } from "../src/readiness/model.js";
import { EnvironmentError } from "../src/util/errors.js";
import { silentLogger } from "../src/util/log.js";

const AGAIN = "npx @icjia/voicecap doctor";
const GIB = 1024 ** 3;
const install = {
  build: "0.2.1-2026.2",
  cacheDir: "C:\\Users\\pat\\AppData\\Local\\guidepup",
  nvdaExe: "C:\\Users\\pat\\AppData\\Local\\guidepup\\nvda\\all\\0.2.1-2026.2\\extracted\\nvda.exe",
};
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const LOCK = "C:\\Users\\pat\\AppData\\Local\\voicecap\\nvda.lock";
const OWN_NVDA = "C:\\Program Files (x86)\\NVDA\\nvda.exe";

const OPTIONS: Omit<ReadinessOptions, "platform"> = {
  config: DEFAULT_CONFIG,
  logger: silentLogger,
  env: {},
  cwd: "C:\\work",
  again: AGAIN,
};

const environment: EnvironmentInfo = {
  driver: { name: "guidepup", version: "0.34.0" },
  screenReader: { name: "NVDA", version: "2026.2", build: "0.2.1-2026.2", language: "en-US" },
  capture: "complete",
  browser: { name: "Chrome", version: "142.0.7444.60" },
  os: "Windows 11 Pro 24H2 (10.0.26100)",
  screenReaderSettings: {},
};

const passingLiveCheck: LiveCheck = {
  environment,
  speech: ["heading, level 1, voicecap doctor check", "Doctor button, button"],
  stepMs: 1300,
};

/** A ready Windows computer: ICJIA-PC, a Dell with Chrome, and Guidepup's NVDA installed. */
function fakeDeps(overrides: Partial<WindowsReadinessDeps> = {}): WindowsReadinessDeps {
  return {
    nodeVersion: "24.11.1",
    voicecapVersion: "0.4.0",
    guidepup: {
      version: "0.34.0",
      dir: "C:\\voicecap\\node_modules\\@guidepup\\guidepup",
      nvdaBuild: "0.2.1-2026.2",
    },
    install,
    exists: (file) => file === install.nvdaExe,
    nvdaProcesses: () => Promise.resolve([]),
    otherVoicecap: () => Promise.resolve(null),
    nvdaLockFile: LOCK,
    sessionLocked: () => Promise.resolve(false),
    system: () => ({ os: "Windows 11 Pro 24H2", uiLocale: "en-US" }),
    computerModel: () => Promise.resolve("Dell Inc. OptiPlex 7010"),
    hostname: () => "ICJIA-PC",
    username: () => "pat",
    cpu: () => "Intel(R) Core(TM) i7-13700",
    totalmem: () => 32 * GIB,
    disk: () => Promise.resolve({ free: 400 * GIB, total: 953 * GIB }),
    resolveBrowser: () => ({ name: "Chrome", path: CHROME }),
    browserVersion: (file) => Promise.resolve(file === CHROME ? "142.0.7444.60" : null),
    transcripts: "C:\\Users\\pat\\voicecap-transcripts",
    liveCheck: () => Promise.resolve(passingLiveCheck),
    ...overrides,
  };
}

function windows(overrides: Partial<WindowsReadinessDeps> = {}) {
  return windowsReadiness({ platform: "win32", ...OPTIONS }, fakeDeps(overrides));
}

async function quickCheck(id: string, overrides: Partial<WindowsReadinessDeps> = {}) {
  const runner = windows(overrides)
    .quickChecks()
    .find((candidate) => candidate.id === id);
  if (!runner) throw new Error(`There's no quick check "${id}".`);
  return runner.run();
}

async function liveTest(overrides: Partial<WindowsReadinessDeps> = {}): Promise<Check[]> {
  const test = windows(overrides).liveTest;
  if (!test) throw new Error("Windows has no live test.");
  return test();
}

describe("Windows readiness", () => {
  it("is for NVDA, which can run here, and warns before the live test", () => {
    const platform = windows();
    expect(platform.screenReader).toBe("NVDA");
    expect(platform.cannotRunYet).toBeNull();
    expect(platform.readyTip).toBeNull();
    expect(platform.liveTestNotice).toEqual([
      "The live test takes about 20 seconds. NVDA speaks and takes over the keyboard, so keep your hands off.",
    ]);
    // Windows' checks raise no prompt, so there's nothing to say before them.
    expect(platform.checkingNotice).toEqual([]);
  });

  it("runs its quick checks in order", () => {
    expect(
      windows()
        .quickChecks()
        .map((runner) => runner.id),
    ).toEqual(["node", "guidepupFolder", "nvda", "otherVoicecap", "ownNvda", "session", "browser"]);
  });

  it("is what voicecap loads on Windows", async () => {
    const platform = await loadPlatformReadiness({ platform: "win32", ...OPTIONS });
    expect(platform.screenReader).toBe("NVDA");
    expect(platform.quickChecks().map((runner) => runner.id)).toEqual([
      "node",
      "guidepupFolder",
      "nvda",
      "otherVoicecap",
      "ownNvda",
      "session",
      "browser",
    ]);
  });
});

describe("Windows machine info", () => {
  it("describes this computer, NVDA, the browser, and where voicecap keeps things", async () => {
    const info = await windows().machineInfo();
    expect(info.lines).toEqual([
      { label: "Computer", value: "ICJIA-PC, user pat" },
      {
        label: "Model",
        value:
          "Dell Inc. OptiPlex 7010, Intel(R) Core(TM) i7-13700, 32 GB memory, 400 GB free of 953 GB",
      },
      { label: "System", value: `Windows 11 Pro 24H2, ${process.arch}` },
      { label: "Node.js", value: "24.11.1" },
      { label: "voicecap", value: "0.4.0, with @guidepup/guidepup 0.34.0" },
      { label: "Screen reader", value: "NVDA 2026.2 (Guidepup's build 0.2.1-2026.2)" },
      { label: "Browser", value: "Chrome 142.0.7444.60" },
      { label: "Language", value: "English (United States)" },
      { label: "Transcripts", value: "C:\\Users\\pat\\voicecap-transcripts" },
      { label: "Guidepup files", value: "C:\\Users\\pat\\AppData\\Local\\guidepup" },
      { label: "Browser path", value: CHROME },
    ]);
    expect(info.screenReader).toBe("NVDA 2026.2");
    expect(info.system).toBe("Windows 11 Pro 24H2");
  });

  it("leaves out the parts of the Model line it can't find", async () => {
    const info = await windows({
      computerModel: () => Promise.resolve(null),
      cpu: () => null,
      disk: () => Promise.resolve(null),
    }).machineInfo();
    expect(info.lines.find((line) => line.label === "Model")?.value).toBe("32 GB memory");
  });

  it("names the browser without a version when its file doesn't give one", async () => {
    const info = await windows({ browserVersion: () => Promise.resolve(null) }).machineInfo();
    expect(info.lines.find((line) => line.label === "Browser")?.value).toBe("Chrome");
  });

  it("says when there's no browser, and has no browser path then", async () => {
    const info = await windows({
      resolveBrowser: () => {
        throw new EnvironmentError("Google Chrome isn't installed.");
      },
    }).machineInfo();
    expect(info.lines.find((line) => line.label === "Browser")?.value).toBe("none found");
    expect(info.lines.map((line) => line.label)).not.toContain("Browser path");
  });

  it("says when Windows doesn't give its display language", async () => {
    const info = await windows({
      system: () => ({ os: "Windows 11 Pro 24H2", uiLocale: null }),
    }).machineInfo();
    expect(info.lines.find((line) => line.label === "Language")?.value).toBe("unknown");
  });
});

describe("Windows quick checks", () => {
  it("pass Node.js 22.19 or later, and fail an older one", async () => {
    expect(await quickCheck("node")).toEqual({
      id: "node",
      status: "OK",
      summary: "Node.js 24.11.1",
    });
    expect(await quickCheck("node", { nodeVersion: "22.18.2" })).toEqual({
      id: "node",
      status: "FAIL",
      summary: "Node.js 22.18.2 is too old",
      problem: {
        title: "Node.js",
        whatsWrong: "voicecap needs Node.js 22.19 or later.",
        fix: [
          "Install the current Node.js LTS from https://nodejs.org.",
          "Run npx @icjia/voicecap doctor again.",
        ],
        setupHelps: false,
      },
    });
  });

  it("pass Guidepup's folder when NVDA can start from it", async () => {
    expect(await quickCheck("guidepupFolder")).toEqual({
      id: "guidepupFolder",
      status: "OK",
      summary: "Guidepup's folder: C:\\Users\\pat\\AppData\\Local\\guidepup",
    });
  });

  it("fail Guidepup's folder when its path has a space, with the fix", async () => {
    const check = await quickCheck("guidepupFolder", {
      install: { ...install, cacheDir: "C:\\Users\\Jane Doe\\AppData\\Local\\guidepup" },
    });
    expect(check).toEqual({
      id: "guidepupFolder",
      status: "FAIL",
      summary: "Guidepup's folder has a path NVDA can't start from",
      problem: {
        title: "Guidepup's folder",
        whatsWrong:
          "Guidepup's NVDA is in C:\\Users\\Jane Doe\\AppData\\Local\\guidepup, and that path has a space in it. Guidepup can't start NVDA from such a path (it runs nvda.exe through the Windows command shell without quoting its path).",
        fix: [
          "Choose a folder whose path has only letters, digits, and - _ . in its names, set GUIDEPUP_SCREEN_READERS_PATH to it, and install NVDA there. In PowerShell: mkdir C:\\guidepup, then setx GUIDEPUP_SCREEN_READERS_PATH C:\\guidepup. In Git Bash: mkdir -p /c/guidepup && setx GUIDEPUP_SCREEN_READERS_PATH 'C:\\guidepup'",
          "Open a new terminal and run: npx @icjia/voicecap setup",
        ],
        setupHelps: false,
      },
    });
  });

  it("pass NVDA when Guidepup's build is installed", async () => {
    expect(await quickCheck("nvda")).toEqual({
      id: "nvda",
      status: "OK",
      summary: "NVDA 2026.2 (Guidepup's build 0.2.1-2026.2) is installed",
    });
  });

  it("fail NVDA when Guidepup's build isn't installed, pointing at setup", async () => {
    expect(await quickCheck("nvda", { exists: () => false })).toEqual({
      id: "nvda",
      status: "FAIL",
      summary: "NVDA for voicecap isn't installed",
      problem: {
        title: "NVDA for voicecap",
        whatsWrong:
          "voicecap uses Guidepup's own copy of NVDA (build 0.2.1-2026.2), and it isn't installed yet.",
        fix: ["Run npx @icjia/voicecap setup."],
        setupHelps: true,
      },
    });
  });

  it("pass when no other voicecap holds NVDA's lock", async () => {
    expect(await quickCheck("otherVoicecap")).toEqual({
      id: "otherVoicecap",
      status: "OK",
      summary: "No other voicecap is using NVDA",
    });
  });

  it("fail when another voicecap is using NVDA, saying where its lock is", async () => {
    const check = await quickCheck("otherVoicecap", {
      otherVoicecap: () =>
        Promise.resolve({ pid: 999, host: "ICJIA-PC", startedAt: "2026-09-28T08:00:00-05:00" }),
    });
    expect(check).toEqual({
      id: "otherVoicecap",
      status: "FAIL",
      summary: "Another voicecap is using NVDA",
      problem: {
        title: "Another voicecap",
        whatsWrong:
          "Another voicecap (process 999, started 2026-09-28T08:00:00-05:00) is using NVDA on this computer, and only one can at a time.",
        fix: [
          "Wait for it to finish, or stop it.",
          "If no other voicecap is running, delete its lock: C:\\Users\\pat\\AppData\\Local\\voicecap\\nvda.lock",
          "Run npx @icjia/voicecap doctor again.",
        ],
        setupHelps: false,
      },
    });
  });

  it("say so when the person's own NVDA isn't running", async () => {
    expect(await quickCheck("ownNvda")).toEqual({
      id: "ownNvda",
      status: "OK",
      summary: "Your NVDA isn't running",
    });
  });

  it("warn that the person's own NVDA is running, and will be turned back on", async () => {
    const check = await quickCheck("ownNvda", {
      nvdaProcesses: () => Promise.resolve([{ pid: 1234, path: OWN_NVDA }]),
    });
    expect(check).toEqual({
      id: "ownNvda",
      status: "WARN",
      summary: "Your NVDA is running: voicecap will use its own NVDA, then turn yours back on",
    });
  });

  it("don't count Guidepup's own NVDA as the person's, whatever the letter case", async () => {
    const guidepups = [
      "c:\\users\\PAT\\appdata\\local\\GUIDEPUP\\nvda\\all\\0.2.1-2026.2\\extracted\\NVDA.EXE",
      "C:/Users/pat/AppData/Local/guidepup/nvda/all/0.2.1-2026.2/extracted/nvda.exe",
    ];
    for (const path of guidepups) {
      const check = await quickCheck("ownNvda", {
        nvdaProcesses: () => Promise.resolve([{ pid: 4321, path }]),
      });
      expect(check.status, path).toBe("OK");
    }
  });

  it("warn when the person's NVDA runs beside Guidepup's", async () => {
    const check = await quickCheck("ownNvda", {
      nvdaProcesses: () =>
        Promise.resolve([
          { pid: 4321, path: install.nvdaExe },
          { pid: 1234, path: OWN_NVDA },
        ]),
    });
    expect(check.status).toBe("WARN");
  });

  it("warn about an nvda.exe whose path Windows doesn't give, without promising to turn it back on", async () => {
    const check = await quickCheck("ownNvda", {
      nvdaProcesses: () => Promise.resolve([{ pid: 1234, path: null }]),
    });
    expect(check).toEqual({
      id: "ownNvda",
      status: "WARN",
      summary:
        "Your NVDA is running: voicecap will use its own NVDA. Afterwards, start yours again the way you usually do",
    });
  });

  it("promise to turn the person's NVDA back on when one of theirs has a known path", async () => {
    const check = await quickCheck("ownNvda", {
      nvdaProcesses: () =>
        Promise.resolve([
          { pid: 1234, path: null },
          { pid: 5678, path: OWN_NVDA },
        ]),
    });
    expect(check.summary).toBe(
      "Your NVDA is running: voicecap will use its own NVDA, then turn yours back on",
    );
  });

  it("don't count Guidepup's known path toward turning the person's NVDA back on", async () => {
    const check = await quickCheck("ownNvda", {
      nvdaProcesses: () =>
        Promise.resolve([
          { pid: 4321, path: install.nvdaExe },
          { pid: 1234, path: null },
        ]),
    });
    expect(check.summary).toBe(
      "Your NVDA is running: voicecap will use its own NVDA. Afterwards, start yours again the way you usually do",
    );
  });

  it("warn, without failing, when they can't tell whether the person's NVDA is running", async () => {
    const check = await quickCheck("ownNvda", {
      nvdaProcesses: () => Promise.reject(new Error("PowerShell didn't answer")),
    });
    expect(check).toEqual({
      id: "ownNvda",
      status: "WARN",
      summary: "Couldn't tell whether your NVDA is running (PowerShell didn't answer)",
    });
  });

  it("pass an unlocked Windows session", async () => {
    expect(await quickCheck("session")).toEqual({
      id: "session",
      status: "OK",
      summary: "Windows is unlocked",
    });
  });

  it("warn when Windows doesn't say whether it's locked", async () => {
    expect(await quickCheck("session", { sessionLocked: () => Promise.resolve(null) })).toEqual({
      id: "session",
      status: "WARN",
      summary: "Windows didn't say whether it's locked: keep it unlocked while voicecap runs",
    });
  });

  it("fail a locked Windows session", async () => {
    expect(await quickCheck("session", { sessionLocked: () => Promise.resolve(true) })).toEqual({
      id: "session",
      status: "FAIL",
      summary: "Windows is locked",
      problem: {
        title: "Windows is locked",
        whatsWrong: "NVDA can't press keys or speak while Windows is locked.",
        fix: ["Unlock the computer.", "Run npx @icjia/voicecap doctor again."],
        setupHelps: false,
      },
    });
  });

  it("pass the browser voicecap would launch", async () => {
    expect(await quickCheck("browser")).toEqual({
      id: "browser",
      status: "OK",
      summary: "Browser: Chrome",
    });
  });

  it("fail when there's no browser, saying why", async () => {
    const check = await quickCheck("browser", {
      resolveBrowser: () => {
        throw new EnvironmentError("Google Chrome isn't installed.");
      },
    });
    expect(check).toEqual({
      id: "browser",
      status: "FAIL",
      summary: "No browser for voicecap",
      problem: {
        title: "The browser",
        whatsWrong: "Google Chrome isn't installed.",
        fix: ["Run npx @icjia/voicecap setup."],
        setupHelps: true,
      },
    });
  });
});

describe("the Windows live test", () => {
  it("reports what NVDA said, the browser in front, and NVDA's language", async () => {
    expect(await liveTest()).toEqual([
      {
        id: "liveHear",
        status: "OK",
        summary:
          'NVDA speaks: "heading, level 1, voicecap doctor check" / "Doctor button, button" (1.3 s per step)',
      },
      {
        id: "liveFront",
        status: "OK",
        summary: "The browser came to the front (checked with NVDA+T)",
      },
      { id: "liveLanguage", status: "OK", summary: "NVDA's language: English (United States)" },
    ]);
  });

  it("fails when voicecap hears nothing from NVDA", async () => {
    const checks = await liveTest({
      liveCheck: () => Promise.resolve({ ...passingLiveCheck, speech: ["", ""] }),
    });
    expect(checks[0]).toEqual({
      id: "liveHear",
      status: "FAIL",
      summary: "NVDA started, but voicecap heard nothing from it",
      problem: {
        title: "NVDA's speech",
        whatsWrong: "NVDA started, but voicecap captured no speech from it.",
        fix: [
          "Run npx @icjia/voicecap doctor again.",
          "If it happens again, run npx @icjia/voicecap setup.",
        ],
        setupHelps: true,
      },
    });
  });

  it("warns when NVDA doesn't speak English, which voicecap's phrasing assumes", async () => {
    const checks = await liveTest({
      liveCheck: () =>
        Promise.resolve({
          ...passingLiveCheck,
          environment: {
            ...environment,
            screenReader: { ...environment.screenReader!, language: "de-DE" },
          },
        }),
    });
    expect(checks.find((check) => check.id === "liveLanguage")).toEqual({
      id: "liveLanguage",
      status: "WARN",
      summary:
        "NVDA's language is German (Germany): voicecap's end-of-page detection and flags expect NVDA's English phrasing",
    });
  });

  it("warns when NVDA's language isn't known", async () => {
    const checks = await liveTest({
      liveCheck: () =>
        Promise.resolve({
          ...passingLiveCheck,
          environment: {
            ...environment,
            screenReader: { ...environment.screenReader!, language: null },
          },
        }),
    });
    expect(checks.find((check) => check.id === "liveLanguage")).toEqual({
      id: "liveLanguage",
      status: "WARN",
      summary:
        "NVDA's language is unknown: voicecap's end-of-page detection and flags expect NVDA's English phrasing",
    });
  });

  it("fails when the browser doesn't come to the front", async () => {
    const message = 'The browser didn\'t come to the front: NVDA+T said "Inbox - Outlook".';
    expect(
      await liveTest({ liveCheck: () => Promise.reject(new ForegroundError(message)) }),
    ).toEqual([
      {
        id: "liveFront",
        status: "FAIL",
        summary: "The browser didn't come to the front",
        problem: {
          title: "The browser's window",
          whatsWrong: message,
          fix: [
            "Don't use the keyboard or mouse during the test.",
            "Run npx @icjia/voicecap doctor again.",
          ],
          setupHelps: false,
        },
      },
    ]);
  });

  it("fails with the error when NVDA or the browser don't work", async () => {
    const failing = () => Promise.reject(new EnvironmentError("NVDA didn't start: Timed out"));
    expect(await liveTest({ liveCheck: failing })).toEqual([
      {
        id: "liveTest",
        status: "FAIL",
        summary: "The live test failed",
        problem: {
          title: "The live test",
          whatsWrong: "NVDA didn't start: Timed out",
          fix: ["Run npx @icjia/voicecap doctor again."],
          setupHelps: false,
        },
      },
    ]);
  });

  it("stops at Ctrl+C, passing the signal to the live check", async () => {
    const controller = new AbortController();
    let given: AbortSignal | undefined;
    const platform = windows({
      liveCheck: (signal) => {
        given = signal;
        return Promise.reject(new InterruptedError());
      },
    });
    await expect(platform.liveTest?.(controller.signal)).rejects.toThrow(InterruptedError);
    expect(given).toBe(controller.signal);
  });
});
