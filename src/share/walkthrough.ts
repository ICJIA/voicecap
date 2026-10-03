/**
 * A walkthrough file: a run's recipe, so anyone can repeat the run exactly. This module builds one
 * from a run's record, writes it as the file holds it, and reads one back. It's pure: it reads no
 * file and no clock.
 *
 * A walkthrough file may come from anyone, so `parseWalkthrough` takes nothing on trust. A text over
 * 8 MB, a key the type doesn't have, a page address that isn't on the file's own site (or is too
 * long, or is written with a space or a control character), a page's label, template, or notes with
 * a control character in it (other than a tab or a line break), a ready selector over 1,024
 * characters or with a control or format character in it, a run id made of anything but a run id's
 * characters, NVDA settings nested too deep, a step limit over 100,000, or a readiness time over
 * ten minutes (600,000 milliseconds) refuses the whole file, saying what's wrong and where, before
 * anything runs. `walkthroughProblem` gives that same reason for a walkthrough in hand, so a writer
 * can say why a file of it couldn't be read back before it writes one.
 *
 * The file goes to auditors, and into the shareable page, so it holds no folders: the file of a
 * page list, or of a walkthrough, is kept by its name alone, since a path can carry the person's
 * user name.
 *
 * After a repeat, `compareWithOriginal` sets what the repeat read against what the file says the
 * original did, page by page, and `comparisonLines` says the result as the terminal shows it.
 */
import { z } from "zod";

import {
  PASS_NAMES,
  type CaptureMode,
  type EnvironmentRecord,
  type PageRecord,
  type PageSource,
  type PageStatus,
  type PassName,
  type RunJson,
  type RunSettings,
  type SourceDetails,
} from "../model.js";
import { canonicalKey } from "../pages/url.js";
import { UsageError } from "../util/errors.js";
import { canonicalJson } from "../util/hash.js";

export interface WalkthroughPage {
  url: string;
  label?: string;
  template?: string;
  notes?: string;
  /** What the original run did with the page, and each pass's fingerprint where it read it. */
  original: { status: PageStatus; passes: Partial<Record<PassName, string>> };
}

export interface WalkthroughSettings {
  passes: PassName[];
  stepCaps: Record<PassName, number>;
  capture: CaptureMode;
  /** null when the original run didn't record them. */
  readiness: {
    readySelector: string | null;
    settleMs: number;
    networkIdleTimeoutMs: number;
  } | null;
}

export interface WalkthroughOrigin {
  run: string;
  seal: string | null;
  createdAt: string;
  completedAt: string;
  replayed: boolean;
  /**
   * The page source as the run recorded it, and the fingerprints of what it read from it. The file
   * of a page list or of a walkthrough is kept by its name alone, in both: its folders could carry
   * the person's user name.
   */
  source: PageSource;
  sourceFingerprints: { name: string; sha256: string }[];
  /** From the run's last session; null where it recorded none. */
  voicecap: string | null;
  screenReader: { name: string; version: string } | null;
  browser: { name: string; version: string } | null;
  /** Recorded, never applied: a repeat uses this computer's. */
  nvdaSettings: Record<string, unknown>;
  browserChannel: string;
}

export interface Walkthrough {
  voicecapWalkthrough: 1;
  site: string;
  pages: WalkthroughPage[];
  settings: WalkthroughSettings;
  original: WalkthroughOrigin;
}

/** The most pages a walkthrough file may list: a file with more is refused, not run. */
export const MAX_WALKTHROUGH_PAGES = 10_000;

/**
 * The most a walkthrough file may be, in bytes: 8 MB. The limits on pages and on addresses each
 * hold on their own, and together allow a file many times this (10,000 pages at 8,192 characters
 * each is about 80 MB), and a hostile file of that size takes seconds to parse. So a larger one is
 * refused before it's read (see readWalkthroughFile) and, as a text, before any of it is parsed,
 * and `walkthroughProblem` refuses a walkthrough whose file would be larger: voicecap never writes
 * a file that it would refuse to read.
 */
export const MAX_WALKTHROUGH_BYTES = 8 * 1024 * 1024;

/**
 * The longest a page's address, or the site's, may be, in characters. A longer one is refused
 * before it's parsed: parsing a very long address with an international host takes seconds on some
 * versions of Node, and no run's address is anywhere near this long.
 */
export const MAX_ADDRESS_LENGTH = 8_192;

/**
 * The longest the ready selector (`settings.readiness.readySelector`) may be, in characters. A
 * longer one is refused before it's searched. A repeat copies the selector into the message of every
 * attempt that doesn't find it, and prints that message, so a selector of megabytes would fill the
 * terminal and the run's record; no real selector is anywhere near this long. A run whose selector
 * is longer can't be written as a file (`walkthroughProblem` says why).
 */
