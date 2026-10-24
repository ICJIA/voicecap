/**
 * A recording as a browser meets it: the WebM file in an <audio> element as a data: address, which
 * is how the voice page holds it, opened in Chromium (Playwright's, as the other browser tests
 * use). Nothing here plays a sound: the page never calls play(), and has no autoplay. The file is
 * loaded, measured, and sought in, and decoded to numbers.
 */
import type { Browser, BrowserContext, Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { encodeVoice } from "../src/voice/encode.js";
import { launchBrowser } from "./helpers/axe.js";
import { busySound, silence, speechAndPauses } from "./helpers/voice-signal.js";

let browser: Browser;
const contexts: BrowserContext[] = [];
/** What each page reported going wrong: errors thrown, and errors in its console. */
const reported: string[] = [];

beforeAll(async () => {
  browser = await launchBrowser();
});

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
  expect(reported.splice(0)).toEqual([]);
});

afterAll(async () => {
  await browser.close();
});

/** A page with an <audio> element, and nothing else. */
async function open(): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  page.on("pageerror", (error) => reported.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") reported.push(message.text());
  });
  await page.setContent(
    '<!doctype html><meta charset="utf-8"><title>voice</title><audio preload="auto"></audio>',
  );
  return page;
}

/** The file as an address, as the voice page holds it. */
const addressOf = (webm: Uint8Array): string =>
  `data:audio/webm;base64,${Buffer.from(webm).toString("base64")}`;

/** Gives the page's <audio> the file, and waits until the browser knows how long it is. */
function load(page: Page, webm: Uint8Array): Promise<number> {
  return page.evaluate(
    (address) =>
      new Promise<number>((resolve, reject) => {
        const audio = document.querySelector("audio");
        if (audio === null) return reject(new Error("The page has no <audio>."));
        setTimeout(() => reject(new Error("The browser didn't load the file in 10 s.")), 10_000);
        audio.addEventListener("loadedmetadata", () => resolve(audio.duration), { once: true });
        audio.addEventListener(
          "error",
          () => {
            const { code, message } = audio.error ?? { code: "?", message: "no message" };
            reject(new Error(`The browser couldn't load the file: code ${code}, ${message}`));
          },
          { once: true },
        );
        audio.src = address;
      }),
    addressOf(webm),
  );
}

/** Seeks to a time, and says whether `seeked` came, and where the browser says it is. */
function seek(page: Page, to: number): Promise<{ seeked: boolean; at: number }> {
  return page.evaluate(
    (time) =>
      new Promise<{ seeked: boolean; at: number }>((resolve, reject) => {
        const audio = document.querySelector("audio");
        if (audio === null) return reject(new Error("The page has no <audio>."));
        const timer = setTimeout(() => resolve({ seeked: false, at: audio.currentTime }), 10_000);
        audio.addEventListener(
          "seeked",
          () => {
            clearTimeout(timer);
            resolve({ seeked: true, at: audio.currentTime });
          },
          { once: true },
        );
        audio.currentTime = time;
      }),
    to,
  );
}

/**
 * What the browser's decoder makes of the file at 48 kHz, the rate Opus decodes to, so that nothing
 * is resampled: how many samples, and with `keep`, the samples themselves.
 */
function decoded(
  page: Page,
  webm: Uint8Array,
  keep = false,
): Promise<{ length: number; samples: number[] }> {
  return page.evaluate(
    async ({ address, keep }) => {
      const context = new OfflineAudioContext(1, 1, 48_000);
      const response = await fetch(address);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      const samples = keep ? Array.from(buffer.getChannelData(0)) : [];
      return { length: buffer.length, samples };
    },
    { address: addressOf(webm), keep },
  );
}

/** How well `decoded` follows `original` when it is `lag` samples later: 1 for the same shape. */
function correlation(original: readonly number[], decoded: readonly number[], lag: number): number {
  let both = 0;
  let originalEnergy = 0;
  let decodedEnergy = 0;
  for (let at = Math.max(0, -lag); at < Math.min(original.length, decoded.length - lag); at++) {
    const x = original[at] ?? 0;
    const y = decoded[at + lag] ?? 0;
    both += x * y;
    originalEnergy += x * x;
    decodedEnergy += y * y;
  }
  return both / Math.sqrt(originalEnergy * decodedEnergy);
}

