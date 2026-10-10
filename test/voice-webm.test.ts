/**
 * The muxer on its own: Opus packets in, a WebM file out. The packets are made up here (a table of
 * contents byte, then bytes, in every length a block's size needs a new byte at), so nothing in
 * these tests depends on libopus. The file is read back by a reader of EBML written for the tests
 * (test/helpers/webm-reader.ts), and what it should say is worked out from the sound's length.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { muxOpusWebm } from "../src/voice/webm.js";
import { childOf, childrenOf, must, readWebm, valueOf } from "./helpers/webm-reader.js";

/** The samples in one 60 ms packet, at the 48 kHz Opus counts in. */
const PACKET_SAMPLES = 2880;
/** The encoder's delay, 6.5 ms, in the same samples. */
const PRE_SKIP = 312;
/** The nanoseconds in one sample of the 16 kHz sound. */
const SAMPLE_NS = 62_500;

/** The packets a sound of `samples` (at 16 kHz) needs, with the encoder's delay in front of it. */
const packetsFor = (samples: number, preSkip = PRE_SKIP): number =>
  Math.ceil((samples * 3 + preSkip) / PACKET_SAMPLES);

/**
 * Lengths of packets. A block's size takes one byte up to 126 (a packet of 122) and two from 127
 * (123), and a cluster's size takes a third byte past 16,382.
 */
const LENGTHS = [1, 2, 3, 80, 122, 123, 124, 255, 256, 1275];

/** Packets that differ from each other, each beginning 0x58: SILK, wideband, 60 ms, one frame. */
function packetsOf(count: number): Uint8Array[] {
  return Array.from({ length: count }, (_, index) => {
    const packet = new Uint8Array(LENGTHS[index % LENGTHS.length] ?? 1);
    packet[0] = 0x58;
    for (let at = 1; at < packet.length; at++) packet[at] = (index * 31 + at * 7) & 0xff;
    return packet;
  });
}

const mux = (samples: number, preSkip = PRE_SKIP): Uint8Array =>
  muxOpusWebm(packetsOf(packetsFor(samples, preSkip)), { preSkip, samples });

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

