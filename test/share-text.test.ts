import { describe, expect, it } from "vitest";

import { lineText, type Line } from "../src/share/line.js";
import * as text from "../src/share/text.js";

const { HOW_LEAD, HOW_STEPS, STORY, WHEN_TO_RUN, WORTH_KNOWING } = text;

/** What a function the module exports is called with, to hear what it says: a pass, and a name. */
const SAMPLE = ["read", "current.docx"];

/** Every string the module stores and every function it exports, however deep. */
function leavesOf(value: unknown): unknown[] {
  if (typeof value === "string" || typeof value === "function") return [value];
  if (Array.isArray(value)) return value.flatMap(leavesOf);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(leavesOf);
  return [];
}

/** Every string the module stores, however deep: the page's fixed text as it is written. */
function storedStrings(): string[] {
  return leavesOf(text).filter((leaf): leaf is string => typeof leaf === "string");
}

/**
 * What the module's functions say, each called with sample arguments: the sentence it gives, or the
 * words of the line it gives (its pieces joined, so a check reads across a piece in bold or in
 * code). `storedStrings` can't see these, since it reads no function.
 */
function spokenStrings(): string[] {
  return leavesOf(text)
    .filter((leaf): leaf is (...args: string[]) => string | Line => typeof leaf === "function")
    .map((say) => {
      const said = say(...SAMPLE);
      return typeof said === "string" ? said : lineText(said);
    });
}

/** Every string the module exports or says, however deep: all of the page's fixed text. */
function everyString(): string[] {
  return [...storedStrings(), ...spokenStrings()];
}

