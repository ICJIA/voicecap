import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createTwoFilesPatch, FILE_HEADERS_ONLY } from "diff";

import type { EnvironmentRecord, PageRecord, PageRef, PassName, RunJson } from "../model.js";
import { describePageUrls } from "../pages/describe.js";
import { DATE_FOLDER, pageDir } from "../run/paths.js";
import { assertRunWritable, listRuns, readRunJson } from "../run/store.js";
import { extractBody } from "../transcripts/format.js";
import { writeFileAtomic } from "../util/atomic-write.js";
import { UsageError } from "../util/errors.js";
import { canonicalJson } from "../util/hash.js";

export interface ComparedPass {
  pass: PassName;
  /** Absolute path of the unified diff written for this pass. */
  diffFile: string;
}

export interface ChangedPage {
  key: string;
  slug: string;
  url: string;
  label?: string;
  passes: ComparedPass[];
}

export interface NotComparedPage extends PageRef {
  reason: string;
}

export interface CompareResult {
  /** Id of the base (older) run. */
  base: string;
  /** Id of the run compared against the base. */
  run: string;
  changed: ChangedPage[];
  /** Pages in both runs whose transcripts are identical. */
  unchanged: number;
  onlyInBase: PageRef[];
  onlyInRun: PageRef[];
  /** In both runs, but not transcribed in one of them (pending, failed, or skipped). */
  notCompared: NotComparedPage[];
  /** Tooling differences that could explain changes, e.g. a different NVDA or browser version. */
  environmentDifferences: string[];
}

/**
 * Compare the pages two runs both contain, by the TXT-body hash of each pass. For each changed
 * pass, write a unified diff of the step lines (never the header blocks) to
 * <diffDir>/<slug>/<pass>.diff.txt.
 */
export async function compareRuns(options: {
  outDir: string;
  base: RunJson;
  run: RunJson;
  diffDir: string;
}): Promise<CompareResult> {
  const { outDir, base, run, diffDir } = options;
  if (base.id === run.id) throw new UsageError(`Can't compare run ${run.id} with itself.`);
  await assertDiffDirWritable(outDir, diffDir);

  const basePages = new Map(base.pages.map((page) => [page.key, page]));
  const runKeys = new Set(run.pages.map((page) => page.key));
  const result: CompareResult = {
    base: base.id,
    run: run.id,
    changed: [],
    unchanged: 0,
    onlyInBase: base.pages.filter((page) => !runKeys.has(page.key)).map(pageRef),
    onlyInRun: run.pages.filter((page) => !basePages.has(page.key)).map(pageRef),
    notCompared: [],
    environmentDifferences: environmentDifferences(base, run),
  };

  for (const page of run.pages) {
    const before = basePages.get(page.key);
    if (!before) continue;
    if (before.status !== "done" || page.status !== "done") {
      const which = before.status !== "done" ? base.id : run.id;
      const status = before.status !== "done" ? before.status : page.status;
      result.notCompared.push({ ...pageRef(page), reason: `${status} in run ${which}` });
      continue;
    }
    const passes = unionPasses(before, page);
    const changedPasses: ComparedPass[] = [];
    for (const pass of passes) {
      if (before.passes[pass]?.contentSha256 === page.passes[pass]?.contentSha256) continue;
      const diffFile = path.join(diffDir, page.slug, `${pass}.diff.txt`);
      await writeFileAtomic(diffFile, await passDiff(outDir, base, before, run, page, pass));
      changedPasses.push({ pass, diffFile });
    }
    if (changedPasses.length === 0) {
      result.unchanged += 1;
    } else {
      result.changed.push({
        key: page.key,
        slug: page.slug,
        url: page.url,
        ...(page.label === undefined ? {} : { label: page.label }),
        passes: changedPasses,
      });
    }
  }
  return result;
}

/**
 * Differences in the tooling between two runs that could make transcripts differ even when the
 * site didn't change: driver, NVDA version and build, browser, voicecap, NVDA settings, and
 * capture mode. Also notes when a run's own sessions used different environments.
 */
