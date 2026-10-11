/**
 * What loadShareInput reads of each page's recording of NVDA's voice (from voicecap 0.18.0): the
 * file of the record each page's card speaks for, held only as its run recorded it (its size and
 * SHA-256), as a screenshot's and an axe file's are. The sites here are written as voicecap writes
 * them: real scripted runs, each page of which was recorded by the scripted driver, with the real
 * encoder making the WebM Opus files. Nothing here plays a sound.
 */
import type * as Fsp from "node:fs/promises";
import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { RunJson } from "../src/model.js";
import { runAudit } from "../src/run/audit.js";
import { pageDir, runJsonPath } from "../src/run/paths.js";
import { loadShareInput } from "../src/share/load.js";
import { buildShareModel } from "../src/share/model.js";
import { renderVoicePage } from "../src/share/voice-page.js";
import { fileHash } from "../src/transcripts/write.js";
import { sealOf } from "../src/util/hash.js";
import {
  config as runConfig,
  options as runOptions,
  setup as setupSite,
  SITE,
  sitePages,
} from "./helpers/run-site.js";
import { ScriptedDriver, type ScriptedVoice } from "./helpers/scripted-driver.js";
import { DEMO_SITE, VOICE_PAGE } from "./helpers/share-model.js";
import { busySound, speechAndPauses } from "./helpers/voice-signal.js";

// Each file read is watched, not stopped: every call goes through, and the test of what the loader
// leaves unread counts the recordings it opened.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof Fsp>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

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

/** Why a run keeps no recording of an attempt that read the page and then failed. */
const UNFINISHED = "the attempt didn't finish, and a recording is kept only of an attempt that did";

/**
 * Give the failed page `index` of a run a recording, as the voice's first builds kept the recording
 * of a page's failed last attempt: a file in the page's folder, and its record (`like`'s, with the
 * file's fingerprint, or one of its own), sealed again with the run.
 */