export const MAX_SELECTOR_LENGTH = 1_024;

/**
 * The most levels the recorded NVDA settings may be nested, the settings themselves being the
 * first, and a list a level as an object is. They're recorded and never applied, but a later task
 * reads them, and nothing real is anywhere near this deep.
 */
export const MAX_NVDA_SETTINGS_DEPTH = 32;

/**
 * The most a step limit may be. The config allows any whole number above 0; this only refuses an
 * absurd one, so a file written from any run the config allows reads back.
 */
const MAX_STEP_LIMIT = 100_000;
/** The most a readiness time may be, in milliseconds (ten minutes), for the same reason. */
const MAX_READINESS_MS = 600_000;

/**
 * The longest a run id may be, in characters. run-id.ts makes ids of fewer than 50 (a date and
 * time, a name of up to 24, and a number for a run begun in the same minute), so this refuses only
 * an absurd one.
 */
const MAX_RUN_ID_LENGTH = 100;

/** What a run id is made of, as run-id.ts makes one: letters, digits, ".", "_", and "-". */
const RUN_ID_CHARACTERS = /^[A-Za-z0-9._-]+$/;

/** The number of the format `walkthroughOf` writes, and the only one `parseWalkthrough` reads. */
const FORMAT_VERSION = 1;

/** How much of the file's own words a refusal repeats. */
const SHOWN_LIMIT = 80;

const BYTE_ORDER_MARK = 0xfeff;

/** The walkthrough of a completed run: every page of its list, in its order. Pure. */
export function walkthroughOf(run: RunJson): Walkthrough {
  if (run.status !== "completed" || run.completedAt === null) {
    throw new UsageError(
      `Run ${run.id} didn't complete, so it can't be repeated. Run it to the end first.`,
    );
  }
  const environment = lastEnvironment(run);
  return {
    voicecapWalkthrough: FORMAT_VERSION,
    site: run.site,
    pages: run.pages.map(pageOf),
    settings: {
      passes: [...run.settings.passes],
      stepCaps: perPass((pass) => run.settings.stepCaps[pass]),
      capture: run.settings.capture,
      readiness: readinessOf(run.settings.readiness),
    },
    original: {
      run: run.id,
      seal: run.seal ?? null,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      replayed: run.replayed,
      source: sourceOf(run.settings.source),
      sourceFingerprints: sourceFingerprintsOf(run.source),
      voicecap: environment?.voicecap.version ?? null,
      screenReader: environment?.screenReader
        ? { name: environment.screenReader.name, version: environment.screenReader.version }
        : null,
      browser: environment?.browser
        ? { name: environment.browser.name, version: environment.browser.version }
        : null,
      nvdaSettings: copyOfSettings(run.settings.nvdaSettings),
      browserChannel: run.settings.browser.channel,
    },
  };
}

/**
 * A copy of the NVDA settings a run recorded, so the walkthrough shares nothing with the record.
 * Settings nested too deep for a file (see MAX_NVDA_SETTINGS_DEPTH) are kept as they are instead:
 * copying a structure thousands of levels deep overflows the stack (structuredClone does, from
 * about 1,300 levels), and walkthroughProblem refuses such a walkthrough for its depth, so no file
 * is ever made of it. A record that deep still gets its reason, and not a RangeError.
 */
function copyOfSettings(settings: Record<string, unknown>): Record<string, unknown> {
  return isNestedTooDeep(settings) ? settings : structuredClone(settings);
}

/** As the file holds it: two-space indents and a final newline. */
export function walkthroughJson(walkthrough: Walkthrough): string {
  return `${JSON.stringify(walkthrough, null, 2)}\n`;
}

/**
 * Why parseWalkthrough would refuse this walkthrough, in the same words without the file's name, as
 * a sentence; null when it wouldn't. walkthroughOf builds the walkthrough of any completed run, and
 * the config allows runs that a file can't hold (more than 10,000 pages, a step limit above
 * 100,000, or pages whose addresses make the file larger than 8 MB), so a writer asks here before it
 * writes one.
 */
export function walkthroughProblem(walkthrough: Walkthrough): string | null {
  // The size first, as parseWalkthrough checks it: that of the file this would be written as.
  const text = writtenOut(walkthrough);
  if (text !== null && isTooLarge(text)) return TOO_LARGE;
  const reading = read(walkthrough);
  return "problem" in reading ? reading.problem : null;
}

/**
 * Read a walkthrough file strictly; a UsageError that names the file and the problem otherwise. A
 * text over MAX_WALKTHROUGH_BYTES is refused first, before any of it is parsed.
 */
