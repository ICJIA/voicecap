# Forms pass: design

Status: approved by the owner, 2026-10-30. Nothing is built. The owner asked for voicecap's recommendations rather than a round of questions, so every decision below is voicecap's call unless it says otherwise, and each can be overruled. The owner's own decisions: nothing is ever sent, submission is assumed to work, and the test is whether the form is accessible through NVDA and axe.

## Why

The owner's manager asked for forms to be tested with NVDA. Most ICJIA sites have at least one form. The read, headings, and Tab passes hear a form as it sits on the page, but never use it, so they can't say what a blind visitor hears at the moment that matters most: pressing submit with something wrong.

The owner's request: for any page with a form, try the submit button, and read what stops the form going through, such as a required field left empty.

The owner's emphasis, 2026-10-30: "the main thing is that forms work via NVDA, including the required fields", and "Assume the form submission works. The key is just making sure that the form is accessible via NVDA and axe."

**The question this pass answers:** can a screen reader user complete this form with NVDA? That means reaching every required field by keyboard, hearing what each is and that it's required, filling it in, pressing submit, and, when something is wrong, finding out what and fixing it.

## Goals

- Find the forms on each page of a run, and say which were tested and why any wasn't.
- Complete each tested form with NVDA, by keyboard alone: every action goes through keys, as a person's would. Fill the required fields with obviously fake values until the form would have gone through, or say exactly where it couldn't go on.
- Check each required field on the way: NVDA can reach it, says its name, says it's required, and it takes the value.
- Check each form with axe in the states the first-load check never sees: with its errors showing, and filled in.
- Press submit before the fields are filled too, and show what stopped the form and whether NVDA said so. A message on screen that NVDA never says is a main finding.
- Give each form a definitive result a manager can read at a glance: "This form works with NVDA". This is what the manager is looking for, so it's the headline of the feature.
- Keep it all in the same sealed, checkable record as the other passes.

## Anti-goals

**Nothing a form sends may ever leave the browser.** This outranks every other goal. A test that emails a program officer, files a fake grant application, or adds a row to a live database is a failure, however good the report looks. voicecap runs against live sites, and it can't tell what a form does on the server.

Also out: testing whether a form's submission works, which voicecap assumes it does; judging whether an error message is well worded (a person decides that); and multi-page forms past their first page.

## The guard

Everything the pass does to a form happens behind a guard: one wall at the network, not a list of browser features to block, since a list always misses one. On a load for this pass, Chrome reaches the network only through a small local gate that voicecap runs (a proxy, for every address, with QUIC and direct UDP off, and no name lookups of its own). The page loads through it as usual. Before the pass's first key, since some pages save or check a field as it's typed in, voicecap shuts the gate and cuts every open connection. After that nothing gets out, whatever a page tries: a form, a script, a worker, a beacon as the page closes, or a request for a file it already had. A late style sheet or icon doesn't load, which NVDA's speech doesn't depend on. Inside the browser, requests are also caught, only so the page stays where it is and voicecap can count what was held. The other passes don't use the gate.

- **It fails closed.** If the guard can't be armed, or can't confirm it's armed, voicecap doesn't press. The form is recorded as not tested, with the reason.
- **GET forms are held too.** A GET form usually searches, but it can also unsubscribe or confirm.
- **A real-Chromium test proves it,** in CI, on all three systems: a local server counts what reaches it while each kind of form is submitted, and the count has to stay at zero.
- **There's no option to turn it off.** A later phase could add one for a staging site, but only as a deliberate decision of its own.

So voicecap sees only what the page does in the browser, and that's all it's asked to see: it assumes the form's submission works. "Would have sent" means the form passed everything the browser checks, and it's reported as a good result. Errors only a server would give are out of scope. A page that reacts to the aborted request with its own "network error" message may show words the site never normally shows, so a message that appears only after a request is held isn't treated as a form error.

## What happens to each form

Each form gets a fresh load, as each pass does, because pressing submit changes the page.

