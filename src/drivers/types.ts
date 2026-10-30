/**
 * The driver layer. A driver owns both the screen reader and the browser, so nothing outside
 * src/drivers/ touches Guidepup or Playwright. The interface is expressed in actions, not
 * keystrokes; the core (src/passes/) decides when a pass stops, from what a driver returns.
 */
import type { AxeSummary } from "../axe/results.js";
import type { FieldValue, FormInfo, FormState } from "../forms/types.js";
import type { NewRunEvent, VoiceStretch } from "../model.js";

/**
 * Everything the screen reader said in response to one action.
 *
 * Every driver must use Guidepup's format (verified in @guidepup/guidepup 0.36.4): the text
 * items of one utterance are trimmed, runs of whitespace collapsed, and joined with ", ";
 * utterances are joined with ". ". An empty string means silence. Keeping one format lets the
 * core's matching and the flag rules work the same for every driver.
 */
export type Speech = string;

/**
 * Where a driver reports what it does to the screen reader and the browser, as it does it, for the
 * run's event log (events.jsonl). The log stamps each event with when it was recorded, or with `at`,
 * the moment it happened, when the driver knows that was earlier: a start that's recorded only once
 * the start's own process id has been looked up, say. Lines stay in the order they were recorded.
 */
export interface EventRecorder {
  record(event: NewRunEvent, at?: Date): void;

  /**
   * The screen reader's own log of the session that has just ended, cleaned by the driver down to
   * what the run keeps of it (for NVDA: its speech, voicecap's keys, and its warnings and errors).
   * The run keeps it as a copy in its folder, records it in the event log (`screen-reader-log`, with
   * the copy's file), and lists it among the run's files. Like `record`, it never throws: a copy
   * that can't be kept is recorded as none, with why. Optional: a recorder that keeps no copies
   * leaves it out, and a driver reads the screen reader's log only for a recorder that has it, so a
   * driver run with none (doctor's live check, fixture capture) reads nothing.
   */
  screenReaderLog?(cleaned: string): void;
}

/** A recorder that records nothing: what a driver reports to until a run gives it a real one. */
export const NO_EVENTS: EventRecorder = Object.freeze({ record: () => {} });

export interface ScreenReaderDriver {
  /** "guidepup", "replay", or "at-driver". */
  readonly name: string;

  /**
   * Where to report the events of the run: the screen reader and the browser starting and
   * stopping, and the like. Optional, so a driver that has nothing to report needn't have it. A run
   * calls it once, before it first calls `cleanupStale` or `start`.
   */
  setEventRecorder?(recorder: EventRecorder): void;

  /** Start the screen reader and the browser. Throws EnvironmentError if they can't start. */
  start(): Promise<void>;
  /**
   * Stop both. Idempotent, and safe to call from a signal handler.
   *
   * restarting: the core will start the driver again at once (a mid-run restart), so don't give
   * anything back yet.
   */
  stop(options?: { restarting?: boolean }): Promise<void>;
  getEnvironmentInfo(): Promise<EnvironmentInfo>;
  /** Clean up screen reader or browser processes left behind by a crashed run. Returns what it did. */
  cleanupStale(): Promise<string[]>;

  /**
   * Load the page fresh, wait until it's ready, bring the browser to the front (or throw
   * ForegroundError), and move the screen reader into the web content.
   *
   * On return the browse-mode cursor is at the top of the document, nothing is focused, and
   * the browser's sequential focus starting point is at the top of the document.
   * If the response isn't HTML, it returns straight after loading and the core skips the page.
   *
   * A driver that takes screenshots takes one of an HTML page once it has loaded, before the screen
   * reader moves into it, and gives it in the PageInfo.
   */
  openPage(url: string): Promise<PageInfo>;

  /**
   * Check the page that's open with axe-core, an automated checker, and give what voicecap keeps of
   * its results, or the reason there are none. The core asks once a page, on its first load: after
   * openPage, which has already pressed its own keys to put the screen reader at the top, and
   * before the first pass's first key. The check moves no focus, scrolls nothing, and adds nothing
   * to the page. One that fails gives the reason, and the page is read as usual. One that runs out
   * of time and is still under way in the page says so too (`leftRunning`): the core opens the
   * page again, and a later openPage must end the check, as a fresh browser for each load does.
   * Neither fails the page; only a browser that's gone throws, as it would for any step.
   *
   * Optional: a driver that can't check a page leaves it out, and its run records no axe result.
   */
  checkWithAxe?(): Promise<AxeCapture>;

