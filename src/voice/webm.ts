/**
 * The file a recording of NVDA's voice is kept in: WebM, with one Opus track. voicecap writes it
 * itself, in this one short module, and not through a library, so that the same packets always give
 * the same bytes, and nothing is in the file that isn't from the sound (no date, no random number,
 * not even the version of voicecap).
 *
 * It writes only what a player needs to play the sound, seek in it, and say how long it is, to the
 * sample:
 *
 * - **Info** counts in milliseconds, and gives the sound's length to a sixteenth of one, which is a
 *   sample of the 16 kHz sound. It names voicecap as the muxing and the writing app, as Matroska
 *   asks.
 * - **Tracks** hold the one track. Opus is always 48 kHz in Matroska, whatever rate the sound had;
 *   the rate the encoder was given is in the OpusHead (RFC 7845), beside the pre-skip. The track
 *   also says the encoder's delay (CodecDelay) and how far before a seek a decoder must start
 *   (SeekPreRoll, 80 ms for Opus).
 * - **Cues** come before the Clusters, so a player has them as soon as it has read the header, and
 *   name each Cluster by its time and its place: one Cue for each Cluster.
 * - **Clusters** hold up to 5 s of packets: 83 packets of 60 ms, which are 4.98 s.
 * - **DiscardPadding**, on the last block, says how much of the last packet is past the end of the
 *   sound. The encoder pads the sound to a whole packet, and a player that trims the padding plays
 *   the sound to its last sample.
 *
 * Every size is known; none is left open to be filled in at the end. The file has no lacing, which
 * WebM doesn't use, and no SeekHead or Void, which a file this small has no need of.
 */

const text = new TextEncoder();

/** The rate of the sound the packets were made from: what OpusHead records and `samples` counts. */
const INPUT_RATE = 16_000;
/** The rate Opus counts in, whatever the rate it was given: pre-skips and padding are in it. */
const OPUS_RATE = 48_000;
/** Every packet holds 60 ms of sound, in one frame: what VOICE_FRAME_MS makes the encoder give. */
const PACKET_MS = 60;
/** The samples in a packet, at the rate Opus counts in. */
const PACKET_SAMPLES = (OPUS_RATE * PACKET_MS) / 1000;
/** A Cluster holds the most packets that fit in 5 s. */
const CLUSTER_PACKETS = Math.floor(5000 / PACKET_MS);
/** How far before a seek point a decoder must start for Opus to be right: 80 ms, in nanoseconds. */
const SEEK_PRE_ROLL_NS = 80_000_000;
/** What the file names as the program that wrote it. No version: no release changes the bytes. */
const APP = "voicecap";

/** The IDs of the elements written, as Matroska writes them, with the length marker in. */
const ID = {
  Ebml: 0x1a45dfa3,
  EbmlVersion: 0x4286,
  EbmlReadVersion: 0x42f7,
  EbmlMaxIdLength: 0x42f2,
  EbmlMaxSizeLength: 0x42f3,
  DocType: 0x4282,
  DocTypeVersion: 0x4287,
  DocTypeReadVersion: 0x4285,
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  MuxingApp: 0x4d80,
  WritingApp: 0x5741,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackUid: 0x73c5,
  TrackType: 0x83,
  FlagLacing: 0x9c,
  CodecId: 0x86,
  CodecPrivate: 0x63a2,
  CodecDelay: 0x56aa,
  SeekPreRoll: 0x56bb,
  Audio: 0xe1,
  SamplingFrequency: 0xb5,
  Channels: 0x9f,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueTrack: 0xf7,
  CueClusterPosition: 0xf1,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  DiscardPadding: 0x75a2,
} as const;

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** An ID's bytes: one to four, as many as its first byte says. */
function idBytes(id: number): Uint8Array {
  const length = id > 0xffffff ? 4 : id > 0xffff ? 3 : id > 0xff ? 2 : 1;
  return Uint8Array.from({ length }, (_, index) => (id >>> (8 * (length - 1 - index))) & 0xff);
}

/**
 * A size as EBML writes it, in the fewest bytes: the first byte's leading zeros say how many there
 * are, then a one, then the number. All ones means "unknown", so each form holds one number fewer.
 */
