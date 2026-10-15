# A clearer slow-down on the voice page: voicecap's own stretcher

## Why

The voice page (from 0.18.0) plays each recording of NVDA's voice at 1×, 0.75×, 0.5×, and 0.25×, slowed by the browser's own stretcher with the pitch kept. On 2026-10-14, the owner found the slowed recordings hard to make out. A sample made with a speech stretcher of voicecap's own, with a gentle filter after it, at 0.5× and 0.25×, changed that:

> "speed stretcher with gentle filler at .25x sounds pretty darn good!"

On 2026-10-15, with the stretcher running in the page itself (Chrome, on the PC):

> ".25 sounds ok. it was slow, yeah, but I could make out the words better."

> "maybe .30? .35 works, but it's fast. The voice has warble. Is it possible to decrease the warble? You can make it out -- but it takes concentration at .25 and .35"

Three ways of slowing the same recording to 0.30× were then put side by side, matched in loudness (see "How it was chosen"). The owner chose the frequency stretcher:

> ".30, stretcher -- no steady blend. That seems to be the sweet spot."

> "yes -- B sounds the best. I don't think this audio will be used much -- but it's there, at least if someone wants it. But B is the easiest to hear without concentraing hard."

And on who reads these pages, and where:

> "this will mostly be used on a PC by auditors and lawyers -- so phone/safari is not critical. That could be added when we do the Mac phase."

> "and even on a macmini or macbook -- folks will still use Chrome. iPhone use is interesting -- but not at all required or expected."

So this is a small change for a rarely used part: it should make a slowed recording easy to follow in Chrome, keep everything else as it is, and stay lean. The recording is still evidence, and the person's review is still made from the transcripts, by reading what NVDA said.

**This spec was settled on 2026-10-15;** every choice the owner hasn't confirmed is listed under "Choices for the owner to confirm", each easy to change.

## What it is

- The voice page slows a recording with voicecap's own stretcher, in the reader's browser, instead of the browser's: a phase vocoder with phase locking, then the gentle filter.
- The speeds are 1×, 0.75×, 0.5×, and 0.3×. 1× plays the recording exactly as recorded, with no filter.
- A slowed copy is made from the recording the page already holds, in the reader's browser, and kept only for the visit. Nothing is saved, and nothing is sent anywhere.
- The recordings, the run's records, the seal, `voicecap verify`, and the voice page's "Check the fingerprints" don't change.

## How it was chosen

- **2026-10-14, a sample.** One recording from the sfs run of 2026-10-14 (the /resources page, 124 s), decoded in Node, slowed by a WSOLA stretcher (32 ms frames, half overlap, a search of ±10 ms), with and without the filter, and encoded at 32 kbps. The owner's verdict on 0.25× with the filter is above.
- **2026-10-15, a check page in Chrome,** holding the same recording:
  - Chrome decodes voicecap's WebM/Opus in a page script with the Web Audio API's `decodeAudioData`, at 16 kHz: 123.8 s in 0.11 s.
  - Three stretchers at 0.30×, each with the filter, matched in loudness: **A**, the WSOLA of the sample; **B**, a phase vocoder with identity phase locking; **C**, the WSOLA with 20 ms frames and a crossfade that keeps the loudness steady by how alike its two sides are. Then B at 0.25× and 0.35×.
  - Measured on that recording: the share of the loudness envelope's modulation that falls at 40 to 80 Hz, where a WSOLA's 16 ms hop warbles, was 7.3% in the recording as it is, 10.9% for A, 9.5% for C, and 1.1% for B; the spectral flux (how much the spectrum changes from one 8 ms step to the next, relative to its energy) was 0.207 for A, 0.183 for C, and 0.105 for B.
  - B took 1.0 to 1.5 s in Chrome for each speed, A 1.3 s, and C 1.9 s.
  - The owner chose B at 0.30×.
- **Tried and dropped: one voice period at a time** (a pitch-synchronous overlap-add). NVDA's voice at a run's speed changes pitch too quickly, and only about a fifth of its speech is steadily voiced, so a pitch tracker has too little to hold.

## The stretcher

