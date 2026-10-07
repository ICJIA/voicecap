# Plan 7: What needs attention, as a card for each problem

**Goal:** Make the shareable report's "What needs attention" a card for each problem: what NVDA says and where, the likely cause, why it matters, the fix in the code, what NVDA should say then, and the path forward. A person's review settles a flag, and the summary loses its "heard live" count. Ship it as 0.12.0, then share the i2i v3 report again.

**Architecture:** A pure model in `src/share/attention.ts` groups the page cards' flags (the current rules'), failures, open issues, and changes since review into `AttentionCard`s. It works from the shown transcripts' lines, through a new `flagItemLines` in `src/flags/evaluate.ts`. `attentionWords` in `src/share/attention-words.ts` (Ruling R12) turns a card into words, and `ATTENTION_TEXT` in `src/share/text.ts` holds the section's fixed strings; both the page (`src/share/html/attention.ts`) and the Word copy (`src/share/word/attention.ts`) render them. The summary takes its problem count and its titles from the cards.

**Tech Stack:** TypeScript strict ESM, Node 22.19+, pnpm, Vitest, Playwright's headless Chromium (axe, folds, the README's screenshots), and docx 9.8.1. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-30-shareable-report-design.md`, as amended in 37cbdff. The parts this plan builds:
- "The page, top to bottom", items 2, 3, and 5;
- "The human review";
- "What needs attention: a card for each problem";
- "What's open at first, and what's folded";
- "Rules the page follows";
- "Tests", under "What needs attention (0.12.0)";
- "Stages and release", item 4.

**Branch:** `plan-7-what-needs-attention`, from `main` at c5b4763 (0.11.0). Plan 6c waits after its Task 2 (see its ledger's PAUSED line).

## Global Constraints

- **Never "automated".** voicecap is always a person's review with a real screen reader, sped up, never "automated testing" or an "automated checker".
- **Words to avoid:** never say a person "listened" (say "heard"; keep "listen-through"). Never name Guidepup on the page or in the Word copy.
- **Only what the records show.** The page says a person heard NVDA, reviewed, or fixed something only where the records say so, and it never leads with what a person hasn't done.
- **A fix is a suggestion.** A card's fix is the usual fix for the case NVDA's words show, and the person reviewing decides whether it fits.
- **Blame the right party.** A card's likely cause never blames NVDA or the site for what a browser adds, and it says which browser added it.
- **From speech, never from code.** The fix comes from what NVDA said, never from the page's code: voicecap keeps no page's HTML.
- **Computed numbers.** Every number is computed from the records, never typed.
- **One source of words.** The page's words live in `src/share/text.ts`, and both renderers use them, so the Word copy has the same cards.
- **Accessibility:**
  - headings in order, and no status shown by color alone;
  - folds are `<details>` and `<summary>`;
  - a section's heading is never inside a fold, and a fold's summary line is never a heading;
  - headings inside a fold start at level 3;
  - axe reports zero violations.
- **Copy the spec pins, word for word:**
  - "Nothing needs attention: every page was read, and every flag was fixed or checked by a person." When no page raised a flag (Ruling R25): "Nothing needs attention: every page was read, and no flags were raised."
  - "Checked by <name>, <date>: not an issue"
  - the summary sentence's "<n> problem needs attention, on <m> pages." ("problems need" for more than one, "page" for one).
- **Chrome's rule, as a card states it** (from Chromium's `ax_image_annotator.cc` and `ax_image_stopwords.cc`, checked 2026-10-06): Chrome splits an image's alt text at spaces, punctuation, and digits. It drops words of one or two letters, and common words such as "logo" and "image". If fewer than three letters are left, it treats the image as having no name.
- **Commits:** a plain subject line with no trailers of any kind, and no push until the release.
- **What subagents never do:**
  - start NVDA, Word, or any desktop program;
  - run voicecap, except through the test suite's scripted or replay drivers;
  - pass a composed command through `cmd /c` or any shell;
  - touch the owner's transcripts home.
  Headless Chromium through the test suite and through `pnpm readme:screenshots` is allowed.

## Review Focus

1. **A site with many problems** (40 cards): the summary's panel names at most 5 cards, then "and 35 more", and the section folds every card when there are more than 5. Task 3 tests the panel's cap, and Task 4 the folds.
2. **A page whose transcripts couldn't be read here** (flags as recorded): its flags still make cards, of the kind `recorded`, from their recorded items. The cards have no quoted line, and say NVDA's words aren't available here. Task 1 tests this.
3. **Records from before voicecap kept a flag's `found`,** with transcripts that can't be read: one `recorded` card for each rule, its subject the flag's message. Task 1 tests this.
4. **Text that needs escaping:** `<`, `&`, and `"` in NVDA's lines, in a link's words, or in a reviewer's note are shown as text on the page, never as markup, and as plain text in Word. Task 4 tests this.
5. **The spellings and orders NVDA uses:**
   - "Unlabelled" (British spelling);
   - a named graphic with no Chrome hint after it ("main landmark, Unlabeled graphic, i 2i logo");
   - Chrome's hint after an unnamed graphic.
   Each gives the right name, or none. Task 1 tests these.

---

### Task 1: The cards' model

**Files:**
- Modify: `src/flags/evaluate.ts`: add and export `flagItemLines`.
- Modify: `src/share/attention.ts`: add the cards' model beside today's `attentionClauses` and `attentionLine`. Task 4 removes those once nothing uses them.
- Modify: `src/share/model.ts`:
  - `ShareModel` gains `attention: AttentionCard[]`;
  - build the page cards before the summary, then the attention cards from the cards (Task 3 passes them into `summaryOf`);
  - keep `flagged` until Task 4.
- Test: `test/flags.test.ts` (`flagItemLines`), and `test/share-attention.test.ts` (new).

**Interfaces:**
- Consumes:
  - `PageCard` from `src/share/cards.ts`: `slug`, `name`, `path`, `status`, `failure`, `readStopped`, `flags`, `flagsAsRecorded`;
  - `PageReview` from `src/share/review.ts`;
  - `FlagRules`, `PagePasses`, `contentSteps`, and `flagQuotes` from `src/flags/evaluate.ts`;
  - `normalizeSpeech` from `src/passes/steps.ts`.
