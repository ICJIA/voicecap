import { mkdtempSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  AxeCapture,
  EnvironmentInfo,
  EventRecorder,
  FocusedElement,
  PageInfo,
  PageScreenshot,
  ScreenReaderDriver,
  Speech,
  VoiceCapture,
  VoiceRecording,
} from "../../src/drivers/types.js";
import type { VoiceStretch } from "../../src/model.js";
import { canonicalKey } from "../../src/pages/url.js";
import { peakOf } from "../../src/voice/encode.js";

/**
 * What a recording of a page gives at stop(), as the Guidepup driver's recorder gives it: `samples`,
 * the sound as 16 kHz samples (the driver writes them to a PCM file), with the time the recorder
 * lost to falling behind and, as a UTC ISO time, when its first sample was (`startedAt`, default
 * "2026-10-09T14:03:07.215Z"); `bytes`, a file that isn't whole samples (an odd count, or none); `missing`,
 * a file that isn't there when the run reads it; or the reason there's no sound. A recording gives
 * the stretches of it that the driver keeps, in ms from its first sample (`stretches`): by default
 * one, the whole recording.
 */
export type ScriptedVoice =
  | { samples: Int16Array; lostMs?: number; startedAt?: string; stretches?: VoiceStretch[] }
  | { bytes: Uint8Array; peak?: number; stretches?: VoiceStretch[] }
  | { missing: true }
  | { error: string };

/** A page as the scripted driver emulates it: NVDA's view of the document. */
export interface ScriptedPage {
  url: string;
  finalUrl?: string;
  status?: number;
  contentType?: string;
  /** The title openPage reports (default: none, reported as null). */
  title?: string;
  /**
   * The address of the page's canonical tag, as the browser reports it (always absolute): what
   * openPage reports (default: no tag, reported as null).
   */
  canonical?: string;
  /**
   * The screenshot openPage reports with the page: a JPEG, or the reason there's none (default: no
   * screenshot, as a driver that takes none leaves it out).
   */
  screenshot?: PageScreenshot;
  /**
   * What checkWithAxe reports for the page: the results axe gave, kept as the Guidepup driver keeps
   * them (`keptAxeResults`), or the reason there are none. A driver none of whose pages has one
   * can't check a page, and has no checkWithAxe, as a driver that doesn't check leaves it out. In a
   * driver that can, a page with none is reported as a check that failed: `{ error: "no axe results
   * were scripted for this page" }`.
   */
  axe?: AxeCapture;
  /**
   * What a recording of the page gives at stop(): see ScriptedVoice. An array gives one for each
   * recording stopped while the page is open, the last repeating, for a page that's tried more than
   * once. A driver none of whose pages has one can't record, and has no recordVoice, as a driver
   * that doesn't record leaves it out. In a driver that can, a page with none gives the reason `no
   * recording was scripted for this page`.
   */
  voice?: ScriptedVoice | readonly ScriptedVoice[];
  /** Browse-mode lines, top to bottom. */
  lines?: string[];
  /**
   * What Ctrl+End says (default: the last line). A list is what each press says in turn, and the
   * last of it again for every press after: a page whose last line changes as it's read.
   */
  bottom?: string | string[];
  /** What Down Arrow says when it arrives at the last line (default: the last line). */
  arrival?: string;
  headings?: string[];
  stops?: { spoken: string; focused: FocusedElement }[];
  /** Speech when Tab leaves the page for the browser UI. */
  leaving?: string;
  initialFocus?: FocusedElement | null;
  /** openPage throws this. */
  openError?: Error;
  /** How many opens throw openError before one succeeds (default: every open). */
  openErrorTimes?: number;
}

export type Command =
  | "openPage"
  | "checkWithAxe"
  | "recordVoice"
  | "stopVoice"
  | "discardVoice"
  | "toTop"
  | "toBottom"
  | "nextLine"
  | "nextHeading"
  | "nextFocusable"
  | "focusInDocument"
  | "focusedElement";

export interface ScriptedOptions {
  /** Return true to make this call hang forever (to exercise timeouts). */
  hang?: (command: Command, url: string, call: number) => boolean;
  /** Return an error to make this call fail with it (a lost foreground mid-pass, say). */
  fail?: (command: Command, url: string, call: number) => Error | null;
}

/**
 * A fake driver that emulates NVDA from a page model: Down Arrow on the last line re-speaks it,
 * H after the last heading says "no next heading", and Tab after the last stop leaves the page.
 */
