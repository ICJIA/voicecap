/**
 * What the shareable report says of NVDA's voice (plan 11, from voicecap 0.18.0), apart from the
 * voice page itself (test/share-voice-page.test.ts): each page's card, which links to its section
 * of the voice page, with the length of its recording; what the details say of the voice page, and
 * where it is or why there is none; and that the card, the details, and the voice page agree on
 * which pages have a recording to play, and which recording each plays. The models are built in
 * memory, with real WebM Opus files (the encoder's own, of sounds from test/helpers/voice-signal.ts).
 * Nothing here plays a sound.
 */
import os from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import type { RunJson, VoiceRecord } from "../src/model.js";
import { lineText } from "../src/share/line.js";
import { buildShareModel, type ShareModel } from "../src/share/model.js";
import { KEEPS_VOICE_FROM } from "../src/share/run-evidence.js";
import { VOICE_TEXT } from "../src/share/text.js";
import { voiceAnchor } from "../src/share/anchors.js";
import { renderVoicePage } from "../src/share/voice-page.js";
import { voiceDetails } from "../src/share/words.js";
import { shareRun, type SharePageSpec } from "./helpers/share-data.js";
import { attributes, textOf } from "./helpers/share-html.js";
import {
  inputOf,
  LINES,
  recordedVoice,
  recordingsOf,
  storeOf,
  TRANSCRIPTS,
  VOICE_PAGE,
  VOICE_RECORDED_AT,
} from "./helpers/share-model.js";
import { busySound, speechAndPauses } from "./helpers/voice-signal.js";

type Recorded = Awaited<ReturnType<typeof recordedVoice>>;

/** Three recordings that differ, so a card can be told to play one and not another. */
let speech: Recorded;
let busy: Recorded;
let other: Recorded;

beforeAll(async () => {
  speech = await recordedVoice(speechAndPauses());
  busy = await recordedVoice(busySound(3.4, 7));
  other = await recordedVoice(busySound(2.5, 8));
});

/** The fonts the share gives the voice page: none here, as the tests read the page as text. */
const NO_FONTS = { fontCss: "" };

/** A page read in full, with the voice a test gives it. */
function read(path: string, voice?: VoiceRecord, more: Partial<SharePageSpec> = {}): SharePageSpec {
  return {
    path,
    files: TRANSCRIPTS,
    passes: LINES,
    ...(voice === undefined ? {} : { voice }),
    ...more,
  };
}

/** A recorder's reason, as a run keeps it. */
const reason = (words: string): VoiceRecord => ({ error: words, recordedAt: VOICE_RECORDED_AT });

/** A kept recording's record, with the length a test says it is (the record's, never the file's). */
const lasting = (recorded: Recorded, seconds: number): VoiceRecord => ({
  ...recorded.record,
  seconds,
});

/** A run of voicecap `version` (0.18.0, the first to record NVDA's voice) of the pages given. */
function runOf(pages: SharePageSpec[], version = KEEPS_VOICE_FROM, id = "2026-09-29_1402") {
  return shareRun({ id, createdAt: "2026-09-29T14:02:51-05:00", voicecapVersion: version, pages });
}

/**
 * The model of some runs, as a share makes it: every transcript readable, each run's recordings
 * held (as the loader holds them), and the voice page beside the page, named `voiceName`.
 */
function modelOf(
  runs: RunJson[],
  more: { voiceName?: string | null; held?: boolean } = {},
): { model: ShareModel; recordings: Map<string, Uint8Array> } {
  const recordings = more.held === false ? new Map<string, Uint8Array>() : recordingsOf(runs);
  const voiceName = more.voiceName === undefined ? VOICE_PAGE : more.voiceName;
  const model = buildShareModel(inputOf(runs, { transcripts: storeOf(), recordings, voiceName }));
  return { model, recordings };
}

/** The sections of a voice page: each card's id, as its markup. */
function sectionsOf(html: string): { id: string; markup: string }[] {
  return [...html.matchAll(/<article class="card" id="([^"]*)">([\s\S]*?)<\/article>/g)].map(
    ([, id = "", markup = ""]) => ({ id, markup }),
  );
}

/** The audio each section of a voice page plays, as bytes, by the section's id. */
function soundsOf(html: string): Map<string, Uint8Array> {
  return new Map(
    sectionsOf(html).flatMap(({ id, markup }): [string, Uint8Array][] => {
      const player = /<audio\b[^>]*>/.exec(markup)?.[0];
      const [address] = player === undefined ? [] : attributes(player, "src");
      return address === undefined
        ? []
        : [
            [
              id,
              new Uint8Array(
                Buffer.from(address.replace(/^data:audio\/webm;base64,/, ""), "base64"),
              ),
            ],
          ];
    }),
  );
}

