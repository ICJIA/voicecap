# Plan 11, NVDA's voice: the plan

> Build it task by task; each step is a checkbox (`- [ ]`).

**Goal:** during a run, voicecap records everything NVDA's process says aloud on each page, and only that. It keeps the recording as a small WebM Opus file with the page, fingerprinted and sealed with the run. Each share gets a voice page that plays the recordings at slower speeds, and the website publishes it.

**Architecture:**
- **The encoder:** a pure module, `src/voice/`, turns 16 kHz PCM into a deterministic WebM Opus file, using `libopus-wasm` and a small muxer of voicecap's own.
- **The recorder:** a long-lived helper in `src/drivers/guidepup/voice-recorder.ts`: Windows PowerShell 5.1 running C# compiled by `Add-Type`. It records one process tree with Windows' process loopback, and the Guidepup driver points it at the NVDA it starts.
- **The record:** the runner starts a recording as each attempt starts, stops it at the end, and encodes and keeps the file. Verify checks it.
- **The display:** the share writes a voice page beside the shareable page, the shareable page and the Word copy point to it, and the website publishes it.

**Tech Stack:** TypeScript strict ESM, Node 22.19+, Windows PowerShell 5.1 with C# through `Add-Type` (in `src/drivers/` only), `libopus-wasm` 0.4.1 (a new runtime dependency), Playwright (in `src/drivers/` and the tests), Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-09-nvda-voice-design.md`. The owner approved it as written on 2026-10-09, including its "Choices for the owner to confirm".

## Global Constraints

- **Wording:**
  - The recording is evidence. The person's review is made from the transcripts, by reading what NVDA said.
  - voicecap's text never says a person listened, and never calls voicecap automated.
  - The voice page leads with the site's name and a date, never an address.
  - No Guidepup on the voice page or in the Word copy.
- **Only NVDA's sound:** process loopback in include-tree mode, on the process id the driver started, with its program checked against the nvda.exe it started. Never the whole device's sound, and never a microphone.
- **Never a failure:** any failure of the recorder or the encoder becomes the page's reason, and the page reads as usual. A helper that doesn't answer a command within 5 s is ended, and the run's later pages give that reason.
- **The helper:**
  - It runs on Windows PowerShell 5.1, with C# compiled by `Add-Type` at its start. Nothing is installed.
  - It's spawned with an argument array, never through a shell. Each command and each answer is one JSON line, made ASCII-safe as the replay's voice does it (`asciiJson`).
  - The end of its stdin stops any recording and ends it.
- **The PCM:**
  - 16 kHz, mono, 16-bit, with AUTOCONVERTPCM and SRC_DEFAULT_QUALITY.
  - Every gap of 2 ms or more on the QPC timeline is filled with silence, and the sound lost to an overrun is counted as `lostMs`.
  - It's written to a temporary file outside the run folder, which is deleted after encoding.
- **The encoding:**
  - `libopus-wasm`, pinned exactly to `0.4.1`.
  - VoIP application, voice signal, wideband at most, VBR, complexity 10, DTX on, 60 ms frames, 12,000 bits a second.
  - WebM, with Cues and DiscardPadding.
  - The same PCM gives the same bytes.
- **The record:**
  - `pages/<slug>/voice.webm`, and `page.voice?` apart from `files`, sealed with the run.
  - `voicecap verify` checks it.
  - One constant, `KEEPS_VOICE_FROM = "0.17.0"`, gates the reasons.
  - No `schemaVersion` bump, no new run setting, and no change to walkthrough files.
- **The voice page:**
  - `${stem}.voice.html` beside the pair, written only when a shared run has a recording.
  - One file, with each recording as a `data:audio/webm;base64,` address, in `<audio controls preload="none">`.
  - Speeds 1× (chosen), 0.75×, 0.5×, 0.25×, setting `playbackRate`, with `preservesPitch = true`.
  - It keeps the shareable page's rules: one style block, one runnable script, one data block, no `style` attribute, axe-clean in both themes at 1280, 390, and 320 pixels, and nothing wider than 320.
