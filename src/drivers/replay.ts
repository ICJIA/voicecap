import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  EnvironmentRecord,
  PassName,
  RunJson,
  SkippedRecord,
  StepRecord,
  TranscriptJson,
} from "../model.js";
import { canonicalKey } from "../pages/url.js";
import { UsageError } from "../util/errors.js";
import { voicecapVersion } from "../util/version.js";
import type {
  EnvironmentInfo,
  FocusedElement,
  PageInfo,
  ScreenReaderDriver,
  Speech,
} from "./types.js";

interface Recording {
  url: string;
  finalUrl: string;
  passes: Partial<Record<PassName, TranscriptJson>>;
}

/**
 * Emulates NVDA from a run folder, with no screen reader or browser, so the whole pipeline
 * (including stop detection) runs on any OS. Pages are matched by URL. Each pass's recorded
 * steps are returned in order; after them it behaves as NVDA does at the end: Down Arrow
 * re-speaks the last line, H says "no next heading", and Tab leaves the document.
 *
 * Passes are told apart by their commands: read uses toBottom/toTop/nextLine, headings uses
 * nextHeading, and tab uses nextFocusable. openPage starts every pass afresh.
 */
export class ReplayDriver implements ScreenReaderDriver {
  readonly name = "replay";

  private readonly recordings = new Map<string, Recording>();
  private readonly skipped = new Map<string, SkippedRecord>();
  private sourceRunId = "unknown";
  private sourceEnvironment: EnvironmentRecord | null = null;
  private loaded = false;

  private current: Recording | null = null;
  private readonly cursor: Record<PassName, number> = { read: 0, headings: 0, tab: 0 };
  private currentLine = "";
  private focus: { inDocument: boolean; focused: FocusedElement | null } = {
    inDocument: true,
    focused: null,
  };

  /**
   * @param dir the run folder to replay (absolute)
   * @param label how to name it in transcripts, e.g. the path as the user typed it
   */
  constructor(
    private readonly dir: string,
    private readonly label: string = dir,
  ) {}

  async start(): Promise<void> {
    if (!this.loaded) await this.load();
  }

  stop(): Promise<void> {
    this.current = null;
    return Promise.resolve();
  }

  getEnvironmentInfo(): Promise<EnvironmentInfo> {
    const env = this.sourceEnvironment;
    return Promise.resolve({
      driver: { name: "replay", version: voicecapVersion() },
      screenReader: env?.screenReader ?? null,
      capture: env?.capture ?? "complete",
      browser: env?.browser ?? null,
      os: `${os.type()} ${os.release()} (replay host)`,
      screenReaderSettings: env?.screenReaderSettings ?? {},
      replay: {
        from: this.label,
        sourceRun: this.sourceRunId,
        sourceDriver: env?.driver.name ?? "unknown",
      },
    });
  }

  cleanupStale(): Promise<string[]> {
    return Promise.resolve([]);
  }

  openPage(url: string): Promise<PageInfo> {
    const key = canonicalKey(url);
    this.cursor.read = 0;
    this.cursor.headings = 0;
    this.cursor.tab = 0;
    this.currentLine = "";

    const recording = this.recordings.get(key);
    this.current = recording ?? null;
    this.focus = { inDocument: true, focused: recording?.passes.tab?.initialFocus ?? null };
    if (recording) {
      return Promise.resolve({
        finalUrl: recording.finalUrl,
        status: 200,
        contentType: "text/html",
        title: null,
      });
    }

    const skip = this.skipped.get(key);
    if (skip?.reason === "non-html-response" || skip?.reason === "redirect-off-origin") {
      return Promise.resolve({
        finalUrl: skip.finalUrl ?? url,
        status: skip.status ?? 200,
        contentType:
          skip.contentType ?? (skip.reason === "redirect-off-origin" ? "text/html" : null),
        title: null,
      });
    }
    return Promise.reject(new Error(`No recording of ${url} in ${this.label}`));
  }

  toBottom(): Promise<Speech> {
    return Promise.resolve(this.readStep("toBottom"));
  }

  toTop(): Promise<Speech> {
    return Promise.resolve(this.readStep("toTop"));
  }

  nextLine(): Promise<Speech> {
    return Promise.resolve(this.readStep("nextLine"));
  }

