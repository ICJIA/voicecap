# Forms Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `forms` pass that completes each form on a page with NVDA, by keyboard, checks it with axe with its errors showing, gives each form a definitive banner ("This form works with NVDA"), and never lets anything the form sends leave the browser.

**Architecture:** `forms` is a fourth pass with the usual transcripts, plus a sealed `forms-result.json` beside them. The driver gains optional actions, and a guard in `ChromeSession` that fails closed; `src/passes/forms.ts` decides what to do from what they return. Each form gets a fresh page load.

**Tech Stack:** TypeScript (strict), Node 22.19+, Playwright 1.63 attached over CDP, Guidepup 0.36.4, axe-core 4.14, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-30-forms-pass-design.md`

## Global Constraints

- **Nothing a form sends ever leaves the browser.** No option turns the guard off.
- No real NVDA or VoiceOver run without the owner's OK. Every subagent prompt must say so. Tests use the replay driver, fakes, or headless Chromium.
- Ask the owner before working around Guidepup. Screen-reader specifics stay in `src/drivers/` and config.
- Fields are filled by keys, never set by script. Focus may be moved by script only to reach a form's first field and its submit control.
- Submission is assumed to work. Errors only a server gives are out of scope.
- axe's findings are evidence, never a verdict, and never a flag.
- `forms` is opt-in (`--passes read,headings,tab,forms`). `DEFAULT_CONFIG.passes` doesn't change.
- A problem in this pass never fails the page's other passes.
- The banner is the feature's headline: the spec's four banners, with its exact words, shown first wherever a form is reported, never only in a fold, and never hedged.
- Limits: `forms.settleMs` 3000, `forms.maxPerPage` 5, presses per form at most fields + 1.
- Commit messages have no AI attribution trailers. Commit and push only when the owner asks. Check CI on a pushed branch before `main`.

## Review Focus

- A page that saves as you type, or checks a field on blur: the guard is armed **before the pass's first key**, not just before the press (stricter than the spec's wording, on purpose). Test in Task 1.
- `<form target="_blank">`, a script calling `window.open`, a service worker's own fetch, and a cross-origin frame's request: none reaches the server. Test in Task 1.
- A page that replaces its form after the press, so the fields voicecap found are gone: the form ends "couldn't go on", with no crash. Test in Task 4.
- A submit that's `type="button"` with a script handler, or a form that resets itself after the press: reported as what happened, and the loop ends at its limit. Test in Task 4.
- Ctrl+C or a restart mid-form: the retry gets a fresh load with a fresh guard, and nothing partial is kept as a result. Test in Task 5.

---

### Task 0: The PC trial (done, 2026-10-30)

The owner ran `pnpm forms:trial` on the PC (NVDA 2026.2, Windows). **No way around Guidepup is needed.** What it found, which later tasks rely on:

- `nvda.press("Enter" | "Space" | "ArrowDown")` and `nvda.type(text)` reach fields through Guidepup, once Tab has put NVDA in the field. The trial's whole form reached "Ready to send." by keyboard.
- Enter on a focused submit button works through NVDA. A page's `role="alert"` is spoken, and so is Chrome's own bubble: "Your name, edit, required, blank. Please fill out this field., alert". Chrome moves focus to the first invalid field, and shows only that field's message.
- Every announcement arrived within 500 ms on a local page. `forms.settleMs` stays 3000, for real sites.
- NVDA says "required" on every required field, so `form-required-unsaid` can rely on it.
- **NVDA says "invalid entry" before any press,** on an untouched required radio, list, and check box. `form-error-unlinked` must not take those words alone as evidence: compare the walk before the press with the walk after it, and ask for what changed or for the error's own words.
- Chrome's bubble isn't in the DOM. `FormState.messages` must include the focused field's `validationMessage`, or `form-error-silent` would flag every form that uses native validation.
- Typing is echoed a character at a time ("v", "o", "i", …), so a filled field's step is long. That's expected, not a problem to flag.

### Task 1: The guard

**Files:**
- Modify: `src/drivers/guidepup/chrome.ts`
- Test: `test/form-guard.test.ts`

**Interfaces:**
- Produces: `ChromeSession.armFormGuard(): Promise<void>`, which rejects unless armed and confirmed; `ChromeSession.heldRequests(): number`.

- [ ] **Step 1: Write the failing tests,** in headless Chromium against a local server that counts every request. `reaches` is its count after the page's own load.

```ts
it.each(["post form", "get form", "fetch", "xhr", "beacon", "websocket", "window.open",
  'target="_blank" form', "service worker fetch", "cross-origin frame's form", "input event autosave"])(
  "lets nothing out: %s", async (kind) => {
    await armAndTrigger(kind);
    expect(server.reaches()).toBe(0);
    expect(session.heldRequests()).toBeGreaterThan(0);
  });
