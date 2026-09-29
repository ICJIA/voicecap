import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { loadPlatformReadiness } from "../src/drivers/readiness.js";
import {
  browserCheck,
  MIN_NODE,
  nodeCheck,
  otherVoicecapCheck,
} from "../src/readiness/common-checks.js";
import { diskSpace, gigabytes, homePath, languageName } from "../src/readiness/machine.js";
import type { Check, CheckRunner, PlatformReadiness } from "../src/readiness/model.js";
import { runCheck, runPreflight } from "../src/readiness/preflight.js";
import { resolveHome } from "../src/run/paths.js";
import { silentLogger } from "../src/util/log.js";

function fakeRunner(id: string, check: Check): CheckRunner {
  return { id, run: () => Promise.resolve(check) };
}

function fakePlatform(quickChecks: () => CheckRunner[]): PlatformReadiness {
  return {
    screenReader: "Fake",
    cannotRunYet: null,
    readyTip: null,
    liveTestNotice: [],
    checkingNotice: [],
    liveTest: null,
    machineInfo: () => Promise.resolve({ lines: [], screenReader: "Fake", system: "FakeOS" }),
    quickChecks,
  };
}

describe("runPreflight", () => {
  it("is ready when every check is OK or WARN", async () => {
    const platform = fakePlatform(() => [
      fakeRunner("a", { id: "a", status: "OK", summary: "A is fine" }),
      fakeRunner("b", { id: "b", status: "WARN", summary: "B needs attention" }),
    ]);
    const result = await runPreflight(platform);
    expect(result.ready).toBe(true);
    expect(result.checks).toEqual([
      { id: "a", status: "OK", summary: "A is fine" },
      { id: "b", status: "WARN", summary: "B needs attention" },
    ]);
  });

  it("is not ready when one check FAILs", async () => {
    const problem = { title: "Oops", whatsWrong: "Broken.", fix: ["Fix it."], setupHelps: false };
    const platform = fakePlatform(() => [
      fakeRunner("a", { id: "a", status: "OK", summary: "A is fine" }),
      fakeRunner("b", { id: "b", status: "FAIL", summary: "B is broken", problem }),
    ]);
    const result = await runPreflight(platform);
    expect(result.ready).toBe(false);
  });

  it("runs the runners in order, one at a time", async () => {
    const order: string[] = [];
    const makeRunner = (id: string): CheckRunner => ({
      id,
      run: async () => {
        order.push(`start:${id}`);
        await Promise.resolve();
        order.push(`end:${id}`);
        return { id, status: "OK", summary: id };
      },
    });
    const platform = fakePlatform(() => [makeRunner("a"), makeRunner("b")]);
    await runPreflight(platform);
    expect(order).toEqual(["start:a", "end:a", "start:b", "end:b"]);
  });

  it('turns a throwing runner into the "Couldn\'t check" FAIL', async () => {
    const platform = fakePlatform(() => [
      { id: "flaky", run: () => Promise.reject(new Error("kaboom")) },
    ]);
    const result = await runPreflight(platform);
    expect(result.ready).toBe(false);
    expect(result.checks).toEqual([
      {
        id: "flaky",
        status: "FAIL",
        summary: "Couldn't check flaky: kaboom",
        problem: {
          title: "An unexpected error",
          whatsWrong: "kaboom",
          fix: ["Run npx @icjia/voicecap doctor and send its output to the voicecap maintainers."],
          setupHelps: false,
        },
      },
    ]);
  });
});

describe("runCheck", () => {
  it("gives a runner's check", async () => {
    const check: Check = { id: "a", status: "OK", summary: "A is fine" };
    expect(await runCheck(fakeRunner("a", check))).toEqual(check);
  });

  it('turns a runner that throws into the same "Couldn\'t check" FAIL as the preflight', async () => {
    const runner: CheckRunner = { id: "flaky", run: () => Promise.reject(new Error("kaboom")) };
    const platform = fakePlatform(() => [runner]);
    expect([await runCheck(runner)]).toEqual((await runPreflight(platform)).checks);
    expect(await runCheck(runner)).toMatchObject({
      status: "FAIL",
      summary: "Couldn't check flaky: kaboom",
    });
  });
});

