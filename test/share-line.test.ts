/**
 * A line of the report as both copies say it: words, with no markup and nothing escaped, and the
 * page's HTML made from one. The Word copy reads the same lines, so what they hold is the words.
 */
import { describe, expect, it } from "vitest";

import { lineHtml, verdictLine } from "../src/share/html/parts.js";
import { firstSentenceBold, lineOfMarkup, lineText, type Line } from "../src/share/line.js";
import { TIMELINE } from "../src/share/text.js";

describe("a line", () => {
  it("gives a line's words, and its HTML with every word escaped", () => {
    const line: Line = [
      { text: "7 pages <all>.", bold: true },
      " See ",
      { text: "a&b", mono: true },
      " at ",
      { text: "NVDA", href: "https://www.nvaccess.org/" },
    ];

    expect(lineText(line)).toBe("7 pages <all>. See a&b at NVDA");
    expect(lineHtml(line)).toBe(
      '<b>7 pages &lt;all&gt;.</b> See <code>a&amp;b</code> at <a href="https://www.nvaccess.org/">NVDA</a>',
    );
  });

  it("escapes a quote and an apostrophe too, in its words and in a link's address", () => {
    const line: Line = [
      `"it's" `,
      { text: `<x y="1">&'</x>`, mono: true },
      { text: "go", href: `https://a.gov/?q="1"&r='2'` },
    ];

    expect(lineHtml(line)).toBe(
      "&quot;it&#39;s&quot; <code>&lt;x y=&quot;1&quot;&gt;&amp;&#39;&lt;/x&gt;</code>" +
        '<a href="https://a.gov/?q=&quot;1&quot;&amp;r=&#39;2&#39;">go</a>',
    );
    // One rule for every word: a sentence the page has always said is escaped as the rest are.
    expect(lineHtml(["the person's review"])).toBe("the person&#39;s review");
  });

  it("sets a piece in bold, in the fixed-width font, and linked, with the link outermost", () => {
    expect(lineHtml([{ text: "x", bold: true, mono: true, href: "https://a.gov/" }])).toBe(
      '<a href="https://a.gov/"><b><code>x</code></b></a>',
    );
    // A piece that says nothing of its own is its words alone.
    expect(lineHtml([{ text: "x" }])).toBe("x");
  });

  it("is nothing for no line, and keeps a bold piece with no words as it is", () => {
    expect(lineText([])).toBe("");
    expect(lineHtml([])).toBe("");
    expect(lineHtml([{ text: "", bold: true }])).toBe("<b></b>");
  });
});

describe("lineOfMarkup", () => {
  it("reads the timeline's markup as a line", () => {
    expect(lineOfMarkup("<b>0.6.0</b>: the page, and <code>voicecap preflight</code>.")).toEqual([
      { text: "0.6.0", bold: true },
      ": the page, and ",
      { text: "voicecap preflight", mono: true },
      ".",
    ]);
  });

  it("gives words with no markup as they are, and nothing as no line", () => {
    expect(lineOfMarkup("The first line of code.")).toEqual(["The first line of code."]);
    expect(lineOfMarkup("")).toEqual([]);
    expect(lineOfMarkup("<b>One</b><code>two</code>")).toEqual([
      { text: "One", bold: true },
      { text: "two", mono: true },
    ]);
  });

  it("reads every cell of the timeline, with the same words as the page inserts", () => {
    const cells = TIMELINE.flatMap((row) => [row.pc, row.mac, row.both]).filter(
      (cell) => cell !== null,
    );

    expect(cells.length).toBeGreaterThan(10);
    for (const cell of cells) {
      // The cell's words, with its tags dropped; and its markup again, with its apostrophes escaped.
      expect(lineText(lineOfMarkup(cell))).toBe(cell.replace(/<\/?(?:b|code)>/g, ""));
      expect(lineHtml(lineOfMarkup(cell))).toBe(cell.replaceAll("'", "&#39;"));
    }
  });
});

describe("firstSentenceBold", () => {
  it("sets a first sentence in bold, and never ends it at a version number", () => {
    expect(firstSentenceBold("2 problems, in 0.4.1 records. Neither came back.")).toEqual([
      { text: "2 problems, in 0.4.1 records.", bold: true },
      " Neither came back.",
    ]);
  });

  it("ends the sentence at a full stop, an exclamation mark, or a question mark before a space or the end", () => {
    expect(firstSentenceBold("Two problems. Neither came back. It was fine.")).toEqual([
      { text: "Two problems.", bold: true },
      " Neither came back. It was fine.",
    ]);
    expect(firstSentenceBold("All the same!")).toEqual([{ text: "All the same!", bold: true }]);
    expect(firstSentenceBold("Why? Because.")).toEqual([{ text: "Why?", bold: true }, " Because."]);
  });

  it("sets a line with no end whole in bold, and leaves nothing of the rest but its words", () => {
    expect(firstSentenceBold("No full stop here")).toEqual([
      { text: "No full stop here", bold: true },
    ]);
    expect(firstSentenceBold("One.   Two   ")).toEqual([{ text: "One.", bold: true }, " Two"]);
    expect(lineText(firstSentenceBold("<i>One</i>. <b>Two</b>"))).toBe("<i>One</i>. <b>Two</b>");
  });

  it("is the line the page's verdict is made of", () => {
    expect(verdictLine("1 didn't happen again. It wasn't <tried>.")).toBe(
      '<p class="prob-verdict"><b>1 didn&#39;t happen again.</b> It wasn&#39;t &lt;tried&gt;.</p>',
    );
  });
});
