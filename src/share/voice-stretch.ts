/**
 * The voice page's stretcher: what slows a recording of NVDA's voice in the reader's browser, from
 * the recording the page already holds. NVDA speaks fast, and slowed by the browser's own
 * stretcher its words are hard to make out; this one is made for speech.
 *
 * It's a phase vocoder with phase locking, then a gentle filter:
 * - The recording is cut into frames of 512 samples (32 ms), each under a Hann window and through
 *   a 512-point FFT. A frame is taken every 8 ms of the copy, which is 8 ms × the speed along the
 *   recording (2.4 ms at 0.3×), read at fractional places by linear interpolation.
 * - Each frame's spectrum is turned so its phases carry on from the last frame's by 8 ms of the
 *   copy. That is the slowing, and the pitch stays where it was. A peak (a bin whose power is
 *   above the bins on each side of it) carries on at its own frequency, which comes from how far
 *   its phase moved since the last frame, and every other bin turns by the rotation of its
 *   nearest peak: that is identity phase locking (Laroche and Dolson, 1999). The parts of one
 *   sound turn together, so a slowed voice stays clear instead of smearing.
 * - Each frame is turned back by an inverse FFT, put under the Hann window again, and added in at
 *   its place; the sum is divided by the sum of the squared windows, so the loudness is even. The
 *   copy is exactly ⌊length ÷ speed⌋ samples long.
 * - It's made in slices, a few frames at a time, so a page can work in small pieces and go on
 *   answering between them.
 * - After the copy come the filter, which takes the rumble from under the voice and eases the hiss
 *   a slowed voice makes plainer; the loudness match, which scales the copy to the loudness of the
 *   recording it came from and never past a peak of 0.98; and a WAV writer, which gives the bytes
 *   a player plays.
 *
 * Why this one: of three stretchers tried on one recording at 0.3×, the two that splice repeated
 * pieces of it (a WSOLA) warbled, at about the rate of their splices. This one has no pieces to
 * splice, and warbled least.
 *
 * The library is plain browser JavaScript (ES2017, no imports, no DOM), held as a string the way
 * the check's library is (./check.ts), so a page can hold it in its one script and the tests can
 * run it in node:vm exactly as a browser does.
 */

/**
 * The stretcher's library, as plain browser JavaScript (ES2017, no imports, no DOM, nothing from
 * outside): `voiceStretcher(signal, speed)`, `voiceFilter(signal)`, `voiceRms(signal)`,
 * `voiceLevel(signal, target)`, and `voiceWav(signal)`, with the constants they share, of which a
 * page needs `VOICE_RATE`. A signal is a `Float32Array` of samples at `VOICE_RATE` (16,000 Hz, one
 * channel), as a recording decodes to.
 *
 * `voiceStretcher` gives `{ next, output }`, to make the copy of `signal` at `speed`, one of the
 * page's 0.75, 0.5, or 0.3: a copy 1 ÷ `speed` times as long, with the pitch kept. `next(frames)`
 * makes up to `frames` more frames of it and returns true once the copy is finished, when
 * `output` is the copy, exactly ⌊`signal.length` ÷ `speed`⌋ samples; `output` is null until then.
 * A caller asks for as many frames as fit in a slice of its time, lets the page answer, and asks
 * again. A signal too short for one frame has no frame to make, and its copy is silent.
 *
 * `voiceFilter` gives a new array: `signal` through the low cut and the high shelf. `voiceRms`
 * gives a signal's root mean square (0 for no samples). `voiceLevel` scales `signal` in place to an
 * RMS of `target`, unless that would take its peak past `VOICE_PEAK`, when the peak is `VOICE_PEAK`
 * instead (a silent signal stays as it is), and gives it back. `voiceWav` gives the whole WAV file
 * of a signal as bytes: 16-bit PCM, one channel, at `VOICE_RATE`, each sample held to -1 to 1 and
 * rounded to a whole number of 32767ths.
 */
