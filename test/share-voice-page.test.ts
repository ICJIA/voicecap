/**
 * The voice page (src/share/voice-page.ts): the companion of the shareable page that plays what NVDA
 * said aloud on each page, from the recordings a run keeps. Here it's made from models built in
 * memory, with real WebM Opus files (the encoder's own, of sounds from test/helpers/voice-signal.ts),
 * and read as text; test/share-browser.test.ts opens it in Chromium. Nothing here plays a sound.
 */
import vm from "node:vm";

import { beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { VOICE_FILE, type RunJson, type VoiceRecord } from "../src/model.js";
import { esc } from "../src/report/html.js";
import { UNFINISHED_ATTEMPT } from "../src/run/page-runner.js";
import { CHECK_LIBRARY, CHECK_SCRIPT, type CheckData } from "../src/share/check.js";
import { sizeLine } from "../src/share/format.js";
import { cardAnchor, transcriptAnchor, voiceAnchor } from "../src/share/anchors.js";
import { SHARE_SCRIPT } from "../src/share/html/client.js";
import { renderSharePage } from "../src/share/html/document.js";
import { lineText, type Line } from "../src/share/line.js";
import { SHARE_CSS, VOICE_CSS } from "../src/share/html/style.js";
import { loadShareInput } from "../src/share/load.js";
import { buildShareModel, type ShareModel } from "../src/share/model.js";
import { KEEPS_VOICE_FROM, keepsVoice } from "../src/share/run-evidence.js";
import { cardRecord, standingOf } from "../src/share/standing.js";
import { EVIDENCE_TEXT, VOICE_TEXT } from "../src/share/text.js";
import { renderVoicePage, SPEED_TOKEN, VOICE_SCRIPT } from "../src/share/voice-page.js";
import { STRETCH_LIBRARY } from "../src/share/voice-stretch.js";
import { shareRun, type SharePageSpec } from "./helpers/share-data.js";
import { attributes, decode, textOf } from "./helpers/share-html.js";
import {
  DEMO_SITE,
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

/** Three recordings that differ: two seconds, three and a half seconds with 250 ms lost, and another. */
let speech: Recorded;
let busy: Recorded;
let other: Recorded;

beforeAll(async () => {
  speech = await recordedVoice(speechAndPauses());
  busy = await recordedVoice(busySound(3.4, 7), 250);
  other = await recordedVoice(busySound(3.4, 8));
});

const RUN = "2026-09-29_1402";

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

/** The model of some runs, with every transcript readable. */
const modelOf = (runs: RunJson[]): ShareModel =>
  buildShareModel(inputOf(runs, { transcripts: storeOf() }));

/**
 * One run of voicecap 0.18.0, begun on 29 September 2026 at 14:02, of four pages: Home and /about/
 * have a recording (the second lost 250 ms), /apply/ has the reason it has none, and a file the
 * run skipped has no record of a recording at all.
 */
function recordedRun(): RunJson {
  return shareRun({
    id: RUN,
    createdAt: "2026-09-29T14:02:51-05:00",
    voicecapVersion: "0.18.0",
    sessions: [{ reviewer: "Pat Lee" }],
    pages: [
      read("/", speech.record, { label: "Home" }),
      read("/about/", busy.record),
      read("/apply/", reason("the recording is silent")),
      { path: "/report.pdf", status: "skipped" },
    ],
  });
}

/** The fonts the page is given: none, as most of these tests read it as text. */
const NO_FONTS = { fontCss: "" };

/** The page of a model, which must be made. */
function pageOf(model: ShareModel, recordings: ReadonlyMap<string, Uint8Array>): string {
  const html = renderVoicePage(model, recordings, NO_FONTS);
  if (html === null) throw new Error("No voice page was made.");
  return html;
}

/** The page of the recorded run, made once. */
let recorded: { run: RunJson; model: ShareModel; html: string };

beforeAll(() => {
  const run = recordedRun();
  const model = modelOf([run]);
  recorded = { run, model, html: pageOf(model, recordingsOf([run])) };
});

/** A page's sections: each card's id, as its markup. */
function sectionsOf(html: string): { id: string; markup: string }[] {
  return [
    ...html.matchAll(/<article class="card voice-card" id="([^"]*)">([\s\S]*?)<\/article>/g),
  ].map(([, id = "", markup = ""]) => ({ id, markup }));
}

/**
 * A section without what it says of its page's screenshot, when it has none (the line the shareable
 * page's card has, in its group): so that the section's first line not recorded is its recording's.
 */
function withoutScreenshot(markup: string): string {
  return markup.replace(
    /<div role="group" aria-label="[^"]*"><p class="not-recorded">[\s\S]*?<\/p><\/div>/,
    "",
  );
}

/** The section of the page with the id of `slug`. */
function sectionOf(html: string, slug: string): string {
  const found = sectionsOf(html).find(({ id }) => id === voiceAnchor(slug));
  if (found === undefined) throw new Error(`The page has no section for ${slug}.`);
  return found.markup;
}

/** The opening tag of a section's player. */
const playerOf = (markup: string): string => /<audio\b[^>]*>/.exec(markup)?.[0] ?? "";

/** The text of each fact a section lists, in order. */
const factsOf = (markup: string): string[] =>
  [...markup.matchAll(/<li>(.*?)<\/li>/gs)].map(([, item = ""]) => textOf(item));

