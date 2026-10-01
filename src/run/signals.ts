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
 * For the live test in init and setup, where the prompter keeps Ctrl+C to itself, and for the
 * listener's question at the end of a session: SIGTERM, or the SIGHUP of a closed terminal window
 * (and SIGBREAK on Windows), stops it as Ctrl+C does, aborting `controller`. A second one exits at
 * once with 130, so exit hooks still run. Nothing is said: the window may be gone. Returns a
 * function that removes the listeners.
 */
export function stopOnClosedWindow(
  controller: AbortController,
  source: SignalSource = process,
): () => void {
  const signals: NodeJS.Signals[] = ["SIGTERM", "SIGHUP"];
  if (source.platform === "win32") signals.push("SIGBREAK");
  return stopOn(signals, controller, source);
}

/**
 * For voicecap demo's audit, where the prompter keeps Ctrl+C to itself while the terminal is in raw
 * mode. If the terminal leaves raw mode during the run, Ctrl+C arrives as a SIGINT instead, which
 * with no listener would end Node at once, with no exit hooks, leaving the screen reader and the
 * browser running. The first SIGINT aborts `controller`, as the prompter's Ctrl+C would; a second
 * exits at once with 130, so exit hooks still run. Nothing is said. Returns a function that
 * removes the listener.
 */
export function stopOnCtrlC(
  controller: AbortController,
  source: SignalSource = process,
): () => void {
  return stopOn(["SIGINT"], controller, source);
}

/**
 * Any of `signals` aborts `controller`, or, once it's aborted (by this or by another listener
 * sharing it), exits at once with 130.
 */
function stopOn(
  signals: readonly NodeJS.Signals[],
  controller: AbortController,
  source: SignalSource,
): () => void {
  const onSignal = () => {
    if (controller.signal.aborted) source.exit(ExitCode.interrupted);
    else controller.abort(new InterruptedError());
  };
  for (const signal of signals) source.on(signal, onSignal);
  return () => {
    for (const signal of signals) source.removeListener(signal, onSignal);
  };
}
