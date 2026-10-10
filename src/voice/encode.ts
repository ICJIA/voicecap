/**
 * Turns a recording of what NVDA said into the small file a page keeps: 16 kHz PCM in, a WebM
 * Opus file out (src/voice/webm.ts holds the container). It runs libopus, compiled to WebAssembly
 * in the libopus-wasm package, which is pinned to one version (0.4.1) because the same sound must
 * always give the same bytes: the file is fingerprinted and sealed with the run, and a golden hash
 * in test/voice-encode.test.ts tells if a newer version changes them.
 *
 * It reads no file, starts no program, and keeps no state of its own between calls: each call makes
 * an encoder and frees it. What outlives a call is libopus-wasm's one WebAssembly instance, which the
 * library loads at the first call and shares with every call after it.
 */
import { Application, Bandwidth, createEncoder, Signal } from "libopus-wasm";

import { muxOpusWebm } from "./webm.js";

/** The rate of the sound the recorder keeps and the encoder is given: mono, 16-bit samples. */
export const VOICE_SAMPLE_RATE = 16_000;
/**
 * The bits a second the encoder aims for. A minute of speech takes about 65 to 95 KB at this rate,
 * the container included. Below about 9 kbps libopus drops to narrowband (4 kHz) of its own accord;
 * at this rate every packet is wideband (8 kHz).
 */
export const VOICE_BITRATE = 12_000;
/** The length of every frame, and so of every packet. 60 ms is the longest an Opus frame can be. */
export const VOICE_FRAME_MS = 60;

/** The samples in a frame, at the rate the encoder is given. */
const FRAME_SAMPLES = (VOICE_SAMPLE_RATE * VOICE_FRAME_MS) / 1000;
/** The rate Opus counts pre-skips in, whatever the rate it was given. */
const OPUS_RATE = 48_000;

/** The largest sample, whichever way it points: 0 for silence, and 32,768 at most. */
export function peakOf(pcm: Int16Array): number {
  let peak = 0;
  for (const sample of pcm) {
    const size = sample < 0 ? -sample : sample;
    if (size > peak) peak = size;
  }
  return peak;
}

/** The frame at `from`: a view of the sound where it's whole, else a copy padded with zeros. */
function frameAt(pcm: Int16Array, from: number): Int16Array {
  if (from + FRAME_SAMPLES <= pcm.length) return pcm.subarray(from, from + FRAME_SAMPLES);
  const frame = new Int16Array(FRAME_SAMPLES);
  frame.set(pcm.subarray(from));
  return frame;
}

/**
 * Encodes a recording. `pcm` is 16 kHz, mono, 16-bit samples; it is read, not changed or kept, and
 * it must not change while this runs. `seconds` is its length, to the sample, and the file says the
 * same (its Duration). The same sound always gives the same bytes.
 *
 * The encoder has the settings that suit speech at 12 kbps:
 * - the VoIP application and a voice signal, which tune it for speech;
 * - wideband at most (8 kHz), which is all speech needs;
 * - variable bit rate, so that the bits follow the sound, and complexity 10, the best for the bits;
 * - DTX, so that a stretch of silence costs a byte a packet, with a short packet of comfort noise
 *   now and then, and not what speech costs;
 * - frames of 60 ms.
 *
 * The sound is followed by silence, enough for the encoder's own delay (its lookahead, 6.5 ms) to
 * come out, and then enough to fill the last frame. The file says how much to skip at the start
 * (the pre-skip) and to discard at the end (DiscardPadding), so a player gives the sound alone.
 *
 * It takes about a hundredth of the recording's length, in one stretch with no pause for anything
 * else: a recording of 10 minutes holds the process up for around 6 s.
 *
 * An empty recording is refused: a file of no sound has no length for a browser to report, and
 * can't be decoded. The encoder lives for the call, and is freed whether it finishes or fails.
 */
export async function encodeVoice(pcm: Int16Array): Promise<{ webm: Uint8Array; seconds: number }> {
  if (pcm.length === 0) {
    throw new RangeError("There is no sound to encode: the recording is empty.");
  }
  const encoder = await createEncoder({
    sampleRate: VOICE_SAMPLE_RATE,
    channels: 1,
    application: Application.Voip,
    signal: Signal.Voice,
    maxBandwidth: Bandwidth.Wideband,
    bitrate: VOICE_BITRATE,
    vbr: true,
    vbrConstraint: false,
    complexity: 10,
    dtx: true,
    frameSize: FRAME_SAMPLES,
  });
  try {
    // A decoder gives the sound this many samples late, which the pre-skip drops. So the encoder is
    // given that many samples of silence past the end of the sound, for the end of it to come out.
    const lookahead = encoder.getLookahead();
    const frames = Math.ceil((pcm.length + lookahead) / FRAME_SAMPLES);
    const packets: Uint8Array[] = [];
    for (let frame = 0; frame < frames; frame++) {
      packets.push(encoder.encode(frameAt(pcm, frame * FRAME_SAMPLES)));
    }
    const preSkip = Math.round((lookahead * OPUS_RATE) / VOICE_SAMPLE_RATE);
    return {
      webm: muxOpusWebm(packets, { preSkip, samples: pcm.length }),
      seconds: pcm.length / VOICE_SAMPLE_RATE,
    };
  } finally {
    encoder.free();
  }
}
