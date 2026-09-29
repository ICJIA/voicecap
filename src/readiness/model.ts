/**
 * The screen-reader-neutral readiness model: what a platform's checks report, and what a
 * platform module (Mac or Windows) exposes so `init`, `doctor`, `setup`, and runs can use the
 * same checks. Types only; see render.ts for the text these are turned into.
 */

export type CheckStatus = "OK" | "WARN" | "FAIL";

/** One thing that's wrong, and how to fix it. */
export interface Problem {
  /** e.g. "Full Disk Access for Visual Studio Code" */
  title: string;
  /** Follows "What's wrong: " */
  whatsWrong: string;
  /** Numbered under "How to fix:" */
  fix: string[];
  /** Adds "Or run npx @icjia/voicecap setup, which walks you through it." */
  setupHelps: boolean;
  open?: { kind: "settings"; url: string; page: string } | { kind: "app"; name: string };
  /** Passes only after the terminal app quits and reopens. */
  needsRestart?: boolean;
}

export interface Check {
  id: string;
  status: CheckStatus;
  summary: string;
  problem?: Problem;
}

export interface CheckRunner {
  id: string;
  run(): Promise<Check>;
}

export interface MachineInfo {
  lines: { label: string; value: string }[];
  /** For the run summary, e.g. "NVDA 2026.2", "VoiceOver 10". */
  screenReader: string | null;
  /** For the run summary, e.g. "Windows 11 Pro 24H2", "macOS 26.6.2". */
  system: string;
}

export interface PreflightResult {
  info: MachineInfo;
  checks: Check[];
  ready: boolean;
}

export interface PlatformReadiness {
  /** "NVDA", "VoiceOver", or null (Linux). */
  readonly screenReader: string | null;
  /** Why runs can't happen here yet, or null when they can. */
  readonly cannotRunYet: string | null;
  /** Printed after "Ready: …" */
  readonly readyTip: string | null;
  /** Said before asking to run the live test. */
  readonly liveTestNotice: string[];
  /**
   * Said just before the quick checks start, by init, doctor, and setup: on a Mac, a check can
   * raise macOS's System Events prompt, and wait up to 60 seconds for it. Empty elsewhere.
   */
  readonly checkingNotice: string[];
  machineInfo(): Promise<MachineInfo>;
  quickChecks(): CheckRunner[];
  /** Throws InterruptedError on Ctrl+C. */
  liveTest: ((signal?: AbortSignal) => Promise<Check[]>) | null;
}
