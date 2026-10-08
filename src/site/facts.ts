/**
 * The facts the website's "Can I trust this?" page states, so that every number and date it gives
 * is read or counted from a source and none is typed by hand.
 *
 * Of voicecap itself, from three files that travel with the package:
 *
 *   - its package.json, for the version it is;
 *   - its CHANGELOG.md, for each release, its date, and the first line of what it changed;
 *   - release-facts.json, which publish.sh writes into dist/ once the tests have passed and the
 *     build is done (see scripts/release-facts.mjs): what the release's own run of the tests
 *     counted, the commits behind it, and where CI runs.
 *
 * The first two are in the source tree and in the published package. The third is only in a built
 * package, beside the build (dist/release-facts.json, read from dist/site/): the source tree never
 * holds one, so a test never reads someone's stale build, and its facts are those of no release.
 *
 * Of the records, from what the website was built from (`SiteContent`): how many sites and reports
 * it shows, how many pages NVDA read in their current reports, how many files it publishes and
 * leaves out, and when the newest was shared.
 *
 * A fact that isn't there is null, never a guess. A release-facts.json that is missing, isn't JSON,
 * or isn't in the form publish.sh writes (a schema that isn't 1, a count that isn't a whole number,
 * a date that isn't one) gives no release facts at all: it's never taken in part, and the page
 * says they aren't recorded. Nothing seals the file, so one in that form is read as it is, edited
 * by hand or not. A website built with voicecap from npm reads it as it was published, since it
 * comes inside the package, whose integrity npm checks when it installs it; nothing here checks
 * that. A CHANGELOG entry that isn't a dated release is skipped. Nothing here reads a clock, the network, or the computer, except that
 * `readVoicecapFacts` reads the three files: the same package and records give the same facts.
 */
import { readFile } from "node:fs/promises";

import type { ShareResult } from "../model.js";
import type { PublishedReport, SiteContent } from "./render.js";

/** What publish.sh recorded of a release, once `parseReleaseFacts` has taken it. */
export interface ReleaseFacts {
  tests: {
    /** The tests that passed in the release's own run of them all, on the computer that made it. */
    passed: number;
    /** The tests that run skipped. */
    skipped: number;
    /** The test files that ran. */
    files: number;
    /** The system that computer is: Windows, macOS, or Linux. */
    system: string;
  };
  commits: {
    /** The commits behind the release, as of its build: before the commit that releases it. */
    count: number;
    /** The date of the first of them, YYYY-MM-DD. */
    first: string;
  };
  ci: {
    /** The systems CI runs the tests on: Ubuntu, macOS, and Windows. */
    systems: string[];
    /** The Node versions it runs them with, as its matrix writes them: "22", "24". */
    node: string[];
  };
}

/** One release the CHANGELOG records. */
export interface VoicecapRelease {
  version: string;
  /** YYYY-MM-DD. */
  date: string;
  /** The first line of its entry, as plain text (see `parseChangelog`); empty when it has none. */
  headline: string;
}

/** What the page says of voicecap itself. */
export interface VoicecapFacts {
  /** The version of the package that is running: its package.json's. */
  version: string;
  /** The date of the CHANGELOG's entry for `version` (YYYY-MM-DD), or null when there is none. */
  released: string | null;
  /** Every dated entry of the CHANGELOG, the newest first. */
  releases: VoicecapRelease[];
  /**
   * What the release recorded of itself, or null when there is no release-facts.json in the form
   * publish.sh writes.
   */
  release: ReleaseFacts | null;
}

/** What the page says of the records, counted from what the website shows. */
export interface RecordFacts {
  /** The sites. */
  sites: number;
  /** Their reports: the ones the website shows, and not the demo's. */
  reports: number;
  /**
   * What each site's current report says it read, added up: the pages NVDA read, the pages in
   * scope, and the problems left to fix, over the `sitesCounted` sites whose current report says
   * so. Null when none does (a site with no report, or one shared before 0.12.3, says nothing).
   */
  reading: { read: number; pages: number; problems: number; sitesCounted: number } | null;
  files: {
    /** The files the website publishes, each counted once however many reports name it. */
    published: number;
    /** The files its records name that it leaves out: changed since shared, or missing. */
    leftOut: number;
  };
  /** The time of the newest report shown, as the record wrote it, or null with no report. */
  newest: string | null;
}

/** A release's heading in the CHANGELOG: `## [0.13.1] - 2026-10-08`. */
const RELEASE_HEADING = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/;