describe("a page's voice, on its card", () => {
  it("is its length and the address of its section on the voice page, for a page with a recording", () => {
    const run = runOf([
      read("/", lasting(speech, 134.2), { label: "Home" }),
      read("/about/", lasting(busy, 61)),
    ]);
    const { model } = modelOf([run]);

    // The address is the voice page's name, beside the page, and the section's own id.
    expect(model.pages.map((card) => card.voice)).toEqual([
      { seconds: 134.2, href: `${VOICE_PAGE}#${voiceAnchor(model.pages[0]?.slug ?? "")}` },
      { seconds: 61, href: `${VOICE_PAGE}#${voiceAnchor(model.pages[1]?.slug ?? "")}` },
    ]);
    expect(model.pages[0]?.voice?.href).toBe(`${VOICE_PAGE}#voice-home`);
  });

  it("is none for a page with no recording to play, whatever the reason: a reason, no record, a file the loader doesn't hold, or a record no voicecap writes", () => {
    const run = runOf([
      read("/", speech.record),
      read("/failed/", reason("the recording is silent")),
      read("/none/"),
      { path: "/skipped/", status: "skipped" },
      read("/odd/", "voice.webm" as unknown as VoiceRecord),
      read("/gone/", other.record),
    ]);
    const { recordings } = modelOf([run]);
    // The loader holds /'s file only: /gone/'s record is a kept one, with no file as it was.
    const gone = run.pages[5];
    recordings.delete(`${run.id}/${gone?.slug}`);
    const model = buildShareModel(
      inputOf([run], { transcripts: storeOf(), recordings, voiceName: VOICE_PAGE }),
    );

    expect(model.pages.map((card) => card.voice !== null)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("is none in a copy that has no voice page beside it, however many recordings it holds", () => {
    const run = runOf([read("/", speech.record), read("/about/", busy.record)]);
    const { model, recordings } = modelOf([run], { voiceName: null });

    expect(recordings.size).toBe(2);
    expect(model.pages.map((card) => card.voice)).toEqual([null, null]);
  });

  it("leaves a length unsaid when its record doesn't give one, and still has the line", () => {
    const odd = { ...speech.record, seconds: "long" } as unknown as VoiceRecord;
    const run = runOf([read("/", odd), read("/about/", lasting(busy, -3))]);
    const { model } = modelOf([run]);

    expect(model.pages.map((card) => card.voice?.seconds)).toEqual([null, null]);
    expect(model.pages.map((card) => card.voice !== null)).toEqual([true, true]);
  });

  describe("is the recording of the record the card speaks for", () => {
    /**
     * A run that read three pages, and a spot check after it (a page given with --page) that read
     * one of them again: Home's recording is the spot check's, and About's and Third's, which the
     * spot check didn't read, are the first run's. The three files differ.
     */
    function spotChecked() {
      const first = runOf(
        [
          read("/", lasting(speech, 10), { label: "Home" }),
          read("/about/", lasting(busy, 20)),
          read("/third/", lasting(speech, 40)),
        ],
        KEEPS_VOICE_FROM,
        "2026-09-29_1402",
      );
      const spot = shareRun({
        id: "2026-09-30_0900",
        createdAt: "2026-09-30T09:00:00-05:00",
        voicecapVersion: KEEPS_VOICE_FROM,
        source: { kind: "urls", urls: ["https://example.illinois.gov/"] },
        pages: [read("/", lasting(other, 30))],
      });
      return { first, spot, ...modelOf([first, spot]) };
    }

    it("the run its transcripts are from, not the newest run the report draws on", () => {
      const { first, spot, model } = spotChecked();

      // The newest run drawn on is the spot check, which has no record of About at all.
      expect(model.evidence[0]?.run.id).toBe(spot.id);
      expect(model.pages.map((card) => card.speaksFor)).toEqual([
        { run: spot.id, slug: spot.pages[0]?.slug },
        { run: first.id, slug: first.pages[1]?.slug },
        { run: first.id, slug: first.pages[2]?.slug },
      ]);
      expect(model.pages.map((card) => card.voice?.seconds)).toEqual([30, 20, 40]);
    });

    it("the very recordings its section of the voice page plays, whichever run they're from", () => {
      const { first, spot, model, recordings } = spotChecked();
      const html = renderVoicePage(model, recordings, NO_FONTS) ?? "";
      const sounds = soundsOf(html);

      for (const card of model.pages) {
        const filed = card.speaksFor;
        const bytes = recordings.get(`${filed?.run}/${filed?.slug}`);
        expect(bytes, card.path).toBeDefined();
        expect(
          Buffer.compare(
            sounds.get(voiceAnchor(card.slug)) ?? new Uint8Array(),
            bytes ?? new Uint8Array(),
          ),
          card.path,
        ).toBe(0);
        // The card's address is its section's id.
        expect(card.voice?.href.split("#")[1], card.path).toBe(voiceAnchor(card.slug));
      }
      // Home plays the spot check's file, not the first run's of the same page.
      const older = recordings.get(`${first.id}/${first.pages[0]?.slug}`) ?? new Uint8Array();
      expect(older.length).toBeGreaterThan(0);
      expect(Buffer.compare(sounds.get(voiceAnchor("home")) ?? new Uint8Array(), older)).not.toBe(
        0,
      );
      expect(new Set(model.pages.map(({ speaksFor }) => speaksFor?.run))).toEqual(
        new Set([spot.id, first.id]),
      );
    });

    it("the failure's, for a page that was never transcribed", () => {
      const run = runOf([
        read("/", speech.record),
        { path: "/never/", status: "failed", voice: lasting(busy, 7) },
      ]);
      const { model } = modelOf([run]);

      expect(model.pages[1]).toMatchObject({
        status: "never",
        speaksFor: { run: run.id, slug: run.pages[1]?.slug },
        voice: { seconds: 7 },
      });
    });

    it("none, for a page whose record has none: a skipped page that no run read", () => {
      const run = runOf([{ path: "/", status: "skipped" }]);
      const { model } = modelOf([run]);

      expect(model.pages[0]).toMatchObject({ voice: null });
      expect(model.pages[0]?.speaksFor).toEqual({ run: run.id, slug: run.pages[0]?.slug });
    });
  });

  it("makes every card with a line a section that plays a recording, and no other, so the voice page is written exactly when a card has a line", () => {
    const run = runOf([
      read("/", speech.record),
      read("/failed/", reason("the recording is silent")),
      read("/about/", busy.record),
      read("/none/"),
    ]);
    const { model, recordings } = modelOf([run]);
    const html = renderVoicePage(model, recordings, NO_FONTS);
    const sounds = soundsOf(html ?? "");

    expect(html).not.toBeNull();
    expect(model.pages.map((card) => sounds.has(voiceAnchor(card.slug)))).toEqual(
      model.pages.map((card) => card.voice !== null),
    );
    // And with no card that has a line, there is no page to link to.
    const bare = modelOf([run], { held: false });
    expect(bare.model.pages.some((card) => card.voice !== null)).toBe(false);
    expect(renderVoicePage(bare.model, bare.recordings, NO_FONTS)).toBeNull();
    const reasons = modelOf([runOf([read("/", reason("no program"))])]);
    expect(reasons.model.pages.some((card) => card.voice !== null)).toBe(false);
    expect(renderVoicePage(reasons.model, reasons.recordings, NO_FONTS)).toBeNull();
  });

  it("has the length its section of the voice page says", () => {
    const run = runOf([read("/", lasting(speech, 134.2)), read("/about/", lasting(busy, 3_725))]);
    const { model, recordings } = modelOf([run]);
    const html = renderVoicePage(model, recordings, NO_FONTS) ?? "";
    const sections = sectionsOf(html);

    // Each card's line and its section both say the length as VOICE_TEXT.length does.
    expect(model.pages.map((card) => VOICE_TEXT.length(card.voice?.seconds ?? NaN))).toEqual([
      "2 min 14 s",
      "1 h 2 min 5 s",
    ]);
    for (const [index, card] of model.pages.entries()) {
      expect(textOf(sections[index]?.markup ?? "")).toContain(
        `Length: ${VOICE_TEXT.length(card.voice?.seconds ?? NaN)}`,
      );
    }
  });
});

describe("what the details say of the voice page", () => {
  it("is nothing for a report whose runs are from before voicecap recorded NVDA's voice", () => {
    for (const version of ["0.17.0", "0.16.0", "0.11.0", "0.4.1"]) {
      const run = runOf([read("/"), read("/about/")], version);

      expect(modelOf([run]).model.voicePage, version).toBeNull();
      expect(modelOf([run], { voiceName: null }).model.voicePage, version).toBeNull();
    }
    expect(voiceDetails(modelOf([runOf([read("/")], "0.17.0")]).model)).toBeNull();
  });

  it("points to the voice page, by its file name, when a card has a line", () => {
    const run = runOf([read("/", speech.record), read("/about/")]);
    const { model } = modelOf([run]);

    expect(model.voicePage).toEqual({ name: VOICE_PAGE });
    // The paragraph is the plan's words, then a link to the file and its name.
    const line = voiceDetails(model);
    expect(lineText(line ?? [])).toBe(
      `${VOICE_TEXT.details.lead} ${VOICE_TEXT.details.open} (${VOICE_PAGE}).`,
    );
    expect(line).toContainEqual({ text: VOICE_TEXT.details.open, href: VOICE_PAGE });
    expect(line).toContainEqual({ text: VOICE_PAGE, mono: true });
  });

  it("says there is none when a run that records has no recording to play: every page's own reason is on its record", () => {
    // With a reason to give, it gives the most common (below); with none, only that there is none.
    const { model } = modelOf([runOf([read("/")])]);

    expect(model.voicePage).toEqual({ why: VOICE_TEXT.details.noRecording });
    expect(lineText(voiceDetails(model) ?? [])).toBe(
      `${VOICE_TEXT.details.lead} ${VOICE_TEXT.details.noRecording}`,
    );
    const silent = modelOf([
      runOf([read("/", reason("the recording is silent")), read("/about/", reason("no program"))]),
    ]).model;
    expect(silent.voicePage).toEqual({
      why: VOICE_TEXT.details.noRecordingBecause("the recording is silent"),
    });
  });

  it("says the live copy has none beside it, for a run that records, and nothing for a run that doesn't", () => {
    const run = runOf([read("/", speech.record)]);
    const live = modelOf([run], { voiceName: null }).model;

    expect(live.voicePage).toEqual({ why: VOICE_TEXT.details.liveCopy });
    expect(lineText(voiceDetails(live) ?? [])).toBe(
      `${VOICE_TEXT.details.lead} ${VOICE_TEXT.details.liveCopy}`,
    );
    // The live copy of a report that draws on no run that records says nothing, as before.
    expect(modelOf([runOf([read("/")], "0.17.0")], { voiceName: null }).model.voicePage).toBeNull();
  });

  it("says it of a report whose latest run records, though other pages come from an older run that didn't", () => {
    const older = runOf([read("/"), read("/about/")], "0.17.0", "2026-09-28_0900");
    const latest = runOf(
      [read("/", speech.record), { path: "/about/", status: "failed" }],
      KEEPS_VOICE_FROM,
      "2026-09-29_1402",
    );
    const { model } = modelOf([older, latest]);

    // The failed page is shown from the older run, which kept no recording.
    expect(model.pages.map((card) => card.voice !== null)).toEqual([true, false]);
    expect(model.voicePage).toEqual({ name: VOICE_PAGE });
  });

  it("points to the voice page when a run's record has a recording, even from a voicecap that wasn't thought to record", () => {
    // A record is data: a recording a run keeps is shown, whatever version the run says it used.
    const run = runOf([read("/", speech.record)], "0.17.0");
    const { model } = modelOf([run]);

    expect(model.pages[0]?.voice).not.toBeNull();
    expect(model.voicePage).toEqual({ name: VOICE_PAGE });
  });
});

// A run that records but has no recording to play says why the pages have none, from what its own
// pages' records say: the person who is sent the report is told the reason, not only that there's
// none. Each page's reason is also on its section of the voice page, but a report with no
// recording at all has no voice page to say it.
describe("what the details say when no page has a recording, and a run gave reasons", () => {
  const SILENT = "the recording is silent";
  const ENDED = "NVDA's process ended during the recording";
  const GONE =
    "the recorder didn't start: PowerShell couldn't compile its C#: Add-Type isn't allowed";

  /** The sentence the details say for `why`: the words of the plan, with the reason in them. */
  const saying = (why: string): string =>
    `There is no voice page: no page has a recording. The latest run gave this reason: ${why}.`;

  /** What the details of a model say, as one paragraph's text. */
  const detailsSaid = (model: ShareModel): string => lineText(voiceDetails(model) ?? []);

  it("is the reason the pages gave, in the details' own words", () => {
    const { model } = modelOf([
      runOf([
        read("/", reason(GONE)),
        read("/about/", reason(GONE)),
        read("/apply/", reason(GONE)),
      ]),
    ]);

    expect(VOICE_TEXT.details.noRecordingBecause(GONE)).toBe(saying(GONE));
    expect(model.voicePage).toEqual({ why: saying(GONE) });
    expect(detailsSaid(model)).toBe(`${VOICE_TEXT.details.lead} ${saying(GONE)}`);
    // The link is gone with the page: there's no voice page to open.
    expect(voiceDetails(model)).not.toContainEqual(
      expect.objectContaining({ href: expect.anything() as unknown }),
    );
  });

  it("names the most common reason when the pages gave different ones, and the first page's on a tie", () => {
    const common = modelOf([
      runOf([
        read("/", reason(SILENT)),
        read("/about/", reason(ENDED)),
        read("/apply/", reason(ENDED)),
      ]),
    ]).model;
    expect(common.voicePage).toEqual({ why: saying(ENDED) });

    const tied = modelOf([
      runOf([read("/", reason(ENDED)), read("/about/", reason(SILENT))]),
    ]).model;
    expect(tied.voicePage).toEqual({ why: saying(ENDED) });
  });

  it("counts a reason once however it was written: on one line, with no full stop at its end", () => {
    const { model } = modelOf([
      runOf([
        read("/", reason(`${SILENT}.`)),
        read("/about/", reason(`  ${SILENT}  `)),
        read("/apply/", reason(ENDED)),
      ]),
    ]);
    expect(model.voicePage).toEqual({ why: saying(SILENT) });
    // It ends in one full stop, after the reason, and none before it.
    expect(detailsSaid(model)).toMatch(/this reason: the recording is silent\.$/);
  });

  it("has the home folder replaced in the reason, as it does in every other reason it says", () => {
    const home = os.homedir();
    const { model } = modelOf([
      runOf([read("/", reason(`process 4242 runs ${join(home, "nvda.exe")}, not another`))]),
    ]);
    expect(model.voicePage).not.toBeNull();
    expect(JSON.stringify(model.voicePage)).not.toContain(home.replaceAll("\\", "\\\\"));
    expect(detailsSaid(model)).not.toContain(home);
    // Only the folder is replaced: its program's name, and what comes after it, are as they were.
    expect(detailsSaid(model)).toMatch(/ runs (?:%USERPROFILE%|~)[\\/]nvda\.exe, not another\.$/);
  });

  it("is today's words when the latest run's pages gave no reason: a driver that records none, a page not read", () => {
    for (const pages of [
      [read("/"), read("/about/")],
      [{ path: "/", status: "skipped" as const }, read("/about/")],
    ]) {
      const { model } = modelOf([runOf(pages)]);
      expect(model.voicePage, JSON.stringify(pages)).toEqual({
        why: VOICE_TEXT.details.noRecording,
      });
    }
    expect(VOICE_TEXT.details.noRecording).toBe(
      "There is no voice page, since no page has a recording to play.",
    );
  });

  it("is today's words for a run from before 0.18.0, whatever an older or newer run said", () => {
    // The latest run (the list) is from 0.17.0 and records nothing; a spot check after it, which is
    // from 0.18.0, has a reason for its one page. The latest run is the one the sentence is of.
    const list = runOf([read("/"), read("/about/")], "0.17.0", "2026-09-28_0900");
    const spot = runOf([read("/about/", reason(GONE))], KEEPS_VOICE_FROM, "2026-09-29_1402");
    const spotRun = shareRun({
      id: "2026-09-29_1402",
      createdAt: "2026-09-29T14:02:51-05:00",
      voicecapVersion: KEEPS_VOICE_FROM,
      source: { kind: "urls", urls: ["https://example.illinois.gov/about/"] },
      pages: [read("/about/", reason(GONE))],
    });
    expect(spot.id).toBe(spotRun.id);

    const { model } = modelOf([list, spotRun]);
    expect(model.voicePage).toEqual({ why: VOICE_TEXT.details.noRecording });
    // And a report that draws on no run that records says nothing, as before, reasons or not.
    const old = runOf([read("/", reason(GONE))], "0.17.0");
    expect(modelOf([old]).model.voicePage).toBeNull();
  });

  it("gives no reason when a page has a recording to play, nor for the live copy", () => {
    const { model } = modelOf([runOf([read("/", speech.record), read("/about/", reason(GONE))])]);
    expect(model.voicePage).toEqual({ name: VOICE_PAGE });

    const live = modelOf([runOf([read("/", reason(GONE))])], { voiceName: null }).model;
    expect(live.voicePage).toEqual({ why: VOICE_TEXT.details.liveCopy });
  });
});