it("still lets a stylesheet and an image load", /* both reach the server */);
it("rejects, and presses nothing, when the guard can't be confirmed", /* a stubbed failing route */);
```

- [ ] **Step 2: Run:** `pnpm exec vitest run test/form-guard.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Route at the browser-context level, so frames and new windows are covered, and set `Network.setBypassServiceWorker`. Allow only GET of `image`, `stylesheet`, `font`, and `script` resource types; abort everything else, and count it. Block WebSockets with `routeWebSocket`. Close any new page at once. Confirm by a same-page `fetch` that's seen held.
- [ ] **Step 4: Run again.** Expected: PASS, on all three systems in CI before going on.
- [ ] **Step 5: Commit:** "Add a guard that keeps anything a form sends in the browser".

### Task 2: `forms` as a pass name

**Files:**
- Modify: `src/model.ts`, `src/config/schema.ts`, `src/config/defaults.ts`, `src/transcripts/format.ts`, `src/drivers/replay.ts`, and each of the 36 files that use `PASS_NAMES` or `PassName` where it assumes three
- Test: the existing suites, and `test/forms-pass-name.test.ts`

**Interfaces:**
- Produces: `PASS_NAMES` with `"forms"`; `DriverCommand` with `"focusField" | "pressSubmit" | "fillField"`; `config.forms: { settleMs: number; maxPerPage: number; values: Record<string, string> }`; `stepCaps.forms` (default 500).