async function keepFailedRecording(
  siteDir: string,
  run: RunJson,
  index: number,
  like?: RunJson["pages"][number]["voice"],
): Promise<void> {
  const bytes = Buffer.from("the recording of a failed attempt");
  await writeFile(voiceFile(siteDir, run, index), bytes);
  const kept = { seconds: 1, lostMs: 0, recordedAt: "2026-09-27T09:31:00.000-05:00" };
  await rewrite(siteDir, run, (_page, at) =>
    at === index ? { voice: { ...(like ?? kept), ...fileHash(bytes) } } : {},
  );
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
    // The second run reads the home page again, and the page /about fails after it was read into:
    // the run keeps no recording of an attempt that didn't finish, and says why.
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
    expect(second.run.pages[1]?.voice).toMatchObject({ error: UNFINISHED });
    // So that the later failure has a recording the loader could take, its record is given one and
    // sealed again, as the voice's first builds kept the recording of a failed last attempt.
    await keepFailedRecording(second.siteDir, second.run, 1, first.run.pages[1]?.voice);
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
    // Every attempt's read pass times out at its first Down Arrow, so the page is never transcribed.
    // Its card speaks for its last attempt's failure, whose recording the run didn't keep: the
    // attempt didn't finish.
    const driver = new ScriptedDriver(sitePages({ home: { voice: SPEECH } }), {
      hang: (command) => command === "nextLine",
    });
    const result = await runAudit(
      runOptions(dir, driver, { config: runConfig({ pageAttempts: 2 }) }),
    );
    expect(result.run.pages[0]).toMatchObject({ status: "failed", attempts: 2 });
    expect(result.run.pages[0]?.voice).toMatchObject({ error: UNFINISHED });
    const none = await loadShareInput({ siteDir: result.siteDir, config: DEFAULT_CONFIG });
    expect(none.recordings.size).toBe(0);

    // A failure whose record lists a recording, as the voice's first builds kept the last attempt's:
    // the loader reads it, from the failure the card names.
    await keepFailedRecording(result.siteDir, result.run, 0);
    const input = await loadShareInput({ siteDir: result.siteDir, config: DEFAULT_CONFIG });

    expect([...input.recordings.keys()]).toEqual([keyOf(result.run, 0)]);
  });

  it("reads no recording when it's told the copy has none to play: the live copy and the replay need none", async () => {
    const { siteDir } = await voiceSite();
    /** How many recordings the loader has opened since the count was cleared. */
    const opened = (): number =>
      vi
        .mocked(readFile)
        .mock.calls.filter(([file]) => typeof file === "string" && file.endsWith("voice.webm"))
        .length;

    vi.mocked(readFile).mockClear();
    const none = await loadShareInput({ siteDir, config: DEFAULT_CONFIG, recordings: false });
    expect(opened()).toBe(0);
    expect(none.recordings.size).toBe(0);

    // The default is to read them, so that a share which asks for nothing in particular keeps its
    // voice page: each page's file, once.
    vi.mocked(readFile).mockClear();
    const all = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });
    expect(opened()).toBe(2);
    expect(all.recordings.size).toBe(2);
    vi.mocked(readFile).mockClear();
    await loadShareInput({ siteDir, config: DEFAULT_CONFIG, recordings: true });
    expect(opened()).toBe(2);

    // Nothing else of what it reads depends on them: the records, and the screenshots and axe
    // files, are as they were.
    expect(none.records).toEqual(all.records);
    expect(none.runs).toEqual(all.runs);
    expect([...none.screenshots.keys()]).toEqual([...all.screenshots.keys()]);
    expect([...none.axeFiles.keys()]).toEqual([...all.axeFiles.keys()]);
    // And a model built from either has the same pages: only a card's line on its recording, which
    // goes with the voice page, needs the files.
    const named = { voiceName: VOICE_PAGE } as const;
    expect(buildShareModel({ ...none, ...named }).pages.map((card) => card.voice)).toEqual([
      null,
      null,
    ]);
    expect(buildShareModel({ ...all, ...named }).pages.every((card) => card.voice !== null)).toBe(
      true,
    );
  });

  it("makes a voice page of a site and a spot check after it: loaded, modelled, and rendered, each page from the run its card speaks for", async () => {
    const dir = await newFolder();
    const first = await runAudit(
      runOptions(
        dir,
        new ScriptedDriver(sitePages({ home: { voice: SPEECH }, about: { voice: BUSY } })),
        { now: () => new Date(2026, 8, 26, 14, 5) },
      ),
    );
    // A spot check of /about alone, the next morning: its page's newest record is this one's.
    const spot = await runAudit(
      runOptions(dir, new ScriptedDriver(sitePages({ about: { voice: OTHER } })), {
        pages: null,
        pageUrls: [`${SITE}/about`],
        fresh: true,
        now: () => new Date(2026, 8, 27, 9, 30),
      }),
    );
    expect(spot.outcome).toBe("completed");
    expect(spot.run.settings.source.kind).toBe("urls");

    // The three steps a share takes, one after the other, as it names its pair.
    const input = await loadShareInput({ siteDir: first.siteDir, config: DEFAULT_CONFIG });
    const model = buildShareModel({
      ...input,
      fileName: VOICE_PAGE.replace(".voice.html", ".html"),
      wordName: VOICE_PAGE.replace(".voice.html", ".docx"),
      voiceName: VOICE_PAGE,
    });
    const html = renderVoicePage(model, input.recordings, { fontCss: "" });
    expect(html).not.toBeNull();

    // Home is the first run's, whose page list decides the pages; /about is the spot check's.
    expect(model.pages.map((card) => card.speaksFor)).toEqual([
      { run: first.run.id, slug: first.run.pages[0]?.slug },
      { run: spot.run.id, slug: spot.run.pages[0]?.slug },
    ]);
    // Each section plays the file its record lists, byte for byte: the one on disk in that run.
    const played = [...(html ?? "").matchAll(/data-slug="([^"]*)" data-file="voice.webm"/g)];
    expect(played).toHaveLength(2);
    const sounds = [...(html ?? "").matchAll(/src="data:audio\/webm;base64,([^"]*)"/g)].map(
      ([, base64 = ""]) => Buffer.from(base64, "base64"),
    );
    const onDisk = [
      await readFile(voiceFile(first.siteDir, first.run, 0)),
      await readFile(voiceFile(spot.siteDir, spot.run, 0)),
    ];
    expect(sounds).toHaveLength(2);
    for (const [index, bytes] of sounds.entries()) {
      expect(Buffer.compare(bytes, onDisk[index] ?? Buffer.alloc(0)), `section ${index + 1}`).toBe(
        0,
      );
    }
    // The spot check's section says which run its recording is from; the first run's, the latest
    // run that decides the pages, doesn't.
    const about = model.pages[1]?.slug ?? "";
    expect(html).toContain(`From run ${spot.run.id}, on 27 September 2026`);
    expect(html).not.toContain(`From run ${first.run.id}`);
    // Both runs are carried for the check, oldest first, as recorded.
    const carried = /id="fp-data">([\s\S]*?)<\/script>/.exec(html ?? "")?.[1] ?? "";
    expect((JSON.parse(carried) as { runs: RunJson[] }).runs.map((run) => run.id)).toEqual([
      first.run.id,
      spot.run.id,
    ]);
    expect(about).not.toBe("");
  });

  it("takes the voice page's name from its option, and none by default", async () => {
    const { siteDir } = await voiceSite();

    expect((await loadShareInput({ siteDir, config: DEFAULT_CONFIG })).voiceName).toBeNull();
    expect(
      (await loadShareInput({ siteDir, config: DEFAULT_CONFIG, voiceName: VOICE_PAGE })).voiceName,
    ).toBe(VOICE_PAGE);
  });
});