describe("a recording in Chromium", () => {
  // 12.345 s: three clusters, and a last packet that is part padding. Made once, loaded in each.
  let recording: { webm: Uint8Array; seconds: number };

  beforeAll(async () => {
    recording = await encodeVoice(busySound(12.345));
  });

  it("has the duration of the sound, to within 10 ms", async () => {
    const page = await open();
    const duration = await load(page, recording.webm);
    expect(Math.abs(duration - recording.seconds)).toBeLessThan(0.01);
  });

  it("seeks to the middle, which fires seeked with the time there", async () => {
    const page = await open();
    await load(page, recording.webm);
    // The middle is 6.17 s, in the second cluster. This can't see the file's Cues: a browser that
    // never read them would seek here all the same, only by scanning. The muxer's tests check the
    // Cues' bytes, and this checks that a seek into a later cluster lands where it was asked.
    const middle = recording.seconds / 2;
    const { seeked, at } = await seek(page, middle);
    expect(seeked).toBe(true);
    expect(Math.abs(at - middle)).toBeLessThan(0.01);
  });

  it("can play WebM with Opus in it", async () => {
    const page = await open();
    const answer = await page.evaluate(() =>
      document.createElement("audio").canPlayType('audio/webm; codecs="opus"'),
    );
    expect(answer).not.toBe("");
  });

  /**
   * Sounds of a known length, for the tests that measure what the browser makes of one: busy sound of
   * these lengths in samples, and five seconds of silence, which DTX turns into packets of one byte
   * and a few of comfort noise, the packets a quiet page makes.
   */
  const sounds = (...lengths: number[]): { name: string; pcm: Int16Array }[] => [
    ...lengths.map((samples) => ({
      name: `${samples} samples of sound`,
      pcm: busySound(samples / 16_000),
    })),
    { name: "5 s of silence", pcm: silence(5) },
  ];

  // 8,000 samples are half a second, which is not a whole number of packets; 47,896 fill 50 packets
  // with nothing to spare, so the last block has no padding to discard.
  it.each(sounds(8_000, 47_896))("has the duration of a recording of $name", async ({ pcm }) => {
    const { webm, seconds } = await encodeVoice(pcm);
    const page = await open();
    const duration = await load(page, webm);
    expect(Math.abs(duration - seconds)).toBeLessThan(0.01);
  });

  it("seeks near the end, in the last cluster, to where it was asked", async () => {
    const page = await open();
    await load(page, recording.webm);
    const near = recording.seconds - 0.1;
    const { seeked, at } = await seek(page, near);
    expect(seeked).toBe(true);
    expect(Math.abs(at - near)).toBeLessThan(0.01);
  });

  // The browser drops the pre-skip from the start of what it decodes, and the padding from the
  // end, so it gives three samples at 48 kHz for each one of the 16 kHz sound, and no more.
  it.each(sounds(1, 855, 856, 8_000, 47_896, 197_520))(
    "decodes $name to exactly its length",
    async ({ pcm }) => {
      const { webm } = await encodeVoice(pcm);
      const page = await open();
      expect((await decoded(page, webm)).length).toBe(pcm.length * 3);
    },
  );

  it("decodes in step with the sound it was made from, to within a millisecond", async () => {
    const pcm = speechAndPauses();
    const { webm } = await encodeVoice(pcm);
    const page = await open();
    const { samples } = await decoded(page, webm, true);
    // The sound at 48 kHz, each sample held for three. A decoder at 48 kHz puts SILK speech a few
    // samples early, a third of a millisecond at most; with no pre-skip it would be 7 ms late.
    const sound = Array.from(pcm).flatMap((sample) => [sample, sample, sample]);
    const lags = Array.from({ length: 145 }, (_, index) => index - 72);
    const best = lags.reduce((a, b) =>
      correlation(sound, samples, b) > correlation(sound, samples, a) ? b : a,
    );
    expect(Math.abs(best)).toBeLessThanOrEqual(48);
    expect(correlation(sound, samples, best)).toBeGreaterThan(0.7);
  });
});