export class ScriptedDriver implements ScreenReaderDriver {
  readonly name = "scripted";
  starts = 0;
  stops = 0;
  /** The options each stop() was called with, in order. */
  readonly stopOptions: ({ restarting?: boolean } | undefined)[] = [];
  readonly opened: string[] = [];
  readonly calls: Command[] = [];
  /** The recorder the run gave this driver, null until it does. This driver records nothing. */
  recorder: EventRecorder | null = null;
  /** Only a driver with a page that has axe results to report can check one: see ScriptedPage.axe. */
  checkWithAxe?: () => Promise<AxeCapture>;
  /** Only a driver with a page that has a recording to give can record one: see ScriptedPage.voice. */
  recordVoice?: () => Promise<VoiceRecording>;
  /**
   * The PCM file of every recording this driver began, in order. A recording makes its file as it
   * begins, as the recorder's helper does, and whoever ends the recording deletes it: the run when
   * it's stopped (once it has read the file), the driver when it's discarded.
   */
  readonly pcmFiles: string[] = [];

  private readonly pages = new Map<string, ScriptedPage>();
  private page: ScriptedPage | null = null;
  private voiceDir: string | null = null;
  /** How many recordings have been stopped while each page was open. */
  private readonly voicesGiven = new Map<ScriptedPage, number>();
  private line = 0;
  private heading = 0;
  private stopIndex = 0;
  /** Ctrl+End presses since the page opened. */
  private bottoms = 0;
  private inDocument = true;
  private focused: FocusedElement | null = null;
  private callCount = 0;
  /** Opens that have thrown each page's openError so far. */
  private readonly openFailures = new Map<ScriptedPage, number>();

  constructor(
    pages: ScriptedPage[],
    private readonly options: ScriptedOptions = {},
  ) {
    for (const page of pages) this.pages.set(canonicalKey(page.url), page);
    if (pages.some((page) => page.axe !== undefined)) {
      this.checkWithAxe = () =>
        this.call(
          "checkWithAxe",
          () => this.page?.axe ?? { error: "no axe results were scripted for this page" },
        );
    }
    if (pages.some((page) => page.voice !== undefined)) {
      this.recordVoice = () => this.call("recordVoice", () => this.beginRecording());
    }
  }

  setEventRecorder(recorder: EventRecorder): void {
    this.recorder = recorder;
  }

  start(): Promise<void> {
    this.starts++;
    return Promise.resolve();
  }

  stop(options?: { restarting?: boolean }): Promise<void> {
    this.stops++;
    this.stopOptions.push(options);
    this.removeVoiceFolder();
    return Promise.resolve();
  }

  getEnvironmentInfo(): Promise<EnvironmentInfo> {
    return Promise.resolve({
      driver: { name: "scripted", version: "1" },
      screenReader: { name: "NVDA", version: "2026.2", build: "0.2.1-2026.2", language: "en" },
      capture: "complete",
      browser: { name: "Chrome", version: "141.0.0.0" },
      os: "Test OS",
      screenReaderSettings: {
        speech: { symbolLevel: 100 },
        keyboard: { speakTypedCharacters: true },
      },
    });
  }

  cleanupStale(): Promise<string[]> {
    return Promise.resolve([]);
  }

  openPage(url: string): Promise<PageInfo> {
    return this.call("openPage", () => {
      this.opened.push(url);
      const page = this.pages.get(canonicalKey(url));
      if (!page) throw new Error(`No scripted page for ${url}`);
      if (page.openError) {
        const failed = this.openFailures.get(page) ?? 0;
        if (page.openErrorTimes === undefined || failed < page.openErrorTimes) {
          this.openFailures.set(page, failed + 1);
          throw page.openError;
        }
      }
      this.page = page;
      this.line = 0;
      this.heading = 0;
      this.stopIndex = 0;
      this.bottoms = 0;
      this.inDocument = true;
      this.focused = page.initialFocus ?? null;
      return {
        finalUrl: page.finalUrl ?? url,
        status: page.status ?? 200,
        contentType: page.contentType ?? "text/html; charset=utf-8",
        title: page.title ?? null,
        canonical: page.canonical ?? null,
        ...(page.screenshot !== undefined ? { screenshot: page.screenshot } : {}),
      };
    });
  }

  toBottom(): Promise<Speech> {
    return this.call("toBottom", () => {
      const lines = this.lines();
      this.line = lines.length - 1;
      const { bottom } = this.page ?? {};
      const press = this.bottoms++;
      const said = Array.isArray(bottom) ? (bottom[press] ?? bottom.at(-1)) : bottom;
      return said ?? lines.at(-1) ?? "";
    });
  }

  toTop(): Promise<Speech> {
    return this.call("toTop", () => {
      this.line = 0;
      return this.lines()[0] ?? "";
    });
  }

  nextLine(): Promise<Speech> {
    return this.call("nextLine", () => {
      const lines = this.lines();
      const last = lines.length - 1;
      if (this.line < last) {
        this.line++;
        return this.line === last && this.page?.arrival !== undefined
          ? this.page.arrival
          : (lines[this.line] ?? "");
      }
      return lines[last] ?? "";
    });
  }

  nextHeading(): Promise<Speech> {
    return this.call("nextHeading", () => {
      const headings = this.page?.headings ?? [];
      return this.heading < headings.length ? headings[this.heading++]! : "no next heading";
    });
  }