export const STRETCH_LIBRARY = String.raw`
// The recordings' rate: 16 kHz, one channel.
var VOICE_RATE = 16000;
// Frames of 32 ms: fine enough in time for NVDA's quick syllables.
var VOICE_FRAME = 512;
// An 8 ms hop in the copy: four frames over each sample.
var VOICE_HOP = 128;
// In Hz: under the voice, rumble and the codec's hum.
var VOICE_LOW_CUT = 100;
// In Hz, and the gain in dB of the high shelf above it, a cut: eases the hiss a slowed voice makes
// plainer.
var VOICE_SHELF = 6000;
var VOICE_SHELF_DB = -6;
// A copy never passes this at its peak.
var VOICE_PEAK = 0.98;

// The FFT, in place, of re (the real parts) and im (the imaginary parts), whose length must be a
// power of two: iterative radix-2. Each pass steps its twiddle factors by complex multiplication,
// so a sine and a cosine are worked out once for a pass, not for every factor.
function voiceFft(re, im) {
  var n = re.length, i, j = 0, bit, len, half, k, t;
  for (i = 1; i < n; i++) {
    bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (len = 2; len <= n; len <<= 1) {
    half = len >> 1;
    var angle = (-2 * Math.PI) / len, stepRe = Math.cos(angle), stepIm = Math.sin(angle);
    for (i = 0; i < n; i += len) {
      var wRe = 1, wIm = 0;
      for (k = 0; k < half; k++) {
        var p = i + k, q = p + half;
        var vRe = re[q] * wRe - im[q] * wIm, vIm = re[q] * wIm + im[q] * wRe;
        re[q] = re[p] - vRe; im[q] = im[p] - vIm;
        re[p] += vRe; im[p] += vIm;
        t = wRe * stepRe - wIm * stepIm; wIm = wRe * stepIm + wIm * stepRe; wRe = t;
      }
    }
  }
}

// The stretcher: the copy of signal at speed, made in slices. It gives { output, next }, where
// next(frames) makes up to that many more frames and returns true once the copy is finished, when
// output is the copy (null until then). A frame is read from the recording at a fractional place
// and added into out, with the squares of its Hann curve added into norm; both have a frame's room
// past the end of the copy. What it keeps between calls is in this closure.
function voiceStretcher(signal, speed) {
  var N = VOICE_FRAME, hopOut = VOICE_HOP, hopIn = hopOut * speed, bins = N / 2 + 1, TWO_PI = 2 * Math.PI;
  var length = Math.floor(signal.length / speed);
  var out = new Float32Array(length + N), norm = new Float32Array(length + N);
  var win = new Float64Array(N);
  for (var w = 0; w < N; w++) win[w] = 0.5 - 0.5 * Math.cos((TWO_PI * w) / N);
  var re = new Float64Array(N), im = new Float64Array(N);
  var lastRe = new Float64Array(bins), lastIm = new Float64Array(bins);
  var madeRe = new Float64Array(bins), madeIm = new Float64Array(bins);
  var power = new Float64Array(bins), turnRe = new Float64Array(bins), turnIm = new Float64Array(bins);
  var peaks = new Int32Array(bins);
  var at = 0, first = true, done = false;
  var self = { output: null, next: next };

  function frame(start, frac) {
    var i;
    for (i = 0; i < N; i++) {
      re[i] = (signal[start + i] * (1 - frac) + signal[start + i + 1] * frac) * win[i];
      im[i] = 0;
    }
    voiceFft(re, im);
    if (first) {
      // The first frame passes as it is.
      for (i = 0; i < bins; i++) { madeRe[i] = re[i]; madeIm[i] = im[i]; }
      first = false;
    } else {
      // Peaks: bins whose power is above both neighbors on each side (above the ones below it, and
      // at least the ones above it, so a flat top is one peak).
      for (i = 0; i < bins; i++) power[i] = re[i] * re[i] + im[i] * im[i];
      var count = 0;
      for (i = 2; i < bins - 2; i++) {
        if (power[i] > power[i - 1] && power[i] >= power[i + 1] && power[i] > power[i - 2] && power[i] >= power[i + 2]) peaks[count++] = i;
      }
      // Each peak's frequency from how far its phase moved over the input hop; its phase in the
      // output moves by that frequency over the output hop. turn = the rotation from its phase in
      // the input to its phase in the output.
      for (var p = 0; p < count; p++) {
        var b = peaks[p];
        var dRe = re[b] * lastRe[b] + im[b] * lastIm[b], dIm = im[b] * lastRe[b] - re[b] * lastIm[b];
        var off = Math.atan2(dIm, dRe) - (TWO_PI * b * hopIn) / N;
        off -= TWO_PI * Math.round(off / TWO_PI);
        var omega = (TWO_PI * b) / N + off / hopIn;
        var turn = Math.atan2(madeIm[b], madeRe[b]) + omega * hopOut - Math.atan2(im[b], re[b]);
        turnRe[b] = Math.cos(turn);
        turnIm[b] = Math.sin(turn);
      }
      // Every bin turns by its nearest peak's rotation (a tie goes to the later peak).
      var k = 0;
      for (i = 0; i < bins; i++) {
        var cRe = 1, cIm = 0;
        if (count > 0) {
          while (k + 1 < count && Math.abs(peaks[k + 1] - i) <= Math.abs(peaks[k] - i)) k++;
          cRe = turnRe[peaks[k]];
          cIm = turnIm[peaks[k]];
        }
        madeRe[i] = re[i] * cRe - im[i] * cIm;
        madeIm[i] = re[i] * cIm + im[i] * cRe;
      }
    }
    for (i = 0; i < bins; i++) { lastRe[i] = re[i]; lastIm[i] = im[i]; }
    // The inverse FFT, as the forward one of the conjugate, of the whole Hermitian spectrum.
    for (i = 0; i < bins; i++) { re[i] = madeRe[i]; im[i] = -madeIm[i]; }
    for (i = bins; i < N; i++) { re[i] = madeRe[N - i]; im[i] = madeIm[N - i]; }
    voiceFft(re, im);
    for (i = 0; i < N; i++) {
      out[at + i] += (re[i] / N) * win[i];
      norm[at + i] += win[i] * win[i];
    }
  }

  function next(frames) {
    while (!done && frames > 0) {
      var pos = (at / hopOut) * hopIn, start = Math.floor(pos);
      if (at + N > out.length || start + N + 1 > signal.length) {
        for (var o = 0; o < length; o++) if (norm[o] > 1e-3) out[o] /= norm[o];
        self.output = out.subarray(0, length);
        done = true;
      } else {
        frame(start, pos - start);
        at += hopOut;
        frames--;
      }
    }
    return done;
  }
  return self;
}

// One biquad over a whole signal, in direct form I: each sample from the two inputs and the two
// outputs before it, with the coefficients c already divided by a0. Gives a new array.
function voiceBiquad(signal, c) {
  var out = new Float32Array(signal.length);
  var x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (var n = 0; n < signal.length; n++) {
    var x0 = signal[n];
    var y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[n] = y0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return out;
}

// The RBJ audio EQ cookbook's high-pass of the second order, at hz and with the quality q, as the
// coefficients of a biquad at VOICE_RATE, divided by a0 as voiceBiquad has them.
function voiceHighPass(hz, q) {
  var w = (2 * Math.PI * hz) / VOICE_RATE, cw = Math.cos(w);
  var alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
  return {
    b0: (1 + cw) / 2 / a0, b1: -(1 + cw) / a0, b2: (1 + cw) / 2 / a0,
    a1: (-2 * cw) / a0, a2: (1 - alpha) / a0,
  };
}

// The cookbook's high shelf from hz up, of db, with a slope of 1: that makes its alpha
// sin(w) / 2 * sqrt(2), and beta below is the cookbook's 2 * sqrt(A) * alpha. A is 10 to the power
// of db / 40. The coefficients are in the same form as the high-pass's.
function voiceHighShelf(hz, db) {
  var A = Math.pow(10, db / 40);
  var w = (2 * Math.PI * hz) / VOICE_RATE, cw = Math.cos(w), sw = Math.sin(w);
  var beta = 2 * Math.sqrt(A) * ((sw / 2) * Math.SQRT2);
  var a0 = A + 1 - (A - 1) * cw + beta;
  return {
    b0: (A * (A + 1 + (A - 1) * cw + beta)) / a0,
    b1: (-2 * A * (A - 1 + (A + 1) * cw)) / a0,
    b2: (A * (A + 1 + (A - 1) * cw - beta)) / a0,
    a1: (2 * (A - 1 - (A + 1) * cw)) / a0,
    a2: (A + 1 - (A - 1) * cw - beta) / a0,
  };
}

// The gentle filter, as a new array: the low cut, then the high shelf. The low cut's Q of
// 1 / sqrt(2) is the flattest there is without a bump at its corner.
function voiceFilter(signal) {
  var lowCut = voiceHighPass(VOICE_LOW_CUT, Math.SQRT1_2);
  var shelf = voiceHighShelf(VOICE_SHELF, VOICE_SHELF_DB);
  return voiceBiquad(voiceBiquad(signal, lowCut), shelf);
}

// A signal's root mean square, its loudness: 0 for no samples.
function voiceRms(signal) {
  var sum = 0;
  for (var i = 0; i < signal.length; i++) sum += signal[i] * signal[i];
  return Math.sqrt(sum / Math.max(1, signal.length));
}

// Scales signal in place to an RMS of target, unless that would take its peak past VOICE_PEAK: then
// to a peak of VOICE_PEAK. A silent signal has no loudness to scale, and stays as it is. Gives the
// signal back.
function voiceLevel(signal, target) {
  var peak = 0, level = voiceRms(signal), i;
  for (i = 0; i < signal.length; i++) peak = Math.max(peak, Math.abs(signal[i]));
  var gain = level > 0 ? target / level : 1;
  if (peak * gain > VOICE_PEAK) gain = VOICE_PEAK / peak;
  for (i = 0; i < signal.length; i++) signal[i] *= gain;
  return signal;
}

// The whole WAV file for a signal, as bytes: a header of 44 bytes for 16-bit PCM, one channel, at
// VOICE_RATE, then each sample held to -1 to 1 and written as a little-endian 16-bit whole number.
function voiceWav(signal) {
  var bytes = new Uint8Array(44 + signal.length * 2), view = new DataView(bytes.buffer);
  function text(at, words) {
    for (var t = 0; t < words.length; t++) bytes[at + t] = words.charCodeAt(t);
  }
  // The RIFF chunk, whose size is everything after these eight bytes.
  text(0, "RIFF");
  view.setUint32(4, 36 + signal.length * 2, true);
  text(8, "WAVE");
  // The format chunk, 16 bytes: PCM (1), one channel, the rate, bytes a second, bytes a frame, and
  // bits a sample.
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, VOICE_RATE, true);
  view.setUint32(28, VOICE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  // The data chunk: the samples.
  text(36, "data");
  view.setUint32(40, signal.length * 2, true);
  for (var n = 0; n < signal.length; n++) {
    var x = Math.max(-1, Math.min(1, signal[n]));
    view.setInt16(44 + n * 2, Math.round(x * 32767), true);
  }
  return bytes;
}
`;
