/**
 * Sounds for the voice tests: 16 kHz, mono, 16-bit, like what the recorder keeps.
 *
 * They're made with whole numbers, the four basic operations, and rounding, and nothing else (no
 * sine, no logarithm). Those give the same result on every machine, so every machine makes the
 * same samples, which the tests that pin a file's hash need: the last digit of a sine can differ
 * from one machine to the next, and a different sample is a different file.
 */

/** The rate of what the recorder keeps. */
export const RATE = 16_000;

/** Numbers that look random and are the same every time, from xorshift32; between -1 and 1. */
function noiseFrom(seed: number): () => number {
  let state = seed | 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state / 2_147_483_648;
  };
}

/** 0 up to 1 and back down to 0, once for each whole number of cycles. */
function triangle(cycles: number): number {
  const part = cycles - Math.floor(cycles);
  return part < 0.5 ? 2 * part : 2 - 2 * part;
}

/** Exact silence, as the recorder writes where the program says nothing. */
export function silence(seconds: number): Int16Array {
  return new Int16Array(Math.round(seconds * RATE));
}

/**
 * A sound that never stops and is never the same for long: two voice-like buzzes, one gliding
 * between 110 and 190 Hz and the other between 190 and 330, swelling and falling four times a
 * second, with a hiss over them. It's the hard case for an encoder and for the size of a file: no
 * pause to save bits in, and a lot for the bits to follow.
 */
export function busySound(seconds: number, seed = 1): Int16Array {
  const length = Math.round(seconds * RATE);
  const out = new Int16Array(length);
  const random = noiseFrom(seed);
  let low = 0;
  let high = 0;
  let lowPhase = 0;
  let highPhase = 0;
  let hissLow = 0;
  for (let index = 0; index < length; index++) {
    const time = index / RATE;
    lowPhase += (110 + 80 * triangle(time / 1.7)) / RATE;
    lowPhase -= Math.floor(lowPhase);
    highPhase += (190 + 140 * triangle(time / 2.329 + 0.3)) / RATE;
    highPhase -= Math.floor(highPhase);
    // Each buzz is a sawtooth, which has every harmonic; one pole takes the edge off the top ones.
    low += (2 * lowPhase - 1 - low) * 0.25;
    high += (2 * highPhase - 1 - high) * 0.25;
    // The hiss is noise less its own low-pass, which is what is left of it above a few kHz.
    const noise = random();
    hissLow += (noise - hissLow) * 0.5;
    const swell = 0.3 + 0.7 * triangle(time * 4);
    out[index] = Math.round((0.6 * low + 0.4 * high + 0.3 * (noise - hissLow)) * swell * 12_000);
  }
  return out;
}

/** The sounds one after the other, as one recording. */
export function joined(...parts: Int16Array[]): Int16Array {
  const out = new Int16Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Two seconds of what a page's recording is like: speech, a pause, speech, a pause. Its pauses are
 * long enough for DTX to start (it needs 200 ms of silence), and it ends in one.
 */
export function speechAndPauses(): Int16Array {
  return joined(busySound(0.7, 1), silence(0.4), busySound(0.5, 2), silence(0.4));
}