const READINESS_OPTIONS = {
  config: DEFAULT_CONFIG,
  logger: silentLogger,
  env: {},
  cwd: "/work",
  again: "npx @icjia/voicecap init",
};

describe("loadPlatformReadiness", () => {
  it("gives Linux one FAIL check naming the platform, and no live test", async () => {
    const platform = await loadPlatformReadiness({ platform: "linux", ...READINESS_OPTIONS });
    expect(platform.screenReader).toBeNull();
    expect(platform.cannotRunYet).toBe("voicecap drives NVDA on Windows and VoiceOver on macOS.");
    expect(platform.readyTip).toBeNull();
    expect(platform.liveTestNotice).toEqual([]);
    expect(platform.checkingNotice).toEqual([]);
    expect(platform.liveTest).toBeNull();

    const runners = platform.quickChecks();
    expect(runners).toHaveLength(1);
    expect(await runners[0]?.run()).toEqual({
      id: "platform",
      status: "FAIL",
      summary: `This is ${os.type()}: voicecap drives NVDA on Windows and VoiceOver on macOS`,
      problem: {
        title: "No screen reader to drive here",
        whatsWrong:
          "voicecap drives NVDA on Windows and VoiceOver on macOS, and neither runs here.",
        fix: [
          "Use replay runs here: add --replay-from <run folder> to the command.",
          "Run real audits on a Windows computer or a Mac.",
        ],
        setupHelps: false,
      },
    });
  });

  it("reports Linux's machine info with the expected labels", async () => {
    const platform = await loadPlatformReadiness({ platform: "linux", ...READINESS_OPTIONS });
    const info = await platform.machineInfo();
    expect(info.screenReader).toBeNull();
    expect(info.system).toBe(`${os.type()} ${os.release()}`);
    expect(info.lines.map((line) => line.label)).toEqual([
      "Computer",
      "Model",
      "System",
      "Node.js",
      "voicecap",
      "Transcripts",
    ]);
    expect(info.lines.find((line) => line.label === "Computer")?.value).toBe(
      `${os.hostname()}, user ${os.userInfo().username}`,
    );
    expect(info.lines.find((line) => line.label === "Model")?.value).toContain("memory");
    expect(info.lines.find((line) => line.label === "System")?.value).toBe(
      `${os.type()} ${os.release()}, ${process.arch}`,
    );
    expect(info.lines.find((line) => line.label === "Node.js")?.value).toBe(process.versions.node);
    expect(info.lines.find((line) => line.label === "Transcripts")?.value).toBe(
      resolveHome({ env: READINESS_OPTIONS.env, cwd: READINESS_OPTIONS.cwd }),
    );
  });
});

describe("gigabytes", () => {
  it("rounds bytes to whole GiB", () => {
    expect(gigabytes(17179869184)).toBe("16 GB");
  });

  it("rounds half up", () => {
    expect(gigabytes(1024 ** 3 * 1.5)).toBe("2 GB");
  });
});

describe("languageName", () => {
  it("names en_US and en-US as English (United States)", () => {
    expect(languageName("en_US")).toBe("English (United States)");
    expect(languageName("en-US")).toBe("English (United States)");
  });

  it("is null for null", () => {
    expect(languageName(null)).toBeNull();
  });
});

describe("homePath", () => {
  it("shows a path under the home folder as ~/…", () => {
    expect(homePath("/Users/cschweda/Library/Caches/guidepup", "/Users/cschweda", path.posix)).toBe(
      "~/Library/Caches/guidepup",
    );
  });

  it("leaves a path outside the home folder alone", () => {
    expect(homePath("/opt/other/file", "/Users/cschweda", path.posix)).toBe("/opt/other/file");
  });

  it("reads each system's paths with that system's path functions, on any computer", () => {
    expect(homePath("C:\\Users\\pat\\AppData\\Local\\x", "C:\\Users\\pat", path.win32)).toBe(
      "~/AppData/Local/x",
    );
    expect(homePath("D:\\guidepup", "C:\\Users\\pat", path.win32)).toBe("D:\\guidepup");
    // Read as a Mac's, a backslash is part of a name, not a separator.
    expect(homePath("/Users/pat/a\\b", "/Users/pat", path.posix)).toBe("~/a\\b");
  });
});

