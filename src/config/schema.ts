import { z } from "zod";

import { PASS_NAMES } from "../model.js";

const passName = z.enum(PASS_NAMES);
const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();
/** A regular expression source string, validated so config errors surface at load time. */
const regexSource = z.string().refine(
  (source) => {
    try {
      new RegExp(source, "i");
      return true;
    } catch {
      return false;
    }
  },
  { message: "must be a valid regular expression" },
);

const toggle = { enabled: z.boolean() };

/**
 * The resolved config. Defaults (defaults.ts) are merged under the user's config before this
 * schema validates it, so every field is required here. Unknown keys are errors, to catch typos.
 */
export const configSchema = z.strictObject({
  /** "guidepup" (default, Windows + NVDA), "replay", or "at-driver" (stub). */
  driver: z.enum(["guidepup", "replay", "at-driver"]),
  /** Replay driver: the run folder to replay (overridden by --replay-from). */
  replayFrom: z.string().nullable(),
  browser: z.strictObject({
    /** Playwright channel; "chrome" is the installed Google Chrome. */
    channel: z.string().min(1),
    /** Fall back to Playwright's Chromium when the channel isn't installed. */
    fallbackToChromium: z.boolean(),
  }),
  /** "complete" keeps everything NVDA says per keystroke (Guidepup capture: true). */
  capture: z.enum(["complete", "initial"]),
  /** NVDA settings overrides, applied through Guidepup's start({ settings }) and recorded. */
  nvdaSettings: z.record(z.string(), z.unknown()),
  readiness: z.strictObject({
    /** Wait for this selector after network idle (Nuxt sites keep rendering after load). */
    readySelector: z.string().min(1).nullable(),
    /** Extra settle delay after the page is ready, in ms. */
    settleMs: nonNegativeInt,
    networkIdleTimeoutMs: positiveInt,
  }),
  timeouts: z.strictObject({
    stepMs: positiveInt,
    pageMs: positiveInt,
    driverStartMs: positiveInt,
  }),
  /** Passes run when --passes isn't given. */
  passes: z.array(passName).min(1),
  stepCaps: z.strictObject({ read: positiveInt, headings: positiveInt, tab: positiveInt }),
  read: z.strictObject({
    /** Extra Down Arrows to confirm the end of the page (0 = the plain rule). */
    endConfirmations: nonNegativeInt,
  }),
  /** Safety net: stop a pass when the same speech occurs this many times in a row. */
  repeatLimit: z.number().int().min(2),
  /** Restart NVDA and the browser every N pages. */
  restartEvery: positiveInt,
  /** Stop the run (exit 2, resumable) after this many failed pages in a row. */
  maxConsecutiveFailures: positiveInt,
  /** NVDA phrasing the core's stop detection matches (English interface). */
  phrasing: z.strictObject({
    noNextHeading: regexSource,
  }),
  flags: z.strictObject({
    genericLinkText: z.strictObject({
      ...toggle,
      passes: z.array(passName),
      /** Link texts that don't make sense out of context. */
      phrases: z.array(z.string().min(1)),
      /** Role words NVDA uses for links. */
      linkRoles: z.array(z.string().min(1)),
      /** Also count links announced with no name at all. */
      countNameless: z.boolean(),
      /** Flag when a pass announces generic links at least this many times. */
      minCount: positiveInt,
    }),
    unlabeled: z.strictObject({
      ...toggle,
      passes: z.array(passName),
      /** Role words that, spoken without a name, mean the control is unlabeled. */
      roles: z.array(z.string().min(1)),
      /** Phrases that always mean something is unlabeled. */
      phrases: z.array(z.string().min(1)),
      /** Context NVDA speaks before a control (landmarks, lists); skipped when looking for a name. */
      contextItems: z.array(regexSource),
      /** State words that don't count as a name. */
      stateItems: z.array(z.string().min(1)),
    }),
    readNotFinished: z.strictObject({ ...toggle }),
    headings: z.strictObject({
      ...toggle,
      /** Captures the heading level from NVDA's announcement. */
      levelPattern: regexSource,
    }),
    tabNoStops: z.strictObject({ ...toggle }),
    tabBeforeMain: z.strictObject({
      ...toggle,
      /** Flag when at least this many focus stops come before main content. */
      maxStops: positiveInt,
      /** Accessible names matching this count as a skip link. */
      skipLinkName: regexSource,
    }),
    repeatedPhrase: z.strictObject({
      ...toggle,
      /** Flag runs of at least this many identical steps. */
      minRun: z.number().int().min(2),
    }),
    /** Extra phrase rules: flag when `pattern` matches at least minCount steps of `passes`. */
    custom: z.array(
      z.strictObject({
        id: z.string().regex(/^[a-z0-9-]+$/, "use lowercase letters, digits and dashes"),
        description: z.string().min(1),
        passes: z.array(passName).min(1),
        pattern: regexSource,
        minCount: positiveInt,
      }),
    ),
  }),
  manual: z.strictObject({
    /** Role and state words that mean focus is in an editable field (redaction heuristic). */
    editableRoles: z.array(z.string().min(1)),
    /** NVDA key names that move focus; the speech after them announces the new focus. */
    focusKeys: z.array(z.string().min(1)),
  }),
  /** Reviewer name used when --reviewer, VOICECAP_REVIEWER and git config user.name are all unset. */
  reviewer: z.string().min(1).nullable(),
  report: z.strictObject({
    title: z.string().min(1),
    agency: z.string().min(1).nullable(),
    /** An inline image, e.g. "data:image/png;base64,..." (the report has no external assets). */
    logo: z
      .string()
      .regex(
        /^data:image\/[a-z0-9.+-]+(;[a-z0-9=.+-]+)*(;base64)?,/i,
        "must be a data:image/... URI",
      )
      .nullable(),
  }),
});

export type VoicecapConfig = z.infer<typeof configSchema>;

type DeepPartial<T> = T extends readonly (infer _U)[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** What a voicecap.config file contains: any subset of the settings. */
export type UserConfig = DeepPartial<VoicecapConfig>;
