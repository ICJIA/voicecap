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
 * Whether `name` is the section that holds NVDA's Remote Access settings, `remote`, in any case. (A
 * name with spaces around it is refused as a name, whatever it spells: see OUTSIDE_A_NAME.)
 */
function isRemoteAccessSection(name: string): boolean {
  return name.toLowerCase() === "remote";
}

/**
 * The characters a setting's name may not have: a name matches `^[A-Za-z0-9_.-]+$`, so this finds
 * the first character of a name that is none of those. NVDA's and Guidepup's setting names are
 * plain identifiers, and Guidepup writes each name into NVDA's settings file as it is, between
 * brackets or before an equals sign. NVDA reads that file with ConfigObj, whose section pattern
 * takes the quotation marks off a section's name and reads a number sign after the closing bracket
 * as a comment. So the name "remote" (with its quotation marks) writes the line ["remote"], and
 * `remote]#` writes [remote]#], and each would read as the Remote Access section. ConfigObj's ways
 * with quotation marks, brackets, and number signs are more than a list of the characters that
 * do this could promise to cover, so the characters a name may have are listed, and no others.
 */
const OUTSIDE_A_NAME = /[^A-Za-z0-9_.-]/u;

/**
 * A control character (Unicode's Cc: U+0000 to U+001F and U+007F to U+009F), or a line or paragraph
 * separator (U+2028, U+2029). No word of NVDA's settings needs one, and several end a line there: a
 * word such as "1\n[remote]\n" writes the line [remote], a section header.
 */
const CONTROL_OR_SEPARATOR = /[\p{Cc}\u{2028}\u{2029}]/u;

/** What a config is told, after the place and the code point, about a name it can't have. */
const NAME_RULE =
  "A name is letters, digits, underscores, dots, and hyphens: voicecap writes it into NVDA's settings file as it is, and anything else could write a section of its own there, such as the one for NVDA's Remote Access settings (remote).";

/** What a config is told, after the place and the code point, about a word it can't have. */
const WORDS_RULE =
  "NVDA's settings are plain text: voicecap writes each word into NVDA's settings file as it is, so a control character or a line break could start a section of its own there, such as the one for NVDA's Remote Access settings (remote).";

/** Where something is in nvdaSettings: its name, and the place of the section that holds it. */
interface Place {
  name: string;
  within: Place | null;
}

/**
 * What is wrong in a name or a string of `settings`, at any depth and in lists too, and where: the
 * names that lead to it (the last being the name, or the name of the string, that is at fault) and
 * what to tell the person. Null when nothing is wrong. A name is wrong if it is empty or holds a
 * character outside A-Z, a-z, 0-9, "_", ".", and "-" (OUTSIDE_A_NAME), and a string is wrong if it
 * holds a control character or a separator (CONTROL_OR_SEPARATOR). The shallowest comes first,
 * and the first is all a refusal says: putting it right shows the next. A character is named by its
 * code point as Unicode writes it (`U+005B`).
 *
 * It looks with a queue of what's left, never by calling itself: the settings may come from a file
 * built to be deep enough to overflow the call stack, or (in memory) to hold themselves, so each
 * object is looked at once.
 */
function firstProblem(
  settings: Record<string, unknown>,
): { names: string[]; message: string } | null {
  const seen = new Set<object>([settings]);
  const queue: { table: Record<string, unknown>; place: Place | null }[] = [
    { table: settings, place: null },
  ];
  // The queue grows as it's read: a loop over an array follows its length as it goes.
  for (const { table, place } of queue) {
    for (const [name, value] of Object.entries(table)) {
      const here = { name, within: place };
      if (name === "") {
        return { names: namesOf(place), message: `has a setting with no name. ${NAME_RULE}` };
      }
      const outside = OUTSIDE_A_NAME.exec(name);
      if (outside !== null) {
        const code = codePointOf(outside[0]);
        return {
          names: namesOf(here),
          message: `holds ${code}, which a setting's name can't have. ${NAME_RULE}`,
        };
      }
      const held = typeof value === "string" ? CONTROL_OR_SEPARATOR.exec(value) : null;
      if (held !== null) {
        const code = codePointOf(held[0]);
        return {
          names: namesOf(here),
          message: `holds ${code}, which a setting's words can't have. ${WORDS_RULE}`,
        };
      }
      if (typeof value === "object" && value !== null && !seen.has(value)) {
        seen.add(value);
        queue.push({ table: value as Record<string, unknown>, place: here });
      }
    }
  }
  return null;
}

/** `U+000A`: a character as Unicode writes it, in upper-case hex of four digits or more. */
function codePointOf(character: string): string {
  return `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** The names that lead to a place, outermost first. */
function namesOf(place: Place | null): string[] {
  const names: string[] = [];
  for (let at = place; at !== null; at = at.within) names.push(at.name);
  return names.reverse();
}

/**
 * `name`, written to be shown in a path: every control character, invisible formatting character,
 * and separator is an escape such as \u{a}. inertText does that, but leaves a line feed and a tab
 * as they are, and a name that holds one is what the message points at. (A name that is only
 * letters, digits, "_", ".", and "-" is shown as it is.)
 */
function written(name: string): string {
  return inertText(
    name.replace(/[\r\n\t]/g, (character) => `\\u{${character.codePointAt(0)!.toString(16)}}`),
  );
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
   * connection to NVDA depends on them, and Guidepup's own configuration sets them. And a name in
   * them, at any depth, is letters, digits, "_", ".", and "-", and no string in them holds a
   * control character or a line or paragraph separator: Guidepup writes both into NVDA's settings
   * file as they are, so anything else could write a section of its own there, that one included,
   * past the check of the name `remote`.
   */
  nvdaSettings: z
    .record(z.string(), z.unknown())
    .refine((settings) => !Object.keys(settings).some(isRemoteAccessSection), {
      path: ["remote"],
      message: REMOTE_ACCESS_REFUSAL,
    })
    .superRefine((settings, ctx) => {
      const problem = firstProblem(settings);
      if (problem === null) return;
      // The path is for the person to read, so each name is written out: a name that holds a line
      // break must not break the line, nor forge a line of its own.
      ctx.addIssue({ code: "custom", path: problem.names.map(written), message: problem.message });
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