describe("diskSpace", () => {
  it("computes free and total bytes from bavail/bsize/blocks", async () => {
    const fake = () => Promise.resolve({ bavail: 1000, bsize: 4096, blocks: 5000 });
    expect(await diskSpace("/anywhere", fake)).toEqual({ free: 4096000, total: 20480000 });
  });

  it("is null when statfs throws", async () => {
    const fake = (): never => {
      throw new Error("no such volume");
    };
    expect(await diskSpace("/anywhere", fake)).toBeNull();
  });
});

describe("nodeCheck", () => {
  it("is exactly MIN_NODE = [22, 19, 0]", () => {
    expect(MIN_NODE).toEqual([22, 19, 0]);
  });

  it("passes at the minimum and above", () => {
    expect(nodeCheck("22.19.0", "again")).toEqual({
      id: "node",
      status: "OK",
      summary: "Node.js 22.19.0",
    });
    expect(nodeCheck("24.1.0", "again")).toEqual({
      id: "node",
      status: "OK",
      summary: "Node.js 24.1.0",
    });
  });

  it("fails below the minimum, with the exact problem", () => {
    expect(nodeCheck("22.18.2", "npx @icjia/voicecap init")).toEqual({
      id: "node",
      status: "FAIL",
      summary: "Node.js 22.18.2 is too old",
      problem: {
        title: "Node.js",
        whatsWrong: "voicecap needs Node.js 22.19 or later.",
        fix: [
          "Install the current Node.js LTS from https://nodejs.org.",
          "Run npx @icjia/voicecap init again.",
        ],
        setupHelps: false,
      },
    });
  });
});

describe("otherVoicecapCheck", () => {
  it("OK when nothing else holds the lock", () => {
    expect(otherVoicecapCheck(null, "/lock", "NVDA", "again")).toEqual({
      id: "otherVoicecap",
      status: "OK",
      summary: "No other voicecap is using NVDA",
    });
  });

  it("FAILs naming the process, its start time, the screen reader, and the lock file", () => {
    const holder = { pid: 4242, startedAt: "2026-09-28 11:00" };
    const result = otherVoicecapCheck(
      holder,
      "/Users/cschweda/Library/Caches/voicecap/voiceover.lock",
      "VoiceOver",
      "npx @icjia/voicecap doctor",
    );
    expect(result).toEqual({
      id: "otherVoicecap",
      status: "FAIL",
      summary: "Another voicecap is using VoiceOver",
      problem: {
        title: "Another voicecap",
        whatsWrong:
          "Another voicecap (process 4242, started 2026-09-28 11:00) is using VoiceOver on " +
          "this computer, and only one can at a time.",
        fix: [
          "Wait for it to finish, or stop it.",
          "If no other voicecap is running, delete its lock: " +
            "/Users/cschweda/Library/Caches/voicecap/voiceover.lock",
          "Run npx @icjia/voicecap doctor again.",
        ],
        setupHelps: false,
      },
    });
  });
});

describe("browserCheck", () => {
  it("OK with the browser's name", () => {
    const result = browserCheck(() => ({
      name: "Chrome for Testing 153.0.8010.12",
      path: "/path/to/chrome",
    }));
    expect(result).toEqual({
      id: "browser",
      status: "OK",
      summary: "Browser: Chrome for Testing 153.0.8010.12",
    });
  });

  it("FAILs with the thrown message when resolve() throws", () => {
    const result = browserCheck(() => {
      throw new Error("No browser found.");
    });
    expect(result).toEqual({
      id: "browser",
      status: "FAIL",
      summary: "No browser for voicecap",
      problem: {
        title: "The browser",
        whatsWrong: "No browser found.",
        fix: ["Run npx @icjia/voicecap setup."],
        setupHelps: true,
      },
    });
  });
});
