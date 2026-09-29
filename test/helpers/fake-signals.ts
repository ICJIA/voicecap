/**
 * A stand-in for the process's signals, so no test sends a real one: `send` delivers a signal to
 * whatever listens, `added` records every signal listened for, and `exits` records process.exit.
 */
import { EventEmitter } from "node:events";

import type { SignalSource } from "../../src/run/signals.js";

export function fakeSignals(platform: NodeJS.Platform = "darwin") {
  const emitter = new EventEmitter();
  const added: string[] = [];
  const exits: number[] = [];
  const source: SignalSource = {
    platform,
    on: (signal, listener) => {
      added.push(signal);
      emitter.on(signal, listener);
    },
    removeListener: (signal, listener) => {
      emitter.removeListener(signal, listener);
    },
    exit: (code) => {
      exits.push(code);
    },
  };
  return {
    source,
    added,
    exits,
    send: (signal: NodeJS.Signals) => emitter.emit(signal, signal),
    /** The signals listened for right now. */
    listening: () =>
      emitter
        .eventNames()
        .filter((name) => emitter.listenerCount(name) > 0)
        .map(String)
        .sort(),
  };
}
