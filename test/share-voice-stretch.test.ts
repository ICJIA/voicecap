/**
 * The voice page's stretcher (src/share/voice-stretch.ts): the library that slows a recording of
 * NVDA's voice, run here in node:vm the way a browser runs it: plain script, no imports, nothing
 * from outside. The sounds are made here, from sine waves and a few awkward signals, so no test
 * needs a recording or a browser.
 */
import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { STRETCH_LIBRARY } from "../src/share/voice-stretch.js";
import { VOICE_SAMPLE_RATE } from "../src/voice/encode.js";

interface Library {
  voiceStretcher: (
    signal: Float32Array,
    speed: number,
  ) => { next: (frames: number) => boolean; output: Float32Array | null };
  voiceFilter: (signal: Float32Array) => Float32Array;
  voiceRms: (signal: Float32Array) => number;
  voiceLevel: (signal: Float32Array, target: number) => Float32Array;
  voiceWav: (signal: Float32Array) => Uint8Array;
  VOICE_RATE: number;
}

// The library as a browser gets it, with nothing from outside.
const lib = vm.runInNewContext(
  STRETCH_LIBRARY +
    ";({ voiceStretcher, voiceFilter, voiceRms, voiceLevel, voiceWav, VOICE_RATE })",
  {},
) as Library;

/** The recordings' rate: 16,000 Hz, one channel. */
const R = 16_000;

/** The slower speeds the voice page offers. */
const SLOWED = [0.75, 0.5, 0.3];

/** A sine of `hz` lasting `seconds`, `amp` high. */
const tone = (hz: number, seconds: number, amp = 0.5): Float32Array =>
  Float32Array.from(
    { length: Math.round(seconds * R) },
    (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / R),
  );

/** `signal` slowed to `speed`, made `slice` frames at a time (all at once, by default). */
function stretch(signal: Float32Array, speed: number, slice = 1e9): Float32Array {
  const made = lib.voiceStretcher(signal, speed);
  while (!made.next(slice));
  if (made.output === null) throw new Error("The stretcher said it was done, and gave no copy.");
  return made.output;
}

/** The RMS of `signal`, worked out here, apart from the library's own. */
function rms(signal: Float32Array): number {
  let sum = 0;
  for (const x of signal) sum += x * x;
  return Math.sqrt(sum / signal.length);
}

/** The size of the largest sample of `signal`, up or down. */
const peakOf = (signal: Float32Array): number =>
  signal.reduce((most, x) => Math.max(most, Math.abs(x)), 0);

/** The middle second of `signal`, where a copy is steady. */
function middleSecond(signal: Float32Array): Float32Array {
  const from = Math.floor((signal.length - R) / 2);
  return signal.subarray(from, from + R);
}

/** How many cycles a tone makes in `signal`: its sign changes, halved. */
function cyclesIn(signal: Float32Array): number {
  let changes = 0;
  let negative = (signal[0] ?? 0) < 0;
  for (const x of signal) {
    if (x < 0 !== negative) {
      changes++;
      negative = x < 0;
    }
  }
  return changes / 2;
}

/** Whether every sample of `signal` is exactly 0. */
const allZero = (signal: Float32Array): boolean => signal.every((x) => x === 0);

/** A whole number as `bytes` bytes, least significant first, as a WAV file writes it. */
const littleEndian = (value: number, bytes: number): number[] =>
  Array.from({ length: bytes }, (_, i) => (value >> (8 * i)) & 255);

/** The bytes of some ASCII text. */
const ascii = (text: string): number[] => Array.from(text, (letter) => letter.charCodeAt(0));

describe("voicecap's own stretcher", () => {
  it("makes a copy exactly ⌊length ÷ speed⌋ samples long", () => {
    // Two lengths, so that rounding to the nearest instead of down is caught: at 3 s and 7 samples
    // the length ÷ speed ends in a third, or in nothing, and at 3 s and 8, in two thirds, or in
    // nothing.
    for (const extra of [7, 8]) {
      const signal = tone(220, 3 + extra / R);
      expect(signal.length).toBe(3 * R + extra);

      for (const speed of SLOWED) {
        expect(stretch(signal, speed).length, `${signal.length} samples at ${speed}`).toBe(
          Math.floor(signal.length / speed),
        );
      }
    }
  });

  it("keeps a tone's pitch", () => {
    for (const speed of SLOWED) {
      const cycles = cyclesIn(middleSecond(stretch(tone(220, 2), speed)));

      expect(Math.abs(cycles - 220), `${cycles} cycles at ${speed}`).toBeLessThanOrEqual(2);
    }
  });

  it("keeps a tone's loudness, dividing the frames by their squared windows", () => {
    // Left undivided, four frames over each sample would make a copy half as loud again.
    const input = tone(220, 2);
    for (const speed of SLOWED) {
      const ratio = rms(middleSecond(stretch(input, speed))) / rms(input);

      expect(Math.abs(ratio - 1), `${ratio} times as loud at ${speed}`).toBeLessThan(0.05);
    }
  });

  it("gives the same samples made in slices as made at once", () => {
    // Two tones, so each frame has more than one peak to carry on.
    const signal = Float32Array.from(
      tone(220, 1.5),
      (x, i) => x + 0.2 * Math.sin((2 * Math.PI * 1_430 * i) / R),
    );

    const once = stretch(signal, 0.3);
    const sliced = stretch(signal, 0.3, 7);

    expect(sliced.length).toBe(once.length);
    expect(sliced.findIndex((x, i) => x !== once[i])).toBe(-1);

    // And a slice is a slice: one frame is a small part of the copy, which isn't there yet.
    const made = lib.voiceStretcher(signal, 0.3);
    expect(made.next(1)).toBe(false);
    expect(made.output === null).toBe(true);
  });

  it("keeps silence silent, and every sample a finite number", () => {
    const silence = new Float32Array(R);
    const signals: [string, Float32Array][] = [
      ["silence", silence],
      ["an impulse", Float32Array.from({ length: R }, (_, i) => (i === R / 2 ? 1 : 0))],
      [
        "a full-scale square wave",
        Float32Array.from({ length: R }, (_, i) => (i % 80 < 40 ? 1 : -1)),
      ],
      ["a constant 0.7", new Float32Array(R).fill(0.7)],
      // Too short for a frame: the copy is silent, and its length is still exact.
      ["100 samples of 0.3", new Float32Array(100).fill(0.3)],
    ];

    for (const speed of [0.3, 0.75]) {
      for (const [what, signal] of signals) {
        const made = lib.voiceFilter(stretch(signal, speed));

        expect(made.every(Number.isFinite), `${what} at ${speed}`).toBe(true);
        expect(made.length, `${what} at ${speed}`).toBe(Math.floor(signal.length / speed));
        if (signal === silence) expect(allZero(made), `${what} at ${speed}`).toBe(true);
      }
    }
  });
});