describe("the WebM muxer", () => {
  it("writes WebM that holds one Opus track", () => {
    const samples = 164_321;
    const bytes = mux(samples);
    const file = readWebm(bytes);

    // The EBML header says what kind of file it is.
    expect(file.header.start).toBe(0);
    expect(valueOf(file.header, "DocType")).toBe("webm");
    expect(valueOf(file.header, "EBMLVersion")).toBe(1);
    expect(valueOf(file.header, "EBMLReadVersion")).toBe(1);
    expect(valueOf(file.header, "EBMLMaxIDLength")).toBe(4);
    expect(valueOf(file.header, "EBMLMaxSizeLength")).toBe(8);

    // The header and one Segment are the whole file, and the Segment holds what a player needs, in
    // the order it reads them: the Cues come before the Clusters, so a player has them at once.
    expect(file.top.map((element) => element.name)).toEqual(["EBML", "Segment"]);
    expect(file.segment.end).toBe(bytes.length);
    expect(file.segment.children.map((element) => element.name)).toEqual([
      "Info",
      "Tracks",
      "Cues",
      "Cluster",
      "Cluster",
      "Cluster",
    ]);

    // Info counts in milliseconds, and gives the exact length of the sound in them: a sixteenth of
    // one for each sample.
    expect(valueOf(file.info, "TimecodeScale")).toBe(1_000_000);
    expect(valueOf(file.info, "Duration")).toBe(samples / 16);
    expect(valueOf(file.info, "MuxingApp")).toBe("voicecap");
    expect(valueOf(file.info, "WritingApp")).toBe("voicecap");

    // One track: audio, Opus, one channel, at 48 kHz on purpose (the rate Opus decodes at, as FFmpeg's
    // muxer writes it: see src/voice/webm.ts). The 16 kHz the encoder was given is in the OpusHead.
    const track = childOf(file.tracks, "TrackEntry");
    expect(childrenOf(file.tracks, "TrackEntry")).toHaveLength(1);
    expect(valueOf(track, "TrackNumber")).toBe(1);
    expect(valueOf(track, "TrackType")).toBe(2);
    expect(valueOf(track, "FlagLacing")).toBe(0);
    expect(valueOf(track, "CodecID")).toBe("A_OPUS");
    expect(valueOf(track, "CodecDelay")).toBe(6_500_000);
    expect(valueOf(track, "SeekPreRoll")).toBe(80_000_000);
    const audio = childOf(track, "Audio");
    expect(valueOf(audio, "SamplingFrequency")).toBe(48_000);
    expect(valueOf(audio, "Channels")).toBe(1);

    // CodecPrivate is the OpusHead of RFC 7845: the pre-skip, and the rate the sound came from.
    const head = valueOf<Uint8Array>(track, "CodecPrivate");
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    expect(head).toHaveLength(19);
    expect(new TextDecoder().decode(head.subarray(0, 8))).toBe("OpusHead");
    expect(view.getUint8(8)).toBe(1);
    expect(view.getUint8(9)).toBe(1);
    expect(view.getUint16(10, true)).toBe(PRE_SKIP);
    expect(view.getUint32(12, true)).toBe(16_000);
    expect(view.getInt16(16, true)).toBe(0);
    expect(view.getUint8(18)).toBe(0);

    // The last block carries DiscardPadding: the 2,085 samples (at 48 kHz) past the end of the
    // sound, which are 695 samples of the 16 kHz sound, at 62.5 microseconds each. No other does.
    const last = file.blocks.at(-1);
    expect(last?.grouped).toBe(true);
    expect(last?.discardPadding).toBe(695 * SAMPLE_NS);
    expect(file.blocks.slice(0, -1).some((block) => block.grouped)).toBe(false);
  });

  it("writes one Cluster and one Cue for each 5 seconds of sound", () => {
    // 172 packets of 60 ms. A cluster holds 83 of them, 4.98 s: the most that fit in 5 s.
    expect(83 * 60).toBeLessThanOrEqual(5000);
    expect(84 * 60).toBeGreaterThan(5000);
    const file = readWebm(mux(164_321));
    expect(file.blocks).toHaveLength(172);
    expect(file.clusters.map((cluster) => valueOf(cluster, "Timecode"))).toEqual([0, 4980, 9960]);
    // A cluster holds its Timecode, then its blocks.
    expect(file.clusters.map((cluster) => cluster.children.length - 1)).toEqual([83, 83, 6]);

    // Each Cue names its cluster by when it begins, and by where it is, counted from the Segment's
    // body.
    const cues = childrenOf(must(file.cues, "Cues"), "CuePoint");
    expect(cues).toHaveLength(3);
    cues.forEach((cue, index) => {
      const cluster = must(file.clusters[index], `Cluster ${index}`);
      const positions = childOf(cue, "CueTrackPositions");
      expect(valueOf(cue, "CueTime")).toBe(valueOf(cluster, "Timecode"));
      expect(valueOf(positions, "CueTrack")).toBe(1);
      expect(valueOf(positions, "CueClusterPosition")).toBe(cluster.start - file.segment.dataStart);
    });
  });

  // A sound whose packets fill the last one exactly, so the count is the one asked for.
  it.each([
    { packets: 83, clusters: 1 },
    { packets: 84, clusters: 2 },
    { packets: 166, clusters: 2 },
    { packets: 167, clusters: 3 },
  ])(
    "writes $clusters Cluster(s) and as many Cues for $packets packets, none of them empty",
    ({ packets, clusters }) => {
      // 960 samples of 16 kHz sound are one 60 ms packet; the encoder's delay is in the first.
      const samples = packets * 960 - PRE_SKIP / 3;
      expect(packetsFor(samples)).toBe(packets);
      const file = readWebm(mux(samples));
      expect(file.blocks).toHaveLength(packets);
      expect(file.clusters).toHaveLength(clusters);
      expect(childrenOf(must(file.cues, "Cues"), "CuePoint")).toHaveLength(clusters);
      // A cluster holds its Timecode, then at least one block: a stray empty one at an exact
      // multiple of 83 packets is what a loop that ran one cluster too far would write.
      const sizes = file.clusters.map((cluster) => cluster.children.length - 1);
      expect(sizes.every((size) => size >= 1 && size <= 83)).toBe(true);
      expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(packets);
      expect(sizes.slice(0, -1).every((size) => size === 83)).toBe(true);
    },
  );

  it("keeps every packet, in a block at its own time", () => {
    const samples = 164_321;
    const packets = packetsOf(packetsFor(samples));
    const file = readWebm(muxOpusWebm(packets, { preSkip: PRE_SKIP, samples }));
    expect(file.blocks.map((block) => block.time)).toEqual(packets.map((_, index) => index * 60));
    file.blocks.forEach((block, index) => {
      expect(block.packet, `packet ${index}`).toEqual(packets[index]);
    });
    // A seek may land on any block, so each is marked a keyframe.
    const simple = file.blocks.filter((block) => !block.grouped);
    expect(simple.length).toBeGreaterThan(0);
    expect(simple.every((block) => block.flags === 0x80)).toBe(true);
  });

  it.each([
    0, 1, 103, 104, 105, 855, 856, 857, 959, 960, 961, 4_999, 5_000, 16_000, 47_896, 164_321,
  ])("says %i samples to the sample", (samples) => {
    const file = readWebm(mux(samples));
    expect(valueOf(file.info, "Duration")).toBe(samples / 16);
    const count = packetsFor(samples);
    expect(file.blocks).toHaveLength(count);
    // The packets decode to the delay at the start, then the sound, then padding to a whole packet.
    const padding = count * PACKET_SAMPLES - PRE_SKIP - samples * 3;
    expect(padding).toBeGreaterThanOrEqual(0);
    expect(padding).toBeLessThan(PACKET_SAMPLES);
    const last = file.blocks.at(-1);
    if (padding === 0) {
      // An exact fit has nothing to discard, and says nothing of it.
      expect(last?.grouped).toBe(false);
      expect(last?.discardPadding).toBeUndefined();
    } else {
      expect(last?.grouped).toBe(true);
      expect(last?.discardPadding).toBe((padding / 3) * SAMPLE_NS);
    }
  });

  // Duration is an 8-byte float: a 4-byte one holds only about 17.5 minutes of milliseconds to the
  // sixteenth of one, so an hour and one sample is where it would round, and where only this sees it
  // (the byte hashes above are of 164,321 samples, which a 4-byte float holds).
  it("says an hour and one sample to the sample", () => {
    const samples = 60 * 60 * 16_000 + 1;
    const count = packetsFor(samples);
    // 60,001 packets, each one byte: the table-of-contents byte alone, which is all a block needs.
    expect(count).toBe(60_001);
    const packets = Array.from({ length: count }, () => Uint8Array.of(0x58));
    const file = readWebm(muxOpusWebm(packets, { preSkip: PRE_SKIP, samples }));

    const duration = valueOf<number>(file.info, "Duration");
    expect(duration).toBe(samples / 16);
    expect(duration).toBe(3_600_000.0625);
    // A 4-byte float would have said 3,600,000: the sample would be lost.
    expect(Math.fround(duration)).not.toBe(duration);
    expect(file.blocks).toHaveLength(count);
    expect(file.clusters).toHaveLength(Math.ceil(count / 83));
  });

  it("writes the pre-skip the encoder gave, both as the OpusHead and as the codec's delay", () => {
    for (const preSkip of [0, 1, 312, 65_535]) {
      const file = readWebm(mux(1000, preSkip));
      const track = childOf(file.tracks, "TrackEntry");
      const head = valueOf<Uint8Array>(track, "CodecPrivate");
      expect(new DataView(head.buffer, head.byteOffset).getUint16(10, true)).toBe(preSkip);
      expect(valueOf(track, "CodecDelay")).toBe(Math.round((preSkip * 1e9) / 48_000));
    }
  });

  it("gives the same bytes for the same packets", () => {
    const first = mux(164_321);
    expect(mux(164_321)).toEqual(first);
    // Pinned, so that a change to the layout is seen as one. It changes only if the muxer does.
    expect(sha256(first)).toBe("7b5df1ffa6cf83989e9f3a6c7de8b4fb05470fd790ec25c2e38a6d2e01339082");
  });

  it("copies the packets, and does not change them", () => {
    const samples = 5_000;
    const packets = packetsOf(packetsFor(samples));
    const before = packets.map((packet) => packet.slice());
    const bytes = muxOpusWebm(packets, { preSkip: PRE_SKIP, samples });
    const copy = bytes.slice();
    expect(packets).toEqual(before);
    for (const packet of packets) packet.fill(0);
    expect(bytes).toEqual(copy);
  });

  describe("refuses what it can't write a true file of", () => {
    it("packets that are too few for the sound", () => {
      const needed = packetsFor(16_000);
      expect(() =>
        muxOpusWebm(packetsOf(needed - 1), { preSkip: PRE_SKIP, samples: 16_000 }),
      ).toThrow(new RegExp(`Expected ${needed} packets .* got ${needed - 1}`));
    });

    it("packets that are more than the sound needs", () => {
      const needed = packetsFor(16_000);
      expect(() =>
        muxOpusWebm(packetsOf(needed + 1), { preSkip: PRE_SKIP, samples: 16_000 }),
      ).toThrow(new RegExp(`Expected ${needed} packets .* got ${needed + 1}`));
    });

    it("no packets, and an empty packet", () => {
      expect(() => muxOpusWebm([], { preSkip: 0, samples: 0 })).toThrow(/no packets/i);
      const packets = packetsOf(packetsFor(1000));
      packets[1] = new Uint8Array(0);
      expect(() => muxOpusWebm(packets, { preSkip: PRE_SKIP, samples: 1000 })).toThrow(
        /Packet 1 is empty/,
      );
    });

    it("a pre-skip that is not a whole number from 0 to 65,535", () => {
      for (const preSkip of [-1, 1.5, 65_536, Number.NaN]) {
        expect(() => muxOpusWebm(packetsOf(1), { preSkip, samples: 0 })).toThrow(/pre-skip/);
      }
    });

    it("a length that is not a whole number of 0 or more", () => {
      for (const samples of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => muxOpusWebm(packetsOf(1), { preSkip: PRE_SKIP, samples })).toThrow(
          /length in samples/,
        );
      }
    });
  });
});
