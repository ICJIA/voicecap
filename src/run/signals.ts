import { InterruptedError } from "../passes/steps.js";
import { ExitCode } from "../util/errors.js";
import type { Logger } from "../util/log.js";

/**
 * Ctrl+C handling for a run. The first signal aborts the run: the current page is abandoned
 * (it stays pending), state is saved, and NVDA and the browser are stopped. A second signal exits
 * immediately. SIGHUP arrives when a Windows Terminal tab is closed; SIGBREAK is Ctrl+Break.
 * Returns a function that removes the handlers.
 */
export function handleInterrupts(controller: AbortController, logger: Logger): () => void {
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  if (process.platform === "win32") signals.push("SIGBREAK");

  const onSignal = (signal: NodeJS.Signals) => {
    if (controller.signal.aborted) {
      logger.warn(`${signal} again: exiting now.`);
      process.exit(ExitCode.interrupted);
    }
    logger.warn(
      `${signal} received: saving state and shutting down NVDA and the browser. Press Ctrl+C again to exit immediately.`,
    );
    controller.abort(new InterruptedError());
  };
  for (const signal of signals) process.on(signal, onSignal);
  return () => {
    for (const signal of signals) process.removeListener(signal, onSignal);
  };
}
