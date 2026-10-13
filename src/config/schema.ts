import { z } from "zod";

import { PASS_NAMES } from "../model.js";
import { normalizeCanonical } from "../pages/canonical.js";
import { UsageError } from "../util/errors.js";
import { inertText } from "../util/inert.js";

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

/** What a config is told when its nvdaSettings set NVDA's Remote Access settings. */
const REMOTE_ACCESS_REFUSAL =
  "voicecap doesn't change NVDA's Remote Access settings (remote): Guidepup's own configuration sets them, and voicecap's connection to NVDA depends on them.";

/**
 * Whether `name` is the section that holds NVDA's Remote Access settings, `remote`. It is compared
 * in any case, and with the spaces around it left off: Guidepup writes a section's name as it is
 * given, and the reader of NVDA's settings file may ignore spaces there.
 */
function isRemoteAccessSection(name: string): boolean {
  return name.trim().toLowerCase() === "remote";
}

/**
 * What a config is told, after the place and the code point, when a name or a word of its
 * nvdaSettings holds a control character. Why: see firstControlCharacter.
 */
const CONTROL_CHARACTER_REASON =
  "NVDA's settings are plain text: voicecap writes each name and word into NVDA's settings file as it is, so a control character or a line break could start a section of its own there, such as the one for NVDA's Remote Access settings (remote).";

/**
 * A control character (Unicode's Cc: U+0000 to U+001F and U+007F to U+009F), or a line or paragraph
 * separator (U+2028, U+2029). No name or word of NVDA's settings needs one, and several end a line.
 */
const CONTROL_OR_SEPARATOR = /[\p{Cc}\u{2028}\u{2029}]/u;

/** Where something is in nvdaSettings: its name, and the place of the section that holds it. */
interface Place {
  name: string;
  within: Place | null;
}

/**
 * The first control character or separator (see CONTROL_OR_SEPARATOR) in a name or a string of
 * `settings`, at any depth and in lists too: the names that lead to it, the last being the name or
 * the string that holds it, and its code point as Unicode writes it (`U+000A`). Null when there is
 * none. The shallowest comes first, and the first is all a refusal says: taking it out shows the
 * next.
 *
 * Guidepup writes each name and string of nvdaSettings into NVDA's settings file as it is, and a
 * line break ends a line there: a name such as "x]\n[remote" writes the line "[remote]", a section
 * header, so refusing the name `remote` alone would not keep a config out of NVDA's Remote Access
 * settings.
 *
 * It looks with a queue of what's left, never by calling itself: the settings may come from a file
 * built to be deep enough to overflow the call stack, or (in memory) to hold themselves, so each
 * object is looked at once.
 */
function firstControlCharacter(
  settings: Record<string, unknown>,
): { names: string[]; code: string } | null {
  const seen = new Set<object>([settings]);
  const queue: { table: Record<string, unknown>; place: Place | null }[] = [
    { table: settings, place: null },
  ];
  // The queue grows as it's read: a loop over an array follows its length as it goes.
  for (const { table, place } of queue) {
    for (const [name, value] of Object.entries(table)) {
      const held =
        CONTROL_OR_SEPARATOR.exec(name) ??
        (typeof value === "string" ? CONTROL_OR_SEPARATOR.exec(value) : null);
      if (held !== null) {
        const code = held[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
        return { names: namesOf({ name, within: place }), code: `U+${code}` };
      }
      if (typeof value === "object" && value !== null && !seen.has(value)) {
        seen.add(value);
        queue.push({ table: value as Record<string, unknown>, place: { name, within: place } });
      }
    }
  }
  return null;
}

/** The names that lead to a place, outermost first. */
function namesOf(place: Place): string[] {
  const names: string[] = [];
  for (let at: Place | null = place; at !== null; at = at.within) names.push(at.name);
  return names.reverse();
}

/**
 * `name`, written to be shown in a message: every control character, invisible formatting
 * character, and separator is an escape such as \u{a}. inertText does that, but leaves a line feed
 * and a tab as they are, and a name that holds one is what the message points at.
 */
function written(name: string): string {
  return inertText(
    name.replace(/[\r\n\t]/g, (character) => `\\u{${character.codePointAt(0)!.toString(16)}}`),
  );
}

/** What a config is told when a name or a string in its nvdaSettings holds a control character. */
function controlCharacterRefusal(names: string[], code: string): string {
  const place = ["nvdaSettings", ...names].map(written).join(".");
  return `${place} holds ${code}. ${CONTROL_CHARACTER_REASON}`;
}

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
  /**
   * NVDA settings overrides, applied through Guidepup's start({ settings }) and recorded. They may
   * not set NVDA's Remote Access settings, a section named `remote` in any case: voicecap's
   * connection to NVDA depends on them, and Guidepup's own configuration sets them. And no name or
   * string in them, at any depth, may hold a control character or a line or paragraph separator,
   * which could write a section of NVDA's settings file, that one included, past the check of names.
   */
  nvdaSettings: z
    .record(z.string(), z.unknown())
    .refine((settings) => !Object.keys(settings).some(isRemoteAccessSection), {
      path: ["remote"],
      message: REMOTE_ACCESS_REFUSAL,
    })
    .superRefine((settings, ctx) => {
      const found = firstControlCharacter(settings);
      if (found === null) return;
      ctx.addIssue({ code: "custom", message: controlCharacterRefusal(found.names, found.code) });
    }),
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
  /** How many times a page is tried before it's recorded as failed. */
  pageAttempts: positiveInt,
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
      /**
       * Roles flagged only in the tab pass, not alone on a read-pass line: in browse mode, NVDA
       * reads a form field's label as separate text, on the field's line or the line before.
       */
      tabOnlyRoles: z.array(z.string().min(1)),
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
    /**
     * The site's name as a line under the shareable page's headline, which is its canonical name
     * (see `canonical`). Without it, the page has no such line.
     */
    siteName: z.string().min(1).nullable(),
    /**
     * The site's canonical address, as people visit it: the page and its Word copy name the site by
     * its host, and show each page on it, whatever address voicecap read (a copy on `localhost`, say).
     * It's kept as its root, with a scheme and a `/` on the end: `dvfr.illinois.gov` is
     * `https://dvfr.illinois.gov/`. It beats the root every run recorded, so it names every site
     * the config is used with: keep one config per site, as with `siteName`. Without it, the page
     * uses the root the latest run recorded, and without that, the address voicecap read. An IP
     * address or a local address is refused, since neither is a site's name.
     */
    canonical: z
      .string()
      .nullable()
      .transform((address, ctx): string | null => {
        if (address === null) return null;
        try {
          return normalizeCanonical(address);
        } catch (error) {
          if (!(error instanceof UsageError)) throw error;
          ctx.addIssue({ code: "custom", message: error.message });
          return z.NEVER;
        }
      }),
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
