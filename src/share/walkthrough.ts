/**
 * A walkthrough file: a run's recipe, so anyone can repeat the run exactly. This module builds one
 * from a run's record, writes it as the file holds it, and reads one back. It's pure: it reads no
 * file and no clock.
 *
 * A walkthrough file may come from anyone, so `parseWalkthrough` takes nothing on trust. A key the
 * type doesn't have, a page address that isn't on the file's own site, or a number beyond what the
 * config allows refuses the whole file, saying what's wrong and where, before anything runs.
 * `walkthroughProblem` gives that same reason for a walkthrough in hand, so a writer can say why a
 * file of it couldn't be read back before it writes one.
 *
 * The file goes to auditors, and into the shareable page, so it holds no folders: a page list's file
 * is kept by its name alone, since a path can carry the person's user name.
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
import { UsageError } from "../util/errors.js";

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
   * The page source as the run recorded it, and the fingerprints of what it read from it. A page
   * list's file is kept by its name alone, in both: its folders could carry the person's user name.
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
 * The most a step limit may be. The config allows any whole number above 0; this only refuses an
 * absurd one, so a file written from any run the config allows reads back.
 */
const MAX_STEP_LIMIT = 100_000;
/** The most a readiness time may be, in milliseconds (ten minutes), for the same reason. */
const MAX_READINESS_MS = 600_000;

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
      nvdaSettings: structuredClone(run.settings.nvdaSettings),
      browserChannel: run.settings.browser.channel,
    },
  };
}

/** As the file holds it: two-space indents and a final newline. */
export function walkthroughJson(walkthrough: Walkthrough): string {
  return `${JSON.stringify(walkthrough, null, 2)}\n`;
}

/**
 * Why parseWalkthrough would refuse this walkthrough, in the same words without the file's name, as
 * a sentence; null when it wouldn't. walkthroughOf builds the walkthrough of any completed run, and
 * the config allows runs that a file can't hold (more than 10,000 pages, a step limit above
 * 100,000), so a writer asks here before it writes one.
 */
export function walkthroughProblem(walkthrough: Walkthrough): string | null {
  const reading = read(walkthrough);
  return "problem" in reading ? reading.problem : null;
}

/** Read a walkthrough file strictly; a UsageError that names the file and the problem otherwise. */
export function parseWalkthrough(text: string, file: string): Walkthrough {
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
 * a page list's file by this alone (and a walkthrough's, once a run's pages can come from one),
 * with its SHA-256 as it is. The file goes to auditors and into the shareable page, and a full path
 * could carry the person's user name. A sitemap's address and --page addresses stay whole.
 */
function fileNameOf(file: string): string {
  return file.slice(Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")) + 1);
}

/**
 * The page source as the run recorded it, with its keys in the type's order, and a page list's file
 * by its name alone.
 */
function sourceOf(source: PageSource): PageSource {
  switch (source.kind) {
    case "sitemap":
      return { kind: "sitemap", url: source.url };
    case "pages":
      return { kind: "pages", file: fileNameOf(source.file), sha256: source.sha256 };
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
 * address), a page list (named by its file's name alone), and nothing for pages given with --page.
 */
function sourceFingerprintsOf(details: SourceDetails): { name: string; sha256: string }[] {
  switch (details.kind) {
    case "sitemap":
      return (details.sitemaps ?? []).flatMap((sitemap) =>
        sitemap.sha256 === undefined ? [] : [{ name: sitemap.url, sha256: sitemap.sha256 }],
      );
    case "pages":
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

const siteSchema = z
  .string()
  .refine((site) => siteOrigin(site) !== null, { error: "its site isn't a web address" });

/** Every kind of page source a run records. A fourth kind is one more entry here. */
const sourceSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("sitemap"), url: z.string() }),
    z.strictObject({ kind: z.literal("pages"), file: z.string(), sha256: fingerprint }),
    z.strictObject({ kind: z.literal("urls"), urls: z.array(z.string()) }),
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
      readySelector: z.string().min(1, "must be some text, or null").nullable(),
      settleMs: wholeNumber(0, MAX_READINESS_MS),
      networkIdleTimeoutMs: wholeNumber(1, MAX_READINESS_MS),
    })
    .nullable(),
});

const versionSchema = z.strictObject({ name: z.string(), version: z.string() });

const originSchema = z.strictObject({
  run: z.string(),
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
  nvdaSettings: z.custom<Record<string, unknown>>(isRecord, {
    error: "its original.nvdaSettings isn't an object",
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
        const problem = addressProblem(page.url, origin);
        if (problem === null) continue;
        const address = page.url === "" ? '""' : shown(page.url);
        ctx.addIssue({
          code: "custom",
          message: `page ${index + 1}'s address, ${address}, ${problem}`,
          path: ["pages", index, "url"],
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
