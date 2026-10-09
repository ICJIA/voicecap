/**
 * A transcripts home with reports shared in it, for the website's tests: the demo runs voicecap 0.4.1
 * recorded (test/fixtures/share/demo-2026-09-29), shared twice, a second site whose one report is
 * written by hand, and the demo's own folder, shared once. Each share is the real `voicecap share`
 * (a scripted run's records, no screen reader and no Word), on a fixed day. The runs read the demo
 * at an IP address and recorded no canonical address, so each share names it by report.canonical,
 * as a config would: with no name, voicecap would refuse to share it. Nothing here reads the
 * machine's own transcripts home, Git name, or config.
 *
 * And a home with one share that has a voice page (homeWithVoiceShare): a scripted run whose pages
 * each have a recording of NVDA's voice, shared by the real `voicecap share`. The sounds are numbers
 * the encoder turns into files, and nothing here plays one.
 */
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "vitest";

import { resolveConfig, type LoadedConfig } from "../../src/config/load.js";
import { DEMO_OUT } from "../../src/demo/words.js";
import type { SharedFile } from "../../src/model.js";
import { runAudit } from "../../src/run/audit.js";
import { shareDir, sharesPath, siteFolder } from "../../src/run/paths.js";
import { shareReport } from "../../src/share/share.js";
import { hashJson, sealOf, sha256 } from "../../src/util/hash.js";
import { silentLogger } from "../../src/util/log.js";
import { options as runOptions, setup, SITE, sitePages } from "./run-site.js";
import { ScriptedDriver } from "./scripted-driver.js";
import { busySound, speechAndPauses } from "./voice-signal.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE_HOME = path.join(ROOT, "test", "fixtures", "share", "demo-2026-09-29");

/** The fixture's site folder, which the home shares twice, and which the demo's folder holds a copy of. */
export const FIXTURE_FOLDER = "127.0.0.1_4848";
/** The address the fixture's runs read: the site that `voicecap share` is asked to share. */
export const FIXTURE_SITE = "http://127.0.0.1:4848";
/** The demo's canonical address, which each share names the fixture's site by. */
export const FIXTURE_CANONICAL = "https://voicecap.icjia.app/demo-site/";
/**
 * The fixture site's canonical name: what its shares name their files after, and the website heads
 * its reports with.
 */
export const FIXTURE_NAME = "voicecap.icjia.app";
/** The site whose one report is written by hand. */
export const EXAMPLE_FOLDER = "example.illinois.gov";
/** The name its page and its Word copy have, without the extension. */
export const EXAMPLE_STEM = `${EXAMPLE_FOLDER}_2027-01-13`;
/** When its report was made, written as a share records a time. */
export const EXAMPLE_AT = "2027-01-13T09:30:00-06:00";

/** The day the fixture site is shared on (a local time, so its day is the same everywhere). */
export const SHARED_ON = new Date(2027, 0, 15, 10, 0);
/** The day the demo's folder is shared on: a later day, so that its files are named and made otherwise. */
export const DEMO_SHARED_ON = new Date(2027, 0, 16, 9, 0);

/**
 * The script and the style of the example site's page, which no other page has, so that its policy
 * is its own.
 */
