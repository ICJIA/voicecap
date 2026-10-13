/**
 * What loadShareInput reads of each page's recording of NVDA's voice (from voicecap 0.18.0): the
 * file of the record each page's card speaks for, held only as its run recorded it (its size and
 * SHA-256), as a screenshot's and an axe file's are. The sites here are written as voicecap writes
 * them: real scripted runs, each page of which was recorded by the scripted driver, with the real
 * encoder making the WebM Opus files. Nothing here plays a sound.
 */
import type { Stats } from "node:fs";
import type * as Fsp from "node:fs/promises";
import {
  appendFile,
  copyFile,
  lstat,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { gestureOf } from "../src/drivers/guidepup/nvda-log.js";
import type { RunJson } from "../src/model.js";
import { runAudit } from "../src/run/audit.js";
import { pageDir, runJsonPath } from "../src/run/paths.js";
import { loadShareInput, readAsRecorded } from "../src/share/load.js";
import { buildShareModel } from "../src/share/model.js";
import { renderVoicePage } from "../src/share/voice-page.js";
import { fileHash } from "../src/transcripts/write.js";
import { sealOf } from "../src/util/hash.js";
import { copyOf, keyAt, saidAt } from "./helpers/nvda-log.js";
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
// leaves unread counts the recordings it opened. What a file is looked at with is watched the same
// way, so a test can give what it says of a link where the system can't make one.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof Fsp>();
  return { ...actual, lstat: vi.fn(actual.lstat), readFile: vi.fn(actual.readFile) };
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

describe("loadShareInput: a record that isn't its folder's", () => {
  it("leaves the record out, and lists its folder among the runs that couldn't be read", async () => {
    const dir = await newFolder();
    const result = await runAudit(runOptions(dir, new ScriptedDriver(sitePages())));
    expect(result.outcome).toBe("completed");
    // A copy of the run that names another place for itself, newer than the run.
    const folder = path.join(result.siteDir, "2099-01-01", "0900");
    await mkdir(folder, { recursive: true });
    const forged = { ...result.run, id: "../../escape", createdAt: "2099-01-01T09:00:00-05:00" };
    await writeFile(path.join(folder, "run.json"), JSON.stringify(forged));

    const input = await loadShareInput({ siteDir: result.siteDir, config: DEFAULT_CONFIG });

    expect(input.records.map((record) => record.id)).toEqual([result.run.id]);
    expect(input.unreadableRuns).toEqual(["2099-01-01_0900"]);
  });
});

describe("loadShareInput: each page's transcripts", () => {
  /** A site folder with one completed run of the scripted site: no recordings, and no log copies. */
  async function transcriptSite() {
    const dir = await newFolder();
    const result = await runAudit(runOptions(dir, new ScriptedDriver(sitePages())));
    expect(result.outcome).toBe("completed");
    return { siteDir: result.siteDir, run: result.run };
  }

  /** Where a page of a run keeps a transcript file. */
  const fileOf = (siteDir: string, run: RunJson, index: number, name: string): string =>
    path.join(pageDir(siteDir, run.id, run.pages[index]?.slug ?? ""), name);

  /** The text with its first letter made the next one: the same size, and not the same bytes. */
  const oneByteOff = (text: string): string =>
    text.replace(/[a-y]/, (letter) => String.fromCharCode(letter.charCodeAt(0) + 1));

  it("reads a TXT transcript only when its file is as its run recorded it", async () => {
    const { siteDir, run } = await transcriptSite();
    const slug = run.pages[0]?.slug ?? "";
    const before = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });
    expect(before.transcripts.txt(run.id, slug, "read")).not.toBeNull();

    // One byte differs and the size is the same: the SHA-256 is what tells.
    const file = fileOf(siteDir, run, 0, "read.txt");
    const text = await readFile(file, "utf8");
    await writeFile(file, oneByteOff(text));
    expect(Buffer.byteLength(oneByteOff(text))).toBe(Buffer.byteLength(text));
    const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });

    expect(input.transcripts.txt(run.id, slug, "read")).toBeNull();
    // The page's other transcripts, and the other page's, are as recorded and still read.
    expect(input.transcripts.txt(run.id, slug, "headings")).not.toBeNull();
    expect(input.transcripts.txt(run.id, run.pages[1]?.slug ?? "", "read")).not.toBeNull();

    // A byte more is another size.
    await writeFile(file, text);
    await appendFile(file, "x");
    expect(
      (await loadShareInput({ siteDir, config: DEFAULT_CONFIG })).transcripts.txt(
        run.id,
        slug,
        "read",
      ),
    ).toBeNull();
  });

  it("reads the steps of a JSON transcript only when its file is as its run recorded it", async () => {
    const { siteDir, run } = await transcriptSite();
    const slug = run.pages[0]?.slug ?? "";
    const before = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });
    expect(before.transcripts.steps(run.id, slug, "read")?.length).toBeGreaterThan(0);
    expect(before.flagsAsRecorded).toEqual([]);

    // The changed file still parses, with its steps: only its fingerprint tells it from the recorded.
    const file = fileOf(siteDir, run, 0, "read.json");
    const changed = oneByteOff(await readFile(file, "utf8"));
    expect(Array.isArray((JSON.parse(changed) as { steps?: unknown }).steps)).toBe(true);
    await writeFile(file, changed);
    const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });

    expect(input.transcripts.steps(run.id, slug, "read")).toBeNull();
    // With a pass's steps left out, the page's flags can't be worked out afresh: they're the record's.
    expect(input.flagsAsRecorded).toEqual([{ run: run.id, slug }]);
    expect(input.transcripts.steps(run.id, slug, "headings")?.length).toBeGreaterThan(0);
    expect(input.transcripts.steps(run.id, run.pages[1]?.slug ?? "", "read")).not.toBeNull();
  });

  it("names a transcript that isn't as recorded as it names a missing one", async () => {
    const { siteDir, run } = await transcriptSite();
    const changed = fileOf(siteDir, run, 0, "read.txt");
    await writeFile(changed, oneByteOff(await readFile(changed, "utf8")));
    await rm(fileOf(siteDir, run, 1, "headings.txt"));
    const model = buildShareModel(await loadShareInput({ siteDir, config: DEFAULT_CONFIG }));

    const [home, about] = run.pages.map((page) =>
      model.appendix.find((entry) => entry.slug === page.slug),
    );
    expect(home?.unreadable).toEqual(["read"]);
    expect(home?.files.map((file) => file.pass)).toEqual(["headings", "tab"]);
    expect(about?.unreadable).toEqual(["headings"]);
    expect(about?.files.map((file) => file.pass)).toEqual(["read", "tab"]);
  });

  it("reads no transcript whose record isn't a file's fingerprint", async () => {
    const { siteDir, run } = await transcriptSite();
    const slug = run.pages[0]?.slug ?? "";
    // As an edit, or a later voicecap, might leave them: the file is there, its record isn't a hash.
    await rewrite(siteDir, run, (page, index) =>
      index === 0
        ? { files: { ...page.files, "read.txt": "not a fingerprint", "read.json": null } }
        : {},
    );
    const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });

    expect(input.transcripts.txt(run.id, slug, "read")).toBeNull();
    expect(input.transcripts.steps(run.id, slug, "read")).toBeNull();
    expect(input.transcripts.txt(run.id, slug, "headings")).not.toBeNull();
  });

  // Making a symbolic link needs a privilege on Windows, so this runs elsewhere.
  it.skipIf(process.platform === "win32")(
    "reads no transcript that is a symbolic link, even to a file with the recorded bytes",
    async () => {
      const { siteDir, run } = await transcriptSite();
      const slug = run.pages[0]?.slug ?? "";
      for (const name of ["read.txt", "read.json"]) {
        const file = fileOf(siteDir, run, 0, name);
        const elsewhere = path.join(await newFolder([]), name);
        await copyFile(file, elsewhere);
        await rm(file);
        await symlink(elsewhere, file);
      }
      const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });

      expect(input.transcripts.txt(run.id, slug, "read")).toBeNull();
      expect(input.transcripts.steps(run.id, slug, "read")).toBeNull();
      expect(input.transcripts.txt(run.id, slug, "headings")).not.toBeNull();
    },
  );

  it("reads no steps of an earlier run's page from a JSON that isn't as recorded, for the check of NVDA's log", async () => {
    const dir = await newFolder();
    /** A run whose NVDA session left a copy of NVDA's log, as a driver hands one over. */
    const runWithCopy = (when: Date, fresh: boolean) => {
      const driver = new ScriptedDriver(sitePages());
      const stop = driver.stop.bind(driver);
      driver.stop = (stopOptions) => {
        driver.recorder?.screenReaderLog?.(
          copyOf(keyAt(32_400_000, "downArrow"), saidAt(32_400_040, "Welcome")),
        );
        return stop(stopOptions);
      };
      return runAudit(runOptions(dir, driver, { fresh, now: () => when }));
    };
    const first = await runWithCopy(new Date(2026, 8, 26, 14, 5), false);
    const second = await runWithCopy(new Date(2026, 8, 27, 9, 30), true);
    expect(first.run.files).toBeDefined();
    const slug = first.run.pages[0]?.slug ?? "";

    // The page's JSON in the first run isn't read for the page (the second run has it, the same),
    // only for the check, which needs a copy of NVDA's log and NVDA's keys.
    const load = () =>
      loadShareInput({ siteDir: first.siteDir, config: DEFAULT_CONFIG, gestureOf });
    const intact = await load();
    expect(intact.nvdaLogs.has(first.run.id)).toBe(true);
    expect(intact.transcripts.steps(first.run.id, slug, "read")?.length).toBeGreaterThan(0);
    expect(intact.transcripts.txt(first.run.id, slug, "read")).toBeNull();

    const file = fileOf(first.siteDir, first.run, 0, "read.json");
    await writeFile(file, oneByteOff(await readFile(file, "utf8")));
    const changed = await load();

    expect(changed.transcripts.steps(first.run.id, slug, "read")).toBeNull();
    expect(changed.transcripts.steps(first.run.id, slug, "headings")?.length).toBeGreaterThan(0);
    expect(changed.transcripts.steps(second.run.id, slug, "read")?.length).toBeGreaterThan(0);
  });
});