1. **Hear the form.** voicecap moves focus to the form's first field and tabs through it to the submit button, keeping what NVDA says at each stop: does it give the field's name, and say "required"? A required field that Tab never reaches is a failure in itself.
2. **Press submit, empty.** Enter on the focused submit button, through NVDA, with the guard armed. voicecap waits for NVDA to go quiet, plus a settle time (`forms.settleMs`, proposed 3 seconds), since many forms show errors a moment later.
3. **Look at the page.** From the browser, it records where focus went, which fields are invalid, what messages appeared, whether a live region changed, and whether a request was held. Then axe checks the form as it now stands, errors showing, in the same way as the check on first load, limited to the form. Each press after the first is checked only when the form's errors changed.
4. **Hear it again.** It tabs through the form once more, to learn whether each invalid field now says so, and says what's wrong.
5. **Fill one and press again.** This is the heart of the pass. It tabs to the first field that's blocking, fills it by keyboard through NVDA, and repeats steps 2 to 4. It stops when the form would have gone through (a request was held), when pressing changes nothing, or at its limit (the number of fields, plus one). Values are never set by script: a field a keyboard can't fill must show up as one, such as a date picker that needs a mouse.

Fake values are plainly fake and come from a table in the config: `voicecap test` for text, `test@example.com` for email, `555-555-5555` for a phone number, Space for a required check box, and arrow keys for a list or radio buttons. Each value goes only into the field in the page, and the guard stops it going further.

**The result for each form** is one plain answer: "Completed with NVDA: all 4 required fields were filled, and the form was ready to send", or "Couldn't complete it: NVDA reached 2 of 3 required fields, and stopped at Date of birth". voicecap can't see fields the page doesn't mark as required, so it fills what the page, or its errors, say is required, and says so.

## Which forms

voicecap finds forms from the browser, by `<form>` elements with a submit control.

| Form | What voicecap does |
| --- | --- |
| A form with a submit control | Tests it |
| A search form (`role="search"`, or one search or text field and a GET) | Skips it, and says so: it has no required fields to learn from |
| The same form on many pages (a newsletter sign-up in the footer) | Tests it once in the run, and later pages say where it was tested |
| More than 5 forms on a page (`forms.maxPerPage`) | Tests the first 5, and says how many it left |
| A login, or a field for a card number or a password | Tests it empty, and never fills it |
| A CAPTCHA | Tests it empty, and says the CAPTCHA stops voicecap there |
| A form in another site's frame (Google Forms, Microsoft Forms) | Doesn't test it, and names the site that holds it |
| A form that sends by email (`mailto:`), or by anything but a web address | Doesn't press it, and says so |
| Fields with no `<form>`, or no submit control | Doesn't test it, and says so |
| A form with several steps | Tests the first step only |

## How it fits voicecap

- **A fourth pass.** `forms` joins `PASS_NAMES`, with `forms.txt` and `forms.json` transcripts in the usual format, so fingerprints, seals, replay, comparison, and review work as they do now. A page with no forms has no such transcripts, and that must not read as a gap. 36 files name the passes, and many assume three ("three ways", a transcript count of 3 × pages), so the first step of the plan is to find each one.
- **A record beside the transcript.** `forms.json`'s neighbor, `forms-result.json`, works as `axe.json` does: what the browser saw, for each form and press, kept apart from the page's transcript files and sealed with the run.
- **New driver actions, all optional.** `findForms()`, `focusFormField()`, `pressSubmit()` (which arms the guard), `fillField()`, and `formState()`. A driver without them can't run the pass, and its run says so. Screen-reader specifics stay in the driver. `src/passes/forms.ts` decides what to do next from what they return.
- **Opt-in first.** It's run with `--passes read,headings,tab,forms`. It becomes a default only after real runs on the PC. It presses buttons on live sites, which nothing else in voicecap does, so that step should be taken on evidence.
- **Failures.** As with axe, a problem in the forms pass never fails the page's other passes.

## Flags

Each is a hint for a person, never a verdict, and each may relate to the WCAG criteria shown.

