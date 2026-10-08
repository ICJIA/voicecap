# "Can I trust this?": a page that shows how voicecap can be checked

## Why

Managers won't take one person's tool on trust, and they shouldn't have to. The owner asked on 2026-10-08 for a "Can I trust this?" page in the website's top bar, "similar in look and feel and detail" to audit.icjia.app/trust: a page that says plainly who made voicecap, and then shows that it can be checked, that it runs its own tests, and that every claim can be verified. "The idea of the 'can I trust this' is to persuade." And: "make all numbers and dates in the trust page dynamic -- so they automatically update when a new version is pushed or new tests are added or new features are added."

The owner approved this design in chat on 2026-10-08 ("Yes, write the spec"). It ships as 0.13.2, after 0.13.1 (the website's banners).

## What it is

A second page on the website that `voicecap site` builds: `trust.html`, served at `voicecap.netlify.app/trust` too. Every page of the website has a link to it in its top bar: **Can I trust this?**

It has the website's look: one self-contained file, dark at first with a switch to light, light in print, the same fonts, colors, and banners, and the same rules. That means headings in order, landmarks, a skip link, visible keyboard focus, complete without JavaScript, no `style` attribute, and a Content Security Policy made from the hashes of its own style block and script.

## Every number and date is generated

Nothing on the page is a number or a date about voicecap typed by hand. Each comes from one of two places, and the page says which. The one exception is the law's own compliance dates (part 5), which are the rule's, quoted with a link to it.

**From voicecap itself, recorded with each release.** A release writes `dist/release-facts.json` into the package:
- **the tests:** how many passed, how many were skipped, and in how many files, from that release's own run of the tests (publish.sh runs every test before anything is published);
- **the public changes:** how many commits the release has on top of, and the date of the first;
- **where CI runs:** the systems and Node versions in `.github/workflows/ci.yml`'s matrix (today Ubuntu, macOS, and Windows, with Node 22 and 24: 6 combinations).

**From the package and the records, at every build of the website:**
- **the version,** from voicecap's own `package.json`, and **its release date**, from its CHANGELOG entry;
- **every release:** each `## [x.y.z] - date` entry of the CHANGELOG that ships in the package, with its first line, so a new release, and what it added, appear on their own;
- **the sites:** how many sites have reports on the website, and how many reports;
- **the pages NVDA read** in the sites' current reports, and the problems that need attention there, from what each share recorded (`result`);
- **the files:** how many the build published, each matching the fingerprint recorded when it was shared, and how many it left out because they didn't.

**The stamp,** under the page's heading, says where the numbers come from: "voicecap 0.13.2, released 9 October 2026 · records as of 8 October 2026, 07:03". The second date is the newest share's. The page is a pure function of the package and the records, so building the same records twice writes the same bytes, as the website's own page does.

**When a fact isn't there,** the page says so in its place, and never makes one up. A build of voicecap that wasn't released (a developer's, or CI's) has no test count, and says "not recorded in this build of voicecap". A website with no report at all says in the stamp that no report has been shared yet. One with no site's report (the demo's is an example, not a site's) says in the pages tile that "no site's report has been shared yet", and one whose sites' current reports recorded no result says "pages NVDA read in the current reports: not recorded in the shares on this website".

## The page, top to bottom

1. **The bar:** the website's, with its links, "Can I trust this?" marked as the page you're on (`aria-current="page"`), and the theme button.
2. **"Built to be checked. See for yourself."** The lead: every claim on this page can be checked without taking anyone's word for it, the builder's included. The stamp. Then four big numbers, each with a line that says what it counts and a link to where it's shown:
   - the tests that passed for this release;
   - the pages NVDA read in the current reports on this website;
   - the files on this website, every one matching its fingerprint (with none published, its line is only "files on this website");
   - the releases, and the public changes (commits), since the first commit's date.
3. **What it does.** One job: hear a website the way a screen reader user hears it. Real NVDA reads every page three ways (line by line, heading by heading, and control by control), voicecap saves every word, and a person reviews what it said. It's a human review, sped up.
4. **Real NVDA, not a simulation.** voicecap drives NVDA, the free screen reader most blind Windows users use, and records exactly what it says. Every transcript is NVDA's own words.
5. **The law: "Title II. IITAA. WCAG."** The lead: "Government information must work for everyone. Two laws say so; one rulebook defines 'works.'" Then three cards, worded as the audit tool's page words them (the owner confirms the wording when reviewing this spec), each heading linked to its source:
   - **Title II of the ADA** (federal law, [ada.gov's page on the rule](https://www.ada.gov/resources/2024-03-08-web-rule/)): "The Department of Justice rule for state and local government. It names WCAG 2.1 Level AA as the standard, and its compliance dates are April 26, 2027 for entities serving 50,000 people or more and April 26, 2028 for smaller ones and special districts."
   - **IITAA** (Illinois law, [DoIT's accessibility page](https://doit.illinois.gov/initiatives/accessibility.html)): "The Illinois Information Technology Accessibility Act, our state's own accessibility law, older than the federal rule, also built on WCAG 2.1 AA. It applies to Illinois state agencies and universities."
   - **WCAG** (the rulebook, [W3C's WCAG page](https://www.w3.org/WAI/standards-guidelines/wcag/)): "The Web Content Accessibility Guidelines, the international rulebook both laws point to." For voicecap: what NVDA says is how a screen reader user meets a page, so its transcripts show, word for word, how a page's images, headings, links, and controls come across against that rulebook; the person reviewing decides.
6. **The evidence can be checked.**
   - Every transcript and screenshot has a SHA-256 fingerprint. Every run's record is sealed, and every share and every review is chained to the one before it.
   - `voicecap verify` checks a whole audit record.
   - Each report checks its own fingerprints in your browser ("Check the fingerprints").
   - The website publishes only files that match their recorded fingerprints.
   - Each report's walkthrough file repeats its run.
   - Four of these five points link to where they're shown or described (not the one on the files the website publishes).
7. **How it's tested.**
   - **Before each release:** every test (the number), the lint, the type checks, and a check that the package installs and runs.
   - **CI, on every change:** the same on every combination in its matrix (the systems and Node versions), plus a run of the CLI with its replay driver.
   - **The shareable page (the report you open from this website) and this website itself are checked with axe** in a real browser, in both themes and at a phone's width.
   - **A run with real NVDA** happens at a PC before a release that changes how NVDA is driven.
8. **What it doesn't do.** The honest limits:
   - It doesn't decide what's accessible: a person does.
   - It's NVDA only, for now; VoiceOver on a Mac comes later.
   - A transcript shows what NVDA said, not what every screen reader would say.
   - The automated checks of other tools (axe) find what code can find; a person's review finds the rest.
9. **"One person built this."** Built by Christopher Schweda at ICJIA. The objection answered in six cards:
   - the code is public, on GitHub, free (MIT);
   - it uses the real screen reader;
   - every word is on the record: each report keeps every transcript "and, since voicecap 0.11.0, a screenshot of each page NVDA read" (a report shared before 0.11.0 has none);
   - anyone can check the fingerprints;
   - the tests (the number): "This release passed them first, on <system>, and CI runs them on every change.";
   - a public, dated record of every change (the releases and commits).
10. **How it got here.** Every release, newest first, with its date and its first line, from the CHANGELOG: the newest five shown, the rest in a fold.
11. **The footer:** the website's, with links to GitHub, the CHANGELOG, and the npm package, and the version.

## Wording

The page follows voicecap's rules:
- voicecap is a human review, sped up, and never "automated" ("automated" may describe another tool, such as axe, never voicecap);
- a person hears, reads, and decides, and never "listened";
- no mention of an AI assistant;
- Guidepup isn't named, as on every page made for managers.

## How it's built

- **`scripts/release-facts.mjs`:** writes `dist/release-facts.json` from the test run's JSON report, `git`, and the CI matrix. publish.sh runs it after the tests pass and the build is done, and its pack check requires the file.
- **`src/site/facts.ts`:** reads `release-facts.json` and the package's `package.json` and CHANGELOG, beside voicecap's `dist`, and counts the records' facts from what the build published (`SiteContent` and what it left out). Pure, except for reading those files.
- **`src/site/trust.ts`:** renders the page from the facts. **`src/site/text.ts`** gains its words, and **`src/site/style.ts`** its styles (the stat tiles, the cards, the release list).
- **`src/site/render.ts`:** the bar gains the link on every page.
- **`src/site/build.ts`:** writes `trust.html`, and `_headers` gives it its policy at both addresses.

## Tests

- **The facts:**
  - the CHANGELOG's releases are parsed, with dates and first lines;
  - test counts are read from a test run's JSON report;
  - the CI matrix is read from a workflow file;
  - a build with no release facts says "not recorded".
- **The page:**
  - its headings are in order, and every number comes from the facts given (none is fixed in the page's code);
  - the stamp's two dates;
  - the bar's link and `aria-current`;
  - no `style` attribute, and the policy's hashes;
  - links only to the website's own pages, GitHub, npm, and the CHANGELOG.
- **The build:** `trust.html` is written, its rules are in `_headers`, and the bar of `index.html` links to it.
- **In a browser:** axe with no violations in both themes, at 1280, 390, and 320 pixels; it fits 320 pixels; it's complete without JavaScript.
- **publish.sh:** its pack check names `dist/release-facts.json`.

## Docs and release

- **The README:** the page in "The website: `voicecap site`", what it shows, and where each number comes from; a picture of its top (`pnpm readme:screenshots`).
- **The CHANGELOG,** and no timeline row (a patch).
- **The release:** 0.13.2. Netlify builds with `@0.13`, so the website takes it on its next build, which a push to the transcripts repo starts. No report needs sharing again.

## Not included

- Numbers about the runs themselves (lines NVDA spoke, NVDA time): the website builds from what was shared, and a share doesn't record them. They can come later, recorded with each share.
- A trust link inside each shared report: a report's page is frozen when it's shared.
- Live numbers from a server: the website is static, and every number is as of its build.
