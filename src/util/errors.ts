import { ForegroundError } from "../drivers/types.js";
import type { FailureCause } from "../model.js";

/** Process exit codes. Documented in the README; keep them stable. */
export const ExitCode = {
  /** The command (or run) completed. Heuristic flags never change this. */
  ok: 0,
  /** Invalid usage or config, including an unreadable page source. */
  usage: 1,
  /** The environment is unusable (e.g. NVDA won't start). */
  environment: 2,
  /** A run completed but some pages failed. */
  pagesFailed: 3,
  /** voicecap verify found something recorded that has changed, is missing, or can't be checked. */
  verifyProblems: 3,
  /** Interrupted (Ctrl+C); state was saved. */
  interrupted: 130,
} as const;

/** An error voicecap reports to the user as a plain message, without a stack trace. */
export class VoicecapError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number = ExitCode.usage, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.exitCode = exitCode;
  }
}

/** Bad arguments or input files. Exit code 1. */
export class UsageError extends VoicecapError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, ExitCode.usage, options);
  }
}

/** An invalid or unreadable voicecap config. Exit code 1. */
export class ConfigError extends VoicecapError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, ExitCode.usage, options);
  }
}

/**
 * The machine can't run the requested work (screen reader, browser, network). Exit code 2.
 *
 * The errors a page can meet carry a failure code, which a page's record keeps (see causeOf in
 * src/run/failure.ts); the others have none.
 */
export class EnvironmentError extends VoicecapError {
  readonly failure: FailureCause | undefined;

  constructor(message: string, options?: ErrorOptions & { failure?: FailureCause }) {
    super(message, ExitCode.environment, options);
    this.failure = options?.failure;
  }
}

/** A feature that exists in the interface but isn't built yet. Exit code 1. */
export class NotImplementedError extends VoicecapError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, ExitCode.usage, options);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The program that took the foreground, from the ForegroundError that says so: its name, or null
 * when Windows didn't say. Undefined for a ForegroundError whose driver didn't look, and for every
 * other error, whatever properties it has: as causeOf takes a code only from voicecap's own errors,
 * this takes a program only from this one.
 */
export function programOf(error: unknown): string | null | undefined {
  return error instanceof ForegroundError ? error.program : undefined;
}