export function environmentDifferences(base: RunJson, run: RunJson): string[] {
  const messages: string[] = [];
  for (const each of [base, run]) {
    const distinct = distinctEnvironments(each);
    if (distinct.length > 1) {
      messages.push(
        `The environment changed during run ${each.id} (it was resumed with different tooling): ${describeChanges(distinct[0]!, distinct.at(-1)!).join("; ")}.`,
      );
    }
  }
  const before = primaryEnvironment(base);
  const after = primaryEnvironment(run);
  if (before && after) {
    for (const change of describeChanges(before, after)) {
      messages.push(`${change} (run ${base.id} → run ${run.id}).`);
    }
  } else if (before || after) {
    messages.push(
      `Run ${before ? run.id : base.id} has no recorded environment, so tooling differences can't be ruled out.`,
    );
  }
  // Stop rules (repeatLimit, read.endConfirmations, phrasing) live in the config, so a different
  // config can change transcripts even when nothing else did.
  if (base.configSha256 && run.configSha256 && base.configSha256 !== run.configSha256) {
    messages.push(
      `The voicecap config differs (run ${base.id} → run ${run.id}); stop rules or NVDA settings may have changed.`,
    );
  }
  return messages;
}

/**
 * Resolve --compare: a run id, or "previous" for the most recent completed run created before
 * `run` with the same page source (the same sitemap URL, or the same page list file).
 */
export async function resolveCompareBase(
  outDir: string,
  run: RunJson,
  spec: string,
): Promise<RunJson> {
  if (spec !== "previous") {
    if (spec === run.id) throw new UsageError(`Can't compare run ${run.id} with itself.`);
    const base = await readRunJson(outDir, spec);
    if (base.status !== "completed") {
      throw new UsageError(`Run ${spec} is incomplete; compare with a completed run.`);
    }
    return base;
  }
  const created = Date.parse(run.createdAt);
  const candidates = (await listRuns(outDir)).filter(
    (other) =>
      other.id !== run.id &&
      other.status === "completed" &&
      // Same-second ties still count: a completed run that isn't this one started first.
      Date.parse(other.createdAt) <= created &&
      samePageSource(other, run),
  );
  const base = candidates.at(-1);
  if (!base) {
    throw new UsageError(
      `No earlier completed run with the same page source (${describeSource(run)}) to compare with${run.id ? ` run ${run.id}` : ""}. Name a run id instead of "previous".`,
    );
  }
  return base;
}

function samePageSource(a: RunJson, b: RunJson): boolean {
  const x = a.settings.source;
  const y = b.settings.source;
  if (x.kind === "sitemap" && y.kind === "sitemap") return x.url === y.url;
  if (x.kind === "pages" && y.kind === "pages") return x.file === y.file;
  if (x.kind === "urls" && y.kind === "urls") {
    return x.urls.length === y.urls.length && x.urls.every((url, i) => url === y.urls[i]);
  }
  return false;
}

function describeSource(run: RunJson): string {
  const source = run.settings.source;
  if (source.kind === "sitemap") return `sitemap ${source.url}`;
  if (source.kind === "pages") return `page list ${source.file}`;
  return describePageUrls(source.urls);
}

async function passDiff(
  outDir: string,
  base: RunJson,
  before: PageRecord,
  run: RunJson,
  after: PageRecord,
  pass: PassName,
): Promise<string> {
  const oldFile = path.join(pageDir(outDir, base.id, before.slug), `${pass}.txt`);
  const newFile = path.join(pageDir(outDir, run.id, after.slug), `${pass}.txt`);
  const [oldBody, oldNote] = await readBody(oldFile, base.id, before.passes[pass] !== undefined);
  const [newBody, newNote] = await readBody(newFile, run.id, after.passes[pass] !== undefined);
  const preamble = [
    `voicecap transcript diff: ${pass} pass`,
    `Page: ${after.url}`,
    `Base run: ${base.id}`,
    `Run: ${run.id}`,
    "Only the step lines are compared; the header blocks differ in every run.",
    ...[oldNote, newNote].filter((note): note is string => note !== null),
    "",
  ];
  const patch = createTwoFilesPatch(
    `${base.id}/pages/${before.slug}/${pass}.txt`,
    `${run.id}/pages/${after.slug}/${pass}.txt`,
    oldBody,
    newBody,
    `run ${base.id}`,
    `run ${run.id}`,
    { context: 3, headerOptions: FILE_HEADERS_ONLY },
  );
  return `${preamble.join("\n")}\n${patch}`;
}