export function parseWalkthrough(text: string, file: string): Walkthrough {
  if (isTooLarge(text)) throw notAWalkthrough(file, TOO_LARGE);
  let json: unknown;
  try {
    json = JSON.parse(text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text);
  } catch {
    throw notAWalkthrough(file, sentence("it isn't JSON"));
  }
  const reading = read(json);
  if ("problem" in reading) throw notAWalkthrough(file, reading.problem);
  return reading.walkthrough;
}

/** What reading a value as a walkthrough comes to: the walkthrough, or why it can't be read. */
type Reading = { walkthrough: Walkthrough } | { problem: string };

/**
 * The one place a value is read as a walkthrough, strictly: parseWalkthrough reads a file's JSON
 * here, and walkthroughProblem a walkthrough, so what they say of the same one can't differ. A
 * problem is a sentence.
 */
function read(value: unknown): Reading {
  if (!isRecord(value)) return { problem: sentence("it isn't a JSON object") };

  // Before the rest, which another version may lay out differently.
  const version = value["voicecapWalkthrough"];
  if (version === undefined) {
    return { problem: sentence('it has no "voicecapWalkthrough" format version') };
  }
  if (version !== FORMAT_VERSION) {
    const found = describeValue(version);
    return {
      problem: sentence(
        `its format version is ${found}, and this voicecap reads version ${FORMAT_VERSION}`,
      ),
    };
  }

  const result = walkthroughSchema.safeParse(value);
  if (result.success) {
    // The schema's output has to fit the type, or this doesn't compile.
    return { walkthrough: result.data };
  }
  const [issue] = result.error.issues;
  return { problem: sentence(issue === undefined ? "it is laid out wrongly" : reasonOf(issue)) };
}

// The size of a file, which parseWalkthrough and walkthroughProblem both check before `read`:

/** Why a file over MAX_WALKTHROUGH_BYTES is refused: what both of them say of it. */
const TOO_LARGE = sentence("it's larger than 8 MB");

/** Whether the text of a file is over MAX_WALKTHROUGH_BYTES, counted in bytes as its size is. */
function isTooLarge(text: string): boolean {
  return Buffer.byteLength(text, "utf8") > MAX_WALKTHROUGH_BYTES;
}

/**
 * The file a walkthrough would be written as, or null for one that JSON can't write out: NVDA
 * settings that hold themselves, or are nested more deeply than the stack can follow, in a
 * walkthrough that's in memory and was never read from a file. It has no file to be too large, and
 * `read` refuses it for its depth.
 */
function writtenOut(walkthrough: Walkthrough): string | null {
  try {
    return walkthroughJson(walkthrough);
  } catch {
    return null;
  }
}

// What a run's record gives:

/** The environment of the run's last session that recorded one. */
function lastEnvironment(run: RunJson): EnvironmentRecord | null {
  return run.sessions.findLast((session) => session.environment !== null)?.environment ?? null;
}

/** A page's place in the list, with what the original run did with it. */
function pageOf(page: PageRecord): WalkthroughPage {
  return {
    url: page.url,
    ...(page.label === undefined ? {} : { label: page.label }),
    ...(page.template === undefined ? {} : { template: page.template }),
    ...(page.notes === undefined ? {} : { notes: page.notes }),
    // A page that wasn't read said nothing, though its record may keep a pass it had begun.
    original: { status: page.status, passes: page.status === "done" ? fingerprintsOf(page) : {} },
  };
}

/** The fingerprint of each pass the page was read in, in pass order. */
function fingerprintsOf(page: PageRecord): Partial<Record<PassName, string>> {
  const fingerprints: Partial<Record<PassName, string>> = {};
  for (const pass of PASS_NAMES) {
    const summary = page.passes[pass];
    if (summary !== undefined) fingerprints[pass] = summary.contentSha256;
  }
  return fingerprints;
}

function readinessOf(readiness: RunSettings["readiness"]): WalkthroughSettings["readiness"] {
  if (!readiness) return null;
  return {
    readySelector: readiness.readySelector,
    settleMs: readiness.settleMs,
    networkIdleTimeoutMs: readiness.networkIdleTimeoutMs,
  };
}

/**
 * A file's name without its folders: the last part of its path, cut at / or \. A walkthrough keeps
 * the file of a page list or of a walkthrough by this alone, with its SHA-256 as it is. The file
 * goes to auditors and into the shareable page, and a full path could carry the person's user name.
 * A sitemap's address and --page addresses stay whole.
 */