function sizeBytes(size: number): Uint8Array {
  for (let length = 1; length <= 8; length++) {
    if (size < 2 ** (7 * length) - 1) {
      const bytes = new Uint8Array(length);
      let rest = size;
      for (let index = length - 1; index >= 0; index--) {
        bytes[index] = rest % 256;
        rest = Math.floor(rest / 256);
      }
      bytes[0] = (bytes[0] ?? 0) | (0x80 >> (length - 1));
      return bytes;
    }
  }
  throw new RangeError(`A size of ${size} is too large for an EBML element.`);
}

/** A whole number of 0 or more as an element holds it: big-endian, in the fewest bytes. */
function uint(value: number): Uint8Array {
  const bytes: number[] = [];
  for (let rest = value; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return Uint8Array.from(bytes.length > 0 ? bytes : [0]);
}

/**
 * A whole number as a signed element holds it: two's complement, big-endian, in the fewest bytes. A
 * positive number whose top bit would be set is given another byte, or it would read as negative.
 */
function int(value: number): Uint8Array {
  for (let length = 1; length <= 6; length++) {
    const limit = 2 ** (8 * length - 1);
    if (value >= -limit && value < limit) {
      const bytes = new Uint8Array(length);
      let rest = value < 0 ? value + 2 ** (8 * length) : value;
      for (let index = length - 1; index >= 0; index--) {
        bytes[index] = rest % 256;
        rest = Math.floor(rest / 256);
      }
      return bytes;
    }
  }
  throw new RangeError(`A number of ${value} is too large for a signed element.`);
}

/** A float of 8 bytes, big-endian. */
function float64(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, false);
  return bytes;
}

