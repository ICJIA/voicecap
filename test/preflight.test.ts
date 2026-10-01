/**
 * voicecap preflight, through main(): the quick checks on their own, with a verdict at the end.
 * A test that runs the checks gives a fake PlatformReadiness (or takes Linux's own, which only
 * reads this computer's details), so nothing here starts a screen reader or a browser: the fakes'
 * live tests are spies that must never be called.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "../src/cli/main.js";
import type { ReadinessOptions } from "../src/drivers/readiness.js";
import type { Check, PlatformReadiness, Problem } from "../src/readiness/model.js";
import type { OutputStream } from "../src/util/log.js";
import { scriptedPlatform } from "./helpers/scripted-platform.js";

/** A stream that records what's written to it, and says it's a terminal when `terminal` is true. */
function screen(terminal = false) {
  let text = "";
  const stream: OutputStream = {
    write: (chunk) => ((text += chunk), true),
    ...(terminal && { isTTY: true }),
  };
  return { stream, text: () => text };
}

const folders: string[] = [];

/** Runs `voicecap <args>` with the fake readiness, in a new empty folder; Linux unless `os` says. */
async function run(
  args: string[],
  readiness: PlatformReadiness | undefined,
  options: { out?: ReturnType<typeof screen>; os?: NodeJS.Platform; run?: typeof main } = {},
) {
  const out = options.out ?? screen();
  const err = screen();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "voicecap-preflight-"));
  folders.push(cwd);
  const code = await (options.run ?? main)(args, {
    stdout: out.stream,
    stderr: err.stream,
    cwd,
    env: {},
    signal: new AbortController().signal,
    interactive: false,
    // Never the real platform: a test gives a fake, or takes Linux's own readiness.
    platform: options.os ?? "linux",
    ...(readiness && { platformReadiness: () => Promise.resolve(readiness) }),
  });
  return { code, out: out.text(), err: err.text() };
}

