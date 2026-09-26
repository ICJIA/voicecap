/**
 * Stub for driving NVDA through the W3C AT Driver protocol (https://w3c.github.io/at-driver/).
 *
 * The NVDA implementation is https://github.com/Prime-Access-Consulting/nvda-at-automation
 * (contributed to the W3C): an NVDA add-on whose "Capture Speech" synthesizer exposes speech, plus
 * a Go WebSocket server, by default at ws://localhost:3031. Every method below throws; the
 * comments show how each would map onto AT Driver messages once this is built.
 *
 * AT Driver basics: JSON over a WebSocket at the resource "/session". Commands are
 * { id, method, params }, results { id, result }, errors { id, error, message }, and events
 * { method, params }. Keys are WebDriver key codes: "\uE009" Control, "\uE010" End,
 * "\uE011" Home, "\uE015" ArrowDown, "\uE004" Tab.
 */
import { NotImplementedError } from "../util/errors.js";
import type {
  EnvironmentInfo,
  FocusedElement,
  PageInfo,
  ScreenReaderDriver,
  Speech,
} from "./types.js";

export class AtDriverNvdaDriver implements ScreenReaderDriver {
  readonly name = "at-driver";

  start(): Promise<void> {
    // Launch the browser with Playwright, as the Guidepup driver does, then connect a WebSocket
    // to ws://localhost:3031/session and send
    //   { id, method: "session.new", params: { capabilities: { alwaysMatch: { atName: "NVDA" } } } }
    // Subscribe to "interaction.capturedOutput" events: each carries { data: text } spoken by NVDA.
    return notImplemented("start");
  }

  stop(): Promise<void> {
    // { method: "session.end" }, close the WebSocket, then close the browser.
    return notImplemented("stop");
  }

  getEnvironmentInfo(): Promise<EnvironmentInfo> {
    // atName/atVersion come back in session.new's result capabilities. Settings come from
    //   { method: "settings.getSettings", params: { settings: [{ name: "..." }, ...] } }
    // after listing names with "settings.getSupportedSettings".
    return notImplemented("getEnvironmentInfo");
  }

  cleanupStale(): Promise<string[]> {
    // The same process cleanup as the Guidepup driver (NVDA and the browser).
    return notImplemented("cleanupStale");
  }

  openPage(_url: string): Promise<PageInfo> {
    // Browser work is Playwright's, as in the Guidepup driver; entering the web content uses the
    // same keystrokes, sent as "interaction.userIntent" pressKeys commands (see nextLine).
    return notImplemented("openPage");
  }

  nextLine(): Promise<Speech> {
    // { method: "interaction.userIntent", params: { name: "pressKeys", keys: ["\uE015"] } }
    // then collect "interaction.capturedOutput" events until 1 s of silence, joining them in
    // the speech format described in types.ts.
    return notImplemented("nextLine");
  }

  nextHeading(): Promise<Speech> {
    // pressKeys with keys: ["h"]
    return notImplemented("nextHeading");
  }

  nextFocusable(): Promise<Speech> {
    // pressKeys with keys: ["\uE004"] (Tab)
    return notImplemented("nextFocusable");
  }

  toTop(): Promise<Speech> {
    // pressKeys with keys: ["\uE009", "\uE011"] (Control+Home)
    return notImplemented("toTop");
  }

  toBottom(): Promise<Speech> {
    // pressKeys with keys: ["\uE009", "\uE010"] (Control+End)
    return notImplemented("toBottom");
  }

  focusInDocument(): Promise<boolean> {
    // Answered by Playwright (document.hasFocus()), not by AT Driver.
    return notImplemented("focusInDocument");
  }

  focusedElement(): Promise<FocusedElement | null> {
    // Answered by Playwright, not by AT Driver.
    return notImplemented("focusedElement");
  }
}

function notImplemented(method: string): Promise<never> {
  return Promise.reject(
    new NotImplementedError(
      `The at-driver driver is a stub: ${method}() is not implemented. Use driver "guidepup" (Windows) or "replay".`,
    ),
  );
}