- **The website:** only the voice page's policy adds `media-src data:`.
- **Tests never play a sound or start NVDA.** The one test of the real helper records a silent program, runs only with `VOICECAP_SOUND_TEST=1` on Windows, and never runs in CI.
- **Only `src/drivers/`** imports Playwright or starts PowerShell for the recorder.
- **Commits:** plain subject lines, no trailers. No push until the release.
- **What the build never does:** start NVDA or any screen reader, play sound, run voicecap except through the test suite, publish, push, or touch the owner's transcripts home.

## Review Focus

1. **NVDA restarts mid-run:** every 50 pages, after a failed page, and on a retry. The recorder retargets to the new process, and the next page's recording is of the new NVDA, never a silent recording of the old process id. *Test: Task 3.*
2. **A path with spaces or letters outside ASCII:** a temp folder such as `C:\Users\José Smith\AppData\Local\Temp` reaches the helper intact. *Test: Task 2.*
3. **The sound device changes mid-run:** for example, a wireless headset turned off. The helper's stream error becomes that page's reason, and the next page records again. *Test: Task 2 with the fake helper, and Task 3.*
4. **A long page:** a 10-minute page is 19 MB of PCM. Encoding stays well under a minute and is bounded in memory. *Test: Task 1, three minutes timed.*
5. **A page with no words:** a page whose transcripts are empty keeps its quiet recording. Only a page whose transcripts have words but whose recording peaks at 2 or less gets "the recording is silent". *Test: Task 3.*

## Decisions this plan makes

- **D1, the Guidepup driver owns the recorder.** The driver knows NVDA's process id and every restart. It starts the helper once, at the run's first recording, and targets each NVDA it starts. The runner only asks for a recording and stops or discards it.
- **D2, both forms of the record carry `recordedAt`:** a local ISO time to the millisecond, as the screenshot's and axe's do.
- **D3, `KEEPS_VOICE_FROM` lives beside `keepsAxe`** in `src/share/run-evidence.ts`.
- **D4, the voice page is a module of its own,** `src/share/voice-page.ts`. It shares the shareable page's style, theme, and fingerprint check, rather than copying them.
- **D5, before Task 6, the controller merges main (0.16.0) into this branch,** so the website task builds on plan 12's website. The branch starts from plan 10's.

---

### Task 1: Encoding a recording: PCM to a WebM Opus file

**Files:**
- Create:
  - `src/voice/encode.ts`;
  - `src/voice/webm.ts`;
  - `test/voice-encode.test.ts`;
  - `test/voice-webm.test.ts`;
  - `test/voice-browser.test.ts`.
- Modify: `package.json` (`libopus-wasm` exactly `0.4.1` in `dependencies`), and `pnpm-lock.yaml`.

**Interfaces:**
- Produces:
  - `VOICE_SAMPLE_RATE = 16000`, `VOICE_BITRATE = 12000`, `VOICE_FRAME_MS = 60`;
  - `encodeVoice(pcm: Int16Array): Promise<{ webm: Uint8Array; seconds: number }>`, where `seconds` is the PCM's length, `pcm.length / 16000`;
  - `peakOf(pcm: Int16Array): number`, the largest absolute sample;
  - `muxOpusWebm(packets: readonly Uint8Array[], options: { preSkip: number; samples: number }): Uint8Array`. Here `samples` is the PCM's length at 16 kHz, and the WebM's times and DiscardPadding are in its own units.

- [ ] **Step 1: Write the failing tests:**
  - "writes WebM that holds one Opus track": a small EBML reader in the test finds:
    - the EBML header, with DocType `webm`;
    - Segment, Info (with Duration), and Tracks, where CodecID is `A_OPUS`, Channels is 1, CodecPrivate is an `OpusHead` with the pre-skip, and SamplingFrequency is 48000;
    - Clusters, and Cues;
    - DiscardPadding on the last block.
  - "gives the same bytes for the same PCM": two seconds of a fixed signal encode to a pinned SHA-256, and encode the same twice.
  - "says how long it is, to the sample": `seconds` is `samples / 16000`, and Info's Duration matches it to the millisecond.
  - "costs little for silence": a minute of zeros encodes to under 8,000 bytes (DTX).
  - "keeps a minute of busy sound small": a minute of a fixed, modulated signal encodes to under 120,000 bytes.
  - "encodes three minutes quickly": under 15 s, using under 300 MB of heap (Review Focus 4).
  - In the browser (Chromium), the file as a `data:audio/webm;base64,` address in an `<audio>`:
    - `duration` is within 10 ms of `seconds`;
    - seeking to the middle fires `seeked`, with `currentTime` there;
    - `canPlayType('audio/webm; codecs="opus"')` isn't empty.