- Produces:
  ```ts
  // src/flags/evaluate.ts
  export interface ItemLine { rule: "unlabeled" | "generic-link-text"; pass: PassName; item: string; spoken: string }
  /** Every content step the unlabeled and generic-link-text rules match, in pass then step order: the item the rule's matcher returns (lowercased, as found), and the step's speech (normalizeSpeech). Passes are each rule's own (rules.unlabeled.passes, rules.genericLinkText.passes). */
  export function flagItemLines(passes: PagePasses, rules: FlagRules): ItemLine[];

  // src/share/attention.ts
  export type AttentionKind =
    | "graphic-generic" | "graphic-unnamed" | "button-unnamed" | "field-unlabeled" | "unnamed"
    | "link-unnamed" | "link-generic" | "first-heading" | "skip-link" | "tab-nothing"
    | "repeated" | "read-stopped" | "custom" | "recorded" | "unread" | "issue" | "changed";
  /** The kinds that come from flags: every kind but "unread", "issue", and "changed". */
  export const FLAG_KINDS: ReadonlySet<AttentionKind>;
  export interface AttentionPlace {
    /** The page part NVDA named at the line: "header", "main content", "navigation", "footer", "sidebar", "search"; null when it named none. */
    part: string | null;
    /** The link or button the item sits in, from its Tab stop: its other words as NVDA said them, and its role; null when none. */
    inside: { words: string; role: "link" | "button" } | null;
    /** One line for each pass that heard it here, the first page's, in pass order (read, headings, tab); empty when NVDA's words aren't available. */
    said: { pass: PassName; line: string }[];
    pages: string[]; // slugs, in page order
    times: number;   // matched lines here, across pages and passes
  }
  export interface AttentionCard {
    id: string;              // "need-1", "need-2", ... in card order
    kind: AttentionKind;
    /** What NVDA named: a graphic's name as NVDA said it ("i 2i Logo"), the item as NVDA said it ("Read more", "edit", "graphic"), a repeated phrase, a custom or recorded flag's subject; null for kinds that name nothing. */
    subject: string | null;
    level: number | null;    // first-heading: the level NVDA said, else null
    places: AttentionPlace[];
    /** Every page on the card, in page order. detail: an unread page's failure, or an issue's note ("" when none); else null. */
    pages: { slug: string; name: string; path: string; detail: string | null }[];
    times: number;
  }
  export interface AttentionPage { card: PageCard; review: PageReview | null; passes: PagePasses | null }
  export function attentionCards(pages: AttentionPage[], rules: FlagRules): AttentionCard[];
  export function speechItems(spoken: string): string[];      // normalizeSpeech, split at ", " and ". ", each trimmed of a final "." or ",", case kept, empties dropped
  export function graphicName(spoken: string): string | null; // see the rules below
  export function insideOf(spoken: string, name: string | null): AttentionPlace["inside"];
  ```

**The decisions the tests pin:**
- **Which pages give which cards.**
  - A page is *settled* when its review's latest entry exists, isn't `unreviewed`, and `changedSinceReview` is false. That's the summary's `decided`.
  - An *open issue* is a latest entry of `issue`.
  - Flag kinds come from pages that have flags and are neither settled nor open-issue pages.
  - An open issue gives an `issue` card for its page, with detail set to its note (`""` when it has none).
  - A latest entry with `changedSinceReview` true puts the page on the one `changed` card. Its flags still count too, since that review settles nothing.
  - A card of status `failed` or `never` with a `failure` goes on the one `unread` card, with its detail set to that failure.
  - A card with `readStopped` set, or with a `read-not-finished` flag, goes on the one `read-stopped` card, once. No review settles it: it stays until a later run reads the page to its end (Ruling R5).
