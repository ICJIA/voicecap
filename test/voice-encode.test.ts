/**
 * The encoder: 16 kHz PCM in, a WebM Opus file out. These run libopus for real (compiled to
 * WebAssembly, in the libopus-wasm package), on sounds made out of whole numbers
 * (test/helpers/voice-signal.ts), so every machine encodes the same samples. The files are read
 * back by the EBML reader of test/helpers/webm-reader.ts, and decoded again by libopus where a test
 * asks what the sound became. The test that plays a file as a page would is voice-browser.test.ts.
 */
import { createHash } from "node:crypto";

import {
  Application,
  Bandwidth,
  createDecoder,
  getPacketInfo,
  Signal,
  type EncoderOptions,
} from "libopus-wasm";
import type * as LibopusModule from "libopus-wasm";
import { describe, expect, it, vi } from "vitest";

import {
  encodeVoice,
  peakOf,
  VOICE_BITRATE,
  VOICE_FRAME_MS,
  VOICE_SAMPLE_RATE,
} from "../src/voice/encode.js";
import { busySound, silence, speechAndPauses } from "./helpers/voice-signal.js";
import { childOf, readWebm, valueOf } from "./helpers/webm-reader.js";

/**
 * What the stand-in below saw of the encoders the code made: their settings, and how many were
 * made and freed. It passes everything to the real library; a test can make one fail to encode.
 */
const made = vi.hoisted(() => ({
  options: [] as unknown[],
  created: 0,
  freed: 0,
  failToEncode: false,
}));

vi.mock("libopus-wasm", async (importOriginal) => {
  const real = await importOriginal<typeof LibopusModule>();
  return {
    ...real,
    createEncoder: async (options?: EncoderOptions) => {
      const encoder = await real.createEncoder(options);
      made.options.push(options);
      made.created += 1;
      const free = encoder.free.bind(encoder);
      encoder.free = () => {
        made.freed += 1;
        free();
      };
      if (made.failToEncode) {
        encoder.encode = () => {
          throw new Error("The encoder failed.");
        };
      }
      return encoder;
    },
  };
});

const sha256 = (...parts: Uint8Array[]): string => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
};

const MB = 1024 * 1024;