describe("readAsRecorded", () => {
  /** A file in a new folder, taken away after the test. */
  async function fileWith(content: string): Promise<string> {
    const dir = await newFolder([]);
    const file = path.join(dir, "read.txt");
    await writeFile(file, content);
    return file;
  }

  it("gives the bytes of a regular file whose size and SHA-256 are the record's", async () => {
    const file = await fileWith("Welcome");

    const bytes = await readAsRecorded(file, fileHash("Welcome"));

    expect(bytes?.toString("utf8")).toBe("Welcome");
  });

  it("gives nothing for a file that differs in its bytes, its size, or both", async () => {
    const file = await fileWith("Welcome");

    expect(await readAsRecorded(file, fileHash("Welcomf"))).toBeNull();
    expect(await readAsRecorded(file, { ...fileHash("Welcome"), bytes: 8 })).toBeNull();
    expect(await readAsRecorded(file, { sha256: "0".repeat(64), bytes: 8 })).toBeNull();
  });

  it("gives nothing for a record that isn't a file's fingerprint", async () => {
    const file = await fileWith("Welcome");

    for (const recorded of [undefined, null, "Welcome", 7, [], {}, { sha256: 1, bytes: 7 }]) {
      expect(await readAsRecorded(file, recorded), JSON.stringify(recorded)).toBeNull();
    }
  });

  it("gives nothing for a file that's missing or is a folder", async () => {
    const file = await fileWith("Welcome");
    const recorded = fileHash("Welcome");
    await rm(file);
    expect(await readAsRecorded(file, recorded)).toBeNull();

    await mkdir(file);
    expect(await readAsRecorded(file, recorded)).toBeNull();
  });

  it("opens nothing that lstat finds to be a link, even with the recorded bytes", async () => {
    // A link needs a privilege to make on Windows, so what lstat says of one is given here, over a
    // file that has the recorded bytes: the test of a transcript's link above makes a real one.
    const file = await fileWith("Welcome");
    const link = { isFile: () => false, isSymbolicLink: () => true } as unknown as Stats;
    vi.mocked(lstat).mockResolvedValueOnce(link);
    vi.mocked(readFile).mockClear();

    expect(await readAsRecorded(file, fileHash("Welcome"))).toBeNull();

    expect(vi.mocked(lstat)).toHaveBeenLastCalledWith(file);
    expect(vi.mocked(readFile)).not.toHaveBeenCalled();
    // The same file, looked at as it is, is read.
    expect((await readAsRecorded(file, fileHash("Welcome")))?.toString("utf8")).toBe("Welcome");
  });
});
