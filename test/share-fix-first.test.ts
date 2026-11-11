import { describe, expect, it } from "vitest";

import { esc } from "../src/report/html.js";
import { renderAiMarkdown } from "../src/share/ai/markdown.js";
import { attentionWords } from "../src/share/attention-words.js";
import { fixFirstOf, MOST_FIX_FIRST } from "../src/share/fix-first.js";
import { renderGlance } from "../src/share/html/top.js";
import type { ShareModel } from "../src/share/model.js";
import { wordsOf } from "../src/share/word/blocks.js";
import { wordGlance } from "../src/share/word/top.js";
import { manyPages } from "./helpers/share-model.js";

/** The model with `cards` problems: its own cards, each copied with a number of its own. */
function withCards(model: ShareModel, cards: number): ShareModel {
  const [first] = model.attention;
  if (first === undefined) throw new Error("The model has no card to copy.");
  return {
    ...model,
    attention: Array.from({ length: cards }, (_, index) => ({
      ...(model.attention[index] ?? first),
      id: `need-${index + 1}`,
    })),
  };
}

/** The box's markup in At a glance, from its opening tag to its end. */
function boxOf(html: string): string {
  const at = html.indexOf('<div class="fix-first">');
  return at < 0 ? "" : html.slice(at, html.indexOf("</ol>", at) + 400);
}

describe("Fix these first", () => {
  it("isn't there when nothing needs attention", () => {
    const quiet = manyPages(5, 0);
    expect(fixFirstOf(quiet.attention)).toBeNull();
    expect(renderGlance(quiet)).not.toContain("fix-first");
    expect(wordsOf(wordGlance(quiet)).join("\n")).not.toContain("Fix these first");
    expect(renderAiMarkdown(quiet)).not.toContain("Fix these first");
  });

  it("says each problem under the verdict: its title and count, what NVDA said, its fix, and a link to its card", () => {
    const model = manyPages(5, 2);
    const html = renderGlance(model);
    const box = boxOf(html);
    expect(model.attention.length).toBeGreaterThan(0);
    // Under the verdict, and before the sentence and the ring.
    expect(html.indexOf('class="verdict')).toBeLessThan(html.indexOf("fix-first"));
    expect(html.indexOf("fix-first")).toBeLessThan(html.indexOf('class="lead"'));
    expect(box).toContain('<h3 id="fix-first-h">Fix these first</h3>');
    model.attention.forEach((card, index) => {
      const words = attentionWords(card);
      expect(box).toContain(`<b>${index + 1}. ${esc(words.title)}</b>`);
      expect(box).toContain(esc(words.count));
      expect(box).toContain(`href="#${card.id}"`);
      const [fix] = words.fixes;
      if (fix !== undefined) expect(box).toContain(`<pre><code>${esc(fix.code)}</code></pre>`);
    });
    // Each link names its problem for a screen reader, so no two sound alike.
    const title = attentionWords(model.attention[0]!).title;
    expect(box).toContain(`<span class="sr">: ${esc(title)}</span>`);
    expect(box).not.toContain("more problem");
  });

  it("shows the 3 on the most pages, and says how many more there are", () => {
    const model = withCards(manyPages(5, 2), 5);
    const box = fixFirstOf(model.attention);
    expect(box?.items.map(({ id }) => id)).toEqual(["need-1", "need-2", "need-3"]);
    expect(box?.more).toBe(2);
    expect(MOST_FIX_FIRST).toBe(3);
    const html = boxOf(renderGlance(model));
    expect(html).toContain('<a href="#need-h">2 more problems are under What needs attention.</a>');
    expect(fixFirstOf(withCards(model, 4).attention)?.more).toBe(1);
    expect(boxOf(renderGlance(withCards(model, 4)))).toContain(
      "1 more problem is under What needs attention.",
    );
  });

  it("says the same in the Word copy and the report for AI tools", () => {
    const model = manyPages(5, 2);
    const title = attentionWords(model.attention[0]!).title;
    const word = wordsOf(wordGlance(model)).join("\n");
    expect(word).toContain("Fix these first");
    expect(word).toContain(`1. ${title}`);
    expect(word).toContain("Each one's pages and the full fix are under What needs attention.");
    const markdown = renderAiMarkdown(model);
    const at = markdown.indexOf("### Fix these first");
    expect(at).toBeGreaterThan(markdown.indexOf("## At a glance"));
    expect(at).toBeLessThan(markdown.indexOf("## What needs attention"));
  });
});
