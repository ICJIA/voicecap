import type {
  EnvironmentInfo,
  EventRecorder,
  FocusedElement,
  PageInfo,
  ScreenReaderDriver,
  Speech,
} from "../../src/drivers/types.js";
import { canonicalKey } from "../../src/pages/url.js";

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
  /** Browse-mode lines, top to bottom. */
  lines?: string[];
  /** What Ctrl+End says (default: the last line). */
  bottom?: string;
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

  private readonly pages = new Map<string, ScriptedPage>();
  private page: ScriptedPage | null = null;
  private line = 0;
  private heading = 0;
  private stopIndex = 0;
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
      this.inDocument = true;
      this.focused = page.initialFocus ?? null;
      return {
        finalUrl: page.finalUrl ?? url,
        status: page.status ?? 200,
        contentType: page.contentType ?? "text/html; charset=utf-8",
        title: page.title ?? null,
        canonical: page.canonical ?? null,
      };
    });
  }

  toBottom(): Promise<Speech> {
    return this.call("toBottom", () => {
      const lines = this.lines();
      this.line = lines.length - 1;
      return this.page?.bottom ?? lines.at(-1) ?? "";
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
