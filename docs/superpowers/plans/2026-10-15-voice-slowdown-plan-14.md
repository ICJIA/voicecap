# Plan 14, a clearer slow-down on the voice page: the plan

> Build it task by task; each step is a checkbox (`- [ ]`).

**Goal:** the voice page slows a recording of NVDA's voice with voicecap's own stretcher, in the reader's browser, at 0.75×, 0.5×, and 0.3×, and plays the slowed copy in a second player in the first one's place; 1× is the recording as recorded.

**Architecture:**
- **The stretcher:** `src/share/voice-stretch.ts` holds `STRETCH_LIBRARY`, plain ES2017 functions as a string (as `CHECK_LIBRARY` is): a phase vocoder with identity phase locking, made in slices, the gentle filter, the loudness match, and a WAV writer. Tested in `node:vm`.
- **The page:** `VOICE_SCRIPT` wraps `STRETCH_LIBRARY` and the page's part in one function: it decodes a recording with `decodeAudioData`, makes a copy, and shows it in a second `<audio>` it adds after the first. The first player, its `data:` address, and the check are never touched. Where decoding fails, a section falls back to 0.18.0's `playbackRate` with `preservesPitch`.
- **The website:** a voice page's policy gets `media-src data: blob:`.

**Tech Stack:** TypeScript strict ESM, Node 22.19+, plain ES2017 in the page's script, the Web Audio API's `OfflineAudioContext.decodeAudioData` in the browser, Playwright's Chromium and Vitest 5 in the tests. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-15-voice-slowdown-design.md`. The owner approved it as written on 2026-10-15, including its "Choices for the owner to confirm".

## Global Constraints

- **Wording:** the recording is evidence, and the transcripts are the record of what was reviewed. voicecap's text never says a person listened to a run, never calls voicecap automated, and never names what it was built with. The page calls the stretcher "voicecap's own stretcher"; the README and Technical details name the method, "a phase vocoder with phase locking".
- **The speeds:** 1×, 0.75×, 0.5×, 0.3×. 1× plays the recording exactly as recorded, with no filter.
- **The stretcher's values:** 16,000 Hz, one channel; frames of 512 samples (32 ms) under a Hann window and a 512-point FFT; an output hop of 128 samples (8 ms) and an input hop of 128 × the speed, read at fractional positions by linear interpolation; identity phase locking; output exactly ⌊length ÷ speed⌋ samples; the filter a low cut at 100 Hz (Q 0.707) then a high shelf of −6 dB from 6 kHz (slope 1), at every slowed speed; the copy scaled to the recording's RMS and never past 0.98 at its peak; a WAV of 16-bit PCM, one channel, 16,000 Hz.
- **The page:** one file, loading nothing from outside; nothing plays by itself (a copy plays on only when the player in view was playing); at most 4 copies kept on the page, never dropping one in view; slices of about 20 ms of work.
- **The check is untouched:** the second player never has `data-slug` or `data-file`, and the first player's `src` is never changed.
- **The page's script:** plain ES2017 (no `?.`, `??`, class fields, or imports), its names inside one function, no markup in it (`innerHTML` and the like are never used).
- **The policy:** a voice page's is the shareable page's plus `media-src data: blob:`. No other page has a `media-src`. No worker and no connection are allowed.
- **Browsers:** Chrome first. Where the page can't decode a recording, that section falls back to the browser's own slow-down, for the rest of the visit.
- **Commands:** tests `pnpm exec vitest run <files>`; types `pnpm typecheck`; lint and format `pnpm lint` (`pnpm format` writes). Commit messages are plain sentences in the repo's style (see `git log`), with no trailers.

## Review Focus

1. **Speeds changed while a copy is being made:** the last choice wins, and a copy finished for an earlier choice never takes the place of the one picked last. (Task 4: "the last choice wins…")
2. **A page with more than four slowed copies:** never more than 4 `blob:` addresses alive, and never the one in view revoked. (Task 5: "keeps at most four copies…")
3. **One recording the browser can't decode:** only its section falls back; the others still make copies. (Task 4: "falls back for one section…")
4. **The website under its real policy:** making and playing a copy raises no policy violation. (Task 4: "makes and plays a copy under its policy…")
5. **The place in the speech across changes:** 1× at t, then 0.5× lands at t ÷ 0.5, then 0.3× at t ÷ 0.3, then 1× back at t, within 0.1 s; a player that was playing plays on. (Task 4: "keeps the place in the speech…")