/** A line that starts with bold words, with the bullet's mark before them or not. */
const BOLD_FIRST = /^(?:[-*+]\s+)?\*\*(.+?)\*\*/;

/** A bullet's mark, and the space after it. */
const BULLET = /^[-*+]\s+/;

/** Whether `value` is an object that isn't a list. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether `text` is a day the calendar has, written YYYY-MM-DD, so that a page never names
 * "2026-13-45". The day is made from its numbers and written out again: a month or a day the
 * calendar lacks comes back as another day (the 30th of February as the 2nd of March), and a day
 * it has comes back as the same text. A day of the years 0000 to 0099 comes back as another too,
 * since Date.UTC takes a year below 100 for one in the 1900s, so those years are refused as well:
 * no release of voicecap is dated in them.
 */
function isDate(text: string): boolean {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (found === null) return false;
  const [year, month, day] = [Number(found[1]), Number(found[2]), Number(found[3])];
  return new Date(Date.UTC(year, month - 1, day)).toISOString().startsWith(text);
}

/** Whether `value` is a count: a whole number of 0 or more that a number holds exactly. */
function isCount(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
  );
}

/** Whether `value` is a name: text with something in it. */
function isName(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Whether `value` is a list of at least one name. */
function isNames(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isName);
}

/** Markdown's words as plain text: a link is its words, and a code span has no marks. */
function plain(markdown: string): string {
  return markdown.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/`/g, "");
}

/**
 * A release's headline, from the first line of its entry (the first that isn't blank or a heading):
 *
 *   - Of a line that starts with bold words, as a bullet does (`- **The page says more.** The
 *     README…`), it's the bold words, less a "," or "." that ends them.
 *   - Of any other, it's the words up to the first ": " or ". ", or all of them. A bullet's mark is
 *     not one of the words.
 *
 * In both, backticks are removed, and a link, `[text](url)`, is its text.
 */
function headlineOf(line: string): string {
  const text = line.trim();
  const bold = BOLD_FIRST.exec(text)?.[1];
  if (bold !== undefined) return plain(bold.replace(/[.,]$/, "")).trim();
  const words = plain(text.replace(BULLET, ""));
  const ends = [words.indexOf(": "), words.indexOf(". ")].filter((end) => end >= 0);
  return words.slice(0, Math.min(words.length, ...ends)).trim();
}

/**
 * Each release the CHANGELOG records, in the file's order (the newest first), with its date and its
 * headline: the first line under its heading, as `headlineOf` words it. A release is a heading
 * written `## [x.y.z] - YYYY-MM-DD`, of a day the calendar has. Any other heading is no release and
 * is skipped, whether it's `## [Unreleased]`, a version with no date, or one with something after
 * the date. Whatever heading comes next ends a release, so what's under a heading that isn't a
 * release is no release's first line, and a release with nothing under its heading has an empty
 * headline.
 */
export function parseChangelog(text: string): VoicecapRelease[] {
  const releases: VoicecapRelease[] = [];
  // The release whose entry is being read, and whether its first line is still to come.
  let release: VoicecapRelease | undefined;
  let looking = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      const [, version, date] = RELEASE_HEADING.exec(line) ?? [];
      release =
        version !== undefined && date !== undefined && isDate(date)
          ? { version, date, headline: "" }
          : undefined;
      if (release !== undefined) releases.push(release);
      looking = true;
    } else if (looking && release !== undefined && line.trim() !== "" && !line.startsWith("### ")) {
      release.headline = headlineOf(line);
      looking = false;
    }
  }
  return releases;
}

/**
 * The facts of a release, from the JSON that publish.sh wrote (see scripts/release-facts.mjs), or
 * null when `value` isn't all of it, as it is written: a schema of 1; every count a whole number
 * of 0 or more that a number holds exactly; the first commit's date as YYYY-MM-DD, of a day the
 * calendar has; the system a name; and CI's systems and Node versions each a list of at least one
 * name. A file in any other form is never taken in part: it gives no facts, and the page says they
 * aren't recorded. Nothing here can tell a file in this form that was edited by hand from the one
 * publish.sh wrote. What's given is made of new objects with only these fields, whatever else the
 * file holds.
 */
