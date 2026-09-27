/**
 * NVDA through @guidepup/guidepup 0.34.0, behind the driver's NvdaControl interface.
 *
 * Checked against Guidepup's source for the pinned version:
 * - Commands (next(), perform(), ...) return nothing; what NVDA said is the latest entry of the
 *   spoken-phrase log, which gets exactly one entry per command. voicecap reads it, then clears
 *   the log so a days-long run doesn't keep every phrase in memory.
 * - start() registers handlers for SIGINT, SIGTERM, SIGQUIT, SIGHUP, and beforeExit
 *   (lib/teardown.js) that stop NVDA but never exit the process. voicecap handles those signals
 *   itself (saving state first), so the driver removes Guidepup's handlers after each start.
 * - Guidepup runs nvda.exe with spawn(..., { shell: true }) and separate arguments, which Node 24
 *   flags as deprecated (DEP0190) on every start and stop; that warning is hidden.
 * - Commands must never be issued inside capture(): both would wait for each other.
 */
import { spawnSync } from "node:child_process";

import type * as GuidepupModule from "@guidepup/guidepup";

import type { NvdaControl, NvdaKey } from "../guidepup-nvda.js";
import type { CaptureMode, Speech } from "../types.js";
import type { GuidepupInstall } from "./paths.js";

type Guidepup = typeof GuidepupModule;
type KeyCommand = Parameters<Guidepup["nvda"]["perform"]>[0];

/** The events Guidepup's teardown handlers listen for. */
const GUIDEPUP_EVENTS = ["SIGINT", "SIGTERM", "SIGQUIT", "SIGHUP", "beforeExit"];

/** Load Guidepup (only when the Guidepup driver starts) and wrap its NVDA object. */
export async function loadGuidepupNvda(install: GuidepupInstall): Promise<NvdaControl> {
  const guidepup = await import("@guidepup/guidepup");
  return new GuidepupNvda(guidepup, install);
}

class GuidepupNvda implements NvdaControl {
  readonly build: string;
  private readonly commands: Record<NvdaKey, KeyCommand>;

  constructor(
    private readonly lib: Guidepup,
    private readonly install: GuidepupInstall,
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
    await nvda.perform(this.commands[key]);
    const spoken = await nvda.lastSpokenPhrase();
    await nvda.clearSpokenPhraseLog();
    return spoken;
  }

  async speechDuring(action: () => Promise<void>): Promise<Speech> {
    const { nvda } = this.lib;
    const { spokenPhrase } = await nvda.capture(action);
    await nvda.clearSpokenPhraseLog();
    return spokenPhrase;
  }

  settings(): Record<string, unknown> {
    return this.lib.nvda.getSettings();
  }
}

type Listener = (...args: unknown[]) => void;

/** Run an action, then remove any listeners it added to the process for these events. */
export async function withoutAddedListeners(
  events: readonly string[],
  action: () => Promise<void>,
): Promise<void> {
  const emitter = process as NodeJS.EventEmitter;
  const before = new Map(events.map((event) => [event, new Set(emitter.listeners(event))]));
  try {
    await action();
  } finally {
    for (const event of events) {
      for (const listener of emitter.listeners(event)) {
        if (!before.get(event)?.has(listener)) emitter.removeListener(event, listener as Listener);
      }
    }
  }
}

/** Run an action with Node's deprecation warnings hidden. */
export async function withoutDeprecationWarnings<T>(action: () => Promise<T>): Promise<T> {
  const previous = process.noDeprecation;
  process.noDeprecation = true;
  try {
    return await action();
  } finally {
    process.noDeprecation = previous;
  }
}
