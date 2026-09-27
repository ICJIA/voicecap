/**
 * NVDA through @guidepup/guidepup 0.34.0, behind the driver's NvdaControl interface.
 *
 * Checked against Guidepup's source for the pinned version:
 * - Commands (next(), perform(), ...) return nothing; what NVDA said is the latest entry of the
 *   spoken-phrase log, which gets exactly one entry per command. voicecap reads it, then clears
 *   the log so a days-long run doesn't keep every phrase in memory.
 * - start() registers handlers for SIGINT, SIGTERM, SIGQUIT, SIGHUP, and beforeExit
 *   (lib/teardown.js) as soon as it's called, and they stop NVDA but never exit the process.
 *   voicecap handles those signals itself (saving state first), so the adapter removes Guidepup's
 *   handlers straight away, before NVDA has finished starting.
 * - Guidepup runs nvda.exe with spawn(..., { shell: true }) and separate arguments, which Node 24
 *   flags as deprecated (DEP0190) on every start and stop; that warning is hidden.
 * - Commands must never be issued inside capture(): both would wait for each other.
 * - Before every captured command, NVDAClient presses NVDA's stop-speech key without waiting for
 *   the result (#stopReading in lib/windows/NVDA/NVDAClient.js). When NVDA has died, that press
 *   fails, and nothing handles the rejection, which by default ends the process; loading Guidepup
 *   marks those presses as handled (handleUnawaitedKeyPresses). Commands then come back with no
 *   speech, so the driver checks isRunning() whenever a step is silent. Once Guidepup has given
 *   up reconnecting, commands come back at once (see checkCaptured).
 */
import { spawnSync } from "node:child_process";
import net from "node:net";

import type * as GuidepupModule from "@guidepup/guidepup";

import { EnvironmentError } from "../../util/errors.js";
import type { NvdaControl, NvdaKey } from "../guidepup-nvda.js";
import type { CaptureMode, Speech } from "../types.js";
import type { GuidepupInstall } from "./paths.js";

type Guidepup = typeof GuidepupModule;
type KeyCommand = Parameters<Guidepup["nvda"]["perform"]>[0];

/** The events Guidepup's teardown handlers listen for. */
const GUIDEPUP_EVENTS = ["SIGINT", "SIGTERM", "SIGQUIT", "SIGHUP", "beforeExit"];
/** NVDA's Remote Access port, where Guidepup connects (NVDA_PORT in lib/windows/NVDA/constants.js). */
const NVDA_PORT = 6837;
/** Less time than any command Guidepup captures takes (see checkCaptured). */
const MIN_CAPTURED_MS = 200;

/** Load Guidepup (only when the Guidepup driver starts) and wrap its NVDA object. */
export async function loadGuidepupNvda(install: GuidepupInstall): Promise<NvdaControl> {
  const guidepup = await import("@guidepup/guidepup");
  // Guidepup's package has no exports map, so its NVDA client can be imported directly.
  const { NVDAClient } = await import("@guidepup/guidepup/lib/windows/NVDA/NVDAClient.js");
  handleUnawaitedKeyPresses(NVDAClient.prototype);
  return new GuidepupNvda(guidepup, install);
}

export class GuidepupNvda implements NvdaControl {
  readonly build: string;
  private readonly commands: Record<NvdaKey, KeyCommand>;

  constructor(
    private readonly lib: Guidepup,
    private readonly install: GuidepupInstall,
    private readonly clock: () => number = () => performance.now(),
  ) {
    const { nvda, WindowsKeyCodes, WindowsModifiers } = lib;
    const keys = nvda.keyboardCommands;
    this.build = nvda.version;
    this.commands = {
      reportTitle: keys.reportTitle,
      exitFocusMode: keys.exitFocusMode,
      nextLine: keys.moveToNext,
      nextHeading: keys.moveToNextHeading,
      tab: keys.readNextFocusableItem,
      toTop: { keyCode: [WindowsKeyCodes.Home], modifiers: [WindowsModifiers.Control] },
      toBottom: { keyCode: [WindowsKeyCodes.End], modifiers: [WindowsModifiers.Control] },
    };
  }

  async start(options: { capture: CaptureMode; settings: Record<string, unknown> }): Promise<void> {
    const capture: true | "initial" = options.capture === "complete" ? true : "initial";
    // Guidepup rewrites its NVDA configuration file whenever settings are given, even empty ones.
    const startOptions =
      Object.keys(options.settings).length > 0
        ? { capture, settings: options.settings }
        : { capture };
    await withoutAddedListeners(GUIDEPUP_EVENTS, () =>
      withoutDeprecationWarnings(() => this.lib.nvda.start(startOptions)),
    );
  }