export function parseReleaseFacts(value: unknown): ReleaseFacts | null {
  if (!isObject(value) || value.schema !== 1) return null;
  const { tests, commits, ci } = value;
  if (!isObject(tests) || !isObject(commits) || !isObject(ci)) return null;
  const { passed, skipped, files, system } = tests;
  const { count, first } = commits;
  const { systems, node } = ci;
  if (!isCount(passed) || !isCount(skipped) || !isCount(files) || !isName(system)) return null;
  if (!isCount(count) || typeof first !== "string" || !isDate(first)) return null;
  if (!isNames(systems) || !isNames(node)) return null;
  return {
    tests: { passed, skipped, files, system },
    commits: { count, first },
    ci: { systems: [...systems], node: [...node] },
  };
}

/**
 * What the page says of voicecap, from its package.json (`packageJson`, once parsed), the text of
 * its CHANGELOG, and the JSON of its release-facts.json (`releaseFacts`; anything, or undefined
 * when there's no such file). The version is the package.json's, and a package.json without one
 * is a broken package: this throws. Nothing else here can: a CHANGELOG that doesn't fit gives
 * fewer releases or no release date, and release facts not in the form publish.sh writes give none.
 */
export function voicecapFactsOf(
  packageJson: unknown,
  changelog: string,
  releaseFacts: unknown,
): VoicecapFacts {
  const version = isObject(packageJson) ? packageJson.version : undefined;
  if (typeof version !== "string" || version === "") {
    throw new Error("voicecap's package.json has no version, so the package is broken.");
  }
  const releases = parseChangelog(changelog);
  return {
    version,
    released: releases.find((release) => release.version === version)?.date ?? null,
    releases,
    release: parseReleaseFacts(releaseFacts),
  };
}

/** The text of the file at `file`, or undefined when it isn't there. Any other failure throws. */
async function readIfThere(file: URL): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
}

/** The JSON in the release's facts, or undefined: no such file, one unreadable, or not JSON. */
async function readReleaseFacts(file: URL): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * What the page says of voicecap, read from the package this module is in, by this module's own
 * place, as ../util/version.ts reads package.json. This file is in src/site/ (tests) or dist/site/
 * (published). The package root is two levels up, and has package.json (a package without one, or
 * whose isn't JSON, is broken, and this throws) and CHANGELOG.md (a missing one is empty). dist/,
 * where publish.sh writes release-facts.json, is one level up: a missing or unreadable one, or one
 * that isn't JSON, is no facts, and a source tree never holds one.
 */
export async function readVoicecapFacts(): Promise<VoicecapFacts> {
  const packageJson = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ) as unknown;
  const changelog = await readIfThere(new URL("../../CHANGELOG.md", import.meta.url));
  const releaseFacts = await readReleaseFacts(new URL("../release-facts.json", import.meta.url));
  return voicecapFactsOf(packageJson, changelog ?? "", releaseFacts);
}

/**
 * The newest of `reports`: the `at` of the one shared latest, by the moment each says and not by
 * how its text sorts, as it was written. A time that can't be read is no moment, so it is never the
 * newest. Null with no report that has one.
 */
function newestOf(reports: readonly PublishedReport[]): string | null {
  let newest: string | null = null;
  let latest = -Infinity;
  for (const { at } of reports) {
    const moment = Date.parse(at);
    // Not a number is never greater, so an unreadable time never gets here.
    if (moment > latest) {
      newest = at;
      latest = moment;
    }
  }
  return newest;
}

/**
 * What the page says of the records, counted from `content`, what the website was built from. The
 * demo's report counts in what the website shows (its files, what's left out of it, and its time),
 * and it isn't a site's, so it isn't one of the `reports`. Only each site's current report, its
 * first, says what was read, and only one that says it counted pages: an older report's result, a
 * report with none (a share from before 0.12.3), and a result of no pages don't count.
 */
export function recordFactsOf(content: SiteContent): RecordFacts {
  const reports = content.sites.flatMap((site) => site.reports);
  const shown = content.demo === null ? reports : [content.demo, ...reports];
  const counted = content.sites.flatMap((site): ShareResult[] => {
    const result = site.reports[0]?.result;
    return result !== undefined && result.pages > 0 ? [result] : [];
  });
  const sum = (of: (result: ShareResult) => number): number =>
    counted.reduce((total, result) => total + of(result), 0);
  return {
    sites: content.sites.length,
    reports: reports.length,
    reading:
      counted.length === 0
        ? null
        : {
            read: sum((result) => result.read),
            pages: sum((result) => result.pages),
            problems: sum((result) => result.problems),
            sitesCounted: counted.length,
          },
    files: {
      published: new Set(shown.flatMap(({ files }) => files.map(({ href }) => href))).size,
      leftOut: shown.reduce((total, { notPublished }) => total + notPublished.length, 0),
    },
    newest: newestOf(shown),
  };
}