- [ ] **Step 2:** Run `pnpm exec vitest run test/voice-encode.test.ts test/voice-webm.test.ts test/voice-browser.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - `encodeVoice` encodes 60 ms frames (960 samples), padding the last one with zeros. It uses the settings in the Global Constraints.
  - The pre-skip is the encoder's lookahead, scaled to 48 kHz.
  - The muxer writes one Cluster per 5 s of sound, and one Cue per Cluster.
  - Keep the encoder's instance for the call only. Free it in a `finally`.
- [ ] **Step 4:** Run `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `Encode a recording of NVDA's voice as a small WebM Opus file, the same bytes for the same sound`.

### Task 2: The recorder: one program's sound, through Windows' process loopback

**Files:**
- Create:
  - `src/drivers/guidepup/voice-recorder.ts`;
  - `test/helpers/fake-recorder.mjs`;
  - `test/voice-recorder.test.ts`;
  - `test/voice-recorder-windows.test.ts`.

**Interfaces:**
- Produces:
  - `RECORDER_SCRIPT: string`, the PowerShell script with its C#;
  - `interface RecorderStop { frames: number; lostMs: number; peak: number; firstSampleAt: string; targetExited: boolean }`, where `firstSampleAt` is a UTC ISO time;
  - `interface Recorder { target(pid: number, image: string): Promise<void>; start(pcmPath: string): Promise<void>; stop(): Promise<RecorderStop>; close(): Promise<void> }`;
  - `startRecorder(options?: { spawnRecorder?: SpawnRecorder; script?: string; readyMs?: number; commandMs?: number }): Promise<Recorder>`, with defaults of 20,000 and 5,000 ms. A failure rejects with an `EnvironmentError` whose message says why.
- **The protocol,** one JSON line each way.
  - **In:**
    - `{"target":{"pid":N,"image":"…"}}`
    - `{"start":{"pcm":"…"}}`
    - `{"stop":true}`
    - `{"quit":true}`
  - **Out:**
    - `{"ready":{"build":N}}` or `{"failed":"…"}`
    - `{"targeted":{"pid":N}}`
    - `{"started":{"at":"…"}}`
    - `{"stopped":{…RecorderStop}}`
    - `{"target-exited":{"pid":N}}`, which can come at any time
    - `{"error":"…"}`, as the answer to the command it follows

- [ ] **Step 1: Write the failing tests**, with `fake-recorder.mjs`, a Node script that speaks the protocol and is scripted by its arguments:
  - "starts, targets, records, and stops": the stop's numbers come back as given.
  - "sends paths with spaces and non-ASCII letters intact": the fake echoes the `pcm` path it read, and it's `C:\Users\José Smith\…\a b.pcm` exactly (Review Focus 2).
  - "rejects with the helper's reason when it can't start": `{"failed":"…"}`, and the first lines of stderr are in the message.
  - "kills a helper that isn't ready within readyMs".
  - "ends a helper that doesn't answer within commandMs, and every later call rejects with 'the recorder stopped answering'".
  - "keeps a target's exit for the next stop": `targetExited: true`.
  - "gives a stream error as that stop's reason, and records again at the next start" (Review Focus 3).
  - "ends the helper when its stdin ends".
  - Windows only, and only with `VOICECAP_SOUND_TEST=1` (`describe.runIf`):
    - "records a silent program on the wall clock": the target is a `powershell.exe` you start that sleeps 3 s;
    - after 1.5 s of recording, `frames / 16000` is within 5 ms of the time measured;
    - `peak` is 2 or less, and `lostMs` is 0;
    - the PCM file holds `frames × 2` bytes.
