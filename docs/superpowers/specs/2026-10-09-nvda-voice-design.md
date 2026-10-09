# NVDA's voice: a recording of what NVDA said on each page, sealed with the run

## Why

On 2026-10-08, the owner asked:

> "can the nvda voice be saved as a replayable audio file? (i.e., what nvda actually said)"

then:

> "so there's an mp4 or mp3 or wav file as a record for auditors or lawyers"

and, queuing it as a later plan:

> "yes -- another (later) plan. Highly compressed audio is fine. Is it possible to slow it down from the actual read? (Even if it sounds weird)"

They also set the priority:

> "smallest, tightest, most compressed. It would be rarely used -- but it's good to have as a record, even if it's not "perfect" voice -- it's at least a record of what NVDA did (and proof that NVDA did it)."

So the recording is evidence, not a way to review. The transcripts stay the key to the person's review: NVDA speaks too fast to follow, so the person reads what it said. The recording is there for whoever later asks what NVDA actually did. It's the sound of the same run the transcripts came from, sealed with them.

The release order is plan 12 (0.15.0), plan 10 (0.16.0), plan 6c (0.17.0), then this (0.18.0). It was 0.17.0, before plan 6c, until 6c was ready first.

**This spec was written on 2026-10-09 from my recommendations,** at the owner's word: "your recommendations are fine for questions" and "push forward to get as much done as possible". Every choice the owner didn't make is listed under "Choices for the owner to confirm".

It rests on two pieces of research done the same night:
- **A feasibility trial** on the PC, recording one test program's sound with Windows' process loopback. It used no screen reader, and its test sound was quieter than a whisper.
- **A survey of small Opus encoders,** with measurements.

What each found is in "How it's recorded" and "How it's encoded".

## What it is

For each page, voicecap keeps a recording of every sound NVDA made while voicecap read the page:
- its speech, and its own sounds (beeps and earcons);
- nothing from any other program;
- from the start of the page's attempt to its end.

It's one small audio file per page, `pages/<slug>/voice.webm`: Opus, mono, about 70-90 KB a minute. It's fingerprinted and sealed with the run like the screenshot and axe's results, and `voicecap verify` checks it.

Each shareable page gets a companion, the **voice page** (`<share>.voice.html`). It has a player for each page's recording, with speeds of 1×, 0.75×, 0.5×, and 0.25×. The browser keeps the pitch as it slows, so NVDA sounds slow, not low. Each player shows its file's size and SHA-256, and the page has its own "Check the fingerprints". The shareable page itself carries no audio: each recorded page's card links to its player on the voice page. The website publishes the voice page beside the report.

The recording never changes the verdict, the ring, the numbers, or "What needs attention", and it never fails a page.

## How it's recorded