- **Its input:** the recording, decoded in the page by `decodeAudioData` on an `OfflineAudioContext` of one channel at 16,000 Hz, the recordings' own rate.
- **The phase vocoder:**
  - frames of 512 samples (32 ms), each under a Hann window, and a 512-point FFT;
  - an output hop of 128 samples (8 ms), and an input hop of 128 × the speed (38.4 samples at 0.3×), read at fractional positions by linear interpolation;
  - **identity phase locking** (Laroche and Dolson, 1999): a frame's peaks are the bins whose power is above both neighbors on each side; each peak's frequency comes from how far its phase moved since the last frame; its phase in the output moves by that frequency over the output hop; and every other bin turns by the rotation of its nearest peak, a complex multiply;
  - the first frame passes as it is;
  - each frame is added in under the same Hann window, and the sum is divided by the sum of the squared windows;
  - the result is exactly ⌊length ÷ speed⌋ samples long.
- **The gentle filter,** after it, at every slowed speed: a low cut at 100 Hz (a second-order high-pass, Q 0.707), then a high shelf of −6 dB from 6 kHz (slope 1). Both are the usual biquad formulas, with the values and their reasons kept as named constants.
- **Its loudness:** the slowed copy is scaled to the recording's own RMS, and never past 0.98 at its peak.
- **What it gives:** a WAV of 16-bit PCM, one channel, 16,000 Hz, as a `Blob`, played from a `blob:` address. 0.3× of a two-minute recording is about 7 minutes and 13 MB.
- **It's made in slices** of about 20 ms of work each, with the page free between them, so the page never stops answering while a copy is made (1 to 2 s for a two-minute recording in Chrome, about 5 s for a ten-minute one).

## The voice page

- **What doesn't change:** each page's first player, with its `data:` address, its name, and the `data-slug` and `data-file` the check reads; what's said of its file; the check; the page with no script, which shows its players alone.
- **The speed choice** is the same radio group under "Speed", with 0.3× in place of 0.25×: 1× (chosen), 0.75×, 0.5×, 0.3×.
- **A status line** under each speed choice, `role="status"`, empty until it has something to say.
- **Picking 0.75×, 0.5×, or 0.3×:**
  1. If a copy at that speed is ready, it's shown at once. If not, the status line says "Getting 0.3× ready…", and the page decodes the recording and makes the copy, while the player in view carries on as it was.
  2. When the copy is ready, a second player shows it in the first one's place, at the same point in the speech (the time divided by the speed), and plays on if the player in view was playing. The status line says "0.3× is ready." The first player is hidden, and paused if it was playing. The second player is a native audio element with its controls, made by the script once per section and named "NVDA's voice on /resources/, at 0.3×".
  3. Picking another speed while a copy is being made drops that copy and starts the one picked.
- **Picking 1×** brings the first player back at the same point in the speech, playing on if the second was, and hides the second.
- **Copies kept:** each copy stays for the visit, so going back to a speed already made is instant. The page keeps at most 4 copies at once: making a fifth drops the one used longest ago (its `blob:` address is revoked), never the one in view.
- **When a browser can't:** if the page can't decode a recording (no `OfflineAudioContext`, or `decodeAudioData` refuses it, as Safari may), or making its copy fails, that page's section falls back for the rest of the visit: its choice sets the first player's speed with `playbackRate` and `preservesPitch`, as 0.18.0's does, and its status line says "This browser slows it down with its own stretcher." The other sections carry on as they were. So a page is never left without a slower speed.
- **The browser's own speed menu** on either player still works. When the player in view isn't at its normal speed, no choice is shown chosen, as today.
- **Accessibility:** the second player is a native control with its own name; focus stays on the speed choice; the hidden player is out of the page's reading order (`hidden`); the status line is polite, says what's happening and when it's done, and gives no running percentage, which a screen reader would read out at every step. The page meets the same checks as now: axe at 1280, 390, and 320 pixels in both themes, keyboard alone, and with no script.
- **The words** are `VOICE_TEXT`'s, in the markup the script reads (the status line's and the second player's words in `data-` attributes on the speed choice), as the speed labels are.
- **The lead** says how the slower speeds are made: "NVDA spoke fast: choose a slower speed, and voicecap's own stretcher slows it down in your browser, with the pitch kept and nothing sent anywhere."

## The website

- **A voice page's policy** becomes the shareable page's plus `media-src data: blob:`: the recordings it holds, as `data:` addresses, and the slowed copies its own script makes of them, as `blob:` addresses. Nothing else changes: scripts by their hashes, no worker, no connection.
- **Every voice page** gets that policy, an older share's included. An older voice page's script makes no `blob:` address, so the added source changes nothing for it.
- **Shares already made** are published byte for byte, as shared, so a voice page shared before 0.19.0 keeps the browser's slow-down at 1×, 0.75×, 0.5×, and 0.25×. After the release, sfs and dvfr are shared again from their latest runs, with no new run, so the website's newest voice pages have the new one.