- [ ] **Step 2:** Run `pnpm exec vitest run test/voice-recorder.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - **The client:** follow `windowsVoice` (src/review-replay/voice.ts) for spawning, stdin errors, the ready wait, stderr, and closing. Use `powershell.exe -NoProfile -NonInteractive -Command <powershellCommand(script)>` with an argument array.
  - **The script, part 1: setup.**
    - It checks the Windows build: 20348 or later, else `failed` with "recording one program's sound needs Windows 10 build 20348 or later; this is build N".
    - It compiles its C# with `Add-Type`, and a failure, such as Constrained Language Mode, becomes `failed`.
    - On `target`, it checks the process's program path with QueryFullProcessImageName against `image`, case-insensitive. A mismatch is an `error`.
  - **The script, part 2: the C#.**
    - It calls `ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK)` with AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK and PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE.
    - The parameters go in a PROPVARIANT of type VT_BLOB, and the completion handler implements IAgileObject.
    - It initializes with LOOPBACK, EVENTCALLBACK, AUTOCONVERTPCM, and SRC_DEFAULT_QUALITY, and a format of 16 kHz mono 16-bit. GetMixFormat isn't supported.
    - One MTA thread at AboveNormal priority owns every COM object.
  - **The script, part 3: the timeline.**
    - Frame 0 is the moment of `Start()`.
    - Each packet is placed by its QPC timestamp, and every gap of 2 ms or more is filled with silence. The sum of gaps beyond the stream's 10 ms rhythm is `lostMs`.
    - Packets keep coming in silence, and the device position is always 0, so QPC is the only clock.
  - **The script, part 4: when the target exits.** It watches the target's process handle. Its exit gives `target-exited` at once, and `targetExited: true` at the next stop.
- [ ] **Step 4:** Run `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS. On this PC, also run the Windows test once with `VOICECAP_SOUND_TEST=1`. It plays nothing.
- [ ] **Step 5:** Commit: `Record one program's sound and nothing else with Windows' process loopback, through a helper that compiles its C# at start`.

### Task 3: The run records NVDA's voice, and verify checks it

