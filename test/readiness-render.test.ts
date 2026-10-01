import { describe, expect, it } from "vitest";

import type { Check, MachineInfo, PreflightResult, Problem } from "../src/readiness/model.js";
import {
  renderFixes,
  renderPreflight,
  renderProblems,
  renderRunSummary,
  renderVerdict,
} from "../src/readiness/render.js";

const TIP = "Tip: turn on Do Not Disturb, so notifications don't interrupt VoiceOver.";

const MACHINE_INFO: MachineInfo = {
  lines: [
    { label: "Computer", value: "cschweda's Mac mini, user cschweda" },
    { label: "Model", value: "Mac mini (Mac16,10), Apple M4, 16 GB memory, 72 GB free of 228 GB" },
    { label: "System", value: "macOS 26.6.2 (25G83), Apple silicon" },
    { label: "Terminal app", value: "Visual Studio Code (macOS gives permissions to this app)" },
    { label: "Node.js", value: "22.22.2" },
    { label: "voicecap", value: "0.4.0, with @guidepup/guidepup 0.34.0" },
    { label: "Screen reader", value: "VoiceOver 10 (build 993)" },
    { label: "Browser", value: "Chrome for Testing 153.0.8010.12 (Playwright's)" },
    { label: "Language", value: "English (United States)" },
    { label: "Transcripts", value: "/Users/cschweda/webdev/voicecap-transcripts" },
    { label: "Guidepup files", value: "/Users/cschweda/Library/Caches/guidepup" },
    { label: "Browser path", value: "~/Library/Caches/ms-playwright/chromium-1243/…" },
  ],
  screenReader: "VoiceOver 10",
  system: "macOS 26.6.2",
};

/** The spec's Full Disk Access problem: docs/superpowers/specs/2026-09-28-readiness-design.md. */
const FULL_DISK_ACCESS: Problem = {
  title: "Full Disk Access for Visual Studio Code",
  whatsWrong:
    "voicecap keeps its VoiceOver settings apart from yours by linking them into a folder macOS protects, and macOS blocks Visual Studio Code from that folder.",
  fix: [
    "Open System Settings, then Privacy & Security, then Full Disk Access.",
    "Switch on Visual Studio Code. If it isn't listed, click + and choose it.",
    "When macOS asks, quit and reopen Visual Studio Code.",
    "Run npx @icjia/voicecap init again.",
  ],
  setupHelps: true,
};

const CHECKS: Check[] = [
  { id: "macos-version", status: "OK", summary: "macOS 26 is supported" },
  { id: "voiceover-files", status: "OK", summary: "VoiceOver's files for Guidepup are installed" },
  { id: "applescript", status: "OK", summary: "VoiceOver can be controlled by AppleScript" },
  { id: "welcome-screen", status: "OK", summary: "VoiceOver's welcome screen is off" },
  { id: "accessibility", status: "OK", summary: "Accessibility: Visual Studio Code is allowed" },
  {
    id: "full-disk-access",
    status: "FAIL",
    summary: "Full Disk Access: Visual Studio Code isn't allowed",
    problem: FULL_DISK_ACCESS,
  },
  { id: "system-events", status: "OK", summary: "Visual Studio Code can control System Events" },
  {
    id: "voiceover-running",
    status: "WARN",
    summary: "VoiceOver is on: voicecap will use it, then turn it back on with your settings",
  },
];

const RESULT: PreflightResult = { info: MACHINE_INFO, checks: CHECKS, ready: false };