  nextFocusable(): Promise<Speech> {
    return this.call("nextFocusable", () => {
      const stops = this.page?.stops ?? [];
      const stop = stops[this.stopIndex++];
      if (stop) {
        this.inDocument = true;
        this.focused = stop.focused;
        return stop.spoken;
      }
      this.inDocument = false;
      this.focused = null;
      return this.page?.leaving ?? "Address and search bar, edit";
    });
  }

  focusInDocument(): Promise<boolean> {
    return this.call("focusInDocument", () => this.inDocument);
  }

  focusedElement(): Promise<FocusedElement | null> {
    return this.call("focusedElement", () => this.focused);
  }

  private lines(): string[] {
    return this.page?.lines ?? [];
  }

  /**
   * The folder this driver made for its recordings' files goes when the driver stops, if it's empty
   * (the next recording makes another). A file a recording left behind keeps its folder, and is
   * there for a test to find: whoever ended the recording should have deleted it.
   */
  private removeVoiceFolder(): void {
    if (this.voiceDir === null) return;
    try {
      rmdirSync(this.voiceDir);
      this.voiceDir = null;
    } catch {
      // Not empty, or not there: left as it is.
    }
  }

  /** A recording begins: its PCM file is made, empty, as the recorder's helper makes it. */
  private beginRecording(): VoiceRecording {
    this.voiceDir ??= mkdtempSync(path.join(os.tmpdir(), "voicecap-scripted-voice-"));
    const pcm = path.join(this.voiceDir, `${this.pcmFiles.length + 1}.pcm`);
    this.pcmFiles.push(pcm);
    writeFileSync(pcm, new Uint8Array(0));
    // An end that fails leaves no sound behind, as the Guidepup driver's leaves none: it deletes the
    // file of a recording it gives no capture of, and of one it discards.
    const ending = <T>(command: Command, action: () => T): Promise<T> =>
      this.call(command, action).catch((error: unknown) => {
        rmSync(pcm, { force: true });
        throw error;
      });
    return {
      stop: () => ending("stopVoice", () => this.endRecording(pcm)),
      discard: () => ending("discardVoice", () => rmSync(pcm, { force: true })),
    };
  }

  /** A recording stops: the page open now says what its file holds. */
  private endRecording(pcm: string): VoiceCapture {
    const voice = this.nextVoice();
    if ("error" in voice) {
      rmSync(pcm, { force: true });
      return { error: voice.error };
    }
    const startedAt =
      ("startedAt" in voice ? voice.startedAt : undefined) ?? "2026-10-09T14:03:07.215Z";
    /** The stretches kept: the scripted ones, or the whole recording of `frames` samples. */
    const kept = (frames: number, stretches?: VoiceStretch[]): VoiceStretch[] =>
      stretches ?? [{ startMs: 0, endMs: frames / 16 }];
    if ("missing" in voice) {
      rmSync(pcm, { force: true });
      return { pcm, frames: 16_000, lostMs: 0, peak: 1_000, startedAt, stretches: kept(16_000) };
    }
    if ("bytes" in voice) {
      writeFileSync(pcm, voice.bytes);
      const frames = Math.floor(voice.bytes.length / 2);
      return {
        pcm,
        frames,
        lostMs: 0,
        peak: voice.peak ?? 1_000,
        startedAt,
        stretches: kept(frames, voice.stretches),
      };
    }
    const { samples } = voice;
    writeFileSync(pcm, new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
    return {
      pcm,
      frames: samples.length,
      lostMs: voice.lostMs ?? 0,
      peak: peakOf(samples),
      startedAt,
      stretches: kept(samples.length, voice.stretches),
    };
  }

  /** What the page open now gives for the recording being stopped: see ScriptedPage.voice. */
  private nextVoice(): ScriptedVoice {
    const page = this.page;
    const voice = page?.voice;
    if (page === undefined || page === null || voice === undefined) {
      return { error: "no recording was scripted for this page" };
    }
    if (!Array.isArray(voice)) return voice as ScriptedVoice;
    const given = this.voicesGiven.get(page) ?? 0;
    this.voicesGiven.set(page, given + 1);
    return (voice as readonly ScriptedVoice[])[Math.min(given, voice.length - 1)]!;
  }

  private call<T>(command: Command, action: () => T): Promise<T> {
    this.calls.push(command);
    const n = ++this.callCount;
    if (this.options.hang?.(command, this.page?.url ?? "", n)) {
      return new Promise<T>(() => {});
    }
    const failure = this.options.fail?.(command, this.page?.url ?? "", n);
    if (failure) return Promise.reject(failure);
    try {
      return Promise.resolve(action());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

export function element(name: string, options: Partial<FocusedElement> = {}): FocusedElement {
  return { tag: "a", role: "link", name, inMain: false, href: "/", ...options };
}