## Files

- Create `src/share/voice-stretch.ts`: `STRETCH_LIBRARY`.
- Create `test/share-voice-stretch.test.ts`: the stretcher's tests, in `node:vm`.
- Modify `src/share/voice-page.ts`: the speed choice's markup (`speeds`), `SPEED_TOKEN`, `VOICE_SCRIPT`, the module's comments.
- Modify `src/share/text.ts`: `VOICE_TEXT` (the speeds, the lead, the status words, the second player's name) and, in Task 7, `TIMELINE`.
- Modify `src/share/html/style.ts`: `VOICE_CSS` (the status line).
- Modify `src/site/headers.ts`, `src/site/build.ts` (comments), `src/site/technical-text.ts`.
- Modify the tests: `test/share-voice-page.test.ts`, `test/share-browser.test.ts` ("the voice page"), `test/site-headers.test.ts`, `test/site-build.test.ts`, `test/site-served.test.ts`, `test/site-technical.test.ts`, and, in Task 7, `test/share-document.test.ts`.
- Modify `README.md`, `CHANGELOG.md`, `docs/phase-c-handoff.md`.

---

### Task 1: The stretcher

**Files:**
- Create: `src/share/voice-stretch.ts`
- Test: `test/share-voice-stretch.test.ts`

**Interfaces:**
- Produces: `export const STRETCH_LIBRARY: string`, plain ES2017 declaring, at its top level and touching no DOM:
  - `var VOICE_RATE = 16000` and the other constants below;
  - `voiceStretcher(signal: Float32Array, speed: number): { next(frames: number): boolean; output: Float32Array | null }`: `next` makes up to `frames` more frames and returns `true` once the copy is finished, when `output` is the copy, exactly ⌊`signal.length` ÷ `speed`⌋ samples;
  - `voiceFilter(signal: Float32Array): Float32Array` (a new array);
  - `voiceRms(signal: Float32Array): number`;
  - `voiceLevel(signal: Float32Array, target: number): Float32Array` (scales `signal` in place to RMS `target`, unless its peak would pass `VOICE_PEAK`, when the peak is `VOICE_PEAK`; returns it);
  - `voiceWav(signal: Float32Array): Uint8Array` (the whole WAV file, samples clamped to ±1, then `Math.round(x * 32767)`).

- [ ] **Step 1: Write the failing tests** in `test/share-voice-stretch.test.ts`, loading the library as the check's tests load `CHECK_LIBRARY`:

```ts
const lib = vm.runInNewContext(
  STRETCH_LIBRARY + ";({ voiceStretcher, voiceFilter, voiceRms, voiceLevel, voiceWav, VOICE_RATE })",
  {},
);
const R = 16_000;
const tone = (hz: number, seconds: number, amp = 0.5) =>
  Float32Array.from({ length: Math.round(seconds * R) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / R));
const stretch = (signal: Float32Array, speed: number, slice = 1e9): Float32Array => {
  const made = lib.voiceStretcher(signal, speed);
  while (!made.next(slice));
  return made.output;
};
```

Tests, each with these assertions:
- "makes a copy exactly ⌊length ÷ speed⌋ samples long": for a signal of `3 * R + 7` samples, at 0.75, 0.5, and 0.3: `stretch(s, speed).length === Math.floor(s.length / speed)`.
- "keeps a tone's pitch": a 220 Hz tone of 2 s at each speed; in the copy's middle second, sign changes ÷ 2 is within 2 of 220.
- "gives the same samples made in slices as made at once": `stretch(s, 0.3, 7)` equals `stretch(s, 0.3)` sample for sample.
- "keeps silence silent, and every sample a finite number": silence, an impulse, a full-scale square wave (period 80 samples), a constant 0.7, and 100 samples of 0.3, at 0.3 and 0.75, through `voiceFilter(stretch(…))`: every sample finite, silence all 0, and the 100 samples give `Math.floor(100 / speed)` samples.
- "filters as the spec says": a 2 s tone's RMS out of `voiceFilter` over its last second, against in, in dB: at 50 Hz below −10; at 1 kHz within 0.5 of 0; at 6 kHz within 0.5 of −3; at 7 kHz within 1 of −6.
- "matches the loudness, and caps the peak": `voiceLevel(stretch(tone(220, 2, 0.2), 0.3), 0.1)` has RMS within 0.001 of 0.1; with target 0.9, its peak is 0.98 within 1e-6 and its RMS under 0.9.
- "writes a WAV of 16-bit PCM, one channel, 16,000 Hz": `voiceWav(Float32Array.from([0, 0.5, -1, 1.5]))` is 52 bytes: "RIFF", 44, "WAVE", "fmt ", 16, 1, 1, 16000, 32000, 2, 16, "data", 8, then the samples 0, 16384, −32767, 32767 (little-endian).
- "is plain ES2017 with no DOM": `new vm.Script(STRETCH_LIBRARY)` doesn't throw; the library has no `document`, `window`, `?.`, `??`, `import`, or backtick, and runs in an empty context.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run test/share-voice-stretch.test.ts`
Expected: FAIL, as `../src/share/voice-stretch.js` doesn't exist.

- [ ] **Step 3: Write `STRETCH_LIBRARY` in `src/share/voice-stretch.ts`**, as `String.raw` with a module comment in the style of `src/share/check.ts`'s, and each constant with its reason:

```text
VOICE_RATE = 16000     the recordings' rate (16 kHz mono)
VOICE_FRAME = 512      32 ms frames: fine enough in time for NVDA's quick syllables
VOICE_HOP = 128        an 8 ms output hop, four frames over each sample
VOICE_LOW_CUT = 100    Hz: under the voice, rumble and the codec's hum
VOICE_SHELF = 6000     Hz, and VOICE_SHELF_DB = -6: eases the hiss a slowed voice makes plainer
VOICE_PEAK = 0.98      a copy never passes this at its peak
```

The phase vocoder is the one the owner chose by ear on 2026-10-15; write it as follows (the FFT is an in-place iterative radix-2, `voiceFft(re, im)`, with twiddles stepped by complex multiplication):

```js
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
      // Peaks: bins whose power is above both neighbours on each side.
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
```

`voiceFilter` is two biquads in series (direct form I), with the RBJ cookbook's coefficients at `VOICE_RATE`: a high-pass at `VOICE_LOW_CUT` with Q `Math.SQRT1_2`, then a high shelf at `VOICE_SHELF` of `VOICE_SHELF_DB`, slope 1 (alpha = sin(w) / 2 · √2).

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm exec vitest run test/share-voice-stretch.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, types, commit**

Run: `pnpm typecheck && pnpm lint`
```bash
git add src/share/voice-stretch.ts test/share-voice-stretch.test.ts
git commit -m "Add voicecap's own stretcher for the voice page: a phase vocoder with phase locking, made in slices, the gentle filter, and a WAV writer, as plain functions the page can hold"
```

---

### Task 2: The speed choice's markup and words

**Files:**
- Modify: `src/share/text.ts` (`VOICE_TEXT`), `src/share/voice-page.ts` (`speeds`, the module comment, `SPEED_TOKEN`), `src/share/html/style.ts` (`VOICE_CSS`)
- Test: `test/share-voice-page.test.ts`, `test/site-technical.test.ts`, `test/share-browser.test.ts`

**Interfaces:**
- Produces, for Task 4:
  - `export const SPEED_TOKEN = "{speed}"` in `src/share/voice-page.ts`;
  - `VOICE_TEXT.speed.rates = [1, 0.75, 0.5, 0.3]`;
  - `VOICE_TEXT.speed.making(speed: string): string` → `Getting ${speed} ready…`;
  - `VOICE_TEXT.speed.made(speed: string): string` → `${speed} is ready.`;
  - `VOICE_TEXT.speed.own: string` → `This browser slows it down with its own stretcher.`;
  - `VOICE_TEXT.slowed(path: string, speed: string): string` → `NVDA's voice on ${path}, at ${speed}`;
  - each section's speed choice, as the script finds it:

```html
<fieldset class="speeds" hidden data-making="Getting {speed} ready…" data-made="{speed} is ready." data-own="This browser slows it down with its own stretcher." data-slowed="NVDA's voice on /about/, at {speed}"><legend>Speed<span class="sr"> on /about/</span></legend><div class="speed-choices">…the four radios…</div><p class="speed-status" role="status"></p></fieldset>
```

- [ ] **Step 1: Write the failing tests** in `test/share-voice-page.test.ts`:
  - "offers each player's speeds as a group that starts hidden, which the script shows": the labels are `["1×", "0.75×", "0.5×", "0.3×"]` (was 0.25×).
  - "gives each speed choice the words its script says, with the speed left to fill in": a section's fieldset has `data-making="Getting {speed} ready…"`, `data-made="{speed} is ready."`, `data-own="This browser slows it down with its own stretcher."`, `data-slowed="NVDA's voice on /about/, at {speed}"`, all escaped as `esc` does, and ends with an empty `<p class="speed-status" role="status"></p>`.
  - "says what the plan fixes, in its words" (line 217): the lead is the spec's, "What NVDA said aloud on each page while voicecap read it, recorded from NVDA alone and sealed with the run. NVDA spoke fast: choose a slower speed, and voicecap's own stretcher slows it down in your browser, with the pitch kept and nothing sent anywhere. The transcripts on the shareable page are the record of what was reviewed."; 0.3× in place of 0.25× in its list.
  - In `test/site-technical.test.ts:971`: `"1×, 0.75×, 0.5×, and 0.3×"`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run test/share-voice-page.test.ts test/site-technical.test.ts`
Expected: FAIL on the speeds, the attributes, and the lead.

- [ ] **Step 3: Make the change:** `VOICE_TEXT` as in the Interfaces; `speeds(card)` writes the four `data-` attributes from `VOICE_TEXT` with `SPEED_TOKEN` for the speed (and the card's path for `data-slowed`), and the status line last; `VOICE_CSS` adds `.speed-status { margin: 4px 0 0; min-height: 1.25em; font-size: 0.82rem; color: var(--muted); }`, kept inside the 2,500-character budget its test sets; the comments that say 0.25× (`voice-page.ts` lines 10–11, `technical-text.ts` line 128) say 0.3×.

- [ ] **Step 4: Bring the browser tests to 0.3×:** in `test/share-browser.test.ts`'s "the voice page", `SPEEDS` is `[1, 0.75, 0.5, 0.3]`, and every "0.25×", `0.25`, and `value="0.25"` there is 0.3, with the script still setting `playbackRate` until Task 3.

- [ ] **Step 5: Run them to see them pass**

Run: `pnpm exec vitest run test/share-voice-page.test.ts test/site-technical.test.ts`, then `pnpm exec vitest run test/share-browser.test.ts -t "the voice page"`
Expected: PASS.

- [ ] **Step 6: Lint, types, commit**

```bash
git add src/share/text.ts src/share/voice-page.ts src/share/html/style.ts src/site/technical-text.ts test/share-voice-page.test.ts test/site-technical.test.ts test/share-browser.test.ts
git commit -m "Offer the voice page's speeds as 1x, 0.75x, 0.5x, and 0.3x, and give each speed choice a status line and the words its script will say"
```

---

### Task 3: The website's policy

**Files:**
- Modify: `src/site/headers.ts` (`contentSecurityPolicy`, its comment), `src/site/build.ts` (the comments at lines 58 and 991), `src/site/technical-text.ts` (the policy's line, about line 597)
- Test: `test/site-headers.test.ts`, `test/site-build.test.ts`, `test/site-served.test.ts`, `test/site-technical.test.ts`

**Interfaces:**
- Produces: `contentSecurityPolicy(hashes, { media: true })` gives `media-src data: blob:` where it gave `media-src data:`; nothing else changes.

- [ ] **Step 1: Write the failing tests:**
- `test/site-headers.test.ts` (lines 428–453) and `test/site-build.test.ts` (lines 3832–3915): every `media-src data:` expected is `media-src data: blob:`; a policy without `media` still has no `media-src`.
- `test/site-served.test.ts`: the expected `media-src data:;` (lines 825, 937, 961) is `media-src data: blob:;`, and "would be refused its recordings under the shareable page's policy…" keeps its assertions. (The served page's test of a copy comes with the script, in Task 4.)
- `test/site-technical.test.ts:1001`: "A voice page's policy also lets it play audio from the recordings it holds, as data: addresses, and from the slowed copies its script makes of them, as blob: addresses (media-src data: blob:); no other page's does."

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run test/site-headers.test.ts test/site-build.test.ts test/site-served.test.ts test/site-technical.test.ts`
Expected: FAIL where they expect `blob:`.

- [ ] **Step 3: Make the change:** the directive, `headers.ts`'s comment (the recordings as `data:` addresses, and the copies its script makes as `blob:` addresses, made in the reader's browser by the page's own script), the two comments in `build.ts`, and the line in `technical-text.ts` as the test has it (`{ code: "media-src data: blob:" }`).

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm exec vitest run test/site-headers.test.ts test/site-build.test.ts test/site-served.test.ts test/site-technical.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, types, commit**

```bash
git add src/site/headers.ts src/site/build.ts src/site/technical-text.ts test/site-headers.test.ts test/site-build.test.ts test/site-served.test.ts test/site-technical.test.ts
git commit -m "Let a voice page play the slowed copies its script makes: media-src data: blob: in its policy, and no other change"
```

---

### Task 4: The page's script: a copy made and shown, and the fallback

**Files:**
- Modify: `src/share/voice-page.ts` (`VOICE_SCRIPT` and its comment)
- Test: `test/share-voice-page.test.ts` ("the player's script and rules"), `test/share-browser.test.ts` ("the voice page"), `test/site-served.test.ts` (the voice page's tests)

**Interfaces:**
- Consumes: `STRETCH_LIBRARY` (Task 1); the markup and `SPEED_TOKEN` (Task 2); the policy's `media-src data: blob:` (Task 3).
- Produces: `VOICE_SCRIPT` = `"\n(function () {\n  \"use strict\";\n"` + `STRETCH_LIBRARY` + the page's part + `"})();\n"`. The behavior below.

**The behavior** (for each `fieldset.speeds`, wired inside a `try` as now):
- The first player is its `article`'s `audio[data-file]`. On load: `preservesPitch = true`, `playbackRate` and `defaultPlaybackRate` 1, as now; 1× is chosen; the group is shown. The second player, an `audio` with `controls`, `preload="auto"`, and no `data-` attributes, is made the first time a copy is shown, right after the first; until then the page has only its first players. The script touches `window` only when a choice is made (a test runs it with a `document` and nothing else).
- **The place in the speech** is the player in view's `currentTime` times its speed (1 for the first). A player shown is given `currentTime` = that place ÷ its speed, set straight after its `src` (a browser keeps it as the start of a file still loading). If the player in view was playing (`!paused`), it's paused and the one shown is played (`play()`'s promise caught).
- **1×:** the section's job, if any, is dropped; the first player is shown at the place; the second is hidden; the status line is emptied.
- **0.75×, 0.5×, 0.3×:** with a copy at that speed kept, it's shown at once. Otherwise the status line says `data-making` with the speed's label, and a job starts, while the player in view carries on: decode the first player's `data:` address (`atob` to bytes, then `decodeAudioData` on `new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, VOICE_RATE)`, by its promise or its callbacks); make the copy with `voiceStretcher`, in slices of `next(8)` until 20 ms have passed (`performance.now()`), with `setTimeout(…, 0)` between slices; then `voiceFilter`, `voiceLevel` to the decoded recording's `voiceRms`, `voiceWav`, `new Blob([bytes], { type: "audio/wav" })`, `URL.createObjectURL`. Shown: the second player gets the copy's address, its `aria-label` is `data-slowed` with the label, the first is hidden, and the status line says `data-made` with the label.
- **The last choice wins:** each choice increments the section's job number; a job checks it before each slice and after decoding, and one that's no longer the latest stops and keeps nothing.
- **The radios:** in a section that hasn't fallen back, the chosen speed is shown while the player in view is at `playbackRate` 1, and none otherwise (`ratechange` on both players).
- **The fallback**, for the section, for the rest of the visit: when there's no `OfflineAudioContext`, decoding throws or is refused, or making the copy throws. The first player is shown at the place, at the chosen speed by 0.18.0's code (`preservesPitch = true`, then `playbackRate` and `defaultPlaybackRate` in a `try`, the radios following its speed); the status line says `data-own`. Every later choice in the section works that way.

- [ ] **Step 1: Write the failing tests.** In `test/share-voice-page.test.ts`, "is plain browser JavaScript…": `VOICE_SCRIPT` contains `STRETCH_LIBRARY` and `SPEED_TOKEN`, starts with `"\n(function () {\n"`, ends with `"})();\n"`, has no `<`, no `innerHTML`, `outerHTML`, or `insertAdjacentHTML`, and no markup attribute (`/\b(style|src|href)\s*=\s*["'\`]/i`, which replaces the old `/\b(style|src|href)\s*=/i`, since the script now sets a player's `src` property); it's under 16,000 characters (was 3,500: the stretcher is most of it). Keep "sets the pitch explicitly…" and "leaves a page without its markup alone".

In `test/share-browser.test.ts`'s "the voice page", replace "the speed choice sets playbackRate and keeps the pitch" with these (the page opened from its file, as `open` does):
- "makes a slowed copy and shows it in a second player in the first one's place": check 0.3× in the first group; poll until a visible `audio` with no `data-file` has a `src` starting `blob:`; its `duration` is the recording's length (its record's `seconds`) ÷ 0.3 within 1%; the first player is hidden and its `src` is the `data:` address it had; the status line reads "0.3× is ready."; the second player's name is "NVDA's voice on /, at 0.3×"; 0.3 is the only radio checked; nothing has played.
- "says it's getting a copy ready, then that it's ready": a `MutationObserver` added by `addInitScript` keeps the first status line's texts; checking 0.5× gives `["Getting 0.5× ready…", "0.5× is ready."]`.
- "keeps the place in the speech across speeds" (Review Focus 5): the first player's `currentTime` set to 1.2; 0.5× → the second's `currentTime` within 0.1 of 2.4; 0.3× → of 4.0; 1× → the first's of 1.2, shown, and the second hidden.
- "plays on in the copy when the player in view was playing" (Review Focus 5): `addInitScript` makes `HTMLMediaElement.prototype.play` and `pause` record the element each was called on (`play` resolving); with the first player made to report `paused` false (a getter on the element), checking 0.5× calls `play()` on the second player only, and `pause()` on the first.
- "the last choice wins while a copy is being made" (Review Focus 1): in one `page.evaluate`, click the 0.3× radio and then the 0.5× radio; then poll: the second player shows a copy whose `duration` is the recording's length ÷ 0.5 within 1%, the status line reads "0.5× is ready.", 0.5 is checked, and it stays so for 1 s more.
- "falls back to the browser's own slow-down when it can't decode": `addInitScript` makes `BaseAudioContext.prototype.decodeAudioData` refuse; checking 0.3× sets the first player's `playbackRate` 0.3 with `preservesPitch` true, no second player is shown, the status line reads "This browser slows it down with its own stretcher."; then 0.75× sets 0.75 at once.
- "falls back for one section, and the others still make copies" (Review Focus 3): the same refusal for the first call only; the first section falls back at 0.5×, and the second makes a `blob:` copy at 0.5×.
- The old "catches the error a browser throws…", "shows the speed a player is at when something else changes it", and "keeps the pitch from the start…" each run with `decodeAudioData` refused (the fallback), with 0.3 for 0.25.
- "Check the fingerprints passes…": first make a 0.3× copy in the first section; the check still reads "3 of 3 recordings match their fingerprints".
- "works by keyboard alone": the arrow keys on the first group now give copies: after each of `ArrowDown` (0.75), `ArrowRight` (0.5), `ArrowDown` (0.3), and `ArrowUp` (0.5), poll until the second player shows a copy whose `duration` is the recording's length ÷ that speed within 1%; Tab from the group reaches the next section's controls, and never a hidden player.
- Wherever a test counts or lists the page's players after a slower speed was picked, it takes the first players, `audio[data-file]`, unless it means the second.

In `test/site-served.test.ts`'s voice page tests:
- "runs its speed choice and its check under the policy…": checking 0.5× now makes a copy: poll until a second player has a `blob:` `src` and a `duration`, and the first player is still at `playbackRate` 1; the check and the theme as before; no violation.
- A new test, "makes and plays a copy under its policy, with no violation" (Review Focus 4): on the served voice page, check 0.3× in the first group; poll until the second player has a `blob:` `src` and a `duration` (it loaded, as `lengthsOf` waits for one); `violationsOf(page)` is `[]`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run test/share-voice-page.test.ts test/site-served.test.ts`, then `pnpm exec vitest run test/share-browser.test.ts -t "the voice page"`
Expected: FAIL: no second player, no `blob:` address, the old script's size.

- [ ] **Step 3: Write `VOICE_SCRIPT`'s page part** to the behavior above, and its comment in the style of the current one: what it does, step by step, and that nothing plays by itself.

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm exec vitest run test/share-voice-page.test.ts test/site-served.test.ts`, then `pnpm exec vitest run test/share-browser.test.ts -t "the voice page"`, then the whole suite once, `pnpm test`, since every page with a voice page carries this script
Expected: PASS.

- [ ] **Step 5: Lint, types, commit**

```bash
git add src/share/voice-page.ts test/share-voice-page.test.ts test/share-browser.test.ts test/site-served.test.ts
git commit -m "Slow a recording on the voice page with voicecap's own stretcher: a copy made in the reader's browser, played in a second player in the first one's place, and the browser's own slow-down where it can't"
```

---

### Task 5: Copies kept, the browser's own speed menu, and the page's checks

**Files:**
- Modify: `src/share/voice-page.ts` (`VOICE_SCRIPT`)
- Test: `test/share-browser.test.ts` ("the voice page")

**Interfaces:**
- Consumes: Task 4's script.
- Produces: the copies kept, page-wide: a list of `{ section, speed, url }`, the most recently shown last. A copy made or shown again goes to the end. While there are more than 4, the oldest one that isn't in view (a visible second player's `src`) is dropped: `URL.revokeObjectURL`, and out of its section's copies.

- [ ] **Step 1: Write the failing tests** in "the voice page":
- "keeps at most four copies on the page, never the one in view" (Review Focus 2): `addInitScript` wraps `URL.createObjectURL` and `URL.revokeObjectURL` to keep the set of live `blob:` addresses. Make, in order: the first section at 0.3×, 0.5×, 0.75×; the second at 0.3×; the third at 0.3×. Then 4 are live; the first made (the first section's 0.3×) was revoked; each section's copy in view is live; checking the first section's 0.3× again makes it anew and shows it.
- "shows no speed chosen while a copy plays at another speed": with the 0.5× copy shown, setting its `playbackRate` to 1.5 checks none; back to 1 checks 0.5 again.
- "is axe-clean in both themes at %i px…": before the first axe run, the first section shows its 0.3× copy, and the status line has its words.
- "loads nothing from outside the file": also after a 0.3× copy is made.
- "plays with scripts off…": unchanged, and passes (no second player, the groups hidden).

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run test/share-browser.test.ts -t "voice page"`
Expected: FAIL on the copies kept (five stay alive).

- [ ] **Step 3: Add the copies kept to `VOICE_SCRIPT`,** and anything the checks need (the status line's look, if axe asks).

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm exec vitest run test/share-browser.test.ts -t "voice page"`
Expected: PASS.

- [ ] **Step 5: Lint, types, commit**

```bash
git add src/share/voice-page.ts src/share/html/style.ts test/share-browser.test.ts
git commit -m "Keep at most four slowed copies on a voice page, never dropping the one in view, and check the page by keyboard, with axe, and with no script with a copy showing"
```

---

### Task 6: The README, Technical details, the CHANGELOG, and the handoff

**Files:**
- Modify: `README.md`, `src/site/technical-text.ts` (the voice page's sentence, about line 318), `CHANGELOG.md`, `docs/phase-c-handoff.md`
- Test: `test/site-technical.test.ts`

- [ ] **Step 1: Write the failing test** in `test/site-technical.test.ts` for the voice page's sentence: "When a page has a recording of NVDA's voice, the share adds a voice page, which plays each recording at 1×, 0.75×, 0.5×, and 0.3×: 1× as recorded, and each slower speed made in the reader's browser by voicecap's own stretcher, a phase vocoder with phase locking, then a gentle filter (a low cut at 100 Hz, and the highs eased by 6 dB from 6 kHz), with the pitch kept." followed by the rest of the current sentence.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run test/site-technical.test.ts`
Expected: FAIL on the sentence.

- [ ] **Step 3: Write the docs:**
- `technical-text.ts`: the sentence as the test has it.
- `README.md`:
  - "NVDA's voice" (line 1006): "plays the recordings at slower speeds: 1×, 0.75×, 0.5×, and 0.3×. 1× is the recording as recorded; each slower speed is made in the reader's browser by voicecap's own stretcher, with the pitch kept, so NVDA sounds slow, not low, and its words stay easy to follow."
  - The section's bullet (line 1033): the speed choice "sets the player's speed" becomes: picking a slower speed makes a slowed copy in the browser (a phase vocoder with phase locking, then a low cut at 100 Hz and the highs eased by 6 dB from 6 kHz, at the recording's own loudness), which plays in a second player in the first one's place, from the same point in the speech; at most 4 copies are kept on the page; nothing is saved or sent anywhere; in a browser that can't decode the recording in the page, the speed choice slows the player with the browser's own stretcher, and says so.
  - The policy's bullet (line 2121): `media-src data: blob:`, with the copies as `blob:` addresses.
  - Known limitations (line 2576) stays; its link to "NVDA's voice" still holds.
- `CHANGELOG.md`, under `[Unreleased]`, a `### Changed` entry in the style of 0.18.0's: "**A clearer slow-down on the voice page: voicecap's own stretcher, in the reader's browser.**" with sub-bullets: how it works (decoded in the page, the phase vocoder, the filter, the loudness, a WAV played from a `blob:` address in a second player, from the same point in the speech, at most 4 copies, nothing saved or sent); the speeds (0.3× in place of 0.25×, the owner's choice by ear); where a browser can't (its own slow-down, per section, with a line that says so); the policy (`media-src data: blob:`); and that a voice page shared before 0.19.0 keeps the browser's slow-down until it's shared again.
- `docs/phase-c-handoff.md`, under "Being built": "plan 14, a clearer slow-down on the voice page (0.19.0): voicecap's own stretcher in the reader's browser; spec `docs/superpowers/specs/2026-10-15-voice-slowdown-design.md`."

- [ ] **Step 4: Run the test, then the whole suite**

Run: `pnpm exec vitest run test/site-technical.test.ts`, then `pnpm test`
Expected: PASS, the whole suite included.

- [ ] **Step 5: Lint, types, commit**

```bash
git add README.md src/site/technical-text.ts test/site-technical.test.ts CHANGELOG.md docs/phase-c-handoff.md
git commit -m "Say how the voice page slows a recording now, in the README, on Technical details, in the CHANGELOG, and in the handoff"
```

---

### Task 7: Prepare 0.19.0

**Files:**
- Modify: `CHANGELOG.md`, `src/share/text.ts` (`TIMELINE`), `test/share-document.test.ts`

- [ ] **Step 1: The CHANGELOG's entry** moves from `[Unreleased]` to `## [0.19.0] - <the release day>`, with a one-line summary under the heading in the style of 0.18.0's.
- [ ] **Step 2: The timeline's row,** after 0.18.0's: `{ date: "<the release day>", release: "0.19.0", pc: null, mac: null, both: "<b>0.19.0</b>: a clearer slow-down on the voice page: voicecap's own stretcher, in the reader's browser, at 0.75×, 0.5×, and 0.3×." }`.
- [ ] **Step 3: Re-pin "adds no line, and no change, for a run from before 0.18.0"** in `test/share-document.test.ts`: run it, log what its loop computes (each model's `[page.length, sha(page)]` and `[word.length, sha(word)]`), paste the new values in, and add a line to its comment: "Prepare 0.19.0 re-pinned all three for the timeline's 0.19.0 row." Every model's page and Word copy must change by the same number of characters, as a timeline row gives.
- [ ] **Step 4: The whole suite, lint, types**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md src/share/text.ts test/share-document.test.ts
git commit -m "Prepare 0.19.0: its CHANGELOG entry, the timeline's row, and the three pinned reports re-pinned for it"
```

## After the tasks: the check and the release

These need the owner, and aren't for the implementer:
1. **The owner's look:** the branch built (`pnpm build`); a copy of `sfs.icjia.illinois.gov` from the transcripts repo in a scratch folder, never the repo itself; `node dist/cli.js share` there, with `VOICECAP_TRANSCRIPTS` pointing at the scratch folder; the owner opens the new `.voice.html` in Chrome at the PC and plays a page at 0.3×.
2. **Merge** the branch to `main`, and push on the owner's word.
3. **Release** with `./publish.sh minor` and the owner's npm code. Check `npm whoami` first.
4. **The website:** the netlify.toml pin to 0.19.0 ten minutes after npm's stamp; then sfs and dvfr shared again with 0.19.0, committed and pushed in the transcripts repo; then each live copy checked against its shared file.