beforeEach(() => {
  // The header says the time: this is 2026-10-01 14:05 wherever the tests run.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 1, 14, 5));
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await Promise.all(folders.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const MACHINE = {
  lines: [
    { label: "Computer", value: "TEST-PC, user pat" },
    { label: "System", value: "Windows 11 Pro 24H2 (10.0.26100), x64" },
  ],
  screenReader: "NVDA 2026.2",
  system: "Windows 11 Pro 24H2",
};

const ok = (id: string, summary: string): Check => ({ id, status: "OK", summary });
const warn = (id: string, summary: string): Check => ({ id, status: "WARN", summary });
const fail = (id: string, summary: string, problem: Problem): Check => ({
  id,
  status: "FAIL",
  summary,
  problem,
});

const NVDA_MISSING: Problem = {
  title: "NVDA for voicecap isn't installed",
  whatsWrong: "voicecap's own copy of NVDA isn't on this computer.",
  fix: ["Run npx @icjia/voicecap setup."],
  setupHelps: true,
};

const LOCKED: Problem = {
  title: "Windows is locked",
  whatsWrong: "voicecap can't use the keyboard while the computer is locked.",
  fix: ["Unlock the computer.", "Run npx @icjia/voicecap preflight again."],
  setupHelps: false,
};

const BROWSER_MISSING: Problem = {
  title: "No browser",
  whatsWrong: "voicecap found neither Google Chrome nor Playwright's Chromium.",
  fix: ["Install Google Chrome."],
  setupHelps: true,
};

const WINDOWS_READY = {
  node: [ok("node", "Node.js 22.19.0")],
  nvda: [ok("nvda", "NVDA 2026.2 is installed")],
  browser: [ok("browser", "Browser: Chrome")],
};

/** A Windows PC, whose live test is a spy: it counts the times it's called, and it must be none. */
function windows(script: Record<string, Check[]> = WINDOWS_READY) {
  let liveTests = 0;
  const { platform } = scriptedPlatform(script, {
    screenReader: "NVDA",
    machineInfo: () => Promise.resolve(MACHINE),
    liveTestNotice: [
      "The live test takes about 20 seconds. NVDA speaks and takes over the keyboard, so keep your hands off.",
    ],
    liveTest: () => {
      liveTests++;
      return Promise.resolve([ok("liveSpeech", "NVDA speaks")]);
    },
  });
  return { platform, liveTests: () => liveTests };
}

const MAC_NOTICE =
  'Checking this Mac. If macOS asks for access to control "System Events", click Allow.';

// What the real Mac readiness says until its VoiceOver driver exists (readiness-mac.ts). preflight
// doesn't print it: "run this command on a Windows computer", right after a preflight, would read
// as "run preflight there".
const CANNOT_RUN_YET =
  "voicecap can't run VoiceOver yet: that comes with its VoiceOver driver. For now, run this command on a Windows computer.";

// What preflight says instead, after a passing Mac's green line.
const MAC_ENDING =
  "voicecap can't run VoiceOver audits yet: that comes with its VoiceOver driver. To hear VoiceOver work now: npx @icjia/voicecap doctor (a 20-second live test; hands off the keyboard and mouse).";

const MAC_READY = {
  macos: [ok("macos", "macOS 26 is supported")],
  voiceOver: [ok("voiceOver", "VoiceOver's files for Guidepup are installed")],
};

/** A Mac before the VoiceOver driver, whose live test is a spy: it must never be called. */
function mac(
  script: Record<string, Check[]> = MAC_READY,
  overrides: Partial<PlatformReadiness> = {},
) {
  let liveTests = 0;
  const { platform } = scriptedPlatform(script, {
    screenReader: "VoiceOver",
    cannotRunYet: CANNOT_RUN_YET,
    readyTip: "Tip: turn on Do Not Disturb, so notifications don't interrupt VoiceOver.",
    checkingNotice: [MAC_NOTICE],
    machineInfo: () => Promise.resolve(MACHINE),
    liveTest: () => {
      liveTests++;
      return Promise.resolve([ok("liveHear", "VoiceOver hears the page")]);
    },
    ...overrides,
  });
  return { platform, liveTests: () => liveTests };
}

/** So that only the output's stream and NO_COLOR decide the color, not node:util's own check. */
function allowColor(): void {
  vi.stubEnv("FORCE_COLOR", "1");
  vi.stubEnv("NO_COLOR", undefined);
}

describe("voicecap preflight", () => {
  it("says a ready computer can run voicecap, and what to do next", async () => {
    const result = await run(["preflight"], windows().platform);

    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toBe(
      [
        "voicecap preflight, 2026-10-01 14:05",
        "",
        "This computer",
        "  Computer        TEST-PC, user pat",
        "  System          Windows 11 Pro 24H2 (10.0.26100), x64",
        "",
        "Checks",
        "  OK    Node.js 22.19.0",
        "  OK    NVDA 2026.2 is installed",
        "  OK    Browser: Chrome",
        "",
        "✓ Ready: this computer can run voicecap.",
        "Next: npx @icjia/voicecap doctor adds a 20-second live test with NVDA (hands off the keyboard and mouse), or npx @icjia/voicecap init sets up a run.",
        "",
      ].join("\n"),
    );
  });

  it("never starts the screen reader, whether the computer is ready or not", async () => {
    const ready = windows();
    const readyRun = await run(["preflight"], ready.platform);
    const broken = windows({
      ...WINDOWS_READY,
      nvda: [fail("nvda", "NVDA for voicecap isn't installed", NVDA_MISSING)],
    });
    const brokenRun = await run(["preflight"], broken.platform);

    expect(readyRun.code).toBe(0);
    expect(brokenRun.code).toBe(2);
    expect(ready.liveTests()).toBe(0);
    expect(broken.liveTests()).toBe(0);
    // Nor does it warn that the screen reader is about to speak.
    expect(readyRun.out + brokenRun.out).not.toContain("The live test takes about 20 seconds");
  });

  it("says what to fix on a computer that isn't ready, then how to check again", async () => {
    const { platform } = windows({
      ...WINDOWS_READY,
      nvda: [fail("nvda", "NVDA for voicecap isn't installed", NVDA_MISSING)],
    });

    const result = await run(["preflight"], platform);

    expect(result.err).toBe("");
    expect(result.code).toBe(2);
    expect(result.out).toBe(
      [
        "voicecap preflight, 2026-10-01 14:05",
        "",
        "This computer",
        "  Computer        TEST-PC, user pat",
        "  System          Windows 11 Pro 24H2 (10.0.26100), x64",
        "",
        "Checks",
        "  OK    Node.js 22.19.0",
        "  FAIL  NVDA for voicecap isn't installed",
        "  OK    Browser: Chrome",
        "",
        "1. NVDA for voicecap isn't installed",
        "   What's wrong: voicecap's own copy of NVDA isn't on this computer.",
        "   How to fix:",
        "     1. Run npx @icjia/voicecap setup.",
        "",
        "✗ Not ready: 1 thing to fix.",
        "Fix these, then run npx @icjia/voicecap preflight again.",
        "",
      ].join("\n"),
    );
  });

  it("counts everything to fix, and numbers each fix, with setup offered where it helps", async () => {
    const { platform } = windows({
      node: [ok("node", "Node.js 22.19.0")],
      nvda: [fail("nvda", "NVDA for voicecap isn't installed", NVDA_MISSING)],
      session: [fail("session", "Windows is locked", LOCKED)],
      browser: [fail("browser", "No browser", BROWSER_MISSING)],
    });

    const result = await run(["preflight"], platform);

    expect(result.code).toBe(2);
    expect(result.out).toContain("\n1. NVDA for voicecap isn't installed\n");
    expect(result.out).toContain("\n2. Windows is locked\n");
    expect(result.out).toContain("\n3. No browser\n");
    expect(result.out).toContain(
      "     1. Install Google Chrome.\n   Or run npx @icjia/voicecap setup, which walks you through it.\n",
    );
    expect(
      result.out.endsWith(
        "\n✗ Not ready: 3 things to fix.\nFix these, then run npx @icjia/voicecap preflight again.\n",
      ),
    ).toBe(true);
    // One verdict, not renderPreflight's own "Not ready: 3 problems." as well.
    expect(result.out).not.toContain("Not ready: 3 problems");
  });

  it("calls a computer with only warnings ready, and shows its warnings", async () => {
    const { platform } = windows({
      ...WINDOWS_READY,
      ownNvda: [
        warn(
          "ownNvda",
          "Your NVDA is running: voicecap will use its own NVDA, then turn yours back on",
        ),
      ],
    });

    const result = await run(["preflight"], platform);

    expect(result.code).toBe(0);
    expect(result.out).toContain(
      "  WARN  Your NVDA is running: voicecap will use its own NVDA, then turn yours back on\n",
    );
    expect(result.out).toContain("\n✓ Ready: this computer can run voicecap.\nNext: ");
  });

  it("says a Mac that passes every check can't run VoiceOver audits yet, and how to hear it work", async () => {
    const { platform, liveTests } = mac();

    const result = await run(["preflight"], platform, { os: "darwin" });

    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out.endsWith(`\n✓ Ready: this Mac passed every check.\n${MAC_ENDING}\n`)).toBe(
      true,
    );
    // Not the platform's own note, which tells a reader to run the command on a Windows computer.
    expect(result.out).not.toContain(CANNOT_RUN_YET);
    expect(result.out).not.toContain("Windows computer");
    // The note replaces the next steps, and the verdict says it once: not renderPreflight's too.
    expect(result.out).not.toContain("Next:");
    expect(result.out).not.toContain("Ready: this computer");
    // It points to the live test without running it.
    expect(liveTests()).toBe(0);
  });

  it("says a Mac's notice before its checks begin", async () => {
    const out = screen();
    let shown: string | null = null;
    const { platform } = mac(MAC_READY, {
      // The preflight's first call.
      machineInfo: () => {
        shown = out.text();
        return Promise.resolve(MACHINE);
      },
    });

    const result = await run(["preflight"], platform, { os: "darwin", out });

    expect(shown).toBe(`${MAC_NOTICE}\n\n`);
    expect(result.out.startsWith(`${MAC_NOTICE}\n\nvoicecap preflight, 2026-10-01 14:05\n`)).toBe(
      true,
    );
  });

  it("fixes a Mac that doesn't pass like any other computer, naming what to fix", async () => {
    const { platform } = mac({
      macos: [ok("macos", "macOS 26 is supported")],
      fullDiskAccess: [
        fail("fullDiskAccess", "Full Disk Access: Visual Studio Code isn't allowed", {
          title: "Full Disk Access for Visual Studio Code",
          whatsWrong:
            "macOS blocks Visual Studio Code from the folder VoiceOver's settings are in.",
          fix: ["Open System Settings.", "Run npx @icjia/voicecap preflight again."],
          setupHelps: true,
        }),
      ],
    });

    const result = await run(["preflight"], platform, { os: "darwin" });

    expect(result.code).toBe(2);
    expect(result.out).toContain("\n1. Full Disk Access for Visual Studio Code\n");
    expect(
      result.out.endsWith(
        "\n✗ Not ready: 1 thing to fix.\nFix these, then run npx @icjia/voicecap preflight again.\n",
      ),
    ).toBe(true);
    expect(result.out).not.toContain("can't run VoiceOver");
  });

  it("says plainly on Linux that voicecap can't drive a screen reader there, and exits 2", async () => {
    // Linux's own readiness, not a fake: it only reads this computer's details.
    const result = await run(["preflight"], undefined);

    expect(result.err).toBe("");
    expect(result.code).toBe(2);
    // The platform check's own words, as init and setup print them.
    expect(result.out).toContain("1. No screen reader to drive here\n");
    // The renderer wraps it at 92 columns, so read it as words.
    expect(result.out.replace(/\s+/g, " ")).toContain(
      "voicecap drives NVDA on Windows and VoiceOver on macOS, and neither runs here.",
    );
    expect(
      result.out.endsWith(
        "\n✗ Not ready: voicecap can't drive a screen reader on this computer.\n",
      ),
    ).toBe(true);
    // Nothing to fix by trying again.
    expect(result.out).not.toContain("Fix these");
    expect(result.out).not.toContain("thing to fix");
  });

  it("loads this platform's checks as doctor does, naming this command to run again", async () => {
    const asked: ReadinessOptions[] = [];
    vi.resetModules();
    vi.doMock("../src/drivers/readiness.js", () => ({
      loadPlatformReadiness: (options: ReadinessOptions) => {
        asked.push(options);
        return Promise.resolve(
          windows({
            nvda: [
              fail("nvda", "NVDA for voicecap isn't installed", {
                ...NVDA_MISSING,
                fix: [`Run ${options.again} again.`],
              }),
            ],
          }).platform,
        );
      },
    }));
    try {
      const { main: mainWithFakeChecks } = await import("../src/cli/main.js");

      const result = await run(["preflight"], undefined, {
        os: "darwin",
        run: mainWithFakeChecks,
      });

      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatchObject({
        platform: "darwin",
        again: "npx @icjia/voicecap preflight",
      });
      expect(result.out).toContain("     1. Run npx @icjia/voicecap preflight again.\n");
    } finally {
      vi.doUnmock("../src/drivers/readiness.js");
      vi.resetModules();
    }
  });
});

describe("voicecap preflight's color", () => {
  it("is plain when the output isn't a terminal", async () => {
    allowColor();

    const ready = await run(["preflight"], windows().platform);
    const broken = await run(
      ["preflight"],
      windows({ ...WINDOWS_READY, nvda: [fail("nvda", "NVDA is missing", NVDA_MISSING)] }).platform,
    );

    expect(ready.out).toContain("✓ Ready: this computer can run voicecap.\n");
    expect(broken.out).toContain("✗ Not ready: 1 thing to fix.\n");
    expect(ready.out + broken.out).not.toContain("\u001b");
  });

  it("is plain at a terminal when NO_COLOR is set", async () => {
    allowColor();
    vi.stubEnv("NO_COLOR", "1");

    const ready = await run(["preflight"], windows().platform, { out: screen(true) });
    const broken = await run(
      ["preflight"],
      windows({ ...WINDOWS_READY, nvda: [fail("nvda", "NVDA is missing", NVDA_MISSING)] }).platform,
      { out: screen(true) },
    );

    expect(ready.out).toContain("✓ Ready: this computer can run voicecap.\n");
    expect(broken.out).toContain("✗ Not ready: 1 thing to fix.\n");
    expect(ready.out + broken.out).not.toContain("\u001b");
  });

  it("shows the ready verdict green at a terminal, and nothing else colored", async () => {
    allowColor();

    const colored = await run(["preflight"], windows().platform, { out: screen(true) });
    const plain = await run(["preflight"], windows().platform);

    expect(colored.out).toContain(
      "\n\u001b[32m✓ Ready: this computer can run voicecap.\u001b[39m\n",
    );
    // Only the verdict carries color: take it away and it's the plain output, word for word.
    expect(colored.out.replace("\u001b[32m", "").replace("\u001b[39m", "")).toBe(plain.out);
  });

  it("shows the not-ready verdict red at a terminal, and nothing else colored", async () => {
    allowColor();
    const broken = () =>
      windows({ ...WINDOWS_READY, nvda: [fail("nvda", "NVDA is missing", NVDA_MISSING)] }).platform;

    const colored = await run(["preflight"], broken(), { out: screen(true) });
    const plain = await run(["preflight"], broken());

    expect(colored.out).toContain(
      "\n\u001b[31m✗ Not ready: 1 thing to fix.\u001b[39m\nFix these, then run npx @icjia/voicecap preflight again.\n",
    );
    expect(colored.out.replace("\u001b[31m", "").replace("\u001b[39m", "")).toBe(plain.out);
  });

  it("shows a Mac's passing verdict green, and its note plain", async () => {
    allowColor();

    const result = await run(["preflight"], mac().platform, {
      os: "darwin",
      out: screen(true),
    });

    expect(
      result.out.endsWith(
        `\n\u001b[32m✓ Ready: this Mac passed every check.\u001b[39m\n${MAC_ENDING}\n`,
      ),
    ).toBe(true);
  });
});

describe("voicecap --help", () => {
  it("lists preflight among the commands, with what it does", async () => {
    const result = await run(["--help"], undefined);

    expect(result.code).toBe(0);
    // The help wraps its descriptions at 80 columns, so read it as words.
    const commands = result.out.slice(result.out.indexOf("Commands:")).replace(/\s+/g, " ");
    expect(commands).toContain(
      " preflight check this computer is ready for a run, without starting the screen reader ",
    );
    for (const name of ["init", "demo", "setup", "doctor"]) {
      expect(commands).toContain(` ${name} `);
    }
  });
});
