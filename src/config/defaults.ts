import type { VoicecapConfig } from "./schema.js";

/**
 * Defaults for every setting. The NVDA phrasing (stop detection and flag rules) assumes NVDA's
 * English interface. It was checked against real output from NVDA 2026.2 with Chrome 153 (the
 * fixture run in fixture/replay-run): on the flawed page every rule fires for the right steps, and
 * the well-built pages raise none. NVDA 2026.2 reads an image without alt text as "Unlabeled
 * graphic" (plus a hint about image descriptions), which the "unlabeled" phrase catches.
 */
export const DEFAULT_CONFIG: VoicecapConfig = {
  driver: "guidepup",
  replayFrom: null,
  browser: { channel: "chrome", fallbackToChromium: true },
  capture: "complete",
  nvdaSettings: {},
  readiness: { readySelector: null, settleMs: 500, networkIdleTimeoutMs: 15_000 },
  timeouts: { stepMs: 30_000, pageMs: 30 * 60_000, driverStartMs: 120_000 },
  passes: ["read", "headings", "tab"],
  stepCaps: { read: 400, headings: 200, tab: 300 },
  read: { endConfirmations: 1 },
  repeatLimit: 10,
  restartEvery: 50,
  maxConsecutiveFailures: 5,
  phrasing: {
    noNextHeading: "^no next heading$",
  },
  flags: {
    genericLinkText: {
      enabled: true,
      passes: ["read", "tab"],
      phrases: ["click here", "read more", "learn more", "here", "more", "more info", "details"],
      linkRoles: ["link", "visited link", "same page link"],
      countNameless: true,
      minCount: 2,
    },
    unlabeled: {
      enabled: true,
      passes: ["read", "tab"],
      roles: ["button", "edit", "combo box", "check box", "radio button", "graphic"],
      phrases: ["unlabeled", "unlabelled"],
      contextItems: [
        "landmark$",
        // Landmarks are announced with "landmark" ("main landmark"); bare role words like
        // "search" or "main" would collide with names ("Search, button").
        "^(form|region)$",
        "^list( with \\d+ items?)?$",
        "^with \\d+ items?$",
        "^out of ",
        "^grouping$",
        "^table with ",
        "^dialog$",
        "^frame$",
        "^document$",
        "^bullet$",
        "^level \\d+$",
      ],
      stateItems: [
        "blank",
        "clickable",
        "focused",
        "unavailable",
        "read only",
        "required",
        "invalid entry",
        "has auto complete",
        "not checked",
        "checked",
        "not pressed",
        "pressed",
        "collapsed",
        "expanded",
        "has popup",
        "submenu",
        "multi line",
        "selected",
      ],
    },
    readNotFinished: { enabled: true },
    headings: { enabled: true, levelPattern: "\\blevel (\\d+)\\b" },
    tabNoStops: { enabled: true },
    tabBeforeMain: { enabled: true, maxStops: 10, skipLinkName: "\\bskip\\b" },
    repeatedPhrase: { enabled: true, minRun: 4 },
    custom: [],
  },
  manual: {
    editableRoles: [
      "edit",
      "password edit",
      "editable",
      "combo box",
      "spin button",
      "protected",
      "search edit",
    ],
    focusKeys: [
      "tab",
      "shift+tab",
      "enter",
      "numpadEnter",
      "escape",
      "f6",
      "shift+f6",
      "alt+tab",
      "alt+shift+tab",
      "nvda+space",
      "alt+d",
      "control+l",
    ],
  },
  reviewer: null,
  report: {
    title: "NVDA transcript report",
    agency: null,
    logo: null,
  },
};