  nextHeading(): Promise<Speech> {
    const step = this.nextRecorded("headings", "nextHeading");
    return Promise.resolve(step ? step.spoken : "no next heading");
  }

  nextFocusable(): Promise<Speech> {
    const step = this.nextRecorded("tab", "nextFocusable");
    if (step) {
      this.focus = { inDocument: step.inDocument ?? true, focused: step.focused ?? null };
      return Promise.resolve(step.spoken);
    }
    // Past the recording: focus leaves the page for the browser's UI.
    const steps = this.stepsOf("tab");
    const leaving = steps.at(-1)?.inDocument === false ? (steps.at(-1)?.spoken ?? "") : "";
    this.focus = { inDocument: false, focused: null };
    return Promise.resolve(leaving);
  }

  focusInDocument(): Promise<boolean> {
    return Promise.resolve(this.focus.inDocument);
  }

  focusedElement(): Promise<FocusedElement | null> {
    return Promise.resolve(this.focus.focused);
  }

  private readStep(command: "toBottom" | "toTop" | "nextLine"): Speech {
    const step = this.nextRecorded("read", command);
    if (step) {
      this.currentLine = step.spoken;
      return step.spoken;
    }
    // Past the recording, behave like NVDA: Down Arrow re-speaks the current (last) line.
    const recorded = this.stepsOf("read").find((s) => s.command === command);
    if (command !== "nextLine" && recorded) this.currentLine = recorded.spoken;
    return this.currentLine;
  }

  private nextRecorded(pass: PassName, command: StepRecord["command"]): StepRecord | undefined {
    if (!this.current) throw new Error("openPage() must be called before replaying steps");
    const step = this.stepsOf(pass)[this.cursor[pass]];
    if (step?.command !== command) return undefined;
    this.cursor[pass]++;
    return step;
  }

  private stepsOf(pass: PassName): StepRecord[] {
    const transcript = this.current?.passes[pass];
    if (!transcript) {
      throw new Error(`The recording of ${this.current?.url ?? "this page"} has no ${pass} pass`);
    }
    return transcript.steps;
  }

  private async load(): Promise<void> {
    if (!existsSync(this.dir)) {
      throw new UsageError(`The replay folder ${this.label} doesn't exist.`);
    }
    const runFile = path.join(this.dir, "run.json");
    if (existsSync(runFile)) {
      const run = JSON.parse(await readFile(runFile, "utf8")) as RunJson;
      this.sourceRunId = run.id;
      this.sourceEnvironment = run.sessions.find((s) => s.environment)?.environment ?? null;
      for (const skip of run.skipped) this.skipped.set(canonicalKey(skip.url), skip);
    }

    const pagesDir = path.join(this.dir, "pages");
    if (existsSync(pagesDir)) {
      for (const entry of await readdir(pagesDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        for (const file of await readdir(path.join(pagesDir, entry.name))) {
          if (!file.endsWith(".json")) continue;
          const transcript = JSON.parse(
            await readFile(path.join(pagesDir, entry.name, file), "utf8"),
          ) as TranscriptJson;
          if (transcript.schemaVersion !== 1 || !Array.isArray(transcript.steps)) continue;
          this.addTranscript(transcript);
        }
      }
    }
    if (this.recordings.size === 0) {
      throw new UsageError(
        `No transcripts to replay in ${this.label}. Point --replay-from at a run folder (runs/<run-id>).`,
      );
    }
    this.loaded = true;
  }

  private addTranscript(transcript: TranscriptJson): void {
    const key = transcript.page.key || canonicalKey(transcript.page.url);
    let recording = this.recordings.get(key);
    if (!recording) {
      recording = {
        url: transcript.page.url,
        finalUrl: transcript.page.finalUrl || transcript.page.url,
        passes: {},
      };
      this.recordings.set(key, recording);
    }
    recording.passes[transcript.pass] = transcript;
    this.sourceEnvironment ??= transcript.environment;
    if (this.sourceRunId === "unknown") this.sourceRunId = transcript.run;
    const finalKey = canonicalKey(recording.finalUrl);
    if (!this.recordings.has(finalKey)) this.recordings.set(finalKey, recording);
  }
}