async function readBody(
  file: string,
  runId: string,
  expected: boolean,
): Promise<[string, string | null]> {
  if (!expected) return ["", `The ${path.basename(file, ".txt")} pass wasn't run in run ${runId}.`];
  if (!existsSync(file)) return ["", `Missing transcript: ${file}`];
  const lines = extractBody(await readFile(file, "utf8"));
  return [lines.map((line) => `${line}\n`).join(""), null];
}

function unionPasses(a: PageRecord, b: PageRecord): PassName[] {
  const order: PassName[] = ["read", "headings", "tab"];
  return order.filter((pass) => a.passes[pass] !== undefined || b.passes[pass] !== undefined);
}

function pageRef(page: PageRecord): PageRef {
  return {
    url: page.url,
    key: page.key,
    slug: page.slug,
    ...(page.label === undefined ? {} : { label: page.label }),
    ...(page.template === undefined ? {} : { template: page.template }),
    ...(page.notes === undefined ? {} : { notes: page.notes }),
  };
}

async function assertDiffDirWritable(outDir: string, diffDir: string): Promise<void> {
  // Diffs may be written into a run folder only while that run is still being completed.
  const relative = path.relative(outDir, diffDir);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return;
  const [date, rest] = relative.split(path.sep);
  if (!date || !rest || !DATE_FOLDER.test(date)) return;
  await assertRunWritable(outDir, `${date}_${rest}`);
}

/** The tooling fields that can change what NVDA says, as display strings, in report order. */
const TOOLING_FIELDS: [string, (env: EnvironmentRecord) => string][] = [
  ["Driver", (env) => `${env.driver.name} ${env.driver.version}`],
  [
    "Screen reader",
    (env) =>
      env.screenReader
        ? `${env.screenReader.name} ${env.screenReader.version} (build ${env.screenReader.build ?? "unknown"})`
        : "none",
  ],
  ["Browser", (env) => (env.browser ? `${env.browser.name} ${env.browser.version}` : "none")],
  ["voicecap", (env) => env.voicecap.version],
  ["Capture mode", (env) => env.capture],
];

/** A string that is equal for two environments exactly when their tooling is the same. */
function toolingKey(env: EnvironmentRecord): string {
  return canonicalJson({
    fields: TOOLING_FIELDS.map(([, describe]) => describe(env)),
    settings: env.screenReaderSettings,
  });
}

function primaryEnvironment(run: RunJson): EnvironmentRecord | null {
  for (let i = run.sessions.length - 1; i >= 0; i -= 1) {
    const env = run.sessions[i]?.environment;
    if (env) return env;
  }
  return null;
}

/** Distinct environments across a run's sessions; more than one means it was resumed with other tooling. */
export function distinctEnvironments(run: RunJson): EnvironmentRecord[] {
  const seen = new Map<string, EnvironmentRecord>();
  for (const session of run.sessions) {
    if (!session.environment) continue;
    const key = toolingKey(session.environment);
    if (!seen.has(key)) seen.set(key, session.environment);
  }
  return [...seen.values()];
}

/** What differs between two environments, as short sentences. */
export function describeChanges(before: EnvironmentRecord, after: EnvironmentRecord): string[] {
  const changes: string[] = [];
  for (const [label, describe] of TOOLING_FIELDS) {
    const a = describe(before);
    const b = describe(after);
    if (a !== b) changes.push(`${label} differs: ${a} → ${b}`);
  }
  const settings = settingsChanges(before.screenReaderSettings, after.screenReaderSettings);
  if (settings.length > 0) {
    const shown = settings.slice(0, 10).join(", ");
    const more = settings.length > 10 ? `, and ${settings.length - 10} more` : "";
    changes.push(`Screen reader settings differ: ${shown}${more}`);
  }
  return changes;
}

function settingsChanges(before: unknown, after: unknown, prefix = ""): string[] {
  const isObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((key) =>
      settingsChanges(before[key], after[key], prefix ? `${prefix}.${key}` : key),
    );
  }
  if (canonicalJson(before) === canonicalJson(after)) return [];
  const show = (value: unknown) => (value === undefined ? "unset" : canonicalJson(value));
  return [`${prefix || "(all)"} ${show(before)} → ${show(after)}`];
}