export const EXAMPLE_SCRIPT = 'document.documentElement.dataset.written = "by hand";';
export const EXAMPLE_STYLE = "body { margin: 2rem; }";
export const EXAMPLE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>A report written by hand</title><style>${EXAMPLE_STYLE}</style></head>
<body><p>A report written by hand.</p><script>${EXAMPLE_SCRIPT}</script></body></html>
`;
/** Bytes to publish as the Word copy: the site never opens a Word copy, so they needn't be one. */
export const EXAMPLE_WORD = Buffer.from("A stand-in for a Word copy: a few bytes to publish.");

/** A file as an entry records it. */
export function recordOf(name: string, bytes: Uint8Array): SharedFile {
  return { name, bytes: bytes.length, sha256: sha256(bytes) };
}

/**
 * An entry as `voicecap share` writes one, sealed over what it holds. `change` replaces fields before
 * the seal is made. The site reads each entry on its own, so a hand-made entry doesn't chain.
 */
export function sealedEntry(
  seq: number,
  at: string,
  files: SharedFile[],
  change: Record<string, unknown> = {},
): Record<string, unknown> {
  const body = {
    seq,
    prev: null,
    at,
    by: "Sam Rivera",
    runs: ["2027-01-12_0900"],
    files,
    ...change,
  };
  return { ...body, seal: sealOf(body) };
}

/** Leave `shares` as the record of what a site folder shared, in its share/ folder. */
export async function writeRecord(siteDir: string, shares: unknown[]): Promise<void> {
  await mkdir(shareDir(siteDir), { recursive: true });
  await writeFile(
    sharesPath(siteDir),
    `${JSON.stringify({ schemaVersion: 1, shares }, null, 2)}\n`,
  );
}

/**
 * The settings of a share of the fixture's site: what a config with only report.canonical, the
 * demo's canonical address, gives.
 */
function namingTheDemo(): LoadedConfig {
  const config = resolveConfig({ report: { canonical: FIXTURE_CANONICAL } });
  return { config, file: null, sha256: hashJson(config) };
}

/**
 * A new home. With no `at`, it's `transcripts` in a folder of its own that this makes in the
 * machine's temporary folder: the caller takes `path.dirname(home)` away. With `at`, it's made there,
 * and the folder it's in is the caller's.
 *
 * - The fixture site's folder, shared twice on the same day, named by the demo's canonical address
 *   (`voicecap.icjia.app_2027-01-15` and `voicecap.icjia.app_2027-01-15-2`), each share a page,
 *   its Word copy, and the walkthrough file of each of the two runs that count.
 * - `example.illinois.gov/`, with a date folder, and a record sealed by hand of one report made on
 *   13 January: a small page and a Word copy, which are in its share/ folder.
 * - `voicecap-demo/127.0.0.1_4848/`, a copy of the fixture's site folder, shared once on 16 January
 *   with `out: <home>/voicecap-demo`, as `voicecap demo` and `voicecap share --out voicecap-demo` do,
 *   named by the demo's canonical address too.
 */
export async function homeWithShares(at?: string): Promise<string> {
  const home =
    at === undefined
      ? path.join(await mkdtemp(path.join(os.tmpdir(), "voicecap-site-home-")), "transcripts")
      : path.resolve(at);
  // The folder the home is in.
  const root = path.dirname(home);
  await cp(FIXTURE_HOME, home, { recursive: true });

  const config = namingTheDemo();
  const share = (out: string, now: Date, reviewer: string) =>
    shareReport({
      out,
      site: FIXTURE_SITE,
      reviewer,
      now,
      config,
      logger: silentLogger,
      // No config file is read, nor any environment.
      cwd: root,
      env: {},
    });
  await share(home, SHARED_ON, "Test Reviewer");
  await share(home, SHARED_ON, "Test Reviewer");

  const example = path.join(home, EXAMPLE_FOLDER);
  await mkdir(path.join(example, "2027-01-12"), { recursive: true });
  await mkdir(shareDir(example), { recursive: true });
  const page = Buffer.from(EXAMPLE_PAGE);
  await writeFile(path.join(shareDir(example), `${EXAMPLE_STEM}.html`), page);
  await writeFile(path.join(shareDir(example), `${EXAMPLE_STEM}.docx`), EXAMPLE_WORD);
  await writeRecord(example, [
    sealedEntry(1, EXAMPLE_AT, [
      recordOf(`${EXAMPLE_STEM}.html`, page),
      recordOf(`${EXAMPLE_STEM}.docx`, EXAMPLE_WORD),
    ]),
  ]);

  const demo = path.join(home, DEMO_OUT);
  await cp(path.join(FIXTURE_HOME, FIXTURE_FOLDER), path.join(demo, FIXTURE_FOLDER), {
    recursive: true,
  });
  await share(demo, DEMO_SHARED_ON, "Demo Reviewer");

  return home;
}

/**
 * The site folder, and the name of the pair's page without its extension, of the share that
 * `homeWithVoiceShare` makes: the scripted site's host, then the day it's shared on.
 */
export const VOICE_FOLDER = siteFolder(SITE);
export const VOICE_STEM = `${VOICE_FOLDER}_2027-01-15`;
/** The voice page's name beside that pair, as `voicecap share` gives it. */
export const VOICE_PAGE = `${VOICE_STEM}.voice.html`;

/**
 * A new home with one share that has a voice page: a completed, sealed, live run of the scripted
 * site's three pages, each with a recording of NVDA's voice (the scripted driver gives each its
 * sound, which the run encodes and keeps as voice.webm; the sounds are numbers, and nothing plays),
 * shared by `voicecap share` on a fixed day, so it has the page, its Word copy, the voice page, and
 * the run's walkthrough file. The home is `transcripts` in a folder of its own that this makes in
 * the machine's temporary folder: the caller takes `path.dirname(home)` away.
 */
export async function homeWithVoiceShare(): Promise<string> {
  const dir = await setup();
  const pages = sitePages({
    home: { voice: { samples: speechAndPauses() } },
    about: { voice: { samples: busySound(1.5, 3) } },
    resources: { voice: { samples: busySound(1.5, 4) } },
  });
  const run = await runAudit(runOptions(dir, new ScriptedDriver(pages)));
  expect(run.outcome).toBe("completed");
  const home = path.join(dir, "transcripts");
  await shareReport({
    out: home,
    site: SITE,
    reviewer: "Test Reviewer",
    now: SHARED_ON,
    logger: silentLogger,
    // No config file is read, nor any environment.
    cwd: dir,
    env: {},
  });
  return home;
}
