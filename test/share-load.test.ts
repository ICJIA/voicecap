/**
 * What loadShareInput reads of each page's recording of NVDA's voice (from voicecap 0.18.0): the
 * file of the record each page's card speaks for, held only as its run recorded it (its size and
 * SHA-256), as a screenshot's and an axe file's are. The sites here are written as voicecap writes
 * them: real scripted runs, each page of which was recorded by the scripted driver, with the real
 * encoder making the WebM Opus files. Nothing here plays a sound.
 */
import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { RunJson } from "../src/model.js";
import { runAudit } from "../src/run/audit.js";
import { pageDir, runJsonPath } from "../src/run/paths.js";
import { loadShareInput } from "../src/share/load.js";
import { buildShareModel } from "../src/share/model.js";
import { fileHash } from "../src/transcripts/write.js";
import { sealOf } from "../src/util/hash.js";
import {
  config as runConfig,
  options as runOptions,
  setup as setupSite,
  sitePages,
} from "./helpers/run-site.js";
import { ScriptedDriver, type ScriptedVoice } from "./helpers/scripted-driver.js";
import { DEMO_SITE, VOICE_PAGE } from "./helpers/share-model.js";
import { busySound, speechAndPauses } from "./helpers/voice-signal.js";

/** The folders these tests made, which are taken away after each. */
const folders: string[] = [];

afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})),
  );
});

/** What the scripted driver gives for a page: two seconds of speech and pauses, or other sounds. */
const SPEECH: ScriptedVoice = { samples: speechAndPauses() };
const BUSY: ScriptedVoice = { samples: busySound(1.5, 3) };
const OTHER: ScriptedVoice = { samples: busySound(1.5, 4) };

/** A new folder with a page list of `entries`, taken away after the test. */
async function newFolder(entries: string[] = ["/", "/about"]): Promise<string> {
  const dir = await setupSite(entries);
  folders.push(dir);
  return dir;
}

/** A site folder with one run of the scripted site, each of whose pages was recorded. */
async function voiceSite(home: ScriptedVoice = SPEECH, about: ScriptedVoice = BUSY) {
  const dir = await newFolder();
  const pages = sitePages({ home: { voice: home }, about: { voice: about } });
  const result = await runAudit(runOptions(dir, new ScriptedDriver(pages)));
  expect(result.outcome).toBe("completed");
  return { siteDir: result.siteDir, run: result.run };
}

/** Where a page of a run keeps its recording. */
const voiceFile = (siteDir: string, run: RunJson, index: number): string =>
  path.join(pageDir(siteDir, run.id, run.pages[index]?.slug ?? ""), "voice.webm");

/** The key a recording is held under: the run's id and the page's slug. */
const keyOf = (run: RunJson, index: number): string => `${run.id}/${run.pages[index]?.slug}`;

/** Write a run's record again with its pages changed, sealed again as the record that matches. */
async function rewrite(
  siteDir: string,
  run: RunJson,
  change: (page: RunJson["pages"][number], index: number) => Record<string, unknown>,
): Promise<void> {
  const file = runJsonPath(siteDir, run.id);
  const recorded = JSON.parse(await readFile(file, "utf8")) as RunJson;
  const { seal: _seal, ...unsealed } = {
    ...recorded,
    pages: recorded.pages.map((page, index) => ({ ...page, ...change(page, index) })),
  };
  await writeFile(file, JSON.stringify({ ...unsealed, seal: sealOf(unsealed) }, null, 2));
}