function fileNameOf(file: string): string {
  return file.slice(Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")) + 1);
}

/**
 * The page source as the run recorded it, with its keys in the type's order, and the file of a page
 * list or of a walkthrough by its name alone.
 */
function sourceOf(source: PageSource): PageSource {
  switch (source.kind) {
    case "sitemap":
      return { kind: "sitemap", url: source.url };
    case "pages":
      return { kind: "pages", file: fileNameOf(source.file), sha256: source.sha256 };
    case "walkthrough":
      return {
        kind: "walkthrough",
        file: fileNameOf(source.file),
        sha256: source.sha256,
        run: source.run,
        from: source.from,
      };
    case "urls":
      return { kind: "urls", urls: [...source.urls] };
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

/**
 * The fingerprints of what the run read its pages from: each sitemap it fetched (named by its
 * address), a page list or a walkthrough (named by its file's name alone), and nothing for pages
 * given with --page.
 */
function sourceFingerprintsOf(details: SourceDetails): { name: string; sha256: string }[] {
  switch (details.kind) {
    case "sitemap":
      return (details.sitemaps ?? []).flatMap((sitemap) =>
        sitemap.sha256 === undefined ? [] : [{ name: sitemap.url, sha256: sitemap.sha256 }],
      );
    case "pages":
    case "walkthrough":
      return details.file !== undefined && details.sha256 !== undefined
        ? [{ name: fileNameOf(details.file), sha256: details.sha256 }]
        : [];
    case "urls":
      return [];
    default: {
      const _exhaustive: never = details.kind;
      return _exhaustive;
    }
  }
}

/** One entry for each pass, in pass order: a shape for the schema, or the values of a record. */
function perPass<T>(entry: (pass: PassName) => T): Record<PassName, T> {
  return Object.fromEntries(PASS_NAMES.map((pass) => [pass, entry(pass)])) as Record<PassName, T>;
}

// A repeat, against the original:

/** How one page of the file sounds in a repeat, against what the file says the original did. */
export type PageComparison =
  | { url: string; result: "same" }
  | { url: string; result: "different"; passes: PassName[] }
  | { url: string; result: "not-read-originally" }
  | { url: string; result: "not-read-now" };

/** A repeat against the original, page by page: what `compareWithOriginal` finds. */
export interface WalkthroughComparison {
  /** The id of the run the file was made from. */
  original: string;
  /** Each page of the file once, in the file's order. */
  pages: PageComparison[];
  /** "NVDA 2026.3 (was 2026.2)", each version that differs; empty when none does. */
  versions: string[];
  /** The NVDA settings whose values differ from the original's, by name. */
  nvdaSettings: string[];
}

/**
 * The repeat, page by page, against the original's fingerprints. Pure.
 *
 * - A page sounds the same only when the original and the repeat both read it (their status is
 *   "done") and every pass has the same fingerprint in both. A pass that only one of them has
 *   differs.
 * - A page the repeat didn't read (it failed, was skipped, or has no record) couldn't be read now,
 *   whatever the original did with it. A page the repeat read, and the original didn't, wasn't read
 *   in the original.
 * - A page is found by its address (see canonicalKey), as the repeat's record keeps it. One the file
 *   lists more than once is compared once, by its first listing, as the repeat read it once.
 * - The versions are the repeat's last session's against the original's, each named only when both
 *   recorded it and they differ; the NVDA settings are the repeat's own against the original's.
 *
 * What the file says that a comparison holds (a version, a setting's name) is held as `shown` gives
 * it, so the file can't put a control character in what's said to a terminal.
 */
export function compareWithOriginal(
  walkthrough: Walkthrough,
  repeat: RunJson,
): WalkthroughComparison {
  const { original } = walkthrough;
  return {
    original: original.run,
    pages: comparePages(walkthrough.pages, repeat.pages),
    versions: differingVersions(original, lastEnvironment(repeat)),
    nvdaSettings: differingSettings(original.nvdaSettings, repeat.settings.nvdaSettings),
  };
}

/** What a repeat says of itself against the original, as lines for the terminal. */
export function comparisonLines(comparison: WalkthroughComparison): string[] {
  const same = comparison.pages.filter((page) => page.result === "same").length;
  const lines = [
    `Compared with run ${comparison.original}, from its walkthrough file:`,
    ...comparison.pages.map((page) => `  ${page.url}: ${soundsLike(page)}`),
    `${same} of ${comparison.pages.length} pages sound the same.`,
  ];
  if (comparison.versions.length > 0) {
    lines.push(`Different from the original: ${comparison.versions.join(", ")}.`);
  }
  if (comparison.nvdaSettings.length > 0) {
    lines.push(
      `NVDA's settings here differ from the original's in: ${comparison.nvdaSettings.join(", ")}.`,
    );
  }
  return lines;
}

/** What a page's line says of it, after its address. */
function soundsLike(page: PageComparison): string {
  switch (page.result) {
    case "same":
      return "sounds the same";
    case "different":
      return `sounds different (${page.passes.join(", ")})`;
    case "not-read-originally":
      return "wasn't read in the original";
    case "not-read-now":
      return "couldn't be read now";
    default: {
      const _exhaustive: never = page;
      return _exhaustive;
    }
  }
}

/** Each page of the file once, in its order, against the repeat's record of it. */
function comparePages(
  listed: readonly WalkthroughPage[],
  repeated: readonly PageRecord[],
): PageComparison[] {
  const recorded = new Map(repeated.map((page) => [page.key, page]));
  const seen = new Set<string>();
  const comparisons: PageComparison[] = [];
  for (const page of listed) {
    const key = canonicalKey(page.url);
    if (seen.has(key)) continue;
    seen.add(key);
    comparisons.push(comparePage(page, recorded.get(key)));
  }
  return comparisons;
}

/** One page of the file against the repeat's record of it, which is undefined when it has none. */
function comparePage(page: WalkthroughPage, now: PageRecord | undefined): PageComparison {
  const { url, original } = page;
  // The repeat first: a page it couldn't read is said so, whether or not the original could.
  if (now?.status !== "done") return { url, result: "not-read-now" };
  if (original.status !== "done") return { url, result: "not-read-originally" };
  const passes = PASS_NAMES.filter(
    (pass) => original.passes[pass] !== now.passes[pass]?.contentSha256,
  );
  return passes.length === 0 ? { url, result: "same" } : { url, result: "different", passes };
}

/** A screen reader, a browser, or voicecap, and the version of it that ran. */
interface Versioned {
  name: string;
  version: string;
}

/**
 * The versions the repeat ran with that differ from the ones the original recorded, each as
 * `changedVersion` says it: NVDA, then the browser, then voicecap. A version is named only when both
 * runs recorded it, and none is when the repeat recorded no environment.
 */
function differingVersions(
  original: WalkthroughOrigin,
  environment: EnvironmentRecord | null,
): string[] {
  if (environment === null) return [];
  const was = original.voicecap === null ? null : { name: "voicecap", version: original.voicecap };
  const now = { name: "voicecap", version: environment.voicecap.version };
  return [
    changedVersion(original.screenReader, environment.screenReader),
    changedVersion(original.browser, environment.browser),
    changedVersion(was, now),
  ].filter((version) => version !== null);
}

/**
 * "NVDA 2026.3 (was 2026.2)": what ran now and what ran in the original, where both are known and
 * they differ, null otherwise. When the original's was another program ("VoiceOver 14.4 (was NVDA
 * 2026.2)"), its name is said too.
 */
function changedVersion(was: Versioned | null, now: Versioned | null): string | null {
  if (was === null || now === null) return null;
  if (was.name === now.name && was.version === now.version) return null;
  const before =
    was.name === now.name ? shown(was.version) : `${shown(was.name)} ${shown(was.version)}`;
  return `${shown(now.name)} ${shown(now.version)} (was ${before})`;
}

/**
 * The names of the NVDA settings whose values differ between the original's and the repeat's,
 * sorted: top-level settings only, one that only one has included. Values are compared as canonical
 * JSON, so a value is the same however its keys were ordered, and a setting with no value
 * (undefined) is one that isn't there, as a run's seal reads it. Serializing them is safe: a file's
 * settings are nested no more than MAX_NVDA_SETTINGS_DEPTH levels deep (a deeper file is refused),
 * and a completed run's were serialized already, to seal it.
 */
function differingSettings(
  original: Record<string, unknown>,
  now: Record<string, unknown>,
): string[] {
  const names = new Set([...Object.keys(original), ...Object.keys(now)]);
  return [...names]
    .filter((name) => settingValue(original, name) !== settingValue(now, name))
    .sort()
    .map(shown);
}

/** A setting's value as canonical JSON; undefined when the settings don't have it. */
function settingValue(settings: Record<string, unknown>, name: string): string | undefined {
  // Own keys only: a file's settings may have a key named __proto__, and settings that don't would
  // answer to that name with Object.prototype.
  return Object.hasOwn(settings, name) ? canonicalJson(settings[name]) : undefined;
}

// What a file must be to be read:

const PAGE_STATUSES = [
  "pending",
  "done",
  "failed",
  "skipped",
] as const satisfies readonly PageStatus[];
const CAPTURE_MODES = ["complete", "initial"] as const satisfies readonly CaptureMode[];

/** A SHA-256, as `sha256` writes it: 64 lower-case hex digits. */
const fingerprint = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "must be a SHA-256 fingerprint: 64 lower-case hex digits");

/** A whole number from `min` to `max`, as the config's bounds say, with a ceiling. */
function wholeNumber(min: number, max: number): z.ZodNumber {
  const rule = `must be a whole number from ${min.toLocaleString("en-US")} to ${max.toLocaleString("en-US")}`;
  return z.number().int(rule).min(min, rule).max(max, rule);
}

// A rule written as a refine or a custom gives its whole reason, as a sentence that names its own
// place in the file; reasonOf uses it as it is. A type, a range, or a key gives only what's wrong,
// and reasonOf puts the place before it.

const siteSchema = z.string().superRefine((site, ctx) => {
  // How it's written first, so a very long address is never parsed.
  const problem =
    writtenProblem("its site", site) ??
    (siteOrigin(site) === null ? "its site isn't a web address" : null);
  if (problem !== null) ctx.addIssue({ code: "custom", message: problem });
});

/**
 * A run id, as run-id.ts makes one: no more than MAX_RUN_ID_LENGTH letters, digits, ".", "_", and
 * "-". An id is printed in a transcript's header, in messages, and in warnings, so a file can't give
 * one that breaks a header's lines or reaches the terminal. `place` is where in the file this id
 * is: the reason is a custom one that names it, whatever is wrong (even a number, or no id at all).
 */
function runId(place: string): z.ZodCustom<string, string> {
  return z.custom<string>(
    (value) =>
      typeof value === "string" &&
      value.length <= MAX_RUN_ID_LENGTH &&
      RUN_ID_CHARACTERS.test(value),
    { error: `${place} isn't a run id` },
  );
}

/** Every kind of page source a run records. A fifth kind is one more entry here. */
const sourceSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("sitemap"), url: z.string() }),
    z.strictObject({ kind: z.literal("pages"), file: z.string(), sha256: fingerprint }),
    z.strictObject({ kind: z.literal("urls"), urls: z.array(z.string()) }),
    z.strictObject({
      kind: z.literal("walkthrough"),
      file: z.string().min(1, "must be a file's name"),
      sha256: fingerprint,
      run: runId("its original.source.run"),
      // What the pages of the run it was made from came from: never another walkthrough, since a
      // repeat's walkthrough says what the pages it repeated came from.
      from: z.enum(["sitemap", "pages", "urls"], {
        error: 'must be "sitemap", "pages", or "urls"',
      }),
    }),
  ],
  { error: "isn't a kind of page source voicecap knows" },
);