- [ ] **Step 1: List every assumption.** `grep -rn "PASS_NAMES\|PassName\|three\|\* 3" src`, and note in the task's commit which needed no change. Look hard at: transcript counts, "three ways", `nvdaGestureOf`, the voice page's stretches (one per pass), the walkthrough reader, and `settingsHash`.
- [ ] **Step 2: Write the failing tests:** default passes stay three; `--passes forms` is accepted; a walkthrough file with no `stepCaps.forms` is still read; a config hash with no forms pass is unchanged; a run's transcript count doesn't assume 3 × pages.
- [ ] **Step 3: Implement.** Make `forms` absent from defaults, and keep the hash of an existing config the same.
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`. Expected: PASS, with no existing test's expected output changed.
- [ ] **Step 5: Commit.**

### Task 3: Finding forms, and what they're like

**Files:**
- Create: `src/forms/classify.ts`, `src/drivers/guidepup/form-scan.ts`
- Test: `test/forms-classify.test.ts`, `test/form-scan.test.ts`

**Interfaces:**
- Produces:

```ts
type FormKind = "test" | "search" | "no-submit" | "other-site";
interface FormField { index: number; name: string | null; type: string; required: boolean }
interface FormInfo {
  index: number; signature: string; kind: FormKind; site: string | null;
  fields: FormField[]; sensitive: boolean; captcha: boolean;
}
interface FormState {
  focused: FocusedElement | null; invalid: number[]; messages: string[];
  liveChanged: boolean; heldRequests: number; present: boolean;
  /** The focused field's own validationMessage: Chrome's bubble, which is in no element. */
  bubble: string | null;
}
```

- [ ] **Step 1: Write the failing tests,** one for each row of the spec's "Which forms" table, on HTML fixtures; `signature` is the same for one form on two pages and differs for two forms.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** `classifyForm(raw: RawForm): FormKind`, pure, in `classify.ts`, and the in-page scan, run in voicecap's isolated world so the page's scripts can't change it. `sensitive`: a `password` type or `cc-*` autocomplete. A message is new visible text in the form, in an `alert` or live region, or named by `aria-describedby` or `aria-errormessage`.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 4: The pass

**Files:**
- Create: `src/passes/forms.ts`, `test/helpers/fake-form-driver.ts`
- Modify: `src/drivers/types.ts`, `src/passes/index.ts`
- Test: `test/forms-pass.test.ts`

**Interfaces:**
- Consumes: `FormInfo`, `FormState`; `StepRecorder`.
- Produces: optional driver members `findForms(): Promise<FormInfo[]>`, `armFormGuard(): Promise<void>`, `focusFormField(form: number, field: number): Promise<Speech>`, `pressSubmit(form: number): Promise<Speech>`, `fillField(value: FieldValue): Promise<Speech>`, `formState(form: number): Promise<FormState>`, `checkFormWithAxe(form: number): Promise<AxeCapture>`; and `formPass(driver, recorder, form, options): Promise<FormOutcome>`.

```ts
type FormResult = "completed" | "stuck" | "not-tested";
interface FormOutcome {
  form: FormInfo; result: FormResult; stoppedAt: FormField | null; reason: string | null;
  presses: { state: FormState; spoken: string; axe: AxeCapture | null }[];
  firstWalk: FieldHeard[]; lastWalk: FieldHeard[];
}
```

- [ ] **Step 1: Write the failing tests,** with the fake driver:
  - a form with 3 required fields: `completed`, 4 presses, and every field heard
  - no press happens when `armFormGuard` rejects: `not-tested`, with the reason, and `fillField` never called
  - `sensitive`: one press, no `fillField`
  - a field that won't take its value: `stuck`, `stoppedAt` names it
  - a required field Tab never reaches: `stuck`
  - pressing changes nothing: ends, no more presses
  - the form's gone after a press (`present: false`): `stuck`, no throw
  - a form that resets after each press: ends at fields + 1 presses
  - a driver without the members: every form `not-tested`, "this run's driver doesn't test forms"
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement,** in the order of the spec's five steps: arm the guard first, then walk, press, look, walk, fill, repeat. "Completed" is a press with `heldRequests` up and no new `invalid`.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 5: Running it: fresh loads, the run, and the driver

**Files:**
- Modify: `src/run/page-runner.ts`, `src/drivers/guidepup-nvda.ts`, `src/drivers/guidepup/chrome.ts`, `src/drivers/replay.ts`
- Test: `test/run-forms.test.ts`, `test/guidepup-driver.test.ts`

**Interfaces:**
- Consumes: Task 4's members. `axe` reuses `ChromeSession.runAxe`, limited to the form's selector, within `AXE_LIMIT_MS`.
- Produces: `FormSignatures`, a set kept across a run's sessions in `run.json`, so a form is tested once and a resumed run doesn't repeat it.

- [ ] **Step 1: Write the failing tests:** each form gets its own `openPage`; a page's second occurrence of a signature adds "tested on /x" and no presses; more than `maxPerPage` says how many were left; a page with no forms has no `forms` transcripts and no gap; a forms-pass failure leaves the page's other passes done; Ctrl+C mid-form keeps no outcome for it, and a retry opens a fresh page and arms a fresh guard; Enter, Space, and the keys a fill presses are in `nvdaGestureOf`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** `fillField` presses keys through Guidepup, as Task 0 found works: `type` for text, `Space` for a check box or radio, `ArrowDown` for a list. Add them to `NvdaControl` with the same capture as `press`. The typed value is one of voicecap's own fake values, so the cleaned NVDA log may keep it; add those keys to what the log keeps, or mark those steps "not checked". Choose whichever Task 0 and `src/share/log-check.ts` show is simpler, and say why in the commit.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 6: The record

**Files:**
- Create: `src/forms/result-file.ts`
- Modify: `src/run/page-runner.ts`, `src/model.ts`, `src/verify.ts`
- Test: `test/forms-result.test.ts`, `test/verify.test.ts`

**Interfaces:**
- Produces: `FORMS_FILE = "forms-result.json"`, `PageRecord.forms: FormsRecord` (a `FileHash` with `ranAt` and counts, or `{ error, ranAt }`), written with sorted keys, as `axe.json` is.

- [ ] **Step 1: Write the failing tests:** the seal covers it; `verify` names a changed, missing, or unrecorded file; a run with no forms pass passes; a review never copies it; the home folder is redacted; the same results give the same bytes.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement,** following `AXE_FILE`'s path through `page-runner.ts` and `verify.ts`.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 7: Flags

**Files:**
- Modify: `src/flags/evaluate.ts`, `src/flags/wcag.ts`, `src/config/defaults.ts`, `src/share/attention.ts`, `src/share/attention-words.ts`
- Test: `test/forms-flags.test.ts`

**Interfaces:**
- Consumes: `FormOutcome`.
- Produces: the six rules, with the spec's exact ids and WCAG numbers.

- [ ] **Step 1: Write the failing tests,** one each way, including "invalid entry" said before the press and no change after it (no evidence of an error being linked), and a native bubble NVDA spoke (not silent), for: `form-error-silent` (3.3.1, 4.1.3), `form-no-feedback` (3.3.1), `form-error-unlinked` (3.3.1, 1.3.1), `form-required-unsaid` (3.3.2), `form-cant-finish` (2.1.1, 3.3.3), `form-field-unreachable` (2.1.1); no flag on a completed form; no flag from axe; a flag never changes the exit code. A message seen only after a request was held doesn't count as a form error.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement,** matching NVDA's English words from config. Each rule's card has the likely cause, why it matters, the fix in the code, and the path forward.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 8: What readers see

**Files:**
- Create: `src/forms/banner.ts`
- Modify: `src/site/render.ts`, `src/share/cards.ts`, `src/share/html/pages.ts`, `src/share/summary.ts`, `src/share/word/*`, `src/share/ai/*`, `src/share/voice-page.ts`, `src/share/check.ts`, `src/report/render.ts`
- Test: the suites for each, `test/share-forms.test.ts`

**Interfaces:**
- Produces: `formBanner(outcome: FormOutcome, flagsLeft: FlagResult[]): { kind: "works" | "needs-work" | "cant-complete" | "not-checked"; headline: string; detail: string }`, in `src/forms/banner.ts`, the only place a banner's words are decided; and `ShareResult.forms?: { found: number; working: number }`, recorded in `shares.json` for the website.

- [ ] **Step 1: Write the failing tests:** each of the four banners, with the spec's exact headline; a "Reviewed, no issues" review of a flagged but completed form turns it green, and a review never turns "can't be completed" green; each banner is in view on the page's card, outside any fold, and its sign repeats its words; "At a glance" says `All 4 forms work with NVDA` or `3 of 4 forms work with NVDA`, naming the pages, only when a run has the pass; the website's card shows the same line from `shares.json`, and `No forms on these pages` for a site with none; a share from before this has no line; a card's fold "What happened at the form" has each required field with NVDA's words, each press, and axe "with its errors showing"; a run with no forms pass says nothing, and one from before it says "Not recorded"; the Word copy writes it out; the Markdown and JSON have it, with its WCAG list; the fingerprint check covers `forms-result.json`; axe-clean in both themes.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement,** following what axe's fold did at each site.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 9: Fixture, real run, and docs

**Files:**
- Create: `fixture/site/forms/*`
- Modify: `fixture/replay-run`, `README.md`, `CHANGELOG.md`, `src/site/technical-text.ts`
- Test: `test/fixture-forms.test.ts`

- [ ] **Step 1: Add fixture pages:** a good form, silent errors, no feedback, no labels, and a field a keyboard can't fill.
- [ ] **Step 2: Ask the owner to run `pnpm fixture:capture` on the PC.** Real NVDA, so **only with the owner's OK**.
- [ ] **Step 3: Write the fixture test:** each page gives its expected result and flags from the recorded run.
- [ ] **Step 4: Update the README's passes, Known limitations, and Technical details,** and the CHANGELOG.
- [ ] **Step 5: Run** `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 6: Commit,** then real runs on ICJIA sites with the owner, and a separate decision on making `forms` a default.
