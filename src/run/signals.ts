import { InterruptedError } from "../passes/steps.js";
import { ExitCode } from "../util/errors.js";
import type { Logger } from "../util/log.js";

/** Where signals come from, and how the process exits: the process itself, or a test's stand-in. */
export interface SignalSource {
  readonly platform: NodeJS.Platform;
  on(signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): unknown;
  removeListener(signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): unknown;
  exit(code: number): void;
}

/** What a run says on the first Ctrl+C. */
function runMessage(signal: NodeJS.Signals): string {
  return `${signal} received: saving state and shutting down NVDA and the browser. Press Ctrl+C again to exit immediately.`;
}

/**
 * Ctrl+C handling for a run, or for doctor. The first signal aborts the run: the current page is
 * abandoned (it stays pending), state is saved, and NVDA and the browser are stopped. A second
 * signal exits immediately. SIGHUP arrives when a Windows Terminal tab is closed; SIGBREAK is
 * Ctrl+Break. `message` is what the first signal says, a run's words unless given. Returns a
 * function that removes the handlers.
 */
export function handleInterrupts(
  controller: AbortController,
  logger: Logger,
  options: { message?: (signal: NodeJS.Signals) => string; source?: SignalSource } = {},
): () => void {
  const { message = runMessage, source = process } = options;
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  if (source.platform === "win32") signals.push("SIGBREAK");

  const onSignal = (signal: NodeJS.Signals) => {
    if (controller.signal.aborted) {
      logger.warn(`${signal} again: exiting now.`);
      source.exit(ExitCode.interrupted);
      return;
    }
    logger.warn(message(signal));
    controller.abort(new InterruptedError());
  };
  for (const signal of signals) source.on(signal, onSignal);
  return () => {
    for (const signal of signals) source.removeListener(signal, onSignal);
  };
}

/**
 * For the live test in init and setup, where the prompter keeps Ctrl+C to itself: SIGTERM, or the
 * SIGHUP of a closed terminal window (and SIGBREAK on Windows), stops it as Ctrl+C does, aborting
 * `controller`. A second one exits at once with 130, so exit hooks still run. Nothing is said: the
 * window may be gone. Returns a function that removes the listeners.
 */
export function stopOnClosedWindow(
  controller: AbortController,
  source: SignalSource = process,
): () => void {
  const signals: NodeJS.Signals[] = ["SIGTERM", "SIGHUP"];
  if (source.platform === "win32") signals.push("SIGBREAK");

  const onSignal = () => {
    if (controller.signal.aborted) source.exit(ExitCode.interrupted);
    else controller.abort(new InterruptedError());
  };
  for (const signal of signals) source.on(signal, onSignal);
  return () => {
    for (const signal of signals) source.removeListener(signal, onSignal);
  };
}