const pageSchema = z.strictObject({
  url: z.string(),
  label: z.string().optional(),
  template: z.string().optional(),
  notes: z.string().optional(),
  original: z.strictObject({
    status: z.enum(PAGE_STATUSES),
    passes: z.strictObject(perPass(() => fingerprint.optional())),
  }),
});

/**
 * The list's size is checked on its own before any page is, so a file of a million pages is refused
 * for its size and not read page by page first.
 */
const pagesSchema = z
  .array(z.unknown())
  .refine((pages) => pages.length > 0, { error: "it lists no pages" })
  .refine((pages) => pages.length <= MAX_WALKTHROUGH_PAGES, {
    error: `it lists more than ${MAX_WALKTHROUGH_PAGES.toLocaleString("en-US")} pages`,
  })
  .pipe(z.array(pageSchema));

/**
 * The selector a repeat waits for before it reads a page: some text, no longer than
 * MAX_SELECTOR_LENGTH, and with no control or format character in it. A repeat prints it, as it is,
 * in the message of each attempt that doesn't find it. The reason is a custom one that names the
 * selector's own place, as `reasonOf` passes it on as it is.
 */
const readySelectorSchema = z
  .string()
  .min(1, "must be some text, or null")
  .superRefine((selector, ctx) => {
    const problem = selectorProblem(selector);
    if (problem !== null) ctx.addIssue({ code: "custom", message: problem });
  });

