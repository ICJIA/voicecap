import type { Speech } from "../drivers/types.js";
import type { DriverCommand, StepRecord } from "../model.js";
import { formatDuration } from "../util/time.js";

/** A driver call took longer than its timeout; the page runner restarts the driver and retries. */
export class StepTimeoutError extends Error {
  constructor(
    readonly what: string,
    readonly ms: number,
  ) {
    super(`${what} did not finish within ${formatDuration(ms)}`);
    this.name = "StepTimeoutError";
  }
}

/** The run was interrupted (Ctrl+C); the page is abandoned and stays pending. */
export class InterruptedError extends Error {
  constructor() {
    super("Interrupted");
    this.name = "InterruptedError";
  }
}

/**
 * Race a driver call against a timeout and an abort signal. The call itself can't be cancelled
 * (a hung screen reader is dealt with by restarting the driver), so its eventual result or
 * rejection is ignored.
 */
export async function withTimeout<T>(
  what: string,
  action: () => Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const call = action();
  call.catch(() => {});
  try {
    return await Promise.race([
      call,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new StepTimeoutError(what, ms)), ms);
        if (signal) {
          onAbort = () => reject(abortReason(signal));
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

/** A page timeout aborts with a StepTimeoutError; any other abort is an interruption. */
function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof StepTimeoutError ? signal.reason : new InterruptedError();
}

/** Records a pass's steps, timing each driver call and enforcing the step timeout. */
export class StepRecorder {
  readonly steps: StepRecord[] = [];
  private readonly started: number;

  constructor(
    private readonly stepTimeoutMs: number,
    private readonly signal: AbortSignal | undefined,
    private readonly clock: () => number = () => performance.now(),
  ) {
    this.started = clock();
  }

  get count(): number {
    return this.steps.length;
  }

  elapsedMs(): number {
    return Math.round(this.clock() - this.started);
  }

  /** Run one screen reader action as a recorded step. */
  async step(
    command: DriverCommand,
    action: () => Promise<Speech>,
    after?: () => Promise<Pick<StepRecord, "inDocument" | "focused">>,
  ): Promise<StepRecord> {
    const begin = this.clock();
    const spoken = await withTimeout(command, action, this.stepTimeoutMs, this.signal);
    const extra = after
      ? await withTimeout(`${command} focus check`, after, this.stepTimeoutMs, this.signal)
      : {};
    const end = this.clock();
    const record: StepRecord = {
      n: this.steps.length + 1,
      command,
      spoken,
      durationMs: Math.round(end - begin),
      offsetMs: Math.round(end - this.started),
      ...extra,
    };
    this.steps.push(record);
    return record;
  }

  /** A driver query that isn't a step of its own (e.g. what's focused before the first Tab). */
  query<T>(what: string, action: () => Promise<T>): Promise<T> {
    return withTimeout(what, action, this.stepTimeoutMs, this.signal);
  }
}

/** Speech compared for repeats: whitespace-normalized, otherwise exact. */
export function normalizeSpeech(speech: string): string {
  return speech.replace(/\s+/g, " ").trim();
}

export function sameSpeech(a: string, b: string): boolean {
  return normalizeSpeech(a) === normalizeSpeech(b);
}