- **Only NVDA's sound.** Windows' process loopback records exactly one process tree's output: NVDA's process, which voicecap starts (Guidepup's portable copy), and anything NVDA starts.
  - It records no microphone, and no other program's sound. In the trial, a second program's sound and the PC's other audio (music and a browser were playing) stayed out.
  - It needs Windows 10 build 20348 or later, which includes every Windows 11.
  - It records whatever the PC's volume, mute, or speakers: in the trial, the master volume didn't reach the recording. A per-program level set in Windows' Volume Mixer probably does, so the recording keeps NVDA's level and mute as they were.
- **One helper per run.** voicecap starts a small helper once per run: Windows PowerShell running C# that voicecap compiles at start with `Add-Type`, as it already does for other Windows calls. Nothing is installed.
  - It's spawned with an argument array, never through a shell, and takes one JSON command a line on stdin: target, start, stop, and quit. It answers one JSON line each on stdout.
  - Starting it takes about 0.8 s, once.
  - A start or stop takes about 2 ms, and recording costs about 1.5% of one CPU core and 90 MB of memory.
  - When stdin closes, it stops and exits, so it can't outlive voicecap.
- **The target.**
  - Each time NVDA starts, the driver already finds its process id. It checks that the process's program is the nvda.exe it started, and points the helper at it.
  - When NVDA stops or restarts, the helper is told to stop, then to retarget. A process that exits only leaves silence, so the helper watches the process, and a recording of a target that exited says so.
- **The page's window.** The recording starts at the page's attempt's start and stops at its end. It holds everything NVDA said in between, the passes and what NVDA says as each load opens. Before each pass, voicecap has NVDA read the window's title, a check that NVDA is in the right window, so the recording has "voicecap check" and a code at each pass's start. The voice page says so.
- **Kept on the wall clock.** Windows sends sound every 10 ms, silence included. The helper fills every gap of 2 ms or more with silence, from the system clock's timestamps, so a second into the file is a second into the attempt. In the trial, every file stayed within 2 ms of the wall clock. When the helper falls behind, sound is lost and the gap is filled; the record says how much (`lostMs`), which is normally 0.
- **Attempts.**
  - An attempt that fails is kept as the page's files are: the next attempt moves the page's folder, recording and all, to `attempts/<slug>/<n>`, unsealed.
  - The page's last attempt, done or failed, is the one recorded and sealed, as with the screenshot and axe.
  - A page stopped by Ctrl+C keeps no recording.
- **Never a failure.** If the helper can't start, NVDA's process isn't found, Windows is too old, PowerShell's language mode blocks `Add-Type`, the recording is silent, or encoding fails, the page records the reason, and the run goes on as if nothing were recorded.
  - A silent recording is a page whose transcripts have words but whose recording peaks at 2 (out of 32,767) or less. It's kept as the reason "the recording is silent", not as a file.
  - A helper that stops answering within 5 s is ended, and the rest of the run's pages give that reason.
- **Which drivers.** Only the `guidepup` driver on Windows records. The replay driver opens nothing, and the AT Driver stub is a stub, so a run with either has no recordings; where a voice page shows its pages, each says why. VoiceOver comes with Phase C.

## How it's encoded

- **The PCM.** The helper writes 16 kHz mono 16-bit PCM to a temporary file outside the run folder, and Windows converts NVDA's sound to that format.
- **The encoder.** At the attempt's end, voicecap encodes the PCM with `libopus-wasm`, pinned at exactly 0.4.1. It's libopus 1.6.1 compiled to WebAssembly, MIT-licensed, with no dependencies, no native build, and no install script. Then voicecap deletes the PCM.
  - **Settings:** VoIP, voice, wideband at most, VBR, complexity 10, DTX on, 60 ms frames, 12 kbps.
  - **Speed:** five minutes of audio takes under 3 s to encode.
  - **Determinism:** the output is byte for byte the same for the same PCM.
- **The container.** WebM, written by voicecap's own small muxer, about 150 lines, with Cues for seeking and DiscardPadding so the length is exact.
  - **Why not Ogg:** Ogg is 5 KB a minute smaller, but Safari plays Ogg Opus only from 18.4, and mis-times it (WebKit bug 293310, still open). WebM Opus plays in Safari from 17.4, and in Chrome, Edge, and Firefox. Windows 11's Media Player and VLC open both.
- **The size.** Measured on fast synthetic speech, at 12 kbps WebM:
  - 66-93 KB a minute;
  - about 2 KB a minute less for a page with long silences.

  A page NVDA reads in two and a half minutes comes to about 200 KB. A 32-page run comes to about 6 MB.

## How it's recorded in the run

- **The record.** `page.voice`, kept apart from the page's `files` as the screenshot's and axe's are, so a review never copies it, and covered by the run's seal. It holds either:
  - `{ sha256, bytes, seconds, lostMs, recordedAt }`; or
  - `{ error, recordedAt }`, with the first line of what went wrong, cut at 300 characters.
- **`voicecap verify`** names a `voice.webm` that's missing, changed, or not recorded by the run. A run from before 0.18.0 passes.
- **The version.** One constant, `keepsVoice` at 0.18.0, gates the reasons: a run from before it says "Not recorded: this run used voicecap 0.17.0."

## The voice page

- **The page.** `<share>.voice.html`, written by `voicecap share` beside the shareable page and the Word copy, whenever a shared run has at least one recording. It's a single file, with each recording in it as a `data:` address, so it can be sent on its own.
- **The order.** It leads with the site's name and the report's date and time. Then come:
  1. a short paragraph: what the recordings are, that they're NVDA alone, how to slow them down, and that the transcripts on the shareable page are the record of what was reviewed;
  2. one section a page, in the shareable page's order. Each section has:
     - the page's name and address;
     - the player, `<audio controls preload="none">`, labelled with the page;
     - the speed choice, a radio group: 1× (chosen), 0.75×, 0.5×, 0.25×. It sets `playbackRate`, with `preservesPitch` on.
     - the length, the lost time when there is any, and the file's size and SHA-256;
     - for a page with no recording, the reason instead.
- **"Check the fingerprints"** works as the shareable page's does. It recomputes each run's seal from the records the page carries, and hashes each recording against its record in the reader's browser, sending nothing anywhere. It shows that the page agrees with itself.
- **The shareable page.**
  - A recorded page's card gets one line: "NVDA's voice: 2 min 14 s, on the voice page", linking to that page's section.
  - "The details, for reviewers and auditors" gets one paragraph on the voice page, with a link.
  - Nothing else changes, and nothing is added for a run from before 0.18.0.
- **The Word copy.**
  - The fingerprints table lists each `voice.webm` with its size and SHA-256.
  - The details say the recordings are on the voice page and in the run's folder.
  - Word doesn't carry the sound.
- **The website.**
  - The site publishes the voice page as one more file of the share, and lists it in the report's files as "NVDA's voice".
  - Its policy is the shareable page's, plus `media-src data:`.
  - Only the newest three reports per site are kept, as now.
- **Accessibility.** The voice page meets the same checks as the shareable page: axe at 1280, 390, and 320 pixels, in both themes, keyboard alone, and with no script. The players and the speed choice are native controls, each with its own label.

## Wording

- The recording is evidence. The person's review is made from the transcripts, by reading what NVDA said.
- The words describe what a reader can do: "play it", "slow it down", "what NVDA said aloud". None of voicecap's text says a person listened to a run.
- The voice page leads with the site's name and a date, never an address.
- The voice page says once why a code follows "voicecap check" at each pass.

## Dependencies

`libopus-wasm` 0.4.1, pinned exactly. It's MIT-licensed, with libopus's BSD notice kept beside it. A golden-hash test catches any change in its output. No other dependency is added: the muxer is voicecap's, and the helper is C# that Windows compiles. The fallback, if `libopus-wasm` is ever withdrawn, is `opusscript` 0.1.1 (MIT, libopus 1.4), whose output matches at 20 ms frames.

## Tests

- **The encoder and muxer:**
  - PCM to WebM: the EBML structure, Cues, DiscardPadding, and the duration exact to the sample;
  - the same PCM gives the same bytes, pinned by a golden SHA-256;
  - silence costs little (DTX);
  - Chromium plays, seeks, and reports the exact duration.
- **The helper's client,** against a fake helper (a Node script speaking the same JSON lines):
  - start, stop, retarget, and quit;
  - a helper that won't start, that stops answering, or that exits;
  - a silent recording;
  - Ctrl+C.
- **The helper itself:**
  - a Windows-only test, run only when `VOICECAP_SOUND_TEST=1` is set and never in CI;
  - it records a silent test program and checks the file's length against the wall clock, with no sound played.
- **The page runner,** with the scripted driver:
  - start at the attempt's start and stop at its end;
  - a failed attempt's recording moves with its folder;
  - Ctrl+C keeps none;
  - every failure is recorded as a reason and the page reads as usual.
- **The record:** the seal covers `page.voice`, and verify names a missing, changed, or unrecorded `voice.webm`.
- **The voice page:**
  - its parts, order, and words;
  - the speed choice sets `playbackRate` and `preservesPitch`;
  - the check catches a changed recording;
  - axe at 1280, 390, and 320 in both themes;
  - keyboard alone;
  - no script.
- **The shareable page and the Word copy:** the card's line, the details' paragraph, and the fingerprints rows.
- **The website:** the voice page published, its policy with `media-src data:`, and its place in the files.

## The check at the PC

Before the release, a real run of the sfs site (9 pages), with the owner present and hands off the PC, checks:
1. Each page's recording is there and not silent.
2. NVDA's speech falls where its transcript says.
3. The lost time stays at or near 0.
4. The sizes per minute.
5. The voice page plays at 0.25× in Edge and Chrome.

The owner then plays one page at 0.5× and decides whether 12 kbps is clear enough, or 16 kbps is worth 32% more bytes.

## Docs and release

- **The README:** a section, "NVDA's voice", covering what's recorded and how, its limits, its sizes, the voice page, and verify.
- **The CHANGELOG entry** for 0.18.0.
- **Technical details:** a toolchain row for `libopus-wasm`, a line on Windows' process loopback, and the voice page in what each share holds.
- **The timeline row** for 0.18.0, in Prepare.

## Choices for the owner to confirm

Made from my recommendations, each easy to change:
1. **The audio lives on its own voice page,** not in the shareable page. Embedding it would make a 32-page report about 8 MB heavier for everyone who opens it, for something rarely played.
2. **12 kbps,** to be confirmed by ear at the PC. 10 kbps is 15% smaller, 8 kbps is the floor, and 16 kbps costs 32% more.
3. **WebM, not Ogg,** for Safari on Macs and iPhones.
4. **No setting to turn it off,** as with axe and the screenshots. Even so, a 32-page run adds about 6 MB to the transcripts repo. A later setting, or keeping the sound only for the newest runs, is easy to add.
5. **The speeds offered:** 1×, 0.75×, 0.5×, 0.25×, starting at 1×.
6. **One recording a page,** from the attempt's start to its end, with the "voicecap check" title read at each pass. It isn't one recording a pass.
7. **A silent recording is kept as a reason, not a file.**
8. **The last attempt's recording is the one sealed,** done or failed, as with the screenshot and axe.

## Not included

- **Jumping from a transcript's line to that moment in the recording.** The files keep the wall clock, so a later plan can add it.
- **Recording at NVDA's normal speed.** The run's NVDA is fast on purpose, and the voice page slows it down.
- **VoiceOver's sound,** which comes with Phase C.
- **Audio in the Word copy.**
- **Any change to the verdict, the ring, or "What needs attention".**