- **The flag kinds, from `flagItemLines` when `passes` isn't null.** For `unlabeled`, with the item lowercased:
  - an item that contains "graphic" is `graphic-generic` with subject `graphicName(spoken)` when that isn't null. Otherwise it's `graphic-unnamed`, with the item, as NVDA said it, as its subject;
  - "button", or an item that contains "button", is `button-unnamed`;
  - "edit", "combo box", "check box", or "radio button" is `field-unlabeled`, with the item, as NVDA said it, as its subject;
  - any other item is `unnamed`, with the item, as NVDA said it, as its subject.

  For `generic-link-text`:
  - "(no name)" is `link-unnamed`;
  - any other item is `link-generic`, with the item, as NVDA said it, as its subject.

  The rules match items lowercased, so a subject takes its capitals from the line: the first of `speechItems(spoken)` that is the item, compared lowercased (the final review's M5). Links that say "Read more" give `Links read as "Read more": …`; grouping still compares subjects lowercased.
- **The other rules' flags:**
  - `headings` is `first-heading`, with the level from the message (`/level (\d+)/`, or null);
  - `tab-before-main` is `skip-link`;
  - `tab-no-stops` is `tab-nothing`;
  - `repeated-phrase` is `repeated`, with subject `flagQuotes(...)[0]`;
  - `read-not-finished` is `read-stopped`;
  - any other rule is `custom`, with its subject set to the custom rule's own `description` from `rules.custom` (Ruling R9). Only when the rule isn't in the config is it the flag's message without its final ".".

  These cards take their place's `said` from `flagQuotes`: the first line, with the flag's pass.
- **When `passes` is null** (flags as recorded): every flag is `recorded`. Its subject is each `found` item's text, or the flag's message (without its final ".") when there's no `found`. Its place has `said: []`.
- **Grouping.** One card per kind and subject, with the subject compared lowercased and with its spaces collapsed. "i 2i Logo" and "i 2i logo" make one card, whose subject is the first as NVDA said it.
- **Places within a card.** Places are keyed by `part`.
  - `part` comes from the line's first item that ends in " landmark":
    - "banner landmark" is "header";
    - "main landmark" is "main content";
    - "navigation landmark" is "navigation";
    - "content info landmark" is "footer";
    - "complementary landmark" is "sidebar";
    - "search landmark" is "search";
    - anything else is null.
  - `inside` is the first non-null `insideOf` over the place's Tab-pass lines.
- **`graphicName(spoken)`**, over `speechItems(spoken)`, compared lowercased. `HINT` is "to get missing image descriptions", Chrome's English wording.
  - If an item starts with `HINT`, the item before it is the name. There's no name instead when that item is the graphic item (the item the rule matched), or an item that's never a name: a landmark, a state (`rules.unlabeled.stateItems`), a link role (`rules.genericLinkText.linkRoles`), "button", "same page", "current page", or "visited". (This last case was accepted in Task 1's fix round.)
  - Otherwise, the item right after the graphic item is the name, unless it starts with `HINT` or is an item that's never a name.
  - Otherwise there's no name.
- **`insideOf(spoken, name)`:** the items left after removing:
  - landmark items;
  - state items;
  - the items "same page", "current page", and "visited";
  - the graphic item, the name, and the items that start with `HINT`, plus "open the context menu".

  Then the role is "link" if a link role was among the items, else "button" if "button" was. With no role, or no words left, it returns null. Otherwise, the words left, joined by ", " as NVDA said them, with that role.
- **Times:**
  - item kinds: one for each matched line;
  - other flags: the flag's `count`, or 1 when it has none, added for each page and pass; but `skip-link` counts 1 for each page and pass, since its flag's count is the Tab stops before the main content, not times found (the final review's M2);
  - `unread`, `issue`, and `changed` cards: one for each page.
- **Order:**
  - by the number of pages, most first;
  - then by the kind's place in `AttentionKind`'s order above;
  - then by the first page's index.

  Ids are `need-1` onward, in that order.

- [ ] **Step 1: Write the failing tests.** In `test/flags.test.ts`:
  - `flagItemLines` on i2i's home page passes (lines below) returns `{ rule: "unlabeled", pass: "read", item: "unlabeled graphic", spoken: <header read line> }`, then the main-content line's, then the Tab line's;
  - `flagItemLines` returns a "(no name)" item for "link".

  In `test/share-attention.test.ts`, with pages built from these exact lines, from the transcripts of 6 October 2026. A local `pageOf(slug, read, tab, review?)` helper makes a `PageCard` whose flags are `evaluateFlags` with `DEFAULT_CONFIG.flags`:
  ```ts
  const HOME_READ_HEADER = "banner landmark, same page, link, current page, Unlabeled graphic, i 2i Logo. To get missing image descriptions, open the context menu.";
  const HOME_READ_MAIN = "main landmark, Unlabeled graphic, i 2i logo";
  const HOME_TAB = "banner landmark, i 2i Logo. To get missing image descriptions, open the context menu., Unlabeled graphic, INSTITUTE 2 INNOVATE, same page, link, current page";
  const BIO_READ = "banner landmark, link, Unlabeled graphic, i 2i Logo. To get missing image descriptions, open the context menu.";
  const BIO_TAB = "banner landmark, i 2i Logo. To get missing image descriptions, open the context menu., Unlabeled graphic, INSTITUTE 2 INNOVATE, link";
  ```
  - **"i2i's logo is one card on 32 pages, 65 times":** the home page plus 31 biography pages give exactly one card:
    - `{ id: "need-1", kind: "graphic-generic", subject: "i 2i Logo", times: 65 }`, with 32 pages;
    - place 1 is `{ part: "header", inside: { words: "INSTITUTE 2 INNOVATE", role: "link" }, times: 64 }`, with 32 pages and `said` of `[{ pass: "read", line: HOME_READ_HEADER }, { pass: "tab", line: HOME_TAB }]`;
    - place 2 is `{ part: "main content", inside: null, pages: ["home"], times: 1, said: [{ pass: "read", line: HOME_READ_MAIN }] }`.
  - **"graphicName reads each order":** each of these maps to the name given:
    - `HOME_READ_HEADER` gives "i 2i Logo";
    - `HOME_TAB` gives "i 2i Logo";
    - `HOME_READ_MAIN` gives "i 2i logo";
    - "Unlabelled graphic, Photo" gives "Photo";
    - "unlabeled graphic. To get missing image descriptions, open the context menu." gives null;
    - "unlabeled graphic" gives null;
    - "graphic" gives null.
  - **"insideOf finds the link's own words":**
    - `HOME_TAB` and `BIO_TAB` give `{ words: "INSTITUTE 2 INNOVATE", role: "link" }`;
    - "Unlabeled graphic, i 2i Logo, link" gives null.
  - **"a graphic with no name is missing alt text":** a read line of "graphic" gives `graphic-unnamed` with subject "graphic".
  - **"a review settles a page's flags":**
    - a page reviewed with no issues and `changedSinceReview: false` gives no card;
    - an `issue` with the note "Logo has no name" gives one `issue` card with that detail, and no flag card;
    - `fixed` gives no card;
    - `changedSinceReview: true` puts the page on the `changed` card and on its flag card.
  - **"pages not read, and reads that stopped":**
    - status `failed` with the failure "another window took the screen" gives an `unread` card with that detail;
    - `readStopped: "step-limit"` plus a `read-not-finished` flag puts the page on the `read-stopped` card once.
  - **"each rule's kind":**
    - "link, Read more" on two pages gives one `link-generic` card, subject "Read more", as NVDA said it;
    - a lone "link" gives `link-unnamed`;
    - "button" gives `button-unnamed`;
    - a Tab line "edit" gives `field-unlabeled`, subject "edit";
    - the headings message "The first heading is level 2, not level 1." gives `first-heading`, level 2;
    - `tab-before-main` gives `skip-link`;
    - `tab-no-stops` gives `tab-nothing`;
    - `repeated-phrase` gives `repeated`, with the phrase as its subject;
    - a custom rule gives `custom`, with its description as its subject (R9).
  - **"cards come most pages first":** ties go in `AttentionKind` order, and ids are `need-1` onward.
  - **"flags as recorded make recorded cards"** (Review Focus 2 and 3):
    - `passes: null` with `found: [{ text: "unlabeled graphic", count: 2 }]` gives a `recorded` card with subject "unlabeled graphic" and `said: []`;
    - with no `found`, the subject is the flag's message without its final ".".
- [ ] **Step 2:** Run `pnpm vitest run test/flags.test.ts test/share-attention.test.ts`. Expected: FAIL, since `flagItemLines` and `attentionCards` don't exist yet.
- [ ] **Step 3: Implement.**
  - **`flagItemLines`** reuses `genericLinkMatcher` and `unlabeledMatcher` over `contentSteps`, so a card's lines are the same steps the rules count.
  - **`attentionCards`** follows the decisions above.
  - **In `buildShareModel`:**
    - build `pages` (`cardsOf`) before `summaryOf`;
    - build each page's `PagePasses` the way `flaggedOf` does: move `shownPasses` into a function both can use, and use null for a card with `flagsAsRecorded`;
    - set `attention: attentionCards(...)` with `input.flagRules`.
- [ ] **Step 4:** Run the two files: PASS. Then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Group what needs attention into a card for each problem, from NVDA's own words`.

### Task 2: The cards' words

**Files:**
- Create: `src/share/attention-words.ts`: `attentionWords` and its tables (Ruling R12).
- Modify: `src/share/text.ts`: add `ATTENTION_TEXT`'s fixed strings and its small formatters.
- Test: `test/share-attention-words.test.ts` (new).

**Interfaces:**
- Consumes: `AttentionCard` and `AttentionPlace` from Task 1.
- Produces:
  ```ts
  export interface AttentionWords {
    title: string;
    count: string;                                            // "32 pages, 65 times"; "1 page, 1 time"
    places: { lead: string; quotes: { pass: string; line: string }[]; unavailable: string | null }[];
    cause: string;
    why: string;
    fixes: { lead: string; code: string; after: string | null }[];  // [] for kinds with no fix in the code
    path: string[];
  }
  export function attentionWords(card: AttentionCard): AttentionWords;
  export const ATTENTION_TEXT: {
    title: "What needs attention";
    gist: (problems: number, pages: number) => string;
    none: "Nothing needs attention: every page was read, and every flag was fixed or checked by a person.";
    labels: { cause: "Likely cause"; why: "Why it matters"; fix: "The fix in the code"; after: "What NVDA should say then"; path: "The path forward"; page: "The page"; pages: "The pages" };  // "The page" on a card with one page (the final review)
    more: (count: number) => string;        // the summary panel's last line (Task 3)
    sentence: (problems: number, pages: number) => string;  // the summary sentence's part (Task 3)
  };
  ```

**The words.** Let `n` be the number of pages on the card, `k` a place's pages, and `pl(k, word)` "1 word" or "k words". Then:
- **Small pieces:**
  - `gist`: `${pl(problems, "problem")}, on ${pl(pages, "page")}. Fix each one and run voicecap again, or check it and record that in voicecap review, until nothing is left.`
  - `more(c)`: `and ${c} more, under What needs attention`
  - `sentence(p, m)`: `${p} ${p === 1 ? "problem needs" : "problems need"} attention, on ${pl(m, "page")}.`
  - `count`: `${pl(n, "page")}, ${pl(times, "time")}`
- **A place's lead:** "In the header", "In the main content", "In the navigation", "In the footer", "In a sidebar", or "In the search", followed by `, on ${pl(k, "page")}`. With no part, it's `On ${pl(k, "page")}`. A `read-stopped` card's lead is `The last line read, on ${pl(k, "page")}`, whatever the part. A place with no line to quote is left out, except on a `recorded` card, which says why it has none (the final review's M7).
- **Quote labels:** a quote's `pass` reads "Down Arrow" for read, "H" for headings, and "Tab" for tab.
- **`unavailable`** is null, except for `recorded` cards: "NVDA's words aren't available here: this page's transcripts couldn't be read." On a place with more than one page: "NVDA's words aren't available here: these pages' transcripts couldn't be read."
- **`<subject>`** below is the card's subject, `<role>` is a `field-unlabeled` subject, and `<name>` is a `graphic-generic` subject.

| Kind | Title | Likely cause | Why it matters |
|---|---|---|---|
| graphic-generic | `The graphic "<name>" is read as "Unlabeled graphic": its alt text is too generic for Chrome` | `Its alt text is there, and NVDA reads it: "<name>". But Chrome counts it as missing. Chrome splits an image's alt text at spaces, punctuation, and digits, then drops words of one or two letters and common words such as "logo" and "image"; with fewer than three letters left, it calls the image "Unlabeled graphic" and offers to describe it. NVDA says what Chrome reports.` | `A screen reader user on Chrome hears "Unlabeled graphic" and an offer to describe the image, every time it's read.` |
| graphic-unnamed | `A graphic is read only as "<subject>": likely missing alt text` | `Likely missing alt text: the image has no text alternative, so NVDA can only say that it's a graphic.` | `A screen reader user hears that there's an image, but not what it shows.` |
| button-unnamed | `A button is read only as "button": likely an icon button with no name` | `Likely an icon button with no name: there are no words in it for NVDA to read.` | `A screen reader user hears that there's a button, but not what it does.` |
| field-unlabeled | `A form field is read only as "<role>": likely a missing label` | `Likely a missing <label>: NVDA can't tell what the field is for.` | `A screen reader user hears what kind of field it is, but not what to put in it.` |
| unnamed | `Something is read as "<subject>": likely a control with no name` | `Likely a control with no name: NVDA has no words to read for it.` | `A screen reader user hears that it's there, but not what it is.` |
| link-unnamed | `A link is read only as "link": likely an image link with no alt text, or an icon link with no text` | `Likely an image link with no alt text, or an icon link with no text: there are no words in it for NVDA to read.` | `A screen reader user hears that there's a link, but not where it goes.` |
| link-generic | `Links read as "<subject>": link text that doesn't say where it goes` | `Link text that doesn't say where it goes: "<subject>" means little when a screen reader user lists the page's links, or tabs from link to link.` | `Screen reader users often move from link to link, and "<subject>" alone doesn't tell them where each one goes.` |
| first-heading | `The first heading is level <level>, not 1: likely a missing <h1>` (no level: `The first heading isn't level 1: likely a missing <h1>`) | `Likely a missing <h1>: the page's main title isn't marked as its level 1 heading.` | `Screen reader users jump to the first heading, or list the headings, to find what the page is about.` |
| skip-link | `Many Tab stops before the main content, and no skip link` | `Likely a missing skip link: the first Tab stop isn't a link to the main content.` | `Keyboard and screen reader users go through every stop before the main content, on every page.` |
| tab-nothing | `Tab reached nothing on the page: likely controls made of <div> or <span>` | `Likely links and buttons made of <div> or <span>, which a keyboard can't reach.` | `A keyboard user can't reach the page's links or buttons.` |
| repeated | `"<subject>" is said many times in a row: likely a focus trap, or repeated content` | `Likely a focus trap, or the same content repeated: NVDA said the same words again and again.` | `A screen reader user hears the same words over and over, and may not get past them.` |
| read-stopped | `The reading stopped before the page's end` | `voicecap stopped reading at its step limit, or because the same words kept coming back.` | `What comes after the stop wasn't heard, so it isn't in the transcripts.` |
| custom | `<subject>` | `A rule in this site's voicecap config raised it.` | `The rule's own words say what it found.` |
| recorded | `What the run recorded: <subject>` | `This page's transcripts couldn't be read here, so this card shows what its run recorded, without NVDA's words.` | `voicecap can't tell from the record alone what NVDA said, so it can't suggest a fix.` |
| unread | `A page the latest run couldn't read` (n > 1: `Pages the latest run couldn't read`) | `The latest run couldn't read it: the reason is beside the page.` (n > 1: `…couldn't read them: each page's reason is beside it.`) | `A page that wasn't read has no transcripts from this run, so nothing on it was heard.` |
| issue | `An issue found in review: <page name>` | the note, or `No note was recorded.` when it's "" | `A person reviewing the transcripts found something a screen reader user would hear.` |
| changed | `A page reads differently since its review` (n > 1: `Pages read differently since their review`) | `Its transcripts changed after it was reviewed.` (n > 1: `Their transcripts changed after they were reviewed.`) | `The review was of other transcripts, so it doesn't cover what NVDA says there now.` |

**A page with no headings** (Ruling R13): the headings flag "The page has no headings." gives a `first-heading` card with level 0, a card of its own.
- title: `NVDA found no headings: likely titles made of styled text, not heading tags`
- cause: `Likely titles made of styled text, not heading tags: NVDA found no headings on the page.` (n > 1: `…on these pages.`)
- why: `Screen reader users jump from heading to heading to find their way around a page; with none, they have to go through all of it.`
- fix: `Mark the page's title and its section titles as headings:` with `<h1>Grant opportunities</h1>
<h2>How to apply</h2>`, then `"heading, level 1, Grant opportunities"`.

**A silence repeated** (a `repeated` card with no subject, the final review's M4): title `Silence, many times in a row: likely a focus trap, or content NVDA can't read`; cause `Likely a focus trap, or content NVDA has no words for: NVDA said nothing, again and again.`; why `A screen reader user hears nothing, again and again, and may not get past it.`; no fix in the code, since nothing was said to hide.

**A `recorded` card on more than one page:** its cause is `These pages' transcripts couldn't be read here, so this card shows what their runs recorded, without NVDA's words.`

**The fixes** (`{ lead, code, after }`). Every other kind has none.
- **graphic-generic,** one for each place, in place order:
  - **With `inside`:**
    - lead: `<Part>, it's inside the <role> that also says "<words>", so mark it decorative:`, where `<Part>` is the place's lead without its ", on …";
    - code: `<img src="…" alt="">`;
    - after: `"<words>, <role>"`.
  - **Without `inside`:**
    - lead: `<Part>, it stands on its own, so give it a name in words, not "logo" or a file name` + (`, such as the words its <role> says elsewhere` when another place has `inside`) + `:`;
    - code: `<img src="…" alt="<suggestion>">`;
    - after: `"graphic, <suggestion>"`.

    `<suggestion>` is the other place's words, made title-like when NVDA said two or more words, all in capitals ("INSTITUTE 2 INNOVATE" becomes "Institute 2 Innovate"). A single all-caps word stays as it is ("ICJIA"). With no other place, it's `What it is, in words`.
- **graphic-unnamed:**
  - `Say what it shows:` with `<img src="…" alt="What it shows, in words">`, then `"graphic, what it shows"`;
  - `Or, when it's decorative, or inside a link or button that already says what it is, mark it decorative:` with `<img src="…" alt="">`, then `Nothing, for the image itself`.
- **button-unnamed:** `Give it words, visible or in aria-label:` with `<button type="button" aria-label="Close menu">…</button>`, then `"Close menu, button"`.
- **field-unlabeled:** `Label it:` with `<label for="email">Email</label>\n<input id="email" type="email">`, then `"Email, <role>"`.
- **unnamed:** `Give it a name, visible or in aria-label:` with `<div role="…" aria-label="What it is">…</div>`, and no after (null).
- **link-unnamed:** `Say where it goes, in the image's alt text or the link's aria-label:` with `<a href="/contact"><img src="…" alt="Contact us"></a>`, then `"Contact us, link", at its Tab stop`.
- **link-generic:**
  - `Say where it goes:` with `<a href="/grants">Read more about the 2026 grants</a>`, then `"Read more about the 2026 grants, link"`;
  - `Or keep the short words, and add the rest for screen readers:` with `<a href="/grants">Read more<span class="visually-hidden"> about the 2026 grants</span></a>`, then the same after.
- **first-heading:** `Make the page's main title its <h1>:` with `<h1>Grant opportunities</h1>`, then `"heading, level 1, Grant opportunities"`.
- **skip-link:** `Make a skip link the first stop:` with `<a href="#main">Skip to main content</a>\n…\n<main id="main">`, then `"Skip to main content, link", at the first Tab`.
- **tab-nothing:** `Use real links and buttons:` with `<a href="/apply">Apply</a>\n<button type="button">Open the menu</button>`, then `Each control's name and role, at each Tab`.
- **repeated:** `Check that Tab and Down Arrow move past it. If the words are repeated on purpose, hide the extra copies from screen readers:` with `<div aria-hidden="true">…</div>`, then `"<subject>", once`.

**The path.** `<first path>` is the card's first page's `path`.
- **The flag kinds, except `recorded` and `read-stopped`:**
  1. Either `Fix it in the <part>, which these pages share: one change fixes it on all <k> pages.` (the final review's M6: the records show only that these pages share it), naming the shared place (header, footer, or navigation, on more than one page) with the most pages, ties by place order; or `Fix it on the page.` (n = 1), or `Fix it on each page.`
  2. `Run voicecap again on one page (--page <first path>), then on every page.`
  3. `Share again: once no page raises it, this card is gone.`
  4. `Not a problem? Mark the page "Reviewed, no issues" in voicecap review.` (n > 1: `the pages`)
- **`recorded`:** `Run voicecap again on the page (--page <first path>).` (n > 1: `Run voicecap again on these pages, starting with --page <first path>.`, the final review's M3)
- **`read-stopped`:** `Run the page again with --page.` (n > 1: `Run each page again with --page.`, the final review's M3) and `If it's just a very long page, raise its step limit.`
- **`unread`:** `Run the page again with --page, with hands off the keyboard and mouse.` (n > 1: `each page`)
- **`issue`:** `Fix it on the site.` and `Run voicecap again on the page, then mark it "Fixed" in voicecap review.`
- **`changed`:** `Review it again in voicecap review.` (n > 1: `them`)

- [ ] **Step 1: Write the failing tests.**
  - **"i2i's card, word for word":** from Task 1's i2i card:
    - **The title:** `The graphic "i 2i Logo" is read as "Unlabeled graphic": its alt text is too generic for Chrome`.
    - **The count:** `32 pages, 65 times`.
    - **The places:**
      - place 1's lead is `In the header, on 32 pages`, with the quotes `[{ pass: "Down Arrow", line: HOME_READ_HEADER }, { pass: "Tab", line: HOME_TAB }]`;
      - place 2's lead is `In the main content, on 1 page`.
    - **The fixes:**
      - `{ lead: 'In the header, it\'s inside the link that also says "INSTITUTE 2 INNOVATE", so mark it decorative:', code: '<img src="…" alt="">', after: '"INSTITUTE 2 INNOVATE, link"' }`;
      - `{ lead: 'In the main content, it stands on its own, so give it a name in words, not "logo" or a file name, such as the words its <role> says elsewhere:', code: '<img src="…" alt="Institute 2 Innovate">', after: '"graphic, Institute 2 Innovate"' }`.
    - **The path's first step:** `Fix it in the header, which these pages share: one change fixes it on all 32 pages.`
    - **The path's second step:** `Run voicecap again on one page (--page /), then on every page.`
  - **"every kind has a title, a likely cause, and a reason":** one table-driven test over all 17 kinds. Each title, cause, and reason is non-empty and equal to the table's words for a fixed sample card.
  - **The summary's words:**
    - `sentence(1, 32)` is `1 problem needs attention, on 32 pages.`;
    - `sentence(2, 1)` is `2 problems need attention, on 1 page.`;
    - `more(35)` is `and 35 more, under What needs attention`;
    - `gist(1, 32)` starts with `1 problem, on 32 pages.`
  - **No banned words:** no `ATTENTION_TEXT` string and no `attentionWords` output for the sample cards contains "automated", "listened", or "Guidepup".
- [ ] **Step 2:** Run `pnpm vitest run test/share-attention-words.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `attentionWords` in `src/share/attention-words.ts` (Ruling R12) and `ATTENTION_TEXT` in `src/share/text.ts`, with the words above.
- [ ] **Step 4:** PASS. Then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Word each card: what NVDA says, the likely cause, the fix, and the path forward`.

### Task 3: The summary: five numbers, its panel, its sentence, and "Checked by"

**Files:**
- Modify: `src/share/summary.ts`:
  - `Summary.numbers` loses `listened`;
  - `Summary.bars.review` loses `listened`;
  - `Summary.attention` becomes `{ problems: number; pages: number; cards: { id: string; title: string }[] }`, with `problems` and `pages` over all cards;
  - `SummaryInput` gains `attention: AttentionCard[]`;
  - `sentenceOf` takes the flag cards' count. In place of "<n> pages have flags worth a closer listen." it says `ATTENTION_TEXT.sentence(f, m)`, where `f` counts the cards whose kind is in `FLAG_KINDS`, and `m` the distinct pages on those cards. "Every page with flags was reviewed…" now depends on `f === 0`.
- Modify: `src/share/words.ts`: `numbersOf` returns five tiles, without "heard live by a person".
- Modify: `src/share/text.ts`:
  - remove `SUMMARY_TEXT.reviewRows.heard`;
  - `SUMMARY_TEXT.noAttention` becomes `ATTENTION_TEXT.none`.
- Modify: `src/share/html/top.ts`:
  - `attentionPanel`: the line `${pl(problems, "problem")}, on ${pl(pages, "page")}:`, then up to 5 cards, each linked to `#<id>` with its title as the words, then `ATTENTION_TEXT.more(rest)` linked to `#need-h` when there are more than 5;
  - with no cards, `ATTENTION_TEXT.none` (later the line for none, `noAttentionLine`: with pages skipped, R16, and with no flag raised, R25);
  - `reviewMeter` drops its heard row.
- Modify: `src/share/word/top.ts`: `attentionBlocks` (the same lines, without links), `reviewBlocks` (no heard row), and the numbers table's heading, which said "six numbers", now says five.
- Modify: `src/share/cards.ts`: `reviewChips` takes the page's flags. For a latest entry of `reviewed` on a page with flags, and no change since that review, the chip is `Checked by ${latest.reviewer}, ${longDate(latest.at)}: not an issue` in place of "Reviewed, no issues".
- Modify: `src/share/model.ts`: pass `attention` into `summaryOf`.
- Test: `test/share-summary.test.ts`, `test/share-words.test.ts`, `test/share-html-top.test.ts`, `test/share-word-top.test.ts`, `test/share-model.test.ts`.

**Interfaces:**
- Consumes: Task 1's `AttentionCard` and `FLAG_KINDS`; Task 2's `ATTENTION_TEXT` (`src/share/text.ts`) and `attentionWords` (`src/share/attention-words.ts`, for the titles).
- Produces: `Summary.attention: { problems: number; pages: number; cards: { id: string; title: string }[] }`, and five tiles from `numbersOf`.

- [ ] **Step 1: Write the failing tests.**
  - **"five numbers":**
    - `numbersOf(model).map((t) => t.label)` doesn't contain "heard live by a person";
    - its length is 5;
    - `summary.numbers` has no `listened`, and `summary.bars.review` has no `listened`.
  - **"the sentence counts problems":** with the i2i-like model (32 pages, one undecided flag card, no reviews, run by Christopher Schweda), `summary.sentence` is `NVDA read all 32 pages, run by Christopher Schweda. 1 problem needs attention, on 32 pages.`
  - **"once every flagged page is reviewed":** the sentence ends `Every page with flags was reviewed, and no issues were found.`, and the attention list is empty.
  - **"the panel names five cards, then counts the rest"** (Review Focus 1):
    - 7 cards give 5 links, `#need-1` through `#need-5`;
    - then `and 2 more, under What needs attention`, linked to `#need-h`;
    - with no cards, the panel says the none line.
  - **"Checked by":** a page with flags whose latest review is `reviewed` by Christopher Schweda at `2026-10-06T14:00:00-05:00`, with no change since, has the chip `Checked by Christopher Schweda, 6 October 2026: not an issue`. A page with no flags keeps `Reviewed, no issues`.
  - **"Word's summary":** five rows in the numbers table, no "Heard live" row, and the attention lines.
- [ ] **Step 2:** Run `pnpm vitest run test/share-summary.test.ts test/share-words.test.ts test/share-html-top.test.ts test/share-word-top.test.ts test/share-model.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** PASS. Then run `pnpm lint && pnpm typecheck && pnpm test`, and update the tests that pinned six numbers or the heard row.
- [ ] **Step 5:** Commit: `Five numbers, a count of problems in the summary, and checked flags on a page's card`.

### Task 4: The section, on the page and in the Word copy

**Files:**
- Create: `src/share/html/attention.ts`: `renderAttention(model: ShareModel): string`.
- Create: `src/share/word/attention.ts`: `wordAttention(model: ShareModel): Block[]`.
- Modify:
  - `src/share/html/document.ts`: in `SECTIONS`, `renderAttention` goes right after `renderSummary`, and `renderFlags` comes out;
  - `src/share/word/outline.ts`: the same, with `wordAttention` and `wordFlags`;
  - `src/share/html/top.ts`: `CONTENTS` starts with `["need-h", ATTENTION_TEXT.title]` and drops `find-h`.
- Remove what nothing uses any more:
  - `renderFlags`, `flagSummary`, `flagBody`, and `MOST_QUOTES_OPEN` (`html/pages.ts`);
  - `wordFlags` (`word/pages.ts`);
  - `FLAGS_TEXT` (`text.ts`);
  - `ShareModel.flagged`, `flaggedOf`, `FlagQuote`, and `FlaggedPage` (`cards.ts`, `model.ts`);
  - `attentionClauses` and `attentionLine` (`attention.ts`), with their tests, where nothing else uses them.
- Modify: `src/share/html/style.ts`: the cards' styles. Quotes and code wrap (`white-space: pre-wrap; overflow-wrap: anywhere`), so a long line never widens the page.
- Test:
  - `test/share-html-attention.test.ts` and `test/share-word-attention.test.ts` (new);
  - `test/share-document.test.ts`, `test/share-word-outline.test.ts`, and `test/share-browser.test.ts`;
  - `test/share-html-pages.test.ts` and `test/share-word-pages.test.ts`: drop the flags section's tests.

**Interfaces:**
- Consumes: `model.attention` (Task 1), `attentionWords` (`src/share/attention-words.ts`) and `ATTENTION_TEXT` (`src/share/text.ts`) (Task 2), and `fold`, `chip`, `scroll`, and `esc` from `html/parts.ts`.
- **The page:**
  - The section is `<section aria-labelledby="need-h">`, with `<h2 id="need-h">What needs attention</h2>` and a `<p class="gist">` (the gist, or the none line).
  - Each card is a `fold`, open when there are 5 cards or fewer, with `id` set to the card's id on the `<details>`. Its summary line is `<span class="what">${i}. ${title}</span> <span class="sub">${count}</span>`, never a heading.
  - **Its body, in this order:**
    - each place: its lead, and each quote as `<code>“…”</code>` after its pass label;
    - the place's `unavailable` words, when not null;
    - `<p><b>Likely cause:</b> …</p>` and `<p><b>Why it matters:</b> …</p>`;
    - "The fix in the code": each fix's lead, `<pre><code>` with its code, and `<p><b>What NVDA should say then:</b> …</p>` when `after` isn't null;
    - "The path forward" as an `<ol>`;
    - "The pages": each a link to `#pg-<idFragment(slug)>`, with its detail after a colon when there is one. It folds behind `The <n> pages` when there are more than 3.
- **Word:**
  - `heading(1, "What needs attention")`, then the gist or the none line;
  - each card: `heading(2, "<i>. <title>")` and a para of its count;
  - each place's lead as a para, and its quotes as `mono` lines (`Tab: “…”`);
  - labelled paras for the cause and the reason;
  - each fix's lead as a para, its code as `mono` (split at "\n"), and its after as a labelled para;
  - the path as a `list`, and the pages as a `list`.

- [ ] **Step 1: Write the failing tests.**
  - **"the section follows the summary":** in `renderSharePage`, the `id="need-h"` heading comes after the summary's, and before "How voicecap works". There's no "What the flags found".
  - **"i2i's card on the page":**
    - the card's `<details id="need-1" open>` holds the title, `32 pages, 65 times`, the two quotes, `Likely cause:`, `<code>&lt;img src="…" alt=""&gt;</code>`, `"INSTITUTE 2 INNOVATE, link"`, and the path's 4 steps;
    - its pages fold behind `The 32 pages`.
  - **"text is escaped"** (Review Focus 4): a line `link, <b> & "x"` and an issue note `<script>` appear as `&lt;b&gt; &amp; &quot;x&quot;` and `&lt;script&gt;`, never as markup. In Word, the same text is plain.
  - **"Word's cards":**
    - `wordOutline(model)` has `heading 1 "What needs attention"` after the summary's headings;
    - a `heading 2` beginning with `1. The graphic "i 2i Logo"`;
    - `mono` blocks holding `<img src="…" alt="">`;
    - no "What the flags found".
  - **In headless Chromium** (`test/share-browser.test.ts`):
    - 5 cards are all open, and 6 are all folded;
    - a card on 3 pages shows them, and one on 4 folds them;
    - the summary's link to `#need-6` opens that fold;
    - axe reports zero violations with every fold closed and with every fold open.
- [ ] **Step 2:** Run the new and changed test files. Expected: FAIL.
- [ ] **Step 3: Implement,** and remove the dead code listed above.
- [ ] **Step 4:** PASS. Then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Show what needs attention as cards, on the page and in its Word copy, in place of what the flags found`.

### Task 5: The README's words, and the CHANGELOG

**Files:**
- Modify: `README.md`. This task changes words only; Task 6 owns the screenshots, their captions, and the report examples.
  - **Line 1311:** "five numbers (pages in scope, pages transcribed, pages with flags, lines NVDA spoke, and NVDA time)".
  - **Line 1314:** "What the flags found" becomes **What needs attention**: a card for each problem, with what NVDA says and where, the likely cause, why it matters, the fix in the code, what NVDA should say then, and the path forward.
  - **Where `voicecap review` is described:** "Reviewed, no issues" settles a page's flags, and its card shows "Checked by <name>, <date>: not an issue". A read that stopped before the page's end stays on the list until a later run reads the page to its end.
- Modify: `CHANGELOG.md`: an `## [Unreleased]` section, under Added and Changed. It covers:
  - the cards and the advice for each kind;
  - a review settling flags (but never a stopped read);
  - five numbers, and no heard-live count or row;
  - the summary sentence's count of problems;
  - "What the flags found" folded into the cards.

- [ ] **Step 1:** Make the README and CHANGELOG changes above.
- [ ] **Step 2:** Run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 3:** Commit: `Describe what needs attention in the README, and note it in the CHANGELOG`.

### Task 6: The README's screenshots, from the i2i v3 run

The owner asked on 2026-10-06 for the README's screenshots to show what the web pages have now, from a 0.11 run, and for i2i v3 to be the main demo site (Ruling R7).

**Files:**
- **The fixture**, which the controller commits before this task: the i2i v3 run of 6 October 2026 (voicecap 0.11.0, 32 pages, every page's screenshot, and its event log), copied from the transcripts home without `report.html`:
  - `fixture/i2i-v3-run/v3--i2i.netlify.app/latest.txt`;
  - `fixture/i2i-v3-run/v3--i2i.netlify.app/2026-10-06/1134/run.json`, its `events.jsonl`, and its `pages/**`.

  Its records name the reviewer and no account or local path.
- Modify: `scripts/readme-screenshots.ts`:
  - **The source:** the fixture's site folder, copied into a temporary transcripts home and shared there with the built voicecap, as today with the demo's runs. The website is built from that share.
  - **The shots:** drawn as today (a 1200 × 900 window at twice its size). As today, any shot whose text shows an IP address or `localhost` is refused.
    - `report-top.png`: the masthead and the summary, down to the end of its panels;
    - `report-heard.png`: "Heard on …";
    - `report-attention.png`: "What needs attention", with each fold open (the logo card);
    - `report-pages.png` (new): the first page cards under "Every page", with their screenshots;
    - `report-timeline.png` (new): the run's evidence, with its minute-by-minute timeline open;
    - `report-fingerprints.png`: the fingerprint check, after it has run;
    - `website-dark.png` and `website-light.png`: the website's bar, through v3--i2i.netlify.app's entry under "The sites".
  - **Its comment:** the screenshots are of the i2i v3 report: the new version of i2i.illinois.gov, not yet live, read on 6 October 2026.
- Modify: `test/readme-screenshots.test.ts`: the eight files (no `report-flags.png`), and the fixture.
- Run `pnpm readme:screenshots`, delete `assets/screenshots/report-flags.png`, and commit the eight PNGs.
- Modify: `README.md`. The built-in `voicecap demo` tour's own docs stay on its own site.
  - **Line 31:** the top of the report for v3--i2i.netlify.app, the new version of i2i.illinois.gov, read on 6 October 2026. Its sentence and five numbers are as the shot shows them, taken from the generated page, never typed from memory.
  - **Lines 144–150 and 875–877:** the first lines NVDA said on i2i v3's home page in each pass, from the fixture's transcripts, and the "Heard on" caption.
  - **Lines 1289–1291:** `report-attention.png`, with alt text that names the logo card's parts.
  - **The two new shots:** each goes where the README describes "Every page" and "The evidence behind these results", with alt text.
  - **The website shots:** their captions and alt text.
- Modify: `CHANGELOG.md`, under `[Unreleased]`: "The README's screenshots and report examples now come from the i2i v3 run of 6 October 2026, and two show what 0.11.0 added: a page card with its screenshot, and a run's minute-by-minute timeline."

- [ ] **Step 1:** Test first. `test/readme-screenshots.test.ts` expects the eight files and the fixture. Run it: FAIL.
- [ ] **Step 2:** Change the script, and run the test: PASS.
- [ ] **Step 3:** Run `pnpm readme:screenshots`, and look at each PNG; the Read tool shows images. Check for:
  - the summary's five numbers;
  - the logo card's parts;
  - a page card with its screenshot;
  - the timeline;
  - the website listing v3--i2i.netlify.app.
- [ ] **Step 4:** Make the README and CHANGELOG changes above, then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Make the README's screenshots from the i2i v3 run, with the cards, a page card, and a run's timeline`.

### Task 7: The summary's "What needs attention" panel, full width

The owner asked on 2026-10-06: "the what needs attention columns needs to be full width. This is the critical column, and it's too hard to read when there's three other columns beside it" (Ruling R23).

**Files:**
- Modify: `src/share/html/style.ts`. The attention panel spans the panels grid's whole row (`grid-column: 1 / -1`), first, and the other three panels share the rows after it. Where the panels stack (narrow widths), nothing changes.
- Modify: `src/share/html/top.ts`. The attention panel carries the class that makes it span, with or without problems (with the none lines too).
- Run `pnpm readme:screenshots`, and commit `report-top.png` and any other shot that changes. Change `scripts/readme-screenshots.ts` only if the top shot's region needs it.
- Modify: `README.md`. The top shot's alt text and its paragraph say that "What needs attention" spans the width, above the other three panels.
- The Word copy has no columns, so it doesn't change.
- Test:
  - `test/share-html-top.test.ts`: the panel's class, with problems and without.
  - `test/share-browser.test.ts`:
    - at 1280 px, the attention panel is as wide as the panels grid, and sits above the other three;
    - at 390 px, all four are full width;
    - axe reports zero violations.

- [ ] **Step 1:** Write the tests, and run them: FAIL.
- [ ] **Step 2:** Implement, and run them: PASS.
- [ ] **Step 3:** Run `pnpm readme:screenshots` and look at `report-top.png`. Then update the README's alt text and paragraph, and run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 4:** Commit: `Give the summary's What needs attention panel the full width`.

---

## The release (the controller, with the owner)

1. Run the final review on opus, then one fix wave and its re-review (subagent-driven development).
2. Push the branch, and get CI green on all six jobs.
3. Merge: `git switch main && git merge --no-ff plan-7-what-needs-attention`.
4. **"Prepare 0.12.0":**
   - the CHANGELOG's `## [0.12.0] - <date>` and its compare link;
   - the timeline's 0.12.0 row in `STORY_TEXT`'s rows, both tracks: `<b>0.12.0</b>: what needs attention, as a card for each problem: what NVDA says and where, the likely cause, the fix in the code, and the path forward; a review settles a flag; and five numbers.`;
   - the pinned tests;
   - `docs/phase-c-handoff.md`'s "Published" line.

   Push, and get CI green.
5. Run `./publish.sh --dry-run minor` in the foreground. Then `npm whoami`; if it fails, the owner logs in.
6. The owner gives a fresh 2FA code. Run `npm version minor --no-git-tag-version && npm publish --access public --ignore-scripts --otp <code>`.
7. Commit "Release v0.12.0", tag `v0.12.0` (annotated), and push with tags.
8. Wait until `npm view @icjia/voicecap@0.12 version` prints `0.12.0`, then wait one more minute.
9. In the transcripts repo, set `netlify.toml`'s command to `@0.12`, commit, and push (standing OK).
10. **Share i2i v3 again** (the owner's request of 2026-10-06), with no new run:
    1. From the transcripts home, run `npx --yes @icjia/voicecap@0.12 share --site https://v3--i2i.netlify.app --out .`.
    2. Check that no file names the account or a local path, including inside the Word copy, and that the page's "What needs attention" shows the logo card.
    3. Commit `Share v3--i2i.netlify.app again with voicecap 0.12.0: what needs attention as cards`, and push.
11. **The live check:**
    - the website lists the new report first;
    - its page shows the card;
    - the live files' SHA-256 fingerprints match the share's.

    Send the owner the link.
12. Update the handoff and the memories. Then resume 6c:
    1. `git switch plan-6c-nvda-log && git merge main`, then run the suite.
    2. Continue at its Task 3; it ships as 0.13.0.
    3. Design the review replay alongside it.