// This is the spec's "What someone sees" block, copied character for character from
// docs/superpowers/specs/2026-09-28-readiness-design.md (the fenced example under "## What
// someone sees"), minus its "$ npx @icjia/voicecap init" line and the blank line after it.
const EXPECTED_PREFLIGHT = `voicecap preflight, 2026-09-28 11:10

This computer
  Computer        cschweda's Mac mini, user cschweda
  Model           Mac mini (Mac16,10), Apple M4, 16 GB memory, 72 GB free of 228 GB
  System          macOS 26.6.2 (25G83), Apple silicon
  Terminal app    Visual Studio Code (macOS gives permissions to this app)
  Node.js         22.22.2
  voicecap        0.4.0, with @guidepup/guidepup 0.34.0
  Screen reader   VoiceOver 10 (build 993)
  Browser         Chrome for Testing 153.0.8010.12 (Playwright's)
  Language        English (United States)
  Transcripts     /Users/cschweda/webdev/voicecap-transcripts
  Guidepup files  /Users/cschweda/Library/Caches/guidepup
  Browser path    ~/Library/Caches/ms-playwright/chromium-1243/…

Checks
  OK    macOS 26 is supported
  OK    VoiceOver's files for Guidepup are installed
  OK    VoiceOver can be controlled by AppleScript
  OK    VoiceOver's welcome screen is off
  OK    Accessibility: Visual Studio Code is allowed
  FAIL  Full Disk Access: Visual Studio Code isn't allowed
  OK    Visual Studio Code can control System Events
  WARN  VoiceOver is on: voicecap will use it, then turn it back on with your settings

Not ready: 1 problem.

1. Full Disk Access for Visual Studio Code
   What's wrong: voicecap keeps its VoiceOver settings apart from yours by linking them into
   a folder macOS protects, and macOS blocks Visual Studio Code from that folder.
   How to fix:
     1. Open System Settings, then Privacy & Security, then Full Disk Access.
     2. Switch on Visual Studio Code. If it isn't listed, click + and choose it.
     3. When macOS asks, quit and reopen Visual Studio Code.
     4. Run npx @icjia/voicecap init again.
   Or run npx @icjia/voicecap setup, which walks you through it.`;

describe("renderPreflight", () => {
  it("renders the spec's example exactly", () => {
    const when = new Date(2026, 8, 28, 11, 10);
    const output = renderPreflight(RESULT, {
      kind: "preflight",
      when,
      screenReader: "VoiceOver",
      canRunYet: true,
      tip: TIP,
      offerSetup: true,
    });
    expect(output).toBe(EXPECTED_PREFLIGHT);
  });
});

describe("renderVerdict", () => {
  it("says Ready, with the tip", () => {
    const allOk: PreflightResult = {
      info: MACHINE_INFO,
      checks: [{ id: "node", status: "OK", summary: "22.22.2" }],
      ready: true,
    };
    const output = renderVerdict(allOk, {
      screenReader: "VoiceOver",
      canRunYet: true,
      tip: TIP,
      offerSetup: true,
    });
    expect(output).toBe(
      "Ready: this computer can run VoiceOver for voicecap.\n" +
        "Tip: turn on Do Not Disturb, so notifications don't interrupt VoiceOver.",
    );
  });

  // A Mac until the VoiceOver driver exists: set up, but nothing can run there yet.
  it("says the computer is set up, but voicecap can't run the screen reader yet", () => {
    const allOk: PreflightResult = {
      info: MACHINE_INFO,
      checks: [{ id: "node", status: "OK", summary: "22.22.2" }],
      ready: true,
    };
    const output = renderVerdict(allOk, {
      screenReader: "VoiceOver",
      canRunYet: false,
      tip: TIP,
      offerSetup: true,
    });
    expect(output).toBe(
      "Ready: this computer is set up for VoiceOver, but voicecap can't run VoiceOver yet: that comes with its VoiceOver driver.\n" +
        "Tip: turn on Do Not Disturb, so notifications don't interrupt VoiceOver.",
    );
  });
});