  stop(): Promise<void> {
    return withoutDeprecationWarnings(() => this.lib.nvda.stop());
  }

  forceQuit(): void {
    // What Guidepup's own quit does (nvda.exe --quit shuts down whichever NVDA is running),
    // without the shell, so a path with spaces works.
    spawnSync(this.install.nvdaExe, ["--quit"], { stdio: "ignore", timeout: 15_000 });
  }

  async press(key: NvdaKey, options: { capture?: boolean } = {}): Promise<Speech> {
    const { nvda } = this.lib;
    if (options.capture === false) {
      await nvda.perform(this.commands[key], { capture: false });
      await nvda.clearSpokenPhraseLog();
      return "";
    }
    const began = this.clock();
    await nvda.perform(this.commands[key]);
    this.checkCaptured(began);
    const spoken = await nvda.lastSpokenPhrase();
    await nvda.clearSpokenPhraseLog();
    return spoken;
  }

  async speechDuring(action: () => Promise<void>): Promise<Speech> {
    const { nvda } = this.lib;
    const began = this.clock();
    const { spokenPhrase } = await nvda.capture(action);
    this.checkCaptured(began);
    await nvda.clearSpokenPhraseLog();
    return spokenPhrase;
  }

  /**
   * Guidepup silences NVDA (at least 250 ms, CANCEL_DEBOUNCE_TIMEOUT in NVDAClient.js) before
   * every command it captures. Once its connection to NVDA is gone for good, disconnect() has
   * cleared its capture setting: commands come back at once with no speech, and no key is sent,
   * whether or not NVDA is still running.
   */
  private checkCaptured(began: number): void {
    if (this.clock() - began < MIN_CAPTURED_MS) {
      throw new EnvironmentError(
        "Guidepup has lost its connection to NVDA, so it no longer sends keys or hears speech.",
      );
    }
  }

  settings(): Record<string, unknown> {
    return this.lib.nvda.getSettings();
  }

  isRunning(): Promise<boolean> {
    return acceptsConnections(NVDA_PORT);
  }
}

/** Whether something accepts TCP connections on the port: the way Guidepup checks for NVDA. */
export function acceptsConnections(
  port: number,
  host = "127.0.0.1",
  timeoutMs = 5_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (accepted: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(accepted);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

const HANDLED = Symbol("voicecap: key presses handled");

/**
 * Mark every key press's promise as handled, so a press nobody waits for (Guidepup's stop-speech
 * key, see the top of this file) can fail without ending the process. The promise itself is
 * returned unchanged: a caller that waits for it still sees its failure.
 */
export function handleUnawaitedKeyPresses(client: {
  sendKeyCode: (...args: never[]) => Promise<void>;
}): void {
  const send = client.sendKeyCode;
  if (HANDLED in send) return;
  const sendHandled = function (this: unknown, ...args: never[]): Promise<void> {
    const sent = send.apply(this, args);
    sent.catch(() => {});
    return sent;
  };
  client.sendKeyCode = Object.assign(sendHandled, { [HANDLED]: true });
}

type Listener = (...args: unknown[]) => void;

/**
 * Run an action, removing any listeners it adds to the process for these events: those it adds
 * straight away (as Guidepup's start() does) at once, and any added later when it has finished.
 */
export async function withoutAddedListeners(
  events: readonly string[],
  action: () => Promise<void>,
): Promise<void> {
  const emitter = process as NodeJS.EventEmitter;
  const before = new Map(events.map((event) => [event, new Set(emitter.listeners(event))]));
  const removeAdded = () => {
    for (const event of events) {
      for (const listener of emitter.listeners(event)) {
        if (!before.get(event)?.has(listener)) emitter.removeListener(event, listener as Listener);
      }
    }
  };
  let running: Promise<void>;
  try {
    running = action();
  } finally {
    removeAdded();
  }
  try {
    await running;
  } finally {
    removeAdded();
  }
}

/** Run an action with Node's deprecation warnings hidden. */
export async function withoutDeprecationWarnings<T>(action: () => Promise<T>): Promise<T> {
  // Already off: node --no-deprecation also makes the setting read-only.
  if (process.noDeprecation === true) return action();
  const previous = process.noDeprecation;
  process.noDeprecation = true;
  try {
    return await action();
  } finally {
    process.noDeprecation = previous;
  }
}