const settingsSchema = z.strictObject({
  passes: z
    .array(z.enum(PASS_NAMES))
    .min(1, "must name at least one pass")
    .refine((passes) => new Set(passes).size === passes.length, {
      error: "its settings.passes name a pass more than once",
    }),
  stepCaps: z.strictObject(perPass(() => wholeNumber(1, MAX_STEP_LIMIT))),
  capture: z.enum(CAPTURE_MODES),
  readiness: z
    .strictObject({
      readySelector: readySelectorSchema.nullable(),
      settleMs: wholeNumber(0, MAX_READINESS_MS),
      networkIdleTimeoutMs: wholeNumber(1, MAX_READINESS_MS),
    })
    .nullable(),
});

const versionSchema = z.strictObject({ name: z.string(), version: z.string() });

const originSchema = z.strictObject({
  run: runId("its original.run"),
  seal: fingerprint.nullable(),
  createdAt: z.string(),
  completedAt: z.string(),
  replayed: z.boolean(),
  source: sourceSchema,
  sourceFingerprints: z.array(z.strictObject({ name: z.string(), sha256: fingerprint })),
  voicecap: z.string().nullable(),
  screenReader: versionSchema.nullable(),
  browser: versionSchema.nullable(),
  // Kept exactly as written, a key named __proto__ too (a record schema would drop it).
  nvdaSettings: z
    .custom<Record<string, unknown>>(isRecord, {
      error: "its original.nvdaSettings isn't an object",
    })
    .refine((settings) => !isNestedTooDeep(settings), {
      error: `its original.nvdaSettings is nested more than ${MAX_NVDA_SETTINGS_DEPTH} levels deep`,
    }),
  browserChannel: z.string(),
});