describe("the fixed text", () => {
  it("never calls voicecap automated", () => {
    const strings = everyString();

    // The word is there, about other tools (the lead's and the story's "automated checkers", and
    // card 5's axe); a test that found none would be reading nothing. A clause that names voicecap,
    // up to a full stop, a colon, or a semicolon, never calls it automated.
    expect(strings.some((string) => /\bautomated\b/i.test(string))).toBe(true);
    expect(strings.filter((string) => /voicecap[^.:;]*\bautomated\b/i.test(string))).toEqual([]);
  });

  it("says what axe checks: the design of the report's web page, in voicecap's own tests", () => {
    // The page a run writes isn't itself checked as it's written, so the card says what is. It
    // names the web page, so it's as true in the Word copy as on the page.
    expect(WORTH_KNOWING[4]).toEqual({
      title: "Both kinds of testing",
      text: "voicecap checks the design of this report's web page with axe in its own tests, with no violations: the automated checker and the listen-through, side by side.",
    });
  });

  it("tells how voicecap began, word for word, as the owner approved it", () => {
    expect(STORY.began).toBe(
      "voicecap began at the Illinois Criminal Justice Information Authority (ICJIA) with a practical need: more than a dozen websites to review before the April 2027 ADA Title II deadline for accessible digital content. Automated checkers such as axe, Lighthouse, and Pa11y were one half of that review. The other half was to go through every site methodically with a real screen reader, NVDA or VoiceOver, and keep a transcript of what it said.",
    );
  });

  it("opens the story with why voicecap was needed, naming the deadline as the owner does", () => {
    expect(STORY.began).toContain("more than a dozen websites");
    expect(STORY.began).toContain(
      "the April 2027 ADA Title II deadline for accessible digital content",
    );
  });

  it("words a page's screenshot as the plan pins it: its alt text, and why there's none", () => {
    const { SCREENSHOT_TEXT } = text;

    expect(SCREENSHOT_TEXT.alt("/about/", "NVDA")).toBe(
      "The page /about/ as it loaded, before NVDA read it",
    );
    expect(SCREENSHOT_TEXT.failed("timed out after 5s")).toBe(
      "Not recorded: the screenshot couldn't be taken (timed out after 5s).",
    );
    // A reason that says nothing leaves the sentence without its brackets.
    expect(SCREENSHOT_TEXT.failed("")).toBe("Not recorded: the screenshot couldn't be taken.");
    expect(SCREENSHOT_TEXT.noDriver).toBe(
      "Not recorded: this run's screen reader driver doesn't take screenshots.",
    );
    expect(SCREENSHOT_TEXT.notRead).toBe(
      "Not recorded: no screenshot was taken, since the page wasn't read.",
    );
    expect(SCREENSHOT_TEXT.changed).toBe(
      "Not shown: the file isn't as the run recorded it; voicecap verify names it.",
    );
  });

  it("words what axe found as the spec pins it: the chip, the fold's lines, and why a page has none", () => {
    const { AXE_TEXT } = text;

    expect(AXE_TEXT.title).toBe("What axe found");
    // The chip counts issues: the rules axe found violated, never what needs review.
    expect([0, 1, 3, 1204].map((issues) => AXE_TEXT.chip(issues))).toEqual([
      "axe: no issues",
      "axe: 1 issue",
      "axe: 3 issues",
      "axe: 1,204 issues",
    ]);
    // axe is called an automated checker; what it finds is said to be part of what can be found.
    expect(AXE_TEXT.what).toBe(
      "axe is an automated checker: it tests a page's code against rules, and finds what code can find. A person's review finds the rest.",
    );
    expect(AXE_TEXT.version("4.13.0", "WCAG 2.0 at level A")).toBe(
      "axe-core 4.13.0, with its rules for WCAG 2.0 at level A.",
    );
    expect(AXE_TEXT.version("4.13.0", "")).toBe("axe-core 4.13.0.");
    expect(AXE_TEXT.none).toBe("axe found no issues on this page.");
    // axe's words on how to fix an element: each element's, or, said once for a rule whose kept
    // elements all share them, words that claim no more than the elements listed.
    expect(AXE_TEXT.fix).toBe("How to fix it, in axe's words");
    expect(AXE_TEXT.fixShared(1)).toBe("How to fix the element listed, in axe's words");
    expect(AXE_TEXT.fixShared(50)).toBe("How to fix each element listed, in axe's words");
    expect(AXE_TEXT.reviewLead).toBe(
      "axe couldn't decide these, so each needs a person to check it.",
    );
    // Why there's none, as a screenshot's place says it.
    expect(AXE_TEXT.failed("timed out after 20s")).toBe(
      "axe couldn't check this page: timed out after 20s.",
    );
    expect(AXE_TEXT.failed("")).toBe("axe couldn't check this page.");
    expect(AXE_TEXT.noDriver).toBe("Not checked: this run's driver doesn't check pages with axe.");
    expect(AXE_TEXT.notRead).toBe("Not checked: axe didn't check this page, since it wasn't read.");
    expect(AXE_TEXT.changed).toBe(
      "Not shown: axe.json isn't as the run recorded it; voicecap verify names it.",
    );
    // The line in How voicecap works: axe checks each page before NVDA reads it, from the version
    // that began to, so it's true of a report whose runs are older, and its results are evidence
    // beside the person's review, never its verdict.
    expect(AXE_TEXT.how).toBe(
      "From voicecap 0.16.0, each page is also checked with axe, an automated checker, before NVDA reads it. What axe finds is shown on the page's card, as evidence beside the person's review, never its verdict.",
    );
  });

  it("never has voicecap's own words call a page accessible or not, in what axe found", () => {
    const said = leavesOf(text.AXE_TEXT).map((leaf) =>
      typeof leaf === "function"
        ? String((leaf as (...args: string[]) => unknown)(...SAMPLE))
        : String(leaf),
    );

    // Read at all, so a check of nothing can't pass.
    expect(said.length).toBeGreaterThan(10);
    expect(said.filter((words) => /accessib|compliant|conform/i.test(words))).toEqual([]);
  });

  it("words At a glance as the spec pins it: its heading, the ring's three parts, and the links' lead", () => {
    const { GLANCE_TEXT, DETAILS_TEXT, ATTENTION_TEXT, PAGES_TEXT } = text;

    expect(GLANCE_TEXT.title).toBe("At a glance");
    // The owner's choice of 2026-10-07 (D6): each part says whether NVDA read the page, so a page
    // that was never read isn't one that "needs attention" beside a verdict that counts a card.
    expect(GLANCE_TEXT.parts).toEqual({
      noProblems: "Read, no problems",
      needAttention: "Read, with problems",
      notRead: "Not read",
    });
    expect(GLANCE_TEXT.onThisPage).toBe("On this page");
    // The words under the number in the ring's middle: "page" for one, and "pages" for none or many.
    expect([0, 1, 2, 1204].map((pages) => GLANCE_TEXT.ringUnit(pages))).toEqual([
      "pages",
      "page",
      "pages",
      "pages",
    ]);
    // The legend's name for a screen reader, which can't see the number in the ring's middle: the
    // total with its unit, as the middle shows them, with thousands set apart.
    expect([0, 1, 2, 7, 1204].map((pages) => GLANCE_TEXT.ringName(pages))).toEqual([
      "0 pages",
      "1 page",
      "2 pages",
      "7 pages",
      "1,204 pages",
    ]);
    // The links say their sections' own words, from wherever those are.
    expect([ATTENTION_TEXT.title, PAGES_TEXT.title, DETAILS_TEXT.link]).toEqual([
      "What needs attention",
      "Every page",
      "The details",
    ]);
  });

  it("words a page's first lines and its full transcript as the spec pins them", () => {
    const { PAGES_TEXT } = text;

    expect(PAGES_TEXT.heardFirst).toBe("Heard first");
    expect(PAGES_TEXT.fullTranscript).toBe("The full transcript");
  });

  it("names where the sample's transcripts are by their section, never by above or below", () => {
    const { HOW_TEXT, PAGES_TEXT } = text;

    // The sample is in the details, which come after the cards, and each page's transcripts are in
    // its card, under Every page. "Below" was false once the page put the cards first, and the
    // Word copy has the same order; the section's name stays true wherever the sections go.
    expect(HOW_TEXT.heardNote).toBe(
      `NVDA's own words: the first lines of each pass, from the transcripts under ${PAGES_TEXT.title}. Each time is how long that line took, which includes the wait for NVDA to finish speaking.`,
    );
    expect(HOW_TEXT.heardNote).not.toMatch(/\b(?:above|below)\b/i);
  });

  it("never names a library as how voicecap began", () => {
    expect(everyString().join("\n")).not.toMatch(/guidepup/i);
  });

  it("reads the sentences its functions say, as well as the text it stores", () => {
    const spoken = spokenStrings();

    // One of each: a line with bold and code, a line with a link, a sentence with a pass in it,
    // and the footer's two lines. A walk that called no function can't pass for the checks above.
    for (const start of [
      "The tools differ between the two runs,",
      "This could be a problem in voicecap itself.",
      "The read pass sounds different,",
      "What the check proves:",
      "This file: read. Its Word copy: current.docx.",
      "This file: current.docx. Its web page: read.",
    ]) {
      expect(
        spoken.some((sentence) => sentence.startsWith(start)),
        start,
      ).toBe(true);
    }
  });

  it("says the person hears NVDA speaking and reads the transcripts, and that NVDA speaks very fast in a run", () => {
    expect(HOW_LEAD).toBe(
      "Automated checkers read a page's code and test it against rules. voicecap takes a real screen reader through each page the way a person would, and saves every word it says. It can spot-check a large site, zero in on the pages that need attention, or go through a whole small site. The person running it reads the transcripts and fixes what they find. voicecap presses the keys and turns the pages, and NVDA speaks very fast as it goes, so the transcripts are where its words are read.",
    );
    expect(HOW_STEPS[4]).toEqual({
      icon: "person",
      title: "A person reads and fixes",
      text: "The person running voicecap hears NVDA at work, and says so when the run ends. NVDA speaks very fast during a run, so the transcripts are where its words are read. The person reads them, records what they found, and fixes it. Flags point to moments worth a closer look.",
    });
  });

  it("never says the person listened during a run, and keeps the word only in the two phrases that stay", () => {
    // Card 5 says "the automated checker and the listen-through", and the band on when to run
    // voicecap says screen reader users hear the deployed site, "so that's the one to listen to".
    const kept = ["the listen-through", "the one to listen to"];
    const strings = everyString();
    const rest = strings.map((string) =>
      kept.reduce((left, phrase) => left.replaceAll(phrase, ""), string),
    );

    // The phrases are there, so a test that found no "listen" at all can't pass for this.
    expect(kept.filter((phrase) => !strings.some((string) => string.includes(phrase)))).toEqual([]);
    expect(rest.filter((string) => /listen/i.test(string))).toEqual([]);
  });

  it("has the parts the renderers draw: six steps with their icons, four stages with one marked, six cards", () => {
    expect(HOW_STEPS.map((step) => step.icon)).toEqual([
      "list",
      "reader",
      "three",
      "words",
      "person",
      "seal",
    ]);
    expect(WHEN_TO_RUN.stages).toHaveLength(4);
    expect(WHEN_TO_RUN.stages.filter((stage) => stage.marked).map((stage) => stage.title)).toEqual([
      "Before launch",
    ]);
    expect(WORTH_KNOWING).toHaveLength(6);
  });

  it("leaves no stored text blank, or padded with spaces", () => {
    // The pieces of a line, which a function gives, end in a space where a word in bold or code
    // follows, so only what the module stores is read.
    expect(storedStrings().filter((string) => string === "" || string !== string.trim())).toEqual(
      [],
    );
  });

  it("quotes the study by its article's own headline, once in the story, for the renderer to link to Deque", () => {
    const { title, url } = STORY.deque;

    // Deque's headline word for word, as the article prints it (published 10 March 2021). A quoted
    // title shown to auditors must be exact, so it is never trimmed.
    expect(title).toBe(
      "Deque Study Shows Its Automated Testing Identifies 57 Percent of Digital Accessibility Issues, Surpassing Accepted Industry Benchmarks",
    );
    expect(STORY.why.split(title)).toHaveLength(2);
    expect(STORY.why).toContain(`“${title}”`);
    expect(new URL(url).protocol).toBe("https:");
    expect(new URL(url).hostname).toBe("www.deque.com");
  });
});