## Wording

- As the voice page's now: the recording is evidence, and the transcripts are the record of what was reviewed. None of voicecap's text says a person listened to a run, calls voicecap automated, or names what it was built with.
- The page calls it "voicecap's own stretcher". The README and the Technical details page name the method, a phase vocoder with phase locking, and the filter's values.

## The code

- **`src/share/voice-stretch.ts`** (new): `STRETCH_LIBRARY`, plain ES2017 functions held as a string, as the check's `CHECK_LIBRARY` is, with no DOM: the FFT, the stretcher (made in slices), the filter, the loudness match, and the WAV writer. Pure, and tested in `node:vm`.
- **`src/share/voice-page.ts`:** `VOICE_SCRIPT` becomes `STRETCH_LIBRARY` and the page's part (the speed choice, the second player, the status line, the copies kept, and the fallback); the speed choice's markup adds the status line and the words.
- **`src/share/text.ts`:** `VOICE_TEXT`: the speeds, the lead, the status words, and the second player's name; and the timeline's row for 0.19.0.
- **`src/site/headers.ts`:** `media-src data: blob:` for a voice page.
- **`src/site/technical-text.ts`:** the policy's line, and a line on how a slower speed is made.
- **No new dependency.**

## Tests

- **The stretcher,** in `node:vm`:
  - the length is exactly ⌊length ÷ speed⌋ at 0.75×, 0.5×, and 0.3×;
  - a 220 Hz tone stays 220 Hz;
  - the loudness matches the recording's RMS, and no sample passes 0.98;
  - silence stays silent, and no input (an impulse, a full-scale square, a constant) gives a sample that isn't a finite number;
  - made in slices, it gives the same samples as made at once;
  - the filter: well under 1 at 50 Hz, within 0.5 dB of 1 at 1 kHz, and within 1 dB of −6 dB at 7 kHz;
  - the WAV's header, length, and 16-bit samples.
- **The voice page:**
  - its markup: the speeds, the status line, and the words; everything else as now;
  - its script parses with the page's others, holds no markup, starts and ends on a new line, and stays under a size limit set for it;
  - in Chromium, from a file, with a real recording: picking 0.3× shows a second player with a `blob:` address, whose length is the first's ÷ 0.3, within 1%; the first player keeps its `data:` address; 1× brings it back; "Check the fingerprints" still passes; and, with `decodeAudioData` made to refuse, the choice falls back to `playbackRate`, and the status line says so;
  - axe in both themes at 1280, 390, and 320 pixels with a slowed copy in view; keyboard alone; no script.
- **The website:** a voice page's policy has `media-src data: blob:`, and no other page's has a `media-src`.

## The check before the release

No NVDA run is needed, as nothing of a run changes. Before the release, the branch's `voicecap share` writes a voice page from the sfs run of 2026-10-14 into a scratch folder, never into the transcripts repo, and the owner opens it from the PC in Chrome and plays a page at 0.3×.

## Docs and release

- **The README:** "NVDA's voice" (the speeds, how a slower speed is made, the fallback) and the policy's paragraph.
- **The CHANGELOG entry** for 0.19.0.
- **Technical details:** the policy's line and how a slower speed is made.
- **The timeline row** for 0.19.0, with its test.
- **After the release:** the netlify.toml pin, then sfs and dvfr shared again, and a check that each live copy matches its shared file.

## Choices for the owner to confirm

Each is easy to change:
1. **The speeds:** 1×, 0.75×, 0.5×, 0.3× (the owner's pick, 2026-10-15).
2. **The filter at every slowed speed,** and never at 1×.
3. **A slowed copy is as loud as the recording,** by its RMS.
4. **At most 4 copies kept on the page.** A ten-minute recording at 0.3× is about 64 MB of WAV.
5. **No running percentage** while a copy is made, only "Getting 0.3× ready…" and "0.3× is ready."
6. **Where a browser can't, its own slow-down,** as 0.18.0's, with a line that says so.
7. **Shares already made keep the old slow-down** until they're shared again.

## Not included

- **Safari and iPhone,** beyond the fallback. A look can come with the Mac phase.
- **A higher bit rate** for the recordings.
- **Speeds above 1×.**
- **A worker** for the stretcher: its script would need the policy to allow a `blob:` script.
- **Sharper consonants** (resetting the phases at a sudden change): a later change, if a slowed recording ever needs it.
- **Saving or downloading a slowed copy.**
