import type { PassName } from "../model.js";
import type { VoicecapConfig } from "./schema.js";

/**
 * What the forms pass takes where the config sets nothing for it. They aren't in DEFAULT_CONFIG: a
 * config's SHA-256 is that of the settings it holds, and a config that doesn't ask for the forms
 * pass hashes as it did before the pass existed.
 */
export const FORMS_DEFAULTS = {
  stepCap: 500,
  settleMs: 3000,
  maxPerPage: 5,
  /**
   * Analytics and tracking services, by host name: a request to one of these, or to a host under
   * one (`www.google-analytics.com` under `google-analytics.com`), never counts as a form sending,
   * since a page sends to them on a press whether or not the form goes. A config's
   * `forms.analyticsHosts` adds to these.
   */
  analyticsHosts: [
    "google-analytics.com",
    "analytics.google.com",
    "googletagmanager.com",
    "doubleclick.net",
    "googleadservices.com",
    "googlesyndication.com",
    "facebook.com",
    "facebook.net",
    "clarity.ms",
    "hotjar.com",
    "hotjar.io",
    "siteimprove.com",
    "siteimproveanalytics.com",
    "siteimproveanalytics.io",
    "newrelic.com",
    "nr-data.net",
    "segment.io",
    "segment.com",
    "mixpanel.com",
    "matomo.cloud",
    "plausible.io",
    "quantserve.com",
    "bing.com",
    "linkedin.com",
    "licdn.com",
    "twitter.com",
    "x.com",
    "t.co",
    "tiktok.com",
    "cloudflareinsights.com",
    "sentry.io",
    "datadoghq.com",
    "browser-intake-datadoghq.com",
  ] as readonly string[],
  /**
   * By input type, as the keys are typed; `text` is for any other typed field. A check box, radio, or
   * list needs none. `date` is a US date: month, day, year. Types with no value here and no way to
   * type one, such as `file`, need a config's, and a form that requires one without it isn't tested.
   */
  values: {
    text: "voicecap test",
    email: "test@example.com",
    tel: "555-555-5555",
    number: "1",
    url: "https://example.org",
    date: "01012026",
  } as Record<string, string>,
  /**
   * NVDA's English words the forms pass's flag rules listen for (matched in any case, anywhere in
   * what it said): the state it gives a required field, and the one it gives an invalid field. NVDA
   * 2026.2 says "required" at every required field, and "invalid entry" at an invalid one, and also,
   * before any press, at an untouched required radio button, list, and check box (the PC trial of
   * 2026-10-30), so the rules never take "invalid entry" alone as proof of an error.
   */
  words: {
    required: ["required"],
    invalid: ["invalid entry"],
    // The roles NVDA gives the fields the pass fills, right after the name, as it announces one at
    // focus: a text field, a textarea ("edit, required, multi line": multi line is a state, after
    // the role), a list, a check box, a radio button, a number field, a range, and a date field.
    fieldRoles: [
      "edit",
      "date edit",
      "combo box",
      "check box",
      "radio button",
      "list",
      "spin button",
      "slider",
    ],
    // How NVDA may say a symbol at the end of a field's name ("Email *" as "Email star").
    spokenSymbols: ["star", "asterisk"],
  } as {
    required: readonly string[];
    invalid: readonly string[];
    fieldRoles: readonly string[];
    spokenSymbols: readonly string[];
  },
};

/** The forms pass's settings as the config has them, with FORMS_DEFAULTS for each it leaves out. */
export function formsSettingsOf(
  config: VoicecapConfig,
): Required<NonNullable<VoicecapConfig["forms"]>> {
  const { settleMs, maxPerPage, values, analyticsHosts } = config.forms ?? {};
  return {
    settleMs: settleMs ?? FORMS_DEFAULTS.settleMs,
    maxPerPage: maxPerPage ?? FORMS_DEFAULTS.maxPerPage,
    values: values ?? FORMS_DEFAULTS.values,
    // The config's hosts are added to voicecap's own, each once, in a lower case.
    analyticsHosts: [
      ...new Set([
        ...FORMS_DEFAULTS.analyticsHosts,
        ...(analyticsHosts ?? []).map((host) => host.toLowerCase()),
      ]),
    ],
  };
}

/** The most steps a pass may take, by the config: the forms pass has FORMS_DEFAULTS' where it sets none. */
export function stepCapOf(config: VoicecapConfig, pass: PassName): number {
  return config.stepCaps[pass] ?? FORMS_DEFAULTS.stepCap;
}

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
  stepCaps: { read: 1500, headings: 500, tab: 1000 },
  read: { endConfirmations: 1 },
  repeatLimit: 10,
  restartEvery: 50,
  maxConsecutiveFailures: 5,
  pageAttempts: 5,
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
      // NVDA 2026.2 read a labeled textarea as "Your question (required)", then "edit, required,
      // multi line" (voicecap demo, 2026-09-29). Focus mode says the name first, so the tab pass
      // can tell. A button's or a graphic's name is spoken with it in both modes.
      tabOnlyRoles: ["edit", "combo box", "check box", "radio button"],
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
    siteName: null,
    canonical: null,
    logo: null,
  },
};