**Files:**
- Modify:
  - `src/drivers/types.ts` (`VoiceCapture`, `VoiceRecording`, and `recordVoice?`);
  - `src/drivers/guidepup-nvda.ts` (the recorder's life);
  - `src/model.ts` (`VOICE_FILE`, `VoiceRecord`, and `PageRecord.voice?`);
  - `src/run/page-runner.ts` (the recording around each attempt; `keepVoice`; `PageOutcome.voice`, `Loaded.voice`);
  - `src/run/audit.ts` (`applyOutcome`);
  - `src/verify.ts` (`recordedFiles`);
  - `src/share/records.ts` (`voiceRecordOf`);
  - `test/helpers/scripted-driver.ts` (a recording for each attempt).
- Create: `test/run-voice.test.ts`.
- Test: `test/verify.test.ts`, `test/guidepup-driver.test.ts`.

**Interfaces:**
- Consumes: `encodeVoice` and `peakOf` (Task 1); `startRecorder`, `Recorder`, and `RecorderStop` (Task 2).
- Produces:
  - `type VoiceCapture = { pcm: string; frames: number; lostMs: number; peak: number; startedAt: string } | { error: string }`;
  - `interface VoiceRecording { stop(): Promise<VoiceCapture>; discard(): Promise<void> }`;
  - `ScreenReaderDriver.recordVoice?(): Promise<VoiceRecording>`. A recording that couldn't start gives its reason at `stop()`.
  - `VOICE_FILE = "voice.webm"`;
  - `type VoiceRecord = (FileHash & { seconds: number; lostMs: number; recordedAt: string }) | { error: string; recordedAt: string }`;
  - `PageRecord.voice?: VoiceRecord`;
  - `voiceRecordOf(page: PageRecord): VoiceRecord | "unreadable" | undefined`.

- [ ] **Step 1: Write the failing tests** (`run-voice`, with the scripted driver, and the driver's own tests with a fake `Recorder`):
  - "records each attempt from its start to its end": the call log has `recordVoice` before the attempt's `page-started` event, and `stop` after its last pass, before `page-finished`.
  - "writes voice.webm, and records its fingerprint, length, and lost time with the page".
  - "records the recorder's reason, and reads the page as usual".
  - "keeps the reason 'the recording is silent' for a page whose transcripts have words and whose recording peaks at 2 or less, and keeps a quiet recording of a page with no words" (Review Focus 5).
  - "discards the recording of an attempt Ctrl+C stopped, and keeps none".
  - "moves a failed attempt's voice.webm to attempts/ with its folder, and seals the last attempt's".
  - "keeps no recording of a page it skips, or one that answered 4xx or 5xx".
  - "records no voice for a driver that can't record".
  - "deletes the PCM after encoding, and after a discard".
  - "seals the voice record with the run": changing `page.voice.bytes` breaks the seal.
  - The driver:
    - "starts the helper once, at the first recording";
    - "targets each NVDA it starts, with the nvda.exe it started";
    - "retargets after a restart, so the next page's recording is the new NVDA's" (Review Focus 1);
    - "a recorder that won't start gives its reason at each stop";
    - "closes the helper at shutdown and on abandon".
  - `verify`: "reports a missing, changed, or unrecorded voice.webm"; "passes a run from before 0.17.0".
- [ ] **Step 2:** Run `pnpm exec vitest run test/run-voice.test.ts test/verify.test.ts test/guidepup-driver.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - **In `processPage`'s loop:**
    - Ask `session.driver.recordVoice?.()` before each `runAttempt`.
    - If `runAttempt` throws, discard the recording and rethrow.
    - Otherwise call `keepVoice(ctx, dir, await recording.stop(), result)` before the attempt's `page-finished` or `page-failed`, and set the result's `voice`. Skip this for an attempt that didn't read the page.
  - **`keepVoice`:**
    - Read the PCM, check the silence, encode, and write `VOICE_FILE` with `writeFileAtomic`.
    - Delete the PCM in a `finally`.
    - Build the record from `fileHash`, `seconds`, `lostMs`, and `recordedAt: isoLocalMs(ctx.now())`.
    - Cut errors to their first line, at most 300 characters.
  - **The driver:**
    - It creates the recorder lazily.
    - It calls `target(nvdaPid, install.nvdaExe)` once `startedNvdaPid()` has the process id. With no id, the recording gives "NVDA's process wasn't found".
    - It stops any recording in `shutDownNvda()`, and closes the recorder in `shutDown()` and `abandon()`.
    - Each PCM file goes in `os.tmpdir()/voicecap-voice-<process id>/`.
  - **The rest:** `applyOutcome` sets or deletes `page.voice`, and `recordedFiles` adds `<slug>/voice.webm` when `isFileHash(page.voice)`.
- [ ] **Step 4:** Run `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `Record what NVDA says on each page with its run, sealed beside its screenshot, and check voice.webm in voicecap verify`.

### Task 4: The voice page

**Files:**
- Create: `src/share/voice-page.ts`, `test/share-voice-page.test.ts`.
- Modify:
  - `src/share/check.ts` (recordings in the check's data, and `audio[data-file]` hashed as `img[data-file]` is);
  - `src/share/text.ts` (`VOICE_TEXT`);
  - `src/share/html/style.ts` (the player's few rules, in the one style block);
  - `src/share/run-evidence.ts` (`KEEPS_VOICE_FROM`, beside `keepsAxe`).
- Test: `test/share-browser.test.ts`, `test/share-check.test.ts`.

**Interfaces:**
- Consumes: the share's model and `voiceRecordOf` (Task 3).
- Produces:
  - `renderVoicePage(model: ShareModel, recordings: ReadonlyMap<string, Uint8Array>): string | null`, keyed `<run>/<slug>`. It gives null when no page has a recording.
  - `voiceAnchor(slug: string): string`, the section's id;
  - `KEEPS_VOICE_FROM = "0.17.0"`.
- **The text,** fixed in `VOICE_TEXT`:
  - **The title:** `NVDA's voice: <site name>, <date and time>`.
  - **The lead:** "What NVDA said aloud on each page while voicecap read it, recorded from NVDA alone and sealed with the run. NVDA spoke fast; choose a slower speed, and the pitch stays the same. The transcripts on the shareable page are the record of what was reviewed."
  - **The note:** "Before each pass, voicecap has NVDA read the window's title, "voicecap check" and a code, to check NVDA is reading the right window."
  - **The speed choice:** legend `Speed`, with the choices `1×`, `0.75×`, `0.5×`, and `0.25×`.
  - **The facts:** "{length}", "{lost} of sound lost" (only when `lostMs > 0`), and "{size}, SHA-256 {hash}".
  - **The reasons:** "Not recorded: this run used voicecap {version}." from `KEEPS_VOICE_FROM`, "Not recorded: {reason}", and "Not recorded: this run's driver doesn't record NVDA's voice."

- [ ] **Step 1: Write the failing tests:**
  - "leads with the site's name and the report's date, and has one section a page, in the shareable page's order".
  - "carries each recording as a data: address in an audio element with preload none and a label naming its page".
  - "gives each page's length, lost time, size, and SHA-256, or its reason".
  - "is null when no page has a recording".
  - "keeps the shareable page's rules": one style block, one runnable script, one data block, and no `style` attribute.
  - In the browser:
    - "the speed choice sets playbackRate and keeps the pitch": choosing 0.25× gives `playbackRate === 0.25` and `preservesPitch === true`;
    - "Check the fingerprints passes, and catches a recording changed by one byte";
    - "is axe-clean in both themes at 1280, 390, and 320, and nothing is wider than 320";
    - "works by keyboard alone";
    - "plays with scripts off": the players still work, and only the speed choice and the check need the script.
- [ ] **Step 2:** Run `pnpm exec vitest run test/share-voice-page.test.ts test/share-check.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - Use the shareable page's document frame, theme, and top. Leave out its summary, cards, and details.
  - The check's data carries each run's records, as the shareable page's does, so the check recomputes each run's seal and hashes each recording.
- [ ] **Step 4:** Run `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `Make a voice page that plays each page's recording of NVDA at a speed a person can follow, and checks its fingerprints`.

### Task 5: The share writes the voice page, and the shareable page and Word copy point to it

**Files:**
- Modify:
  - `src/share/load.ts` (read each `voice.webm` whose record matches);
  - `src/share/model.ts` (`ShareInput.recordings`);
  - `src/share/share.ts` (write `${stem}.voice.html`, and list it among the copies);
  - `src/share/cards.ts` and `src/share/html/pages.ts` (the card's line);
  - `src/share/html/details.ts` and `src/share/word/details.ts` (the paragraph);
  - `src/share/run-evidence.ts` (`voice.webm` in the fingerprints);
  - `src/share/text.ts`.
- Test:
  - `test/share-load.test.ts`;
  - `test/share-share.test.ts`;
  - `test/share-html-pages.test.ts`;
  - `test/share-word-evidence.test.ts`;
  - `test/share-document.test.ts`.

**Interfaces:**
- Consumes: `renderVoicePage`, `voiceAnchor`, and `KEEPS_VOICE_FROM` (Task 4).
- Produces:
  - `ShareInput.recordings: Map<string, Uint8Array>`, keyed `<run>/<slug>`;
  - `PageCard.voice: { seconds: number; href: string } | null`.
- **The text:**
  - **The card's line:** "NVDA's voice: {length}, on the voice page", linking to `${stem}.voice.html#${voiceAnchor(slug)}`.
  - **The details' paragraph:** "NVDA's voice: what NVDA said aloud on each page is recorded and sealed with the run, and the voice page plays it at slower speeds." It's followed by a link to the voice page, or by the reason there's none.

- [ ] **Step 1: Write the failing tests:**
  - "loads a recording only when it matches its record".
  - "writes the voice page beside the pair when a run has a recording, and lists it with its size and SHA-256": the share's result and the record of what was sent.
  - "writes no voice page when no run has one".
  - "gives a recorded page's card the line, linked to its section".
  - "adds no line, and no change, for a run from before 0.17.0": the page is byte-identical to before for the i2i fixture.
  - "lists voice.webm in the Word copy's fingerprints, after the page's axe.json".
  - "keeps the shareable page's size": a 32-page share with recordings is no larger than without them, but for the lines.
- [ ] **Step 2:** Run the files above. Expected: FAIL.
- [ ] **Step 3: Implement it.** The shareable page links to the voice page by its file name. Both are written in the same share, with the same stem.
- [ ] **Step 4:** Run `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `Write the voice page with each share, and point to it from each recorded page's card, the details, and the Word copy's fingerprints`.

### Task 6: The website publishes the voice page

The controller merges main (0.16.0) into this branch first (D5).

**Files:**
- Modify:
  - `src/site/render.ts` (`fileKind` gives `"voice"` for a name ending `.voice.html`, shown as "NVDA's voice");
  - `src/site/headers.ts` (a `media` option that adds `media-src data:`);
  - `src/site/build.ts` (the voice page's policy);
  - `src/site/technical-text.ts` (the toolchain row for `libopus-wasm`; a line on Windows' process loopback; the voice page in what a share holds).
- Test:
  - `test/site-build.test.ts`;
  - `test/site-headers.test.ts`;
  - `test/site-render.test.ts`;
  - `test/site-technical.test.ts`.

- [ ] **Step 1: Write the failing tests:**
  - "publishes a share's voice page, and lists it as NVDA's voice in the report's files".
  - "gives only the voice page media-src data:": every other page's policy is unchanged.
  - "names libopus-wasm in the toolchain with its version from package.json".
  - "says what the voice page is, and that only NVDA's sound is recorded": checked against the code's words.
- [ ] **Step 2:** Run the files above. Expected: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4:** Run `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `Publish each share's voice page on the website, with a policy that lets it play its recordings, and name the encoder on Technical details`.

### Task 7: The README and the CHANGELOG

**Files:**
- Modify:
  - `README.md`: a section, "NVDA's voice";
  - the run folder's and verify's parts;
  - the Credits, for `libopus-wasm` (MIT) and libopus (BSD, Xiph.Org);
  - `CHANGELOG.md`: [Unreleased];
  - the spec, amended to what was built.

- [ ] **Step 1:** Write the README section:
  - what's recorded, and only NVDA's sound;
  - how: the helper, process loopback, and Windows 10 build 20348;
  - the sizes;
  - the voice page and its speeds;
  - what verify checks;
  - the reasons a page has no recording;
  - that the review is made from the transcripts.
- [ ] **Step 2:** Write the CHANGELOG entry, led by one line for the banner and What's New.
- [ ] **Step 3:** Check that every sentence is true of the code, and that the README's anchors resolve. The README test does part of this.
- [ ] **Step 4:** Run `pnpm lint && pnpm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `Describe NVDA's voice in the README and the CHANGELOG`.

## The release (with the owner)

1. Review the whole branch, then make one round of fixes and review them.
2. **The check at the PC, at the owner's word, hands off:**
   - run sfs (9 pages) with a build of this branch, and share it;
   - check the spec's five points;
   - the owner plays one page at 0.5× and settles 12 or 16 kbps.
3. Merge into main (`--no-ff`). Then make "Prepare 0.17.0":
   - the CHANGELOG heading and links;
   - the timeline row under `both`: `<b>0.17.0</b>: NVDA's voice: a recording of what NVDA said on each page, sealed with the run, and a voice page that plays it at slower speeds.`;
   - the Word copy test's days;
   - the handoff.
4. Push, and wait for CI to go green.
5. Run `./publish.sh --dry-run minor`.
6. Run `npm whoami`. Then, with the owner's 2FA code: `npm version minor --no-git-tag-version && npm publish --access public --ignore-scripts --otp <code>`.
7. Commit "Release v0.17.0", tag it, and push.
8. After the tarball wait, set `netlify.toml` to `@0.17` (the standing OK). Re-share sfs, then do the live check.
9. Update the handoff and the memories. Add `libopus-wasm` and the recorder helper to the PC security audit's list.