  /**
   * Start recording what the screen reader says aloud, and no other sound, from now until the
   * recording is ended. The core asks for one at the start of each attempt at a page, before the
   * attempt's first step, and ends it, with `stop()` or `discard()`, before it asks for the next.
   * A recording that couldn't start (the recorder can't run, or the screen reader's process isn't
   * found) gives its reason at `stop()`, never here: not being able to record never fails a page, so
   * the reason is the answer, and the run records it.
   *
   * Optional: a driver that can't record leaves it out, and its run records no voice.
   */
  recordVoice?(): Promise<VoiceRecording>;

  /** Move to the next line in browse mode (NVDA: Down Arrow). */
  nextLine(): Promise<Speech>;
  /** Move to the next heading (NVDA: H). */
  nextHeading(): Promise<Speech>;
  /** Move focus to the next focusable element (Tab). */
  nextFocusable(): Promise<Speech>;
  /** Move to the top of the document (NVDA: Ctrl+Home). */
  toTop(): Promise<Speech>;
  /** Move to the bottom of the document (NVDA: Ctrl+End). */
  toBottom(): Promise<Speech>;

  /** False once focus has left the page document, e.g. into the browser's address bar. */
  focusInDocument(): Promise<boolean>;
  /** The focused element as the browser sees it; null when nothing is focused (the body). */
  focusedElement(): Promise<FocusedElement | null>;

  // The forms pass's actions, which a driver has all of or none of (checkFormWithAxe aside). Without
  // them its run's forms aren't tested, and the run says so. The core decides what to do next;
  // `form` and `field` are places in what findForms gave.

  /** Every form the page shows, sorted by what voicecap does with it. Moves no focus. */
  findForms?(): Promise<FormInfo[]>;
  /**
   * Shut the guard, so nothing the page does from here reaches the network. Rejects when it can't
   * be armed, or can't be confirmed, and the core then presses no key on the form.
   */
  armFormGuard?(): Promise<void>;
  /** Move focus to one of the form's fields by script: the core asks only for its first, to enter it. */
  focusFormField?(form: number, field: number): Promise<Speech>;
  /**
   * Press Enter on the submit control that has focus, where Tab has put it: the core asks for this
   * only then, and a driver moves no focus for it. It keeps listening until the screen reader goes quiet and `settleMs` more has gone by,
   * since many forms show their errors a moment later, and what's said by then is its answer.
   */
  pressSubmit?(form: number, settleMs: number): Promise<Speech>;
  /** Put a value in the focused field by keys, never by script. */
  fillField?(value: FieldValue): Promise<Speech>;
  /** What the form shows now. Reading it clears `liveChanged`. */
  formState?(form: number): Promise<FormState>;
  /** Check the form as it stands with axe-core, limited to the form, as checkWithAxe does a page. */
  checkFormWithAxe?(form: number): Promise<AxeCapture>;
}

export interface PageInfo {
  /** URL after redirects. */
  finalUrl: string;
  /** HTTP status of the final response, when known. */
  status: number | null;
  /** Content-Type of the final response, when known. */
  contentType: string | null;
  title: string | null;
  /**
   * The address the page's first `<link rel="canonical">` tag gives, as the browser resolved it (so
   * absolute, even for a tag written as a path), or null when the page has no such tag, the tag has
   * no address, or the response isn't HTML. A driver that can't read the page's tags gives null.
   */
  canonical: string | null;
  /**
   * The page as it looked once it had loaded, before the screen reader read it, for the run to keep.
   * A driver that doesn't take screenshots leaves it out, and so does one that took none because the
   * response isn't HTML.
   */
  screenshot?: PageScreenshot;
}

/**
 * A page's screenshot: a JPEG, or the reason none could be taken. Not being able to take one never
 * fails the page, so the reason is the answer, and the run records it.
 */
export type PageScreenshot = { jpeg: Uint8Array } | { error: string };

/**
 * axe-core's check of a page: the text of the file the page keeps (axe.json) and what its record
 * says of it, or the reason there's none. Not being able to check a page never fails it, so the
 * reason is the answer, and the run records it.
 *
 * `leftRunning` is set only when the check ran out of its time (AXE_LIMIT_MS) and couldn't be
 * stopped, so it's still under way in the page: the core then opens the page again before the first
 * pass's first key, so no key is pressed in a page axe is holding up. Only the reason is recorded.
 */