/** The page's data for its check, as JSON. */
function dataOf(html: string): CheckData {
  const json = /<script type="application\/json" id="fp-data">([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (json === undefined) throw new Error("The page has no data for its check.");
  return JSON.parse(json) as CheckData;
}

// The check's library as a browser gets it, with nothing but TextEncoder from outside.
const library = vm.runInNewContext(CHECK_LIBRARY + ";({ sha256Hex, checkAll })", {
  TextEncoder,
}) as {
  sha256Hex: (bytes: Uint8Array) => string;
  checkAll: (
    data: CheckData,
    digest?: (bytes: Uint8Array) => string,
    shown?: undefined,
    pictures?: undefined,
    axeShown?: undefined,
    sounds?: (item: { slug: string }) => Uint8Array[],
  ) => Promise<{ recordings: { label: string; ok: boolean }[]; line: string }>;
};

/** The page markup without what its style and script elements hold. */
function markupOf(html: string): string {
  return html
    .replace(/(<style>)[\s\S]*?(<\/style>)/g, "$1$2")
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/g, "$1$2");
}

/** The audio of each section as bytes, by the page's slug: the base64 in each player's address. */
function soundsOf(html: string): Map<string, Uint8Array> {
  return new Map(
    sectionsOf(html).flatMap(({ markup }): [string, Uint8Array][] => {
      const player = playerOf(markup);
      const [slug] = attributes(player, "data-slug");
      const [address] = attributes(player, "src");
      return slug === undefined || address === undefined
        ? []
        : [
            [
              slug,
              new Uint8Array(
                Buffer.from(address.replace(/^data:audio\/webm;base64,/, ""), "base64"),
              ),
            ],
          ];
    }),
  );
}

describe("renderVoicePage", () => {
  it("leads with the site's name and the report's date, and has one section a page, in the shareable page's order", () => {
    const { html, model } = recorded;

    // The tab, and the page's own words: the site's name, then when it was tested.
    expect(decode(/<title>(.*?)<\/title>/.exec(html)?.[1] ?? "")).toBe(
      "NVDA's voice: example.illinois.gov, 29 September 2026, 14:02",
    );
    expect(model.header.name).toBe("example.illinois.gov");
    const head = /<header class="mast">([\s\S]*?)<\/header>/.exec(html)?.[1] ?? "";
    expect(textOf(/<h1>(.*?)<\/h1>/.exec(head)?.[1] ?? "")).toBe("example.illinois.gov");
    expect(head.indexOf("<h1>")).toBeLessThan(head.indexOf("Tested 29 September 2026, 14:02"));
    expect(textOf(head)).toContain("NVDA's voice");
    // It leads with a name and a date, never an address: no address in its top, and none in what a
    // reader sees of the page (its data holds the runs' records as they were sealed, with the
    // address they read).
    expect(textOf(head)).not.toMatch(/https?:\/\//);
    expect(markupOf(html)).not.toContain(model.header.site);
    expect(html).not.toContain("Site address");

    // One section a page, in the order of the shareable page's cards, each numbered as its card is.
    const sections = sectionsOf(html);
    expect(sections.map(({ id }) => id)).toEqual(model.pages.map(({ slug }) => voiceAnchor(slug)));
    expect(model.pages.map(({ path }) => path)).toEqual(["/", "/about/", "/apply/", "/report.pdf"]);
    expect(
      sections.map(({ markup }) => /<h3><span class="num">(\d+)<\/span>/.exec(markup)?.[1]),
    ).toEqual(["1", "2", "3", "4"]);
    // A page with a label is named by it, with its address on the site beside it.
    expect(textOf(/<h3>(.*?)<\/h3>/.exec(sections[0]?.markup ?? "")?.[1] ?? "")).toBe("1 Home /");
    expect(textOf(/<h3>(.*?)<\/h3>/.exec(sections[1]?.markup ?? "")?.[1] ?? "")).toBe("2 /about/");
  });

  it("says what the plan fixes, in its words", () => {
    const { html } = recorded;
    const text = textOf(html.replace(/<(style|script)\b[\s\S]*?<\/\1>/g, ""));

    expect(VOICE_TEXT.title("dvfr.illinois.gov", "29 September 2026, 14:02")).toBe(
      "NVDA's voice: dvfr.illinois.gov, 29 September 2026, 14:02",
    );
    expect(VOICE_TEXT.lead).toBe(
      "What NVDA said aloud on each page while voicecap read it, recorded from NVDA alone and sealed with the run. NVDA spoke fast, so each recording starts at 0.3×: press play to hear it slowly, or choose another speed. voicecap's own stretcher slows it down in your browser, with the pitch kept and nothing sent anywhere. Beside each recording are its page's screenshot and transcripts, the record of what was reviewed, and as it plays, the line NVDA is saying is outlined in yellow.",
    );
    // Each pass's stretch starts with its title check, and between the passes the recording is
    // silenced (the NVDA driver's stretches, which the run keeps).
    expect(VOICE_TEXT.note).toBe(
      `Before each pass, voicecap has NVDA read the window's title, "voicecap check" and a code, to check NVDA is reading the right window. Between the passes, while a browser opens and comes to the front, the recording is silent: NVDA may read the window behind it then.`,
    );
    expect(VOICE_TEXT.speed.legend).toBe("Speed");
    expect(VOICE_TEXT.speed.rates.map((rate) => VOICE_TEXT.speed.label(rate))).toEqual([
      "1×",
      "0.75×",
      "0.5×",
      "0.3×",
    ]);
    // The lead is under the name, and the note once, before the first page's section.
    expect(text).toContain(VOICE_TEXT.lead);
    expect(text.split(VOICE_TEXT.note)).toHaveLength(2);
    expect(
      html.indexOf(VOICE_TEXT.note.replaceAll('"', "&quot;").replaceAll("'", "&#39;")),
    ).toBeLessThan(html.indexOf('<article class="card voice-card"'));
  });

  it("never calls voicecap automated, never says a person listened, and names no tool it's built on", () => {
    const words: string[] = [];
    const gather = (value: unknown): void => {
      if (typeof value === "string") words.push(value);
      else if (typeof value === "function") {
        for (const sample of [
          [1.5],
          [74],
          [3_725],
          [250],
          [1_250],
          [64_210],
          ["/about/"],
          ["x", "y"],
        ]) {
          try {
            gather((value as (...args: unknown[]) => unknown)(...sample));
          } catch {
            // A sample of the wrong kind for this function.
          }
        }
      } else if (Array.isArray(value)) value.forEach(gather);
      else if (typeof value === "object" && value !== null) Object.values(value).forEach(gather);
    };
    gather(VOICE_TEXT);
    const { html } = recorded;
    words.push(textOf(html.replace(/<(style|script)\b[\s\S]*?<\/\1>/g, "")));

    expect(words.length).toBeGreaterThan(20);
    for (const said of words) {
      expect(said).not.toMatch(/automat|listen|guidepup/i);
    }
  });

  it("carries each recording as a data: address in an audio element with preload none and a label naming its page", () => {
    const { html, run, model } = recorded;
    const recordings = recordingsOf([run]);
    const players = html.match(/<audio\b[^>]*>/g) ?? [];

    // Home and /about/ have one; the others say why they don't.
    expect(players).toHaveLength(2);
    expect(html.match(/<audio\b/g)).toHaveLength(2);
    const [slugHome = "", slugAbout = ""] = model.pages.map(({ slug }) => slug);
    for (const [tag, slug, name] of [
      [players[0] ?? "", slugHome, "NVDA's voice on /"],
      [players[1] ?? "", slugAbout, "NVDA's voice on /about/"],
    ] as const) {
      expect(tag).toMatch(/^<audio controls preload="none" /);
      expect(tag).not.toMatch(/autoplay|loop|muted/);
      const [address = ""] = attributes(tag, "src");
      expect(address).toMatch(/^data:audio\/webm;base64,[A-Za-z0-9+/]*={0,2}$/);
      const bytes = new Uint8Array(
        Buffer.from(address.replace(/^data:audio\/webm;base64,/, ""), "base64"),
      );
      expect(bytes).toEqual(recordings.get(`${RUN}/${slug}`));
      expect(attributes(tag, "aria-label").map(decode)).toEqual([name]);
      expect(attributes(tag, "data-slug")).toEqual([slug]);
      expect(attributes(tag, "data-file")).toEqual([VOICE_FILE]);
    }
    // Each is a different file: Home's is speech's, and /about/'s is busy's.
    expect(soundsOf(html).get(slugHome)).toEqual(speech.webm);
    expect(soundsOf(html).get(slugAbout)).toEqual(busy.webm);
    // The address is the only place the sound is: nothing is requested from anywhere.
    expect(markupOf(html).replace(/<audio\b[^>]*>/g, "<audio>")).not.toMatch(/\ssrc\s*=/i);
  });

  it("gives each page's length, lost time, size, and SHA-256, or its reason", () => {
    const { html, model } = recorded;
    const [home = "", about = "", apply = "", file = ""] = model.pages.map(({ slug }) =>
      sectionOf(html, slug),
    );

    // Home: two seconds, nothing lost (so nothing said of lost sound), and its file's fingerprint.
    expect(factsOf(home)).toEqual([
      "Length: 2 s",
      `${sizeLine(speech.record.bytes)}, SHA-256 ${speech.record.sha256}`,
    ]);
    expect(home).toContain(`<code>${speech.record.sha256}</code>`);
    // /about/: 3.4 seconds, 250 ms of it lost.
    expect(factsOf(about)).toEqual([
      "Length: 3 s",
      "250 ms of sound lost",
      `${sizeLine(busy.record.bytes)}, SHA-256 ${busy.record.sha256}`,
    ]);
    // A page with none gives its reason where the player would be, and no player or facts.
    for (const [markup, said] of [
      [apply, "Not recorded: the recording is silent."],
      [file, VOICE_TEXT.notRead],
    ] as const) {
      expect(markup).toContain(`<p class="not-recorded">${said.replace("'", "&#39;")}</p>`);
      expect(markup).not.toMatch(/<audio|<fieldset|<ul class="voice-facts"/);
    }
    expect(VOICE_TEXT.notRead).toBe(
      "Not recorded: no recording was made, since the page wasn't read.",
    );
  });

  it("gives a length as a reader says it, and sound lost in the unit that fits", () => {
    expect(VOICE_TEXT.length(0)).toBe("0 s");
    expect(VOICE_TEXT.length(0.3)).toBe("under 1 s");
    expect(VOICE_TEXT.length(45.4)).toBe("45 s");
    expect(VOICE_TEXT.length(59.6)).toBe("1 min");
    expect(VOICE_TEXT.length(60)).toBe("1 min");
    expect(VOICE_TEXT.length(134)).toBe("2 min 14 s");
    expect(VOICE_TEXT.length(120)).toBe("2 min");
    expect(VOICE_TEXT.length(3_725)).toBe("1 h 2 min 5 s");
    expect(VOICE_TEXT.length(7_200)).toBe("2 h");
    expect(VOICE_TEXT.lost(1)).toBe("1 ms of sound lost");
    expect(VOICE_TEXT.lost(250)).toBe("250 ms of sound lost");
    expect(VOICE_TEXT.lost(999)).toBe("999 ms of sound lost");
    expect(VOICE_TEXT.lost(1_250)).toBe("1.3 s of sound lost");
    expect(VOICE_TEXT.lost(64_210)).toBe("64.2 s of sound lost");
  });

  it("is null when no page has a recording", () => {
    const none = modelOf([
      shareRun({ id: RUN, voicecapVersion: "0.18.0", pages: [read("/"), read("/about/")] }),
    ]);
    expect(renderVoicePage(none, new Map(), NO_FONTS)).toBeNull();

    // Reasons alone make no page: a run whose pages all have the reason they have none.
    const reasons = modelOf([
      shareRun({
        id: RUN,
        voicecapVersion: "0.18.0",
        pages: [read("/", reason("the recording is silent")), read("/about/")],
      }),
    ]);
    expect(renderVoicePage(reasons, new Map(), NO_FONTS)).toBeNull();

    // A record of a file the loader doesn't hold (it's missing, or isn't as the run recorded it)
    // shows no player, so with no other, there's no page.
    const missing = modelOf([
      shareRun({ id: RUN, voicecapVersion: "0.18.0", pages: [read("/", speech.record)] }),
    ]);
    expect(renderVoicePage(missing, new Map(), NO_FONTS)).toBeNull();

    // No run counts: no page to give.
    const replayed = modelOf([shareRun({ id: RUN, replayed: true, pages: [read("/")] })]);
    expect(renderVoicePage(replayed, new Map(), NO_FONTS)).toBeNull();
  });

  it("keeps the shareable page's rules: one style block, one runnable script, one data block, and no style attribute", () => {
    const { html } = recorded;
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    const withoutSound = html.replace(
      /data:audio\/webm;base64,[A-Za-z0-9+/=]+/g,
      "data:audio/webm;base64,",
    );

    expect(html.match(/<style\b/g)).toHaveLength(1);
    expect(withoutSound).not.toMatch(/style\s*=/i);
    expect(scripts.filter((tag) => tag === "<script>")).toHaveLength(1);
    expect(scripts.filter((tag) => tag !== "<script>")).toEqual([
      '<script type="application/json" id="fp-data">',
    ]);
    // Nothing loaded from outside: no linked file, no import, no source but a recording's own
    // address in an audio element and a screenshot's in an image, and every url() the page's own
    // data.
    const markup = markupOf(html);
    expect(markup).not.toMatch(/<link\b|<iframe\b|<video\b|<source\b|<track\b/i);
    for (const source of attributes(markup, "src")) expect(source).toMatch(/^data:/);
    expect(html).not.toMatch(/@import/i);
    for (const [, address = ""] of html.matchAll(/url\(\s*["']?([^"')]*)/g)) {
      expect(address).toMatch(/^data:/);
    }
    // The only links go to the page's own parts, to voicecap's page, and to the shareable page beside
    // it, from the footer: a page's transcripts are beside its recording, so nothing a person reads
    // along with takes them off the page while it plays.
    const page = recorded.model.footer.fileName;
    expect(
      attributes(markup, "href")
        .map(decode)
        .filter((href) => !href.startsWith("#")),
    ).toEqual(["https://github.com/ICJIA/voicecap", "https://github.com/ICJIA/voicecap", page]);
    // The page's one script is the page's, then the check's, then the speed choice's.
    expect(
      html.endsWith(
        `<script>${SHARE_SCRIPT}${CHECK_SCRIPT}${VOICE_SCRIPT}</script>\n</body>\n</html>\n`,
      ),
    ).toBe(true);
    expect(html.match(/<main id="main">/g)).toHaveLength(1);
    expect(html).toMatch(/^<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n/);
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    // Names are unique, and every link to a part of the page goes to one.
    const ids = attributes(markup, "id");
    expect(new Set(ids).size).toBe(ids.length);
    for (const href of attributes(markup, "href").filter((each) => each.startsWith("#"))) {
      expect(ids).toContain(href.slice(1));
    }
  });

  it("puts the fonts, then the shareable page's styles, then the player's few rules in its one style block", () => {
    const fontCss = '@font-face { font-family: "X"; src: url(data:font/woff2;base64,AAAA); }';
    const html = renderVoicePage(recorded.model, recordingsOf([recorded.run]), { fontCss });
    const style = /<style>([\s\S]*?)<\/style>/.exec(html ?? "")?.[1] ?? "";

    expect(style.indexOf(fontCss)).toBeGreaterThan(-1);
    expect(style.indexOf(fontCss)).toBeLessThan(style.indexOf(SHARE_CSS));
    expect(style.indexOf(SHARE_CSS)).toBeLessThan(style.indexOf(VOICE_CSS));
    expect(style.replace(fontCss, "").replace(SHARE_CSS, "").replace(VOICE_CSS, "").trim()).toBe(
      "",
    );
    // Given no fonts (""), the page is made the same, with none in it.
    expect(recorded.html).not.toContain("@font-face");
    // The shareable page's own style is as it was: the player's rules are the voice page's alone.
    expect(SHARE_CSS).not.toContain(".speeds");
    expect(VOICE_CSS).toContain(".speeds");
  });

  it("needs its fonts given, as the shareable page does, so a page that forgot them can't be written", () => {
    const { model, run } = recorded;
    // @ts-expect-error The fonts are required: leaving them out doesn't compile.
    const forgotten = () => renderVoicePage(model, recordingsOf([run]));

    // Nor does it make a page in the reader's own fonts, silently, when it's called without them.
    expect(forgotten).toThrow(TypeError);
  });

  it("offers each player's speeds as a group that starts hidden, which the script shows", () => {
    const { html, model } = recorded;
    const home = sectionOf(html, model.pages[0]?.slug ?? "");
    const group = /<fieldset\b[^>]*>[\s\S]*?<\/fieldset>/.exec(home)?.[0] ?? "";

    expect(group).toMatch(/^<fieldset class="speeds" hidden[ >]/);
    expect(textOf(/<legend>(.*?)<\/legend>/.exec(group)?.[1] ?? "")).toBe("Speed on /");
    expect(/<legend>Speed<span class="sr"> on \/<\/span><\/legend>/.test(group)).toBe(true);
    const radios = group.match(/<input\b[^>]*>/g) ?? [];
    expect(radios.map((tag) => attributes(tag, "value"))).toEqual([
      ["1"],
      ["0.75"],
      ["0.5"],
      ["0.3"],
    ]);
    expect(radios.every((tag) => tag.includes('type="radio"'))).toBe(true);
    // One group of them for the player: they share a name, which no other player's has.
    expect(new Set(radios.flatMap((tag) => attributes(tag, "name"))).size).toBe(1);
    // 0.3× chosen, so a person who presses play hears words they can follow; the group names it.
    expect(VOICE_TEXT.speed.start).toBe(0.3);
    expect(radios.map((tag) => tag.includes(" checked"))).toEqual([false, false, false, true]);
    expect(attributes(group, "data-start")).toEqual(["0.3"]);
    expect(
      [...group.matchAll(/<label>(.*?)<\/label>/gs)].map(([, label = ""]) => textOf(label)),
    ).toEqual(["1×", "0.75×", "0.5×", "0.3×"]);
    const names = (html.match(/<input\b[^>]*>/g) ?? []).flatMap((tag) => attributes(tag, "name"));
    expect(new Set(names).size).toBe(2);
    expect(names).toHaveLength(8);
  });

  it("gives each speed choice the words its script says, with the speed left to fill in", () => {
    const { html, model } = recorded;
    const groupOf = (index: number): string =>
      /<fieldset\b[^>]*>[\s\S]*?<\/fieldset>/.exec(
        sectionOf(html, model.pages[index]?.slug ?? ""),
      )?.[0] ?? "";
    const [home, about] = [groupOf(0), groupOf(1)];

    // The words are VOICE_TEXT's, and where a speed goes they hold the token the script fills in
    // with the speed's label ("0.3×"), since the markup is made before any speed is chosen.
    expect(SPEED_TOKEN).toBe("{speed}");
    expect(VOICE_TEXT.speed.making("0.3×")).toBe("Getting 0.3× ready…");
    expect(VOICE_TEXT.speed.made("0.3×")).toBe("0.3× is ready.");
    expect(VOICE_TEXT.speed.own).toBe("This browser slows it down with its own stretcher.");
    expect(VOICE_TEXT.slowed("/about/", "0.3×")).toBe("NVDA's voice on /about/, at 0.3×");

    // A section's fieldset carries the speed it starts at, then all four, after `hidden`, in this order, escaped as every value
    // is (the apostrophe in "NVDA's"), with its own page's address in the name of its slowed copy.
    expect(/^<fieldset\b[^>]*>/.exec(about)?.[0]).toBe(
      '<fieldset class="speeds" hidden data-start="0.3" data-making="Getting {speed} ready…" data-made="{speed} is ready." data-own="This browser slows it down with its own stretcher." data-slowed="NVDA&#39;s voice on /about/, at {speed}">',
    );
    for (const [group, path] of [
      [home, "/"],
      [about, "/about/"],
    ] as const) {
      expect(attributes(group, "data-making")).toEqual([esc(VOICE_TEXT.speed.making(SPEED_TOKEN))]);
      expect(attributes(group, "data-made")).toEqual([esc(VOICE_TEXT.speed.made(SPEED_TOKEN))]);
      expect(attributes(group, "data-own")).toEqual([esc(VOICE_TEXT.speed.own)]);
      expect(attributes(group, "data-slowed")).toEqual([esc(VOICE_TEXT.slowed(path, SPEED_TOKEN))]);
      // The status line is last, empty, and polite: the script writes in it, and says what it's
      // doing and when it's done.
      expect(group.endsWith('</div><p class="speed-status" role="status"></p></fieldset>')).toBe(
        true,
      );
      expect(group.match(/<p\b/g)).toHaveLength(1);
    }
  });

  it("names the run a page's recording is from when it isn't the latest, as its card does", () => {
    const earlier = shareRun({
      id: "2026-09-27_0900",
      createdAt: "2026-09-27T09:00:00-05:00",
      voicecapVersion: "0.18.0",
      pages: [read("/", speech.record), read("/old/", other.record)],
    });
    const latest = shareRun({
      id: RUN,
      createdAt: "2026-09-29T14:02:51-05:00",
      voicecapVersion: "0.18.0",
      pages: [read("/", busy.record), read("/old/", undefined, { status: "failed" })],
    });
    const model = modelOf([earlier, latest]);
    const html = pageOf(model, recordingsOf([earlier, latest]));
    const [home = "", old = ""] = model.pages.map(({ slug }) => sectionOf(html, slug));

    expect(textOf(home)).not.toContain("From run");
    expect(textOf(old)).toContain("From run 2026-09-27_0900, on 27 September 2026");
    // And it is that run's recording that's played: the card shows that run's transcripts.
    expect(soundsOf(html).get(model.pages[1]?.slug ?? "")).toEqual(other.webm);
    expect(soundsOf(html).get(model.pages[0]?.slug ?? "")).toEqual(busy.webm);
  });

  it("plays each page's recording from the run its card speaks for, a spot check after the list's run included", () => {
    // The list's run F recorded both pages. A spot check S, after it, read /a/ again: /a/'s card
    // shows S's transcripts, and /b/'s shows F's, so the recording of each is that run's.
    const list = shareRun({
      id: "2026-09-28_0900",
      createdAt: "2026-09-28T09:00:00-05:00",
      voicecapVersion: "0.18.0",
      pages: [read("/a/", speech.record), read("/b/", busy.record)],
    });
    const spot = shareRun({
      id: "2026-09-29_0900",
      createdAt: "2026-09-29T09:00:00-05:00",
      voicecapVersion: "0.18.0",
      source: { kind: "urls", urls: ["https://example.illinois.gov/a/"] },
      pages: [read("/a/", other.record)],
    });
    const model = modelOf([list, spot]);
    const html = pageOf(model, recordingsOf([list, spot]));
    const [a = "", b = ""] = model.pages.map(({ slug }) => slug);

    expect(model.pages.map(({ path }) => path)).toEqual(["/a/", "/b/"]);
    expect(soundsOf(html).get(a)).toEqual(other.webm);
    expect(soundsOf(html).get(b)).toEqual(busy.webm);
    expect(dataOf(html).recordings).toEqual([
      { run: "2026-09-29_0900", slug: a, name: VOICE_FILE },
      { run: "2026-09-28_0900", slug: b, name: VOICE_FILE },
    ]);
    // /a/ is from the spot check, as its card says; /b/ is from the list's run, which isn't said.
    expect(textOf(sectionOf(html, a))).toContain("From run 2026-09-29_0900, on 29 September 2026");
    expect(textOf(sectionOf(html, b))).not.toContain("From run");
  });

  describe("a page with no recording says why", () => {
    /**
     * Home, recorded by the latest run, with /old/, which the latest run failed and an earlier run
     * (of `version`, with `voice` on /old/) read.
     */
    function withEarlier(
      version: string,
      oldVoice?: VoiceRecord,
      others?: VoiceRecord,
      driver?: string,
    ): ShareModel {
      const earlier = shareRun({
        id: "2026-09-27_0900",
        createdAt: "2026-09-27T09:00:00-05:00",
        voicecapVersion: version,
        ...(driver === undefined ? {} : { driver }),
        pages: [read("/", others), read("/old/", oldVoice)],
      });
      const latest = shareRun({
        id: RUN,
        createdAt: "2026-09-29T14:02:51-05:00",
        voicecapVersion: "0.18.0",
        pages: [read("/", speech.record), read("/old/", undefined, { status: "failed" })],
      });
      return modelOf([earlier, latest]);
    }

    /** The paragraph of /old/'s section that says why. */
    function whyOf(model: ShareModel, recordings = new Map<string, Uint8Array>()): string {
      const all = new Map([...recordingsOf([]), ...recordings, ...soundsFor(model)]);
      const html = pageOf(model, all);
      const slug = model.pages.find(({ path }) => path === "/old/")?.slug ?? "";
      return textOf(
        /<p class="not-recorded">(.*?)<\/p>/.exec(withoutScreenshot(sectionOf(html, slug)))?.[1] ??
          "",
      );
    }

    /** Home's recording, which every model here needs one of, so that a page is made. */
    function soundsFor(model: ShareModel): Map<string, Uint8Array> {
      const slug = model.pages.find(({ path }) => path === "/")?.slug ?? "";
      return new Map([[`${RUN}/${slug}`, speech.webm]]);
    }

    it("says the run used a voicecap from before it recorded, by its version", () => {
      expect(whyOf(withEarlier("0.17.0"))).toBe("Not recorded: this run used voicecap 0.17.0.");
      expect(whyOf(withEarlier("0.16.2"))).toBe("Not recorded: this run used voicecap 0.16.2.");
    });

    it("says the page wasn't read when the run's driver is one that records, though no page of the run has a record", () => {
      // Every page of a run skipped, or answered with an HTTP error, has no record of a recording,
      // as an NVDA that read nothing recorded nothing: that's no driver that can't record.
      expect(whyOf(withEarlier("0.18.0"))).toBe(VOICE_TEXT.notRead);
      expect(whyOf(withEarlier("0.18.0", undefined, undefined, "guidepup"))).toBe(
        VOICE_TEXT.notRead,
      );
    });

    it("says its driver doesn't record only when the run's driver is one that doesn't", () => {
      // The replay driver opens nothing, and the AT Driver stub is a stub.
      for (const driver of ["replay", "at-driver"]) {
        expect(whyOf(withEarlier("0.18.0", undefined, undefined, driver)), driver).toBe(
          "Not recorded: this run's driver doesn't record NVDA's voice.",
        );
        // Whatever else the run has: a record that lists a recording is shown as it is.
        expect(whyOf(withEarlier("0.18.0", undefined, other.record, driver)), driver).toBe(
          "Not recorded: this run's driver doesn't record NVDA's voice.",
        );
      }
      expect(VOICE_TEXT.noDriver).toBe(
        "Not recorded: this run's driver doesn't record NVDA's voice.",
      );
    });

    it("goes by the run's other pages for a driver it doesn't know: one that recorded any recorded this", () => {
      expect(whyOf(withEarlier("0.18.0", undefined, other.record, "a-later-driver"))).toBe(
        VOICE_TEXT.notRead,
      );
      expect(whyOf(withEarlier("0.18.0", undefined, undefined, "a-later-driver"))).toBe(
        VOICE_TEXT.noDriver,
      );
    });

    it("says the page wasn't read, when the run's driver recorded other pages, whichever driver it is", () => {
      expect(whyOf(withEarlier("0.18.0", undefined, other.record))).toBe(VOICE_TEXT.notRead);
    });

    it("gives the recorder's reason, as the record has it, on one line with a full stop", () => {
      expect(whyOf(withEarlier("0.18.0", reason("NVDA's process wasn't found")))).toBe(
        "Not recorded: NVDA's process wasn't found.",
      );
      // A reason's own full stop is kept once, and its line breaks are one space.
      expect(
        whyOf(withEarlier("0.18.0", reason("The helper stopped.\n  \n it  answering. "))),
      ).toBe("Not recorded: The helper stopped. it answering.");
      // The record carries its reason with the home folder already replaced, as text.
      expect(
        whyOf(withEarlier("0.18.0", reason("couldn't make <home>\\AppData\\x.cs: <b>access</b>"))),
      ).toBe("Not recorded: couldn't make <home>\\AppData\\x.cs: <b>access</b>.");
      expect(whyOf(withEarlier("0.18.0", reason("")))).toBe(
        "Not recorded: the recording couldn't be made.",
      );
    });

    // A page no run read in full speaks for its latest failure, whose attempt read the page and
    // then failed: the run kept no recording of it, and recorded why, which the section says.
    it("says the attempt didn't finish, for a page whose latest record is a failure", () => {
      const latest = shareRun({
        id: RUN,
        createdAt: "2026-09-29T14:02:51-05:00",
        voicecapVersion: "0.18.0",
        pages: [
          read("/", speech.record),
          read("/old/", reason(UNFINISHED_ATTEMPT), { status: "failed" }),
        ],
      });
      const model = modelOf([latest]);
      // Its card speaks for the failure, the only record of it.
      const old = model.pages.find(({ path }) => path === "/old/");
      expect(old?.speaksFor).toEqual({ run: RUN, slug: old?.slug });
      expect(whyOf(model)).toBe(
        "Not recorded: the attempt didn't finish, and a recording is kept only of an attempt that did.",
      );
    });

    // The section says a reason word for word, so what the recorder gives is what the page says: it
    // names the program it was asked for voicecap's NVDA, since that program's path is in Guidepup's
    // folder, and Guidepup isn't named on the page.
    it("gives the reason for a target the helper refused as the recorder words it, with no Guidepup on the page", () => {
      const refused = String.raw`process 5353 runs C:\Windows\System32\notepad.exe, not voicecap's NVDA`;
      const textOfPage = (model: ShareModel): string =>
        textOf(
          pageOf(model, new Map([...recordingsOf([]), ...soundsFor(model)])).replace(
            /<(style|script)\b[\s\S]*?<\/\1>/g,
            "",
          ),
        );
      const model = withEarlier("0.18.0", reason(refused));

      expect(whyOf(model)).toBe(`Not recorded: ${refused}.`);
      expect(textOfPage(model)).not.toMatch(/guidepup/i);
      // The scan sees it when it's there: the path a refusal used to name is in Guidepup's folder.
      const path = String.raw`C:\Users\jane\AppData\Local\guidepup\nvda\all\0.2.1-2026.2\extracted\nvda.exe`;
      const named = withEarlier("0.18.0", reason(refused.replace("voicecap's NVDA", path)));
      expect(textOfPage(named)).toMatch(/guidepup/i);
    });

    it("says the file isn't as its run recorded it, when the loader holds none, and the run's record can't be read", () => {
      const model = withEarlier("0.18.0", other.record);
      expect(whyOf(model)).toBe(
        "Not shown: voice.webm isn't as the run recorded it; voicecap verify names it.",
      );
      const unreadable = withEarlier("0.18.0", "nonsense" as unknown as VoiceRecord);
      expect(whyOf(unreadable)).toBe(
        "Not shown: the run's record of this page's recording couldn't be read.",
      );
      expect(whyOf(withEarlier("0.18.0", null as unknown as VoiceRecord))).toBe(
        "Not shown: the run's record of this page's recording couldn't be read.",
      );
    });

    it("shows a recording whose record has no length or lost time to speak of, with the rest of its facts", () => {
      const earlier = shareRun({
        id: RUN,
        voicecapVersion: "0.18.0",
        pages: [
          read("/", { ...speech.record, seconds: "long", lostMs: -3 } as unknown as VoiceRecord),
          read("/about/", {
            ...busy.record,
            seconds: Number.NaN,
            lostMs: "x",
          } as unknown as VoiceRecord),
        ],
      });
      const model = modelOf([earlier]);
      const html = pageOf(model, recordingsOf([earlier]));

      for (const { markup } of sectionsOf(html)) {
        expect(factsOf(markup)).toHaveLength(1);
        expect(factsOf(markup)[0]).toContain("SHA-256 ");
        expect(textOf(markup.replace(/<audio\b[^>]*>/g, ""))).not.toMatch(/NaN|undefined|null/);
      }
    });
  });

  it("escapes what a record or a page name supplies", () => {
    const hostile = shareRun({
      id: RUN,
      voicecapVersion: "0.18.0",
      pages: [
        read("/", speech.record, {
          label: `<b>Home</b> & "x" </script><script>window.__pwned = 1</script>`,
        }),
        read("/second/", reason(`</script><script>window.__pwned = 1</script> <b>bold</b> & "q"`)),
        // A page with no label is named by its address, whose query can hold an ampersand.
        read("/search?q=a&b=c", busy.record),
      ],
    });
    const model = modelOf([hostile]);
    const html = pageOf(model, recordingsOf([hostile]));

    expect(html.match(/<script\b/g)).toHaveLength(2);
    expect(html).not.toContain("<b>Home</b>");
    expect(html).not.toContain("<b>bold</b>");
    expect(html).not.toContain("<script>window.__pwned");
    const home = sectionOf(html, model.pages[0]?.slug ?? "");
    expect(textOf(/<h3>(.*?)<\/h3>/.exec(home)?.[1] ?? "")).toContain(
      `<b>Home</b> & "x" </script><script>window.__pwned = 1</script>`,
    );
    const second = sectionOf(html, model.pages[1]?.slug ?? "");
    expect(
      textOf(/<p class="not-recorded">(.*?)<\/p>/.exec(withoutScreenshot(second))?.[1] ?? ""),
    ).toBe(`Not recorded: </script><script>window.__pwned = 1</script> <b>bold</b> & "q".`);
    // An address is text too: in the page's name, the player's label, its speeds' legend, and the
    // name its speed choice carries for a slowed copy.
    const search = sectionOf(html, model.pages[2]?.slug ?? "");
    expect(search).toContain('<h3><span class="num">3</span> /search?q=a&amp;b=c</h3>');
    expect(search).toContain('aria-label="NVDA&#39;s voice on /search?q=a&amp;b=c"');
    expect(search).toContain('<span class="sr"> on /search?q=a&amp;b=c</span>');
    expect(search).toContain('data-slowed="NVDA&#39;s voice on /search?q=a&amp;b=c, at {speed}"');
    expect(textOf(/<h3>(.*?)<\/h3>/.exec(search)?.[1] ?? "")).toBe("3 /search?q=a&b=c");
    // The check's data keeps it intact: nothing in it can end its block.
    const json = /<script type="application\/json" id="fp-data">([\s\S]*?)<\/script>/.exec(
      html,
    )?.[1];
    expect(json).not.toContain("<");
  });

  it("carries the check's data: each recording it plays, the transcripts and screenshots beside them, and the sealed record of each run they're from", async () => {
    const { html, run, model } = recorded;
    const data = dataOf(html);
    const [slugHome = "", slugAbout = ""] = model.pages.map(({ slug }) => slug);

    // The records exactly as recorded (a seal covers every field), of the one run that's drawn on.
    expect(data.runs).toEqual([run]);
    expect(data.recordings).toEqual([
      { run: RUN, slug: slugHome, name: VOICE_FILE },
      { run: RUN, slug: slugAbout, name: VOICE_FILE },
    ]);
    // The transcripts and screenshots it shows beside them are the shareable page's own, checked as
    // they are there; it shows no axe result.
    expect(data.files).toEqual(model.check.files);
    expect(data.files).toHaveLength(9);
    expect(data.screenshots).toEqual(model.check.screenshots);
    expect(data.axe).toEqual([]);
    expect(data.reviews).toBeNull();

    // The check finds each recording the page plays as its run recorded it, and the run's seal.
    // (The transcripts are checked as the shareable page's are; see shownTextsOf below.)
    const sounds = soundsOf(html);
    const checked = await library.checkAll(
      { ...data, files: [] },
      library.sha256Hex,
      undefined,
      undefined,
      undefined,
      (item) => [sounds.get(item.slug) ?? new Uint8Array(0)],
    );
    expect(checked.recordings.map(({ ok }) => ok)).toEqual([true, true]);
    expect(checked.recordings.map(({ label }) => label)).toEqual([
      "Run 1402 · / · voice.webm",
      "Run 1402 · /about/ · voice.webm",
    ]);
    expect(checked.line).toBe(
      "2 of 2 recordings match their fingerprints, and the run's seal checks out",
    );
  });

  it("carries only the runs its sections are from, each once, oldest first", () => {
    const earlier = shareRun({
      id: "2026-09-27_0900",
      createdAt: "2026-09-27T09:00:00-05:00",
      voicecapVersion: "0.18.0",
      pages: [read("/", speech.record), read("/old/", other.record)],
    });
    const latest = shareRun({
      id: RUN,
      createdAt: "2026-09-29T14:02:51-05:00",
      voicecapVersion: "0.18.0",
      pages: [read("/", busy.record), read("/old/", undefined, { status: "failed" })],
    });
    const model = modelOf([earlier, latest]);
    const data = dataOf(pageOf(model, recordingsOf([earlier, latest])));

    expect(data.runs.map(({ id }) => id)).toEqual(["2026-09-27_0900", RUN]);
    expect(data.recordings?.map(({ run }) => run)).toEqual([RUN, "2026-09-27_0900"]);

    // The run before the latest is one the model draws on, to say what changed since it. When no
    // page is from it, the voice page has nothing of it to hold to a seal, so it carries none of it.
    const before = shareRun({
      id: "2026-09-27_0900",
      createdAt: "2026-09-27T09:00:00-05:00",
      voicecapVersion: "0.18.0",
      pages: [read("/", speech.record), read("/about/", other.record)],
    });
    const after = shareRun({
      id: RUN,
      createdAt: "2026-09-29T14:02:51-05:00",
      voicecapVersion: "0.18.0",
      pages: [read("/", busy.record), read("/about/", speech.record)],
    });
    const drawn = modelOf([before, after]);
    expect(drawn.check.runs.map(({ id }) => id)).toEqual(["2026-09-27_0900", RUN]);
    const only = dataOf(pageOf(drawn, recordingsOf([before, after])));
    expect(only.runs.map(({ id }) => id)).toEqual([RUN]);
    expect(only.recordings?.map(({ run }) => run)).toEqual([RUN, RUN]);
  });

  it("names the shareable page it belongs to in its footer, and says when the voice page was made", () => {
    const { html, model } = recorded;
    const footer = /<footer>([\s\S]*?)<\/footer>/.exec(html)?.[1] ?? "";
    const words = textOf(footer, "");

    expect(words).toContain("voicecap is free, open-source software");
    expect(words).toContain("Generated on 30 September 2026 at 09:00");
    expect(words).toContain(
      `The shareable page: ${model.footer.fileName}. Its Word copy: ${model.footer.wordName}.`,
    );
  });

  it("gives the checks the shareable page has, with its own words on what they prove", () => {
    const { html } = recorded;
    const text = textOf(html.replace(/<(style|script)\b[\s\S]*?<\/\1>/g, ""));

    for (const id of [
      "fp-run",
      "fp-demo",
      "fp-result",
      "fp-list",
      "fp-count",
      "fp-rows",
      "fp-data",
    ]) {
      expect(html.match(new RegExp(`id="${id}"`, "g")), id).toHaveLength(1);
    }
    expect(html).toContain("Check the fingerprints</button>");
    expect(html).toContain("Show a change being caught</button>");
    expect(html).toMatch(/<button type="button" id="fp-run" class="fp-button" hidden>/);
    expect(html).toMatch(/<button type="button" id="fp-demo" class="fp-demo" hidden>/);
    expect(html).toContain(
      '<p class="fp-result fp-noscript">To check the fingerprints without scripts, use those two commands.</p>',
    );
    expect(text).toContain(
      "every recording, transcript, and screenshot on it is exactly the one its run's sealed record lists",
    );
    expect(text).toContain("npx @icjia/voicecap verify");
    // It claims nothing of what it doesn't show.
    expect(text).not.toMatch(/axe/i);
  });

  it("gives a heading for each section and for the check, one level under the name", () => {
    const { html } = recorded;
    const levels = [...html.matchAll(/<h([1-6])\b/g)].map(([, level]) => Number(level));

    expect(levels[0]).toBe(1);
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    // Every page's section is an h3, under the h2 that names them, each transcript beside it an h4
    // under it (read, headings, and Tab, for the three pages read in full), and the check is an h2.
    expect(levels).toEqual([1, 2, 3, 4, 4, 4, 3, 4, 4, 4, 3, 4, 4, 4, 3, 2]);
  });
});

// The voice page is audio alone, so its text alternative is on it (WCAG 1.2.1): each section shows
// its page's transcripts beside its recording, word for word, so a person can read along as it plays
// without leaving the page, and the footer links to the shareable page by name. The link is
// relative, so it works in the folder, in the two files of an email opened side by side, and on the
// website, where the two are published in one folder.
describe("the voice page's transcripts beside each recording", () => {
  /** The shareable page's name beside the voice page: the same stem, as a share names the pair. */
  const PAGE = VOICE_PAGE.replace(".voice.html", ".html");
  const WORD = VOICE_PAGE.replace(".voice.html", ".docx");

  /** The run's model as a share makes it: the pair named, and the voice page beside them. */
  function sharedModel(run: RunJson): ShareModel {
    return buildShareModel(
      inputOf([run], {
        transcripts: storeOf(),
        recordings: recordingsOf([run]),
        fileName: PAGE,
        wordName: WORD,
        voiceName: VOICE_PAGE,
      }),
    );
  }

  /** The transcripts a section shows: each `section.tx`'s file, and the text of its `<pre>`. */
  const shownTextsOf = (markup: string): { file: string; text: string }[] =>
    [
      ...markup.matchAll(
        /<section class="tx" data-run="[^"]*" data-slug="[^"]*" data-file="([^"]*)">[\s\S]*?<pre>([\s\S]*?)<\/pre>/g,
      ),
    ].map(([, file = "", pre = ""]) => ({
      file,
      text: decode(pre.replace(/<[^>]+>/g, "")).replace(/^\n/, ""),
    }));

  it("shows each page's transcripts beside its recording, word for word, in a box of their own named for the page", () => {
    const model = sharedModel(recorded.run);
    const voicePage = pageOf(model, recordingsOf([recorded.run]));
    const about = model.pages.find(({ path }) => path === "/about/");
    const section = sectionOf(voicePage, about?.slug ?? "");
    const entry = model.appendix.find(({ slug }) => slug === about?.slug);

    // What it plays, then what it says: the player is on the left, the transcripts on the right.
    expect(section.indexOf('<div class="listen-side">')).toBeLessThan(section.indexOf("<audio"));
    expect(section.indexOf("<audio")).toBeLessThan(section.indexOf('<div class="follow-side">'));
    expect(section).toContain(
      `<p class="follow-title">What NVDA said, word for word</p><div class="follow" tabindex="0" role="region" aria-label="What NVDA said on /about/">`,
    );
    // Each pass's transcript, as the shareable page's fold has it: the same files, word for word.
    expect(shownTextsOf(section)).toEqual(
      (entry?.files ?? []).map(({ name, text }) => ({ file: name, text })),
    );
    expect(shownTextsOf(section).map(({ file }) => file)).toEqual([
      "read.txt",
      "headings.txt",
      "tab.txt",
    ]);
    // No link takes a reader off the page to read them.
    expect(attributes(section, "href")).toEqual([]);
  });

  it("shows a page with no recording its transcripts too, since they are what it has", () => {
    const model = sharedModel(recorded.run);
    const voicePage = pageOf(model, recordingsOf([recorded.run]));
    const apply = model.pages.find(({ path }) => path === "/apply/");
    const section = sectionOf(voicePage, apply?.slug ?? "");

    // /apply/ was read in full, and has a reason in place of a player.
    expect(section).toContain("Not recorded: the recording is silent.");
    expect(shownTextsOf(section)).toHaveLength(3);
    // With no recording, there's nothing to outline.
    expect(section).not.toContain('class="ln"');
    expect(section).not.toContain(VOICE_TEXT.follow.outlined);
  });

  /**
   * A run of one page read in full whose recording keeps a stretch for each pass, as a run of
   * voicecap's real driver does: each begins with the window's check (3500 ms here), then the pass,
   * whose lines take 1200 ms each (the test store's steps): 4 lines read, 2 headings, 2 Tab stops.
   */
  function timedRun(
    stretches = [
      { startMs: 100, endMs: 100 + 3500 + 4 * 1200 },
      { startMs: 9000, endMs: 9000 + 3500 + 2 * 1200 },
      { startMs: 15500, endMs: 15500 + 3500 + 2 * 1200 },
    ],
  ): RunJson {
    const { record } = speech;
    return shareRun({
      id: RUN,
      createdAt: "2026-09-29T14:02:51-05:00",
      voicecapVersion: "0.18.0",
      pages: [read("/", { ...record, stretches })],
    });
  }

  /** Each line a section's transcripts mark with when it was spoken: its span, and its words. */
  const timedLines = (markup: string): [number, number, string][] =>
    [...markup.matchAll(/<span class="ln" data-from="(\d+)" data-to="(\d+)">([^<]*)<\/span>/g)].map(
      ([, from = "", to = "", words = ""]) => [Number(from), Number(to), decode(words)],
    );

  it("marks each line with when the recording says it: its pass's start, at its stretch's end less its length, and the line's span from the pass's start", () => {
    const run = timedRun();
    const model = sharedModel(run);
    const section = sectionOf(pageOf(model, recordingsOf([run])), model.pages[0]?.slug ?? "");

    // The read pass ends where its stretch ends (8400), 4800 ms after it began (3600); the headings
    // pass began at 14900 less 2400; the Tab pass at 21400 less 2400.
    expect(timedLines(section)).toEqual([
      [3600, 4800, LINES.read[0]],
      [4800, 6000, LINES.read[1]],
      [6000, 7200, LINES.read[2]],
      [7200, 8400, LINES.read[3]],
      [12500, 13700, LINES.headings[0]],
      [13700, 14900, LINES.headings[1]],
      [19000, 20200, LINES.tab[0]],
      [20200, 21400, LINES.tab[1]],
    ]);
    expect(section).toContain(`<p class="sub follow-note">${esc(VOICE_TEXT.follow.outlined)}</p>`);
    // The text is the transcript's, as the fingerprint check reads it: the spans add no words.
    expect(shownTextsOf(section).map(({ text }) => text)).toEqual(
      model.appendix[0]?.files.map(({ text }) => text),
    );
  });

  it("marks no line when the recording's stretches aren't one for each pass, or a pass would begin before its stretch", () => {
    for (const stretches of [
      // Two stretches for three passes: which is which can't be said.
      [
        { startMs: 100, endMs: 8400 },
        { startMs: 9000, endMs: 14900 },
      ],
      // The read pass is longer than its stretch: its start would be before the stretch's.
      [
        { startMs: 100, endMs: 3000 },
        { startMs: 9000, endMs: 14900 },
        { startMs: 15500, endMs: 21400 },
      ],
    ]) {
      const run = timedRun(stretches);
      const model = sharedModel(run);
      const section = sectionOf(pageOf(model, recordingsOf([run])), model.pages[0]?.slug ?? "");
      // No read line: the read pass would be the first stretch, before 9000.
      expect(
        timedLines(section).filter(([from]) => from < 9000),
        JSON.stringify(stretches),
      ).toEqual([]);
      // The transcripts are there all the same.
      expect(shownTextsOf(section)).toHaveLength(3);
    }
    // With two stretches, no line at all, and no word of an outline.
    const two = timedRun([
      { startMs: 100, endMs: 8400 },
      { startMs: 9000, endMs: 14900 },
    ]);
    const model = sharedModel(two);
    const section = sectionOf(pageOf(model, recordingsOf([two])), model.pages[0]?.slug ?? "");
    expect(timedLines(section)).toEqual([]);
    expect(section).not.toContain(VOICE_TEXT.follow.outlined);
  });

  it("has no transcripts for a page never read in full, and its recording alone", () => {
    const run = shareRun({
      id: RUN,
      createdAt: "2026-09-29T14:02:51-05:00",
      voicecapVersion: "0.18.0",
      pages: [read("/", speech.record), { path: "/broke/", status: "failed", voice: busy.record }],
    });
    const model = sharedModel(run);
    const voicePage = pageOf(model, recordingsOf([run]));
    const broke = model.pages.find(({ path }) => path === "/broke/");
    const section = sectionOf(voicePage, broke?.slug ?? "");

    expect(section).toContain("<audio");
    expect(section).not.toContain('class="follow-side"');
    expect(attributes(section, "href")).toEqual([]);
  });

  it("links the footer to the shareable page by its name, and names its Word copy as plain words", () => {
    const model = sharedModel(recorded.run);
    const voicePage = pageOf(model, recordingsOf([recorded.run]));
    const footer = /<footer>([\s\S]*?)<\/footer>/.exec(voicePage)?.[1] ?? "";

    expect(footer).toContain(
      `The shareable page: <a href="${PAGE}"><code>${PAGE}</code></a>. Its Word copy: <code>${WORD}</code>.`,
    );
    expect(attributes(footer, "href").map(decode)).toEqual([
      "https://github.com/ICJIA/voicecap",
      PAGE,
    ]);
    expect(textOf(footer, "")).toContain(`The shareable page: ${PAGE}. Its Word copy: ${WORD}.`);
  });

  it("keeps the voice page's rules: no style attribute, one style block, one script, no address in the links", () => {
    const model = sharedModel(recorded.run);
    const voicePage = pageOf(model, recordingsOf([recorded.run]));
    const markup = markupOf(voicePage);

    expect(markup).not.toMatch(/\sstyle\s*=/i);
    expect(voicePage.match(/<style\b/g)).toHaveLength(1);
    expect(voicePage.match(/<script>/g)).toHaveLength(1);
    // Every link out of the page is voicecap's, or to a file beside it, by name.
    for (const href of attributes(markup, "href").map(decode)) {
      expect(
        href.startsWith("#") ||
          href.startsWith("https://github.com/ICJIA/voicecap") ||
          href.startsWith(PAGE),
      ).toBe(true);
    }
    expect(markup).not.toMatch(/https?:\/\/(?!github\.com\/ICJIA\/voicecap)/);
  });

  it("names the parts of a page by the same ids the shareable page makes them with", () => {
    expect(transcriptAnchor("home")).toBe("tx-home");
    expect(transcriptAnchor("a b/c")).toBe("tx-a-b-c");
    expect(voiceAnchor("a b/c")).toBe("voice-a-b-c");
    expect(cardAnchor("a b/c")).toBe("pg-a-b-c");
    const model = sharedModel(recorded.run);
    const sharePage = renderSharePage(model, NO_FONTS);
    for (const card of model.pages) {
      expect(sharePage.includes(`id="${cardAnchor(card.slug)}"`), card.path).toBe(true);
    }
  });
});

describe("what the voice page says its check proves", () => {
  /** The words from where "What the check proves" says what it can't prove, to its end. */
  const tailOf = (line: Line): string => {
    const words = lineText(line);
    return words.slice(words.indexOf("It can't prove"));
  };

  it("says `voicecap share` prints the fingerprint with the other files it writes, since the email's line leaves the voice page out", () => {
    const text = textOf(/<p class="sub fp-limit">(.*?)<\/p>/s.exec(recorded.html)?.[1] ?? "");

    expect(text).toContain(
      "compare this file's own fingerprint with the one its sender recorded: voicecap share prints it with the other files it writes, and Get-FileHash <file> in PowerShell, or shasum -a 256 <file> on a Mac, shows it for the file you received. Or run npx @icjia/voicecap verify on the transcripts folder.",
    );
    // The email's line names the page and its Word copy only: it isn't what carries this file's.
    expect(text).not.toMatch(/email/i);
  });

  it("ends as the shareable page's does, with the one phrase about where `voicecap share` puts it", () => {
    const verify = "npx @icjia/voicecap verify";
    const page = tailOf(EVIDENCE_TEXT.proves(verify));
    const voice = tailOf(VOICE_TEXT.check.proves(verify));

    expect(page).toContain(
      "voicecap share prints it, ready for the email that sends the file, and ",
    );
    // The same words, from one place: but for that phrase, nothing differs.
    expect(voice).toBe(
      page.replace(
        "prints it, ready for the email that sends the file, and ",
        "prints it with the other files it writes, and ",
      ),
    );
    // And the pieces that are set apart (the three commands) are the same, in the same order.
    const commands = (line: Line) =>
      line.flatMap((piece) => (typeof piece !== "string" && piece.mono ? [piece.text] : []));
    expect(commands(VOICE_TEXT.check.proves(verify))).toEqual(
      commands(EVIDENCE_TEXT.proves(verify)).slice(0, 4),
    );
    expect(commands(VOICE_TEXT.check.proves(verify))).toEqual([
      "voicecap share",
      "Get-FileHash <file>",
      "shasum -a 256 <file>",
      verify,
    ]);
  });
});

describe("a section's markup", () => {
  it("lists what it says of a recording as a list a screen reader counts", () => {
    const { html, model } = recorded;
    const home = sectionOf(html, model.pages[0]?.slug ?? "");

    // A list with its markers taken away loses its list role in some screen readers (VoiceOver):
    // the role says it again, as the shareable page does for its other lists.
    expect(home).toMatch(/<ul class="voice-facts" role="list">/);
    expect(html.match(/<ul class="voice-facts"/g)).toHaveLength(2);
    expect(html.match(/<ul class="voice-facts" role="list">/g)).toHaveLength(2);
  });

  it("has the heading its card has on the shareable page: its number, and its label with its address, or its address", () => {
    const { model, html } = recorded;
    const sharePage = renderSharePage(model, NO_FONTS);
    const headingOf = (markup: string, id: string): string =>
      new RegExp(`<article class="card(?: voice-card)?" id="${id}">[\\s\\S]*?(<h3>.*?</h3>)`).exec(
        markup,
      )?.[1] ?? "";

    for (const card of model.pages) {
      const voice = headingOf(html, voiceAnchor(card.slug));
      expect(voice, card.path).toMatch(/^<h3><span class="num">\d+<\/span> /);
      expect(voice, card.path).toBe(headingOf(sharePage, cardAnchor(card.slug)));
    }
    // A labeled page (Home) has its label with its address beside it; the others, their address.
    expect(headingOf(html, voiceAnchor(model.pages[0]?.slug ?? ""))).toBe(
      '<h3><span class="num">1</span> Home <span class="sub">/</span></h3>',
    );
    expect(headingOf(html, voiceAnchor(model.pages[1]?.slug ?? ""))).toBe(
      '<h3><span class="num">2</span> /about/</h3>',
    );
  });

  it("says why a page that no run read has no recording, in the words that fit the run's voicecap", () => {
    // A page the run left pending: no record speaks for it, so there is no source for its section.
    const pending = (version: string) =>
      shareRun({
        id: RUN,
        createdAt: "2026-09-29T14:02:51-05:00",
        voicecapVersion: version,
        pages: [read("/", speech.record), { path: "/waiting/", status: "pending" }],
      });
    const whyOf = (version: string): string => {
      const run = pending(version);
      const model = modelOf([run]);
      const waiting = model.pages.find(({ path }) => path === "/waiting/");
      expect(waiting?.speaksFor, version).toBeNull();
      const html = pageOf(model, recordingsOf([run]));
      return textOf(
        /<p class="not-recorded">(.*?)<\/p>/.exec(
          withoutScreenshot(sectionOf(html, waiting?.slug ?? "")),
        )?.[1] ?? "",
      );
    };

    // From a voicecap that records, a page no one read wasn't recorded because it wasn't read.
    expect(whyOf("0.18.0")).toBe(VOICE_TEXT.notRead);
    // From one that didn't, it's that run's voicecap, as every other page of it says.
    expect(whyOf("0.17.0")).toBe("Not recorded: this run used voicecap 0.17.0.");
  });
});

describe("the runs a voice page carries for its check", () => {
  it("includes the latest run even when every section is from an older one, so its seal is checked", () => {
    // The latest run read no page in full, so each card shows the run before's transcripts and
    // recording. The page still says things of the latest run (when it was tested, and which run
    // each recording is from), so the check holds that run to its seal too.
    const earlier = shareRun({
      id: "2026-09-27_0900",
      createdAt: "2026-09-27T09:00:00-05:00",
      voicecapVersion: "0.18.0",
      pages: [read("/", speech.record), read("/about/", busy.record)],
    });
    const latest = shareRun({
      id: RUN,
      createdAt: "2026-09-29T14:02:51-05:00",
      voicecapVersion: "0.18.0",
      pages: [
        { path: "/", status: "failed" },
        { path: "/about/", status: "failed" },
      ],
    });
    const model = modelOf([earlier, latest]);
    const html = pageOf(model, recordingsOf([earlier, latest]));
    const data = dataOf(html);

    // Every section plays the earlier run's recording.
    expect(data.recordings?.map(({ run }) => run)).toEqual(["2026-09-27_0900", "2026-09-27_0900"]);
    // And both runs are carried, oldest first, each once.
    expect(data.runs.map(({ id }) => id)).toEqual(["2026-09-27_0900", RUN]);
    expect(data.runs[1]).toEqual(latest);
  });
});

describe("the voice page of the demo's runs", () => {
  it("plays each page's recording from the run its card speaks for, as the standing of every run has it", async () => {
    const input = await loadShareInput({ siteDir: DEMO_SITE, config: DEFAULT_CONFIG });
    // Every page a demo run read in full has a recording: run 1315's are one file, and run 1402's
    // another. The page /how-a-run-works/ failed in 1402, so its card shows 1315's transcripts.
    const withVoice = (run: RunJson): RunJson => {
      const kept =
        run.id === "2026-09-29_1315" ? other : run.id === "2026-09-29_1402" ? busy : null;
      if (kept === null) return run;
      const pages = run.pages.map((page) =>
        page.status === "done" ? { ...page, voice: kept.record } : page,
      );
      return { ...run, pages };
    };
    const runs = input.runs.map(withVoice);
    const records = input.records.map(withVoice);
    const model = buildShareModel({
      ...input,
      runs,
      records,
      generatedAt: "2026-09-30T09:00:00-05:00",
    });
    const html = pageOf(model, recordingsOf(records));

    // What the loader sees: the standing of every run the site has, and the record each card
    // speaks for, which is the run and page its recording is filed under.
    const wanted = standingOf(runs).pages.map((page) => {
      const source = cardRecord(page);
      if (source === null) throw new Error(`No record of ${page.key}.`);
      return { run: source.run.id, slug: source.page.slug, name: VOICE_FILE };
    });
    expect(wanted).toHaveLength(7);
    expect(dataOf(html).recordings).toEqual(wanted);
    expect(new Set(wanted.map(({ run }) => run))).toEqual(
      new Set(["2026-09-29_1315", "2026-09-29_1402"]),
    );
    // And what each section plays is that run's file.
    const sounds = soundsOf(html);
    for (const { run, slug } of wanted) {
      expect(sounds.get(slug), `${run}/${slug}`).toEqual(
        run === "2026-09-29_1315" ? other.webm : busy.webm,
      );
    }
    // The page of those that came from the older run says so, as its card does.
    expect(
      sectionsOf(html).filter(({ markup }) => textOf(markup).includes("From run 2026-09-29_1315")),
    ).toHaveLength(wanted.filter(({ run }) => run === "2026-09-29_1315").length);
    // The model draws on both runs, and so does this page: each is a source.
    expect(dataOf(html).runs.map(({ id }) => id)).toEqual(["2026-09-29_1315", "2026-09-29_1402"]);
  });
});

describe("the player's script and rules", () => {
  it("is plain browser JavaScript that can follow the check's script in the page's one script", () => {
    // The stretcher's library and the words' token are in it, inside the one function.
    expect(VOICE_SCRIPT).toContain(STRETCH_LIBRARY);
    expect(VOICE_SCRIPT).toContain(SPEED_TOKEN);
    expect(VOICE_SCRIPT.startsWith("\n(function () {\n")).toBe(true);
    expect(VOICE_SCRIPT.endsWith("})();\n")).toBe(true);
    // No tag, comment, or closing tag can begin in it (`<` is only ever an operator, as in a loop's
    // test), and it writes no markup: a player's address is set as a property, never an attribute.
    expect(VOICE_SCRIPT).not.toMatch(/<[a-z!/]/i);
    expect(VOICE_SCRIPT).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
    expect(VOICE_SCRIPT).not.toMatch(/\b(style|src|href)\s*=\s*["'`]/i);
    // Plain ES2017: no optional chaining, nullish coalescing, class, or import, which an older
    // browser can't read.
    expect(VOICE_SCRIPT).not.toMatch(/\?\.(?!\d)|\?\?|\bclass\b|\bimport\b/);
    // It parses, as the page's one script does, after the page's and the check's.
    expect(() => new vm.Script(SHARE_SCRIPT + CHECK_SCRIPT + VOICE_SCRIPT)).not.toThrow();
    // The stretcher and its finisher (the filter, the loudness match, and the WAV writer, which a
    // copy goes through in slices) are most of it; the limit was raised for the copies the page keeps
    // (a list it cuts back to four, and the check of which copies are in view, as those never go),
    // and again for the line it outlines as a recording plays; the style, for the transcripts beside
    // each recording.
    expect(VOICE_SCRIPT.length).toBeLessThan(24_000);
    expect(VOICE_CSS.length).toBeLessThan(3_500);
  });

  it("sets the pitch explicitly, and catches the error a browser throws for a speed it won't play at", () => {
    expect(VOICE_SCRIPT).toContain("preservesPitch = true");
    expect(VOICE_SCRIPT).toMatch(/try\s*\{[\s\S]*playbackRate = [\s\S]*catch/);
  });

  it("leaves a page without its markup alone", () => {
    const page = {
      getElementById: () => null,
      querySelectorAll: () => [],
    };
    const context = vm.createContext({ document: page });

    expect(() => {
      vm.runInContext(VOICE_SCRIPT, context);
    }).not.toThrow();
  });
});

describe("voiceAnchor", () => {
  it("is the section's id: the page's slug, made safe for an id, under a name of its own", () => {
    expect(voiceAnchor("home")).toBe("voice-home");
    expect(voiceAnchor("how-a-run-works-fd116f9328")).toBe("voice-how-a-run-works-fd116f9328");
    expect(voiceAnchor("a b/c.d")).toBe("voice-a-b-c-d");
  });
});

describe("keepsVoice", () => {
  it("is 0.18.0, the version that first records NVDA's voice", () => {
    expect(KEEPS_VOICE_FROM).toBe("0.18.0");
  });

  it.each([
    ["0.18.0", true],
    ["0.18.1", true],
    ["0.19.0", true],
    ["0.100.0", true],
    ["1.0.0", true],
    ["0.18.0-rc.1", true],
    ["0.17.0", false],
    ["0.17.99", false],
    ["0.9.0", false],
    ["0.0.1", false],
    ["0.18", false],
    ["unknown", false],
    ["", false],
    [null, false],
  ] as const)("says %j is %s", (version, keeps) => {
    expect(keepsVoice(version)).toBe(keeps);
  });
});