| Flag | Raised when | May relate to |
| --- | --- | --- |
| `form-error-silent` | A message appeared or a field turned invalid, and NVDA said none of it after the press | 3.3.1, 4.1.3 |
| `form-no-feedback` | Pressing submit changed nothing, and no request was held | 3.3.1 |
| `form-error-unlinked` | On the second walk, an invalid field didn't say it was invalid, or what's wrong | 3.3.1, 1.3.1 |
| `form-required-unsaid` | A field that blocked the form didn't say "required" on the first walk | 3.3.2 |
| `form-cant-finish` | Filling the fields by keyboard never got the form to the point of sending | 2.1.1, 3.3.3 |
| `form-field-unreachable` | Tab never reached a required field, or its value couldn't be entered by keyboard | 2.1.1 |

The `unlabeled` flag already covers a field with no name. A form that gets to the point of sending with no problems raises no flag.

axe's findings on a form stay what they are on a page: evidence beside the review, never a verdict and never a flag. They're shown with the form, labeled by state ("with its errors showing"), and kept in `forms-result.json`.

## What readers see

**The banner is the point of this feature.** The owner, 2026-10-30: there must be "a definitive banner or flag or info box saying that the form has been checked and works with NVDA". It comes first wherever a form is reported, and it's plain and definite, with no hedging:

| Banner | When |
| --- | --- |
| ✓ green: **This form works with NVDA.** "Checked 30 October 2026: NVDA reached all 4 required fields, said each one's name and that it's required, and told the user what was wrong. The form was completed by keyboard." | The form reached the point of sending, and no form flag is left on it. A person's `voicecap review` of "Reviewed, no issues" settles a flag, as on any page |
| ⚠ amber: **This form needs work with NVDA.** It says what's wrong, such as "NVDA didn't say the error for Email." | Completed, with a form flag left |
| ⚠ red: **This form can't be completed with NVDA.** "It stopped at Date of birth." | It never reached the point of sending |
| Gray: **This form wasn't checked.** It says why, such as a form on another site | Not tested |

The words and signs repeat each other, so color is never the only sign. A line under the banner gives axe's result with the form's errors showing, such as "axe: no issues". axe is evidence and doesn't change the banner.

- **"What needs attention"** gets a card for each flag, as any flag does, with NVDA's words, the page's message beside them, the likely cause, and the fix in the code.
- **"At a glance"** gets its own banner, once a run has this pass: ✓ "All 4 forms work with NVDA", or ⚠ "3 of 4 forms work with NVDA", naming the page of each that doesn't.
- **The website's site card** shows the same line beside the verdict, from what the share recorded, so a manager sees it without opening the report. A site with no forms says "No forms on these pages", and that's not a problem.
- **Each page's card** shows each form's banner, in view, not in a fold, then a fold, "What happened at the form": each required field with what NVDA said of it, what each press did, and what axe found with the errors showing.
- **The Word copy, the report for AI tools, and the voice page** carry the same, and the voice page's recording gets a stretch for the pass.
- **A run from before this pass** says "Not recorded", like every other newer feature.

## Order of work

1. **A short trial on the PC, with the owner's OK. Done 2026-10-30:** every answer was good, and no way around Guidepup is needed. The plan's Task 0 has the findings. It asked: whether NVDA reads Chrome's native validation bubble, whether Enter reaches the button through NVDA in focus mode, how long error announcements take, and whether typing, Space, and arrow keys reach fields through Guidepup. The last matters most: filling fields by keyboard is the heart of the pass. If any of these needs a way around Guidepup, stop and ask the owner first.
2. **The guard, and its test.** Nothing else is built until it's proven.
3. **The whole pass, in one release:** the empty press and filling the fields go together, because completing a form is the point. Fixture pages: a good form, one with silent errors, one with no feedback, one with no labels, and one with a field a keyboard can't fill. Report, flags, and a real recorded fixture run.
4. **Real runs on ICJIA sites,** with the owner, then a decision on making it a default.

## Left to the builder

The exact shape of `forms-result.json`, the words on the page, which messages count as an error (a proposed rule: new visible text in the form, in an `alert` or live region, or named by `aria-describedby` or `aria-errormessage`), and the settings' final names.