export type AxeCapture =
  { json: string; summary: AxeSummary } | { error: string; leftRunning?: true };

/**
 * What a recording of the screen reader's voice was: the file of its sound, or the reason there's
 * none. Not being able to record never fails a page, so the reason is the answer, and the run records
 * it.
 *
 * `pcm` is the file: 16 kHz, mono, 16-bit samples, little-endian, which the core reads, encodes, and
 * deletes. `frames` is how many samples it holds; its first is at `startedAt`, a UTC ISO time such as
 * "2026-10-09T14:03:07.215Z". `lostMs` is the sound lost because the recorder fell behind, in whole
 * milliseconds, normally 0. `peak` is the loudest sample, from 0 to 32,768.
 *
 * `stretches` are the parts of the recording the driver keeps, in ms from its first sample: each
 * pass of the page, from the check that confirmed its browser in front to the end of its last step.
 * Between passes, while a browser opens or comes to the front, the screen reader can read whatever
 * window is behind it. The core silences every sample outside them before it encodes the sound,
 * and keeps no recording when they hold none of it.
 */
export type VoiceCapture =
  | {
      pcm: string;
      frames: number;
      lostMs: number;
      peak: number;
      startedAt: string;
      stretches: VoiceStretch[];
    }
  | { error: string };

/**
 * One recording of the screen reader's voice, made from when the driver gave it. It ends with
 * `stop()` or `discard()`, whichever is called first, and ending it again is harmless. A driver
 * that is stopped meanwhile ends it too: it discards it.
 */
export interface VoiceRecording {
  /**
   * End the recording and say what it was. The sound's file is the core's to delete. Never rejects
   * for want of a recording: its reason is the answer.
   */
  stop(): Promise<VoiceCapture>;
  /** End the recording and keep nothing: its sound is deleted. For an attempt that isn't kept. */
  discard(): Promise<void>;
}

export interface FocusedElement {
  /** Lowercase tag name, e.g. "a". */
  tag: string;
  /** Computed ARIA role, when known. */
  role: string | null;
  /** Accessible name ("" when it has none). */
  name: string;
  /** Whether the element is inside the main landmark. */
  inMain: boolean;
  /** The href attribute of links (used to recognize skip links), otherwise null. */
  href: string | null;
}

export type CaptureMode = "complete" | "initial";

/**
 * The browser window's fixed size, in pixels, so pages lay out (and the screen reader splits lines)
 * the same way in every run. It lives here, not in the code that opens the browser, because the
 * run's record of its computer names it too, and that code loads Playwright. Frozen: nothing may
 * change it for one run and not the next.
 */
export const BROWSER_WINDOW = Object.freeze({ width: 1280, height: 960 } as const);

export interface EnvironmentInfo {
  driver: { name: string; version: string };
  screenReader: {
    name: string;
    /** e.g. "2026.2" */
    version: string;
    /** Guidepup's build id, e.g. "0.2.1-2026.2" */
    build: string | null;
    language: string | null;
  } | null;
  capture: CaptureMode;
  browser: { name: string; version: string } | null;
  os: string;
  /**
   * Screen reader settings in effect, by section. For NVDA at least speech,
   * documentFormatting, virtualBuffers (browse mode), and keyboard.
   */
  screenReaderSettings: Record<string, unknown>;
  /** Present when the output is replayed rather than captured from a live screen reader. */
  replay?: { from: string; sourceRun: string; sourceDriver: string };
}

/** The browser couldn't be brought to the front, so keystrokes would reach the wrong window. */
export class ForegroundError extends Error {
  /** The failure code a page's record keeps for this error (see causeOf in src/run/failure.ts). */
  readonly failure = "foreground";
  /**
   * The program that took the foreground, by its name ("Microsoft Teams"): null when the driver
   * looked and couldn't name one (Windows didn't say, or the foreground had come back to the
   * browser itself), and absent when it didn't look. The page's record keeps it.
   */
  readonly program?: string | null;

  constructor(message: string, options?: { program?: string | null }) {
    super(message);
    this.name = "ForegroundError";
    this.program = options?.program;
  }
}