const walkthroughSchema = z
  .strictObject({
    voicecapWalkthrough: z.literal(FORMAT_VERSION),
    site: siteSchema,
    pages: pagesSchema,
    settings: settingsSchema,
    original: originSchema,
  })
  .superRefine(
    (walkthrough, ctx) => {
      const origin = siteOrigin(walkthrough.site);
      // The site is a web address by now: a file whose site isn't one has been refused already.
      if (origin === null) return;
      for (const [index, page] of walkthrough.pages.entries()) {
        const problem = pageProblem(index + 1, page, origin);
        if (problem === null) continue;
        ctx.addIssue({
          code: "custom",
          message: problem.reason,
          path: ["pages", index, problem.field],
        });
        // One reason is all a refusal gives.
        return;
      }
    },
    // Only a file with nothing else wrong gets here. A list that was refused for its size, say,
    // never had its pages read, and what's in it isn't pages.
    { when: ({ issues }) => issues.length === 0 },
  );

/**
 * A compile-time check that the schema reads every walkthrough the types allow: a kind added to
 * `PageSource`, say, doesn't compile until `sourceSchema` has an entry for it. (The other way, the
 * schema's output has to fit `Walkthrough`, `parseWalkthrough` checks by returning it.)
 */
type SchemaReadsEveryWalkthrough =
  Walkthrough extends z.output<typeof walkthroughSchema> ? true : never;
const _schemaReadsEveryWalkthrough: SchemaReadsEveryWalkthrough = true;

/** The origin of a site that's an http or https address, and null for anything else. */
function siteOrigin(site: string): string | null {
  const url = parseAddress(site);
  return url !== null && isWeb(url) ? url.origin : null;
}

/**
 * What an address may not be written with. The URL standard drops some characters as it parses an
 * address (a tab or a newline anywhere, spaces at either end) and rewrites others, so an address can
 * pass as parsed and still hold them as written, and the file keeps it as written. Control
 * characters (an escape, a bell), format characters (a zero-width space, a right-to-left override),
 * and spaces and separators are all refused.
 */
const UNSAFE_IN_AN_ADDRESS = /[\p{Cc}\p{Cf}\p{Z}]/u;

/**
 * What a page's label, template, and notes may not hold: a control character other than a tab, a
 * carriage return, or a line feed. They're the file's own words, and a repeat copies them, as they
 * are, into the header of every transcript it writes, where an escape sequence could clear or
 * rewrite the screen of whoever reads the transcript with `type` or `cat`. A carriage return or a
 * line feed is a legitimate part of a note from a CSV, and the header folds both into a space.
 */
const UNSAFE_IN_PAGE_TEXT = /(?![\t\n\r])\p{Cc}/u;

/**
 * What the ready selector may not hold: a control character (an escape, a bell, a tab, a line
 * break) or a format character (a zero-width space, a right-to-left override). A repeat prints the
 * selector, as it is, in the message of each attempt that doesn't find it.
 */
const UNSAFE_IN_A_SELECTOR = /[\p{Cc}\p{Cf}]/u;

/**
 * What's wrong with how an address is written, before it's parsed, as a reason that names it
 * (`subject` is "its site", or "page 3's address"); null when nothing is. The length comes first,
 * so a very long address is never searched or parsed.
 */
function writtenProblem(subject: string, address: string): string | null {
  if (address.length > MAX_ADDRESS_LENGTH) {
    return `${subject} is longer than ${MAX_ADDRESS_LENGTH.toLocaleString("en-US")} characters`;
  }
  return UNSAFE_IN_AN_ADDRESS.test(address)
    ? `${subject} has a space or a control character in it`
    : null;
}

/**
 * What's wrong with the ready selector, as a reason that names its place in the file; null when
 * nothing is. The length comes first, so a very long selector is never searched.
 */
function selectorProblem(selector: string): string | null {
  const subject = "its settings.readiness.readySelector";
  if (selector.length > MAX_SELECTOR_LENGTH) {
    return `${subject} is longer than ${MAX_SELECTOR_LENGTH.toLocaleString("en-US")} characters`;
  }
  return UNSAFE_IN_A_SELECTOR.test(selector) ? `${subject} has a control character in it` : null;
}

/** The fields of a page that hold the file's own words, which are checked for what's in them. */
const PAGE_TEXT_FIELDS = ["label", "template", "notes"] as const;