describe("renderProblems", () => {
  it("counts problems", () => {
    const checks: Check[] = [
      {
        id: "a",
        status: "FAIL",
        summary: "Problem A is wrong",
        problem: {
          title: "Problem A",
          whatsWrong: "Wrong A.",
          fix: ["Fix A1.", "Fix A2."],
          setupHelps: false,
        },
      },
      {
        id: "b",
        status: "FAIL",
        summary: "Problem B is wrong",
        problem: {
          title: "Problem B",
          whatsWrong: "Wrong B.",
          fix: ["Fix B1."],
          setupHelps: false,
        },
      },
    ];
    const output = renderProblems(checks, { offerSetup: true });
    expect(output).toBe(
      [
        "Not ready: 2 problems.",
        "",
        "1. Problem A",
        "   What's wrong: Wrong A.",
        "   How to fix:",
        "     1. Fix A1.",
        "     2. Fix A2.",
        "",
        "2. Problem B",
        "   What's wrong: Wrong B.",
        "   How to fix:",
        "     1. Fix B1.",
      ].join("\n"),
    );
  });

  it("offers setup once: not again when a fix step already says to run it", () => {
    const problem = (fix: string[]): Check => ({
      id: "nvda",
      status: "FAIL",
      summary: "NVDA for voicecap isn't installed",
      problem: { title: "NVDA for voicecap", whatsWrong: "It isn't there.", fix, setupHelps: true },
    });
    const SETUP = "   Or run npx @icjia/voicecap setup, which walks you through it.";
    const saysSetup = renderProblems([problem(["Run npx @icjia/voicecap setup."])], {
      offerSetup: true,
    });
    expect(saysSetup).toContain("     1. Run npx @icjia/voicecap setup.");
    expect(saysSetup).not.toContain(SETUP);
    const saysOther = renderProblems([problem(["Install it by hand."])], { offerSetup: true });
    expect(saysOther.endsWith(`     1. Install it by hand.\n${SETUP}`)).toBe(true);
  });

  it("leaves out the setup line when setup is the one asking", () => {
    const checks: Check[] = [
      {
        id: "full-disk-access",
        status: "FAIL",
        summary: "Full Disk Access: Visual Studio Code isn't allowed",
        problem: FULL_DISK_ACCESS,
      },
    ];
    const output = renderProblems(checks, { offerSetup: false });
    expect(output).not.toContain("Or run npx @icjia/voicecap setup");
  });

  it("wraps long text under its label", () => {
    const longWhatsWrong = Array.from({ length: 40 }, () => "abcd").join(" ");
    const checks: Check[] = [
      {
        id: "long",
        status: "FAIL",
        summary: "Something long is wrong",
        problem: {
          title: "A long problem",
          whatsWrong: longWhatsWrong,
          fix: ["Do the one thing."],
          setupHelps: false,
        },
      },
    ];
    const output = renderProblems(checks, { offerSetup: true });
    const lines = output.split("\n");
    const start = lines.findIndex((line) => line.startsWith("   What's wrong: "));
    const end = lines.indexOf("   How to fix:");
    const wrongLines = lines.slice(start, end);
    expect(wrongLines.length).toBeGreaterThan(1);
    for (const line of wrongLines) expect(line.length).toBeLessThanOrEqual(92);
    expect(wrongLines[1]).toMatch(/^ {3}[^ ]/);
  });
});

describe("renderFixes", () => {
  const failing = (id: string, title: string, fix: string[]): Check => ({
    id,
    status: "FAIL",
    summary: `${title} is wrong`,
    problem: { title, whatsWrong: `${title} is wrong.`, fix, setupHelps: false },
  });

  it("numbers each problem's block, as renderProblems does, with no heading of its own", () => {
    const checks: Check[] = [
      { id: "ok", status: "OK", summary: "Fine" },
      failing("a", "Problem A", ["Fix A1.", "Fix A2."]),
      { id: "warn", status: "WARN", summary: "Careful" },
      failing("b", "Problem B", ["Fix B1."]),
    ];

    const fixes = renderFixes(checks, { offerSetup: true });

    expect(fixes).toBe(
      [
        "1. Problem A",
        "   What's wrong: Problem A is wrong.",
        "   How to fix:",
        "     1. Fix A1.",
        "     2. Fix A2.",
        "",
        "2. Problem B",
        "   What's wrong: Problem B is wrong.",
        "   How to fix:",
        "     1. Fix B1.",
      ].join("\n"),
    );
    expect(renderProblems(checks, { offerSetup: true })).toBe(`Not ready: 2 problems.\n\n${fixes}`);
  });

  it("offers setup, or not, as renderProblems does", () => {
    const checks: Check[] = [
      {
        id: "full-disk-access",
        status: "FAIL",
        summary: "Full Disk Access: Visual Studio Code isn't allowed",
        problem: FULL_DISK_ACCESS,
      },
    ];
    const SETUP = "Or run npx @icjia/voicecap setup, which walks you through it.";

    expect(renderFixes(checks, { offerSetup: true })).toContain(SETUP);
    expect(renderFixes(checks, { offerSetup: false })).not.toContain(SETUP);
  });

  it("is empty when nothing failed", () => {
    expect(
      renderFixes(
        CHECKS.filter((check) => check.status !== "FAIL"),
        { offerSetup: true },
      ),
    ).toBe("");
  });
});

describe("renderRunSummary", () => {
  it("sums up a passing run in one line, plus warnings", () => {
    const result: PreflightResult = {
      info: { lines: [], screenReader: "NVDA 2026.2", system: "Windows 11 Pro 24H2" },
      checks: [
        { id: "node", status: "OK", summary: "22.22.2" },
        {
          id: "own-nvda",
          status: "WARN",
          summary: "Your NVDA is running: voicecap will use its own NVDA, then turn yours back on",
        },
      ],
      ready: true,
    };
    expect(renderRunSummary(result)).toBe(
      "Checks passed: NVDA 2026.2 on Windows 11 Pro 24H2\n" +
        "  WARN  Your NVDA is running: voicecap will use its own NVDA, then turn yours back on",
    );
  });
});