/** An unsigned number in 4 bytes whatever its size, so that a size doesn't depend on its value. */
function fixed4(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

/** An element: its ID, the size of its body, then the body, which is its parts in a row. */
function element(id: number, body: readonly Uint8Array[]): Uint8Array {
  const content = concat(body);
  return concat([idBytes(id), sizeBytes(content.length), content]);
}

/** The OpusHead of RFC 7845, which is the track's CodecPrivate. */
function opusHead(preSkip: number): Uint8Array {
  const bytes = new Uint8Array(19);
  const view = new DataView(bytes.buffer);
  bytes.set(text.encode("OpusHead"), 0);
  view.setUint8(8, 1); // version
  view.setUint8(9, 1); // channels: one
  view.setUint16(10, preSkip, true); // pre-skip, in samples at 48 kHz
  view.setUint32(12, INPUT_RATE, true); // the rate of the sound given to the encoder
  view.setInt16(16, 0, true); // output gain: none
  view.setUint8(18, 0); // channel mapping family 0: mono or stereo
  return bytes;
}

/** A block's bytes: track 1, its time from its cluster's (in ms), flags, then the packet. */
function blockBody(time: number, flags: number, packet: Uint8Array): Uint8Array {
  return concat([Uint8Array.of(0x81, (time >> 8) & 0xff, time & 0xff, flags), packet]);
}

function isWhole(value: number, least: number, most: number): boolean {
  return Number.isInteger(value) && value >= least && value <= most;
}

/**
 * Writes Opus packets as a WebM file. `packets` are the encoder's, one for each 60 ms, in order.
 * `preSkip` is the encoder's delay at the start, in samples at 48 kHz, which a player drops from
 * the start of what it decodes. `samples` is the length of the sound the packets were made from, in
 * samples at 16 kHz.
 *
 * The packets decode to the delay, then the sound, then padding that fills out the last packet. So
 * they must be as many as that takes, which leaves padding of less than a packet. The file says
 * how much (DiscardPadding), and a player gives the sound alone. The times and the padding are in
 * the units WebM uses, worked out here from `samples`.
 *
 * The same arguments give the same bytes. The packets are copied, not kept.
 */
export function muxOpusWebm(
  packets: readonly Uint8Array[],
  options: { preSkip: number; samples: number },
): Uint8Array {
  const { preSkip, samples } = options;
  if (!isWhole(preSkip, 0, 0xffff)) {
    throw new RangeError(`The pre-skip must be a whole number from 0 to 65535, not ${preSkip}.`);
  }
  if (!isWhole(samples, 0, Number.MAX_SAFE_INTEGER / 3)) {
    throw new RangeError(
      `The length in samples must be a whole number of 0 or more, not ${samples}.`,
    );
  }
  if (packets.length === 0) throw new RangeError("There are no packets to write.");
  const sound = samples * (OPUS_RATE / INPUT_RATE);
  const expected = Math.ceil((preSkip + sound) / PACKET_SAMPLES);
  if (packets.length !== expected) {
    throw new RangeError(
      `Expected ${expected} packets for ${samples} samples and a pre-skip of ${preSkip}, got ${packets.length}.`,
    );
  }
  packets.forEach((packet, index) => {
    if (packet.length === 0) throw new RangeError(`Packet ${index} is empty.`);
  });
  // How much of the last packet is past the end of the sound: samples at 48 kHz, then nanoseconds.
  const padding = packets.length * PACKET_SAMPLES - preSkip - sound;
  const discard = Math.round((padding * 1e9) / OPUS_RATE);

  const header = element(ID.Ebml, [
    element(ID.EbmlVersion, [uint(1)]),
    element(ID.EbmlReadVersion, [uint(1)]),
    element(ID.EbmlMaxIdLength, [uint(4)]),
    element(ID.EbmlMaxSizeLength, [uint(8)]),
    element(ID.DocType, [text.encode("webm")]),
    element(ID.DocTypeVersion, [uint(4)]),
    element(ID.DocTypeReadVersion, [uint(2)]),
  ]);

  const info = element(ID.Info, [
    element(ID.TimecodeScale, [uint(1_000_000)]), // so that times are in milliseconds
    element(ID.Duration, [float64((samples * 1000) / INPUT_RATE)]),
    element(ID.MuxingApp, [text.encode(APP)]),
    element(ID.WritingApp, [text.encode(APP)]),
  ]);

  const tracks = element(ID.Tracks, [
    element(ID.TrackEntry, [
      element(ID.TrackNumber, [uint(1)]),
      element(ID.TrackUid, [uint(1)]),
      element(ID.TrackType, [uint(2)]), // audio
      element(ID.FlagLacing, [uint(0)]),
      element(ID.CodecId, [text.encode("A_OPUS")]),
      element(ID.CodecPrivate, [opusHead(preSkip)]),
      element(ID.CodecDelay, [uint(Math.round((preSkip * 1e9) / OPUS_RATE))]),
      element(ID.SeekPreRoll, [uint(SEEK_PRE_ROLL_NS)]),
      element(ID.Audio, [
        element(ID.SamplingFrequency, [float64(OPUS_RATE)]),
        element(ID.Channels, [uint(1)]),
      ]),
    ]),
  ]);

  const clusters: { time: number; bytes: Uint8Array }[] = [];
  for (let first = 0; first < packets.length; first += CLUSTER_PACKETS) {
    const time = first * PACKET_MS;
    const parts = [element(ID.Timecode, [uint(time)])];
    packets.slice(first, first + CLUSTER_PACKETS).forEach((packet, offset) => {
      const from = offset * PACKET_MS;
      if (first + offset === packets.length - 1 && discard > 0) {
        // DiscardPadding belongs to a block, so a block that has it is in a BlockGroup.
        parts.push(
          element(ID.BlockGroup, [
            element(ID.Block, [blockBody(from, 0x00, packet)]),
            element(ID.DiscardPadding, [int(discard)]),
          ]),
        );
      } else {
        parts.push(element(ID.SimpleBlock, [blockBody(from, 0x80, packet)])); // 0x80: a keyframe
      }
    });
    clusters.push({ time, bytes: element(ID.Cluster, parts) });
  }

  // The Cues name each Cluster's place, counted from the start of the Segment's body, and they come
  // before the Clusters. So their size must not depend on the places they hold: each is 4 bytes.
  const head = concat([info, tracks]);
  const cuesAt = (firstCluster: number): Uint8Array => {
    let place = firstCluster;
    const points = clusters.map((cluster) => {
      const point = element(ID.CuePoint, [
        element(ID.CueTime, [uint(cluster.time)]),
        element(ID.CueTrackPositions, [
          element(ID.CueTrack, [uint(1)]),
          element(ID.CueClusterPosition, [fixed4(place)]),
        ]),
      ]);
      place += cluster.bytes.length;
      return point;
    });
    return element(ID.Cues, points);
  };
  const cues = cuesAt(head.length + cuesAt(0).length);

  return concat([header, element(ID.Segment, [head, cues, ...clusters.map((c) => c.bytes)])]);
}