/**
 * What's wrong with page number `place` (counted from 1) and the field it's in, as a reason that
 * names the page: its address first, then its words; null when nothing is wrong with it.
 */
function pageProblem(
  place: number,
  page: z.output<typeof pageSchema>,
  origin: string,
): { field: "url" | (typeof PAGE_TEXT_FIELDS)[number]; reason: string } | null {
  const address = pageAddressProblem(place, page.url, origin);
  if (address !== null) return { field: "url", reason: address };
  for (const field of PAGE_TEXT_FIELDS) {
    const text = page[field];
    if (text !== undefined && UNSAFE_IN_PAGE_TEXT.test(text)) {
      return { field, reason: `page ${place}'s ${field} has a control character in it` };
    }
  }
  return null;
}

/**
 * Why page number `place` (counted from 1) can't be read as a page of the site, as a reason; null
 * when its address is a web address on the site.
 */
function pageAddressProblem(place: number, address: string, origin: string): string | null {
  const subject = `page ${place}'s address`;
  const written = writtenProblem(subject, address);
  if (written !== null) return written;
  const problem = addressProblem(address, origin);
  if (problem === null) return null;
  return `${subject}, ${address === "" ? '""' : shown(address)}, ${problem}`;
}

/** What's wrong with a page's address for a site, or null when it's a web address on the site. */
function addressProblem(address: string, origin: string): string | null {
  const url = parseAddress(address);
  if (url === null) return "isn't a full web address";
  return isWeb(url) && url.origin === origin ? null : "isn't on its site";
}

function parseAddress(address: string): URL | null {
  try {
    return new URL(address);
  } catch {
    return null;
  }
}

function isWeb(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a value is nested more than MAX_NVDA_SETTINGS_DEPTH levels deep, an object or a list being
 * a level. It's checked with a stack of what's left to look at, never by calling itself: the value
 * may come from a file built to be deep enough to overflow the call stack, or (in memory) to hold
 * itself, and the search stops at the first level too deep.
 */
function isNestedTooDeep(value: unknown): boolean {
  const pending: { item: unknown; level: number }[] = [{ item: value, level: 1 }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { item, level } = next;
    if (typeof item !== "object" || item === null) continue;
    if (level > MAX_NVDA_SETTINGS_DEPTH) return true;
    for (const inside of Object.values(item)) pending.push({ item: inside, level: level + 1 });
  }
  return false;
}

// How a refusal says what's wrong:

/** A reason, said as a sentence: what parseWalkthrough and walkthroughProblem both give. */
function sentence(reason: string): string {
  return `${reason}.`;
}

function notAWalkthrough(file: string, problem: string): UsageError {
  return new UsageError(`${file} isn't a voicecap walkthrough file: ${problem}`);
}

/** The reason for a problem the schema found, in the words a person fixing the file needs. */
function reasonOf(issue: z.core.$ZodIssue): string {
  if (issue.code === "custom") return issue.message;
  const where = placeOf(issue.path);
  if (issue.code === "unrecognized_keys") {
    const keys = issue.keys.map((key) => `"${shown(key)}"`).join(", ");
    return `${where} has ${issue.keys.length === 1 ? "a key" : "keys"} voicecap doesn't know: ${keys}`;
  }
  return `${where}: ${issue.message}`;
}

/** Where in the file a problem is, counting from 1 as a person does: "page 3's url". */
function placeOf(path: readonly PropertyKey[]): string {
  const [first, second, ...rest] = path;
  if (first === "pages" && typeof second === "number") {
    return rest.length === 0 ? `page ${second + 1}` : `page ${second + 1}'s ${dotted(rest)}`;
  }
  return path.length === 0 ? "it" : `its ${dotted(path)}`;
}

function dotted(path: readonly PropertyKey[]): string {
  let place = "";
  for (const segment of path) {
    if (typeof segment === "number") place += `[${segment + 1}]`;
    else place += place === "" ? String(segment) : `.${String(segment)}`;
  }
  return place;
}

/** A value of the file's in a few words: a number or a text as it is, else what kind of thing. */
function describeValue(value: unknown): string {
  if (typeof value === "string") return `"${shown(value)}"`;
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  return Array.isArray(value) ? "a list" : "an object";
}

/**
 * Some of the file's own words, to repeat in a message: with every control character, bidirectional
 * mark, and invisible one written out as an escape (so a file can't move the terminal's cursor or
 * clear it, or turn the words around), and cut short.
 */
function shown(text: string): string {
  const printable = text.replace(
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,
    (character) => `\\u{${character.codePointAt(0)!.toString(16)}}`,
  );
  const letters = Array.from(printable);
  return letters.length > SHOWN_LIMIT ? `${letters.slice(0, SHOWN_LIMIT).join("")}…` : printable;
}