describe("the filter, the loudness match, and the WAV writer", () => {
  it("filters as the spec says", () => {
    // The gain at `hz` in dB: a 2 s tone's RMS out of the filter over its last second, against the
    // same going in.
    const gain = (hz: number): number => {
      const input = tone(hz, 2);
      return 20 * Math.log10(rms(lib.voiceFilter(input).subarray(R)) / rms(input.subarray(R)));
    };

    expect(gain(50)).toBeLessThan(-10);
    for (const [hz, db, within] of [
      // The low cut's corner, where a second-order Butterworth high-pass is 3 dB down.
      [100, -3, 0.5],
      [1_000, 0, 0.5],
      [6_000, -3, 0.5],
      [7_000, -6, 1],
    ] as const) {
      const got = gain(hz);

      expect(Math.abs(got - db), `${hz} Hz gives ${got} dB`).toBeLessThanOrEqual(within);
    }

    // It makes a new array, and leaves the one it's given as it was.
    const input = tone(1_000, 0.01);
    const before = Float32Array.from(input);
    expect(lib.voiceFilter(input) === input).toBe(false);
    expect(input).toEqual(before);
  });

  it("matches the loudness, and caps the peak", () => {
    const quiet = stretch(tone(220, 2, 0.2), 0.3);
    // It scales the array it's given, and gives it back.
    expect(lib.voiceLevel(quiet, 0.1) === quiet).toBe(true);
    expect(Math.abs(rms(quiet) - 0.1)).toBeLessThan(0.001);
    expect(lib.voiceRms(quiet)).toBeCloseTo(rms(quiet), 6);

    // 0.9 is more than the peak allows: the peak is what's held, so the RMS falls short of it.
    const loud = lib.voiceLevel(stretch(tone(220, 2, 0.2), 0.3), 0.9);
    expect(Math.abs(peakOf(loud) - 0.98)).toBeLessThan(1e-6);
    expect(rms(loud)).toBeLessThan(0.9);

    // Nothing to match in no sound, and nothing to divide by.
    expect(lib.voiceRms(new Float32Array(0))).toBe(0);
    expect(allZero(lib.voiceLevel(new Float32Array(100), 0.1))).toBe(true);
  });

  it("writes a WAV of 16-bit PCM, one channel, 16,000 Hz", () => {
    const wav = lib.voiceWav(Float32Array.from([0, 0.5, -1, 1.5]));

    // The rate the recorder keeps (src/voice/encode.ts), which a page decodes a recording to.
    expect(lib.VOICE_RATE).toBe(VOICE_SAMPLE_RATE);
    expect(lib.VOICE_RATE).toBe(R);
    expect(wav.length).toBe(52);
    expect(Array.from(wav)).toEqual([
      // "RIFF", the size of the rest (36 and the samples' 8), "WAVE".
      ...ascii("RIFF"),
      ...littleEndian(44, 4),
      ...ascii("WAVE"),
      // "fmt ", its 16 bytes: PCM (1), one channel, 16,000 Hz, 32,000 bytes a second, 2 bytes a
      // frame, 16 bits a sample.
      ...ascii("fmt "),
      ...littleEndian(16, 4),
      ...littleEndian(1, 2),
      ...littleEndian(1, 2),
      ...littleEndian(16_000, 4),
      ...littleEndian(32_000, 4),
      ...littleEndian(2, 2),
      ...littleEndian(16, 2),
      // "data", its 8 bytes, and the four samples: 0, 0.5 rounded, -1, and 1.5 held to 1.
      ...ascii("data"),
      ...littleEndian(8, 4),
      ...littleEndian(0, 2),
      ...littleEndian(16_384, 2),
      ...littleEndian(-32_767, 2),
      ...littleEndian(32_767, 2),
    ]);
  });
});

describe("the stretcher's library", () => {
  it("is plain ES2017 with no DOM", () => {
    expect(() => new vm.Script(STRETCH_LIBRARY)).not.toThrow();
    // Nothing of a page, and nothing newer than ES2017: no optional chaining or nullish
    // coalescing, no imports, no template literals.
    expect(STRETCH_LIBRARY).not.toMatch(/\b(document|window|import)\b|\?\.|\?\?|`/);
    // It starts and ends on a new line, so it can follow another script in a page's one <script>.
    expect(STRETCH_LIBRARY.startsWith("\n")).toBe(true);
    expect(STRETCH_LIBRARY.endsWith("\n")).toBe(true);
    // And it runs where there's nothing but the language's own objects: an empty context.
    expect(() => {
      vm.runInNewContext(STRETCH_LIBRARY, {});
    }).not.toThrow();
  });
});