describe("loadShareInput: each page's recording", () => {
  it("loads a recording only when it matches its record", async () => {
    const { siteDir, run } = await voiceSite();

    // Each page's file is as its record lists it: the fingerprint of the file on disk.
    const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });
    expect([...input.recordings.keys()].sort()).toEqual([keyOf(run, 0), keyOf(run, 1)].sort());
    for (const [index, page] of run.pages.entries()) {
      const bytes = input.recordings.get(keyOf(run, index));
      expect(bytes, page.slug).toBeDefined();
      expect(
        Buffer.compare(bytes ?? new Uint8Array(), await readFile(voiceFile(siteDir, run, index))),
      ).toBe(0);
      expect(fileHash(bytes ?? new Uint8Array()), page.slug).toEqual({
        sha256: (page.voice as { sha256: string }).sha256,
        bytes: (page.voice as { bytes: number }).bytes,
      });
    }

    // One byte more than the record says: that page's file isn't held, and the other's still is.
    await appendFile(voiceFile(siteDir, run, 1), Buffer.from([0]));
    const grown = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });
    expect([...grown.recordings.keys()]).toEqual([keyOf(run, 0)]);

    // A byte changed, and the file the same size: its fingerprint no longer matches either.
    const file = voiceFile(siteDir, run, 0);
    const bytes = await readFile(file);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
    await writeFile(file, bytes);
    expect((await loadShareInput({ siteDir, config: DEFAULT_CONFIG })).recordings.size).toBe(0);

    // A file that's gone.
    await rm(voiceFile(siteDir, run, 0));
    expect((await loadShareInput({ siteDir, config: DEFAULT_CONFIG })).recordings.size).toBe(0);
  });

  it("holds no recording of a page whose file isn't as recorded, so its card has no line", async () => {
    const { siteDir, run } = await voiceSite();
    await rm(voiceFile(siteDir, run, 0));
    await appendFile(voiceFile(siteDir, run, 1), Buffer.from([0]));
    const input = await loadShareInput({
      siteDir,
      config: DEFAULT_CONFIG,
      voiceName: VOICE_PAGE,
    });

    expect(input.recordings.size).toBe(0);
    expect(buildShareModel(input).pages.map((card) => card.voice)).toEqual([null, null]);
  });

  it("holds a file as its run recorded it as it is, whatever its bytes are", async () => {
    const { siteDir, run } = await voiceSite();
    // Bytes that aren't a WebM file at all, recorded as the home page's recording: the loader holds
    // what the record fingerprints, and never judges what it is.
    const bytes = Buffer.from([0x00, 0xff, 0x7b, 0x7d, 0x0a]);
    await writeFile(voiceFile(siteDir, run, 0), bytes);
    await rewrite(siteDir, run, (page, index) =>
      index === 0 ? { voice: { ...(page.voice as object), ...fileHash(bytes) } } : {},
    );
    const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });

    expect(Buffer.compare(input.recordings.get(keyOf(run, 0)) ?? new Uint8Array(), bytes)).toBe(0);
    expect(input.recordings.has(keyOf(run, 1))).toBe(true);
  });

  it("reads no file for a page whose record says why it has none", async () => {
    const { siteDir, run } = await voiceSite({ error: "the recorder couldn't start" }, BUSY);
    const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });

    expect(run.pages[0]?.voice).toMatchObject({ error: "the recorder couldn't start" });
    expect([...input.recordings.keys()]).toEqual([keyOf(run, 1)]);
  });

  it("reads no file for a record no voicecap writes, rather than stop", async () => {
    const { siteDir, run } = await voiceSite();
    // As an edit, or a later voicecap, might leave them: no object, and an object of neither kind.
    const odd: unknown[] = [null, "voice.webm"];
    await rewrite(siteDir, run, (_page, index) => ({ voice: odd[index] }));
    const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });

    expect(input.recordings.size).toBe(0);
  });

  it("reads no file its record doesn't list, as one dropped into a page's folder", async () => {
    const dir = await newFolder();
    // The scripted driver records nothing here, so the run has no record of a recording.
    const result = await runAudit(runOptions(dir, new ScriptedDriver(sitePages())));
    expect(result.outcome).toBe("completed");
    expect(result.run.pages.map((page) => page.voice)).toEqual([undefined, undefined]);
    await writeFile(voiceFile(result.siteDir, result.run, 0), Buffer.from("not recorded"));

    const input = await loadShareInput({ siteDir: result.siteDir, config: DEFAULT_CONFIG });

    expect(input.recordings.size).toBe(0);
  });

  it("reads nothing of a run from before voicecap recorded NVDA's voice", async () => {
    const input = await loadShareInput({ siteDir: DEMO_SITE, config: DEFAULT_CONFIG });

    expect(input.recordings.size).toBe(0);
    expect(input.records.length).toBeGreaterThan(0);
  });

  it("reads the recording of the record the card speaks for, and no other: not that of a later failure of the page", async () => {
    const dir = await newFolder();
    const first = await runAudit(
      runOptions(
        dir,
        new ScriptedDriver(sitePages({ home: { voice: SPEECH }, about: { voice: BUSY } })),
        {
          now: () => new Date(2026, 8, 26, 14, 5),
        },
      ),
    );
    // The second run reads the home page again, and the page /about fails after it was recorded: its
    // failed attempt is the page's last, so its recording is kept (and sealed) with the run.
    const second = await runAudit(
      runOptions(
        dir,
        new ScriptedDriver(sitePages({ home: { voice: OTHER }, about: { voice: OTHER } }), {
          hang: (command, url) => command === "nextLine" && url.endsWith("/about"),
        }),
        {
          fresh: true,
          now: () => new Date(2026, 8, 27, 9, 30),
          config: runConfig({ pageAttempts: 1 }),
        },
      ),
    );
    expect(second.run.pages.map((page) => page.status)).toEqual(["done", "failed"]);
    expect(second.run.pages[1]?.voice).toHaveProperty("sha256");
    const input = await loadShareInput({ siteDir: first.siteDir, config: DEFAULT_CONFIG });

    // /about is shown from the first run, with its transcripts: its recording is the first run's.
    expect([...input.recordings.keys()].sort()).toEqual(
      [keyOf(second.run, 0), keyOf(first.run, 1)].sort(),
    );
    expect(
      Buffer.compare(
        input.recordings.get(keyOf(first.run, 1)) ?? new Uint8Array(),
        await readFile(voiceFile(first.siteDir, first.run, 1)),
      ),
    ).toBe(0);
  });

  it("reads the recording of a page that was never transcribed, from the failure its card names", async () => {
    const dir = await newFolder(["/"]);
    // Every attempt's read pass times out at its first Down Arrow, so the page is never transcribed,
    // and its last attempt's recording is the one kept.
    const driver = new ScriptedDriver(sitePages({ home: { voice: SPEECH } }), {
      hang: (command) => command === "nextLine",
    });
    const result = await runAudit(
      runOptions(dir, driver, { config: runConfig({ pageAttempts: 2 }) }),
    );
    expect(result.run.pages[0]).toMatchObject({ status: "failed", attempts: 2 });
    const input = await loadShareInput({ siteDir: result.siteDir, config: DEFAULT_CONFIG });

    expect([...input.recordings.keys()]).toEqual([keyOf(result.run, 0)]);
  });

  it("takes the voice page's name from its option, and none by default", async () => {
    const { siteDir } = await voiceSite();

    expect((await loadShareInput({ siteDir, config: DEFAULT_CONFIG })).voiceName).toBeNull();
    expect(
      (await loadShareInput({ siteDir, config: DEFAULT_CONFIG, voiceName: VOICE_PAGE })).voiceName,
    ).toBe(VOICE_PAGE);
  });
});