/** How well `decoded` follows `original` when it is `lag` samples later: 1 for the same shape. */
function correlation(original: Int16Array, decoded: Int16Array, lag: number): number {
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

describe("the voice's settings", () => {
  it("are 16 kHz, 12,000 bits a second, and frames of 60 ms", () => {
    expect(VOICE_SAMPLE_RATE).toBe(16_000);
    expect(VOICE_BITRATE).toBe(12_000);
    expect(VOICE_FRAME_MS).toBe(60);
  });

  it("make an encoder for VoIP and voice, wideband at most, VBR, complexity 10, DTX", async () => {
    await encodeVoice(silence(0.1));
    expect(made.options.at(-1)).toEqual({
      sampleRate: 16_000,
      channels: 1,
      application: Application.Voip,
      signal: Signal.Voice,
      maxBandwidth: Bandwidth.Wideband,
      bitrate: 12_000,
      vbr: true,
      vbrConstraint: false,
      complexity: 10,
      dtx: true,
      frameSize: 960,
    });
  });
});

describe("peakOf", () => {
  it("is the largest sample, whichever way it points", () => {
    expect(peakOf(new Int16Array(0))).toBe(0);
    expect(peakOf(Int16Array.of(3, -7, 5))).toBe(7);
    expect(peakOf(Int16Array.of(0, 0, 2, -1))).toBe(2);
    expect(peakOf(Int16Array.of(32_767, -32_768, 1))).toBe(32_768);
    expect(peakOf(Int16Array.of(-32_768))).toBe(32_768);
    expect(peakOf(new Int16Array(1_000_000).fill(-2))).toBe(2);
  });
});

describe("encodeVoice", () => {
  it("writes WebM that holds one Opus track, as the encoder made it", async () => {
    const pcm = speechAndPauses();
    const { webm } = await encodeVoice(pcm);
    const file = readWebm(webm);

    const track = childOf(file.tracks, "TrackEntry");
    expect(valueOf(track, "CodecID")).toBe("A_OPUS");
    expect(valueOf(childOf(track, "Audio"), "Channels")).toBe(1);
    // libopus's lookahead is 104 samples at 16 kHz, 6.5 ms: 312 at the 48 kHz Opus counts in.
    const head = valueOf<Uint8Array>(track, "CodecPrivate");
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    expect(view.getUint16(10, true)).toBe(312);
    expect(view.getUint32(12, true)).toBe(16_000);
    expect(valueOf(track, "CodecDelay")).toBe(6_500_000);

    // 2 s of sound, with the lookahead after it, in packets of 60 ms: 34 of them.
    expect(file.blocks).toHaveLength(Math.ceil((pcm.length + 104) / 960));
    expect(file.blocks).toHaveLength(34);

    // Every packet is one frame of 60 ms for one channel, and none is wider than wideband.
    for (const block of file.blocks) {
      const info = await getPacketInfo(block.packet, { sampleRate: 48_000 });
      expect(info.durationMs).toBe(60);
      expect(info.frames).toBe(1);
      expect(info.channels).toBe(1);
      expect(info.bandwidth).toBeLessThanOrEqual(Bandwidth.Wideband);
    }

    // The last block carries the padding that fills out its packet, which isn't the sound's.
    expect(file.blocks.at(-1)?.discardPadding).toBe(
      ((34 * 2880 - 312 - 3 * pcm.length) / 3) * 62_500,
    );
  });

  it("gives the same bytes for the same PCM", async () => {
    const pcm = speechAndPauses();
    const first = await encodeVoice(pcm);
    const second = await encodeVoice(pcm);
    expect(second.webm).toEqual(first.webm);

    // Pinned in three hashes, so that a change can be told from its cause:
    // - the sound's changes only if the test's own sound does (test/helpers/voice-signal.ts);
    // - the packets' changes only if libopus-wasm's version or the encoder's settings do;
    // - the file's changes with the packets, and with the muxer's layout; so if it moves while the
    //   packets' hash holds, it is the muxer's doing.
    const packets = readWebm(first.webm).blocks.map((block) => block.packet);
    expect(sha256(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength))).toBe(
      "218b75f9fcb667a75b42415bb9b664cde4317c49c9f6531d8d6e6f03b744b239",
    );
    expect(sha256(...packets)).toBe(
      "85a74e6385e1ef82d1d9094d0b9a967ffb79624e8f532049d21a02aa170480dc",
    );
    expect(sha256(first.webm)).toBe(
      "82cf7110edfd8e25d20dea56aa765de9f8606004258ddffe25b73d2db6bb96a4",
    );
  });

  it("gives the same bytes for a view into a larger buffer, as it does for a copy", async () => {
    const pcm = speechAndPauses();
    const buffer = new ArrayBuffer(pcm.byteLength + 16);
    const view = new Int16Array(buffer, 6, pcm.length);
    view.set(pcm);
    const before = view.slice();
    expect((await encodeVoice(view)).webm).toEqual((await encodeVoice(pcm)).webm);
    expect(view).toEqual(before);
  });

  it.each([1, 103, 104, 105, 855, 856, 857, 959, 960, 961, 5_000, 16_000, 47_896, 100_001])(
    "says how long it is, to the sample: %i samples",
    async (samples) => {
      const pcm = busySound(samples / 16_000);
      expect(pcm).toHaveLength(samples);
      const { webm, seconds } = await encodeVoice(pcm);
      expect(seconds).toBe(samples / 16_000);
      const duration = valueOf<number>(readWebm(webm).info, "Duration");
      expect(Math.abs(duration - seconds * 1000)).toBeLessThan(1);
      expect(duration).toBe(samples / 16);
    },
  );

  it("refuses an empty recording, which no browser could play", async () => {
    const created = made.created;
    await expect(encodeVoice(new Int16Array(0))).rejects.toThrow(/recording is empty/);
    expect(made.created).toBe(created);
  });

  it("costs little for silence", async () => {
    const { webm } = await encodeVoice(silence(60));
    const packets = readWebm(webm).blocks.map((block) => block.packet);
    // DTX leaves a packet of silence as its table of contents byte alone, and sends 21 bytes of
    // comfort noise in every seventh: 3,900 bytes of packets for the minute, where each packet of
    // speech has 50 to 80. The count of one-byte packets is libopus's cadence, which the 800 leaves
    // room around (it was 856), as the bytes below do: this asserts that most are, not how many.
    expect(packets).toHaveLength(1001);
    expect(packets.filter((packet) => packet.length === 1).length).toBeGreaterThan(800);
    expect(packets.reduce((sum, packet) => sum + packet.length, 0)).toBeLessThan(4_500);
    // The file adds what a block costs, 6 bytes for each of the 1,001, and its own few hundred.
    expect(webm.length).toBeLessThan(12_000);
  });

  it("keeps a minute of busy sound small", async () => {
    const { webm } = await encodeVoice(busySound(60));
    expect(webm.length).toBeLessThan(120_000);
    // And it did code the sound: 12 kbps for a minute is 90,000 bytes of packets, at most.
    expect(webm.length).toBeGreaterThan(50_000);
  });

  it("encodes three minutes quickly", async () => {
    const pcm = busySound(180);
    const before = process.memoryUsage();
    const started = performance.now();
    const { webm, seconds } = await encodeVoice(pcm);
    const took = performance.now() - started;
    const after = process.memoryUsage();
    expect(seconds).toBe(180);
    expect(readWebm(webm).blocks).toHaveLength(Math.ceil((pcm.length + 104) / 960));
    expect(took).toBeLessThan(15_000);
    // What the call leaves behind: the heap, and the memory of the arrays (the WASM's too).
    expect(after.heapUsed - before.heapUsed).toBeLessThan(300 * MB);
    expect(after.arrayBuffers - before.arrayBuffers).toBeLessThan(300 * MB);
  });

  it("decodes to the sound it was given, in step with it", async () => {
    const pcm = speechAndPauses();
    const { webm } = await encodeVoice(pcm);
    const file = readWebm(webm);
    const head = valueOf<Uint8Array>(childOf(file.tracks, "TrackEntry"), "CodecPrivate");
    // The pre-skip, from the file, in samples of the 16 kHz sound.
    const delay =
      new DataView(head.buffer, head.byteOffset, head.byteLength).getUint16(10, true) / 3;

    const decoder = await createDecoder({ sampleRate: 16_000, channels: 1, maxFrameSize: 960 });
    try {
      const everything = new Int16Array(file.blocks.length * 960);
      file.blocks.forEach((block, index) =>
        everything.set(decoder.decode(block.packet), index * 960),
      );
      const trimmed = everything.subarray(delay, delay + pcm.length);
      expect(trimmed).toHaveLength(pcm.length);

      // The shape of the sound is the same, and it comes no later or earlier than half a
      // millisecond (8 samples). With no pre-skip it would be 6.5 ms late, and with one twice the
      // size, 6.5 ms early.
      const lags = Array.from({ length: 33 }, (_, index) => index - 16);
      const best = lags.reduce((a, b) =>
        correlation(pcm, trimmed, b) > correlation(pcm, trimmed, a) ? b : a,
      );
      expect(Math.abs(best)).toBeLessThanOrEqual(8);
      expect(correlation(pcm, trimmed, best)).toBeGreaterThan(0.7);
    } finally {
      decoder.free();
    }
  });

  it("frees its encoder when it has finished, and when it fails", async () => {
    const created = made.created;
    const freed = made.freed;
    await encodeVoice(speechAndPauses());
    expect([made.created - created, made.freed - freed]).toEqual([1, 1]);

    made.failToEncode = true;
    try {
      await expect(encodeVoice(speechAndPauses())).rejects.toThrow("The encoder failed.");
    } finally {
      made.failToEncode = false;
    }
    expect([made.created - created, made.freed - freed]).toEqual([2, 2]);
  });
});
