import { beforeAll, describe, expect, it } from "vitest";

import type { RunJson } from "../src/model.js";
import { voiceAnchor } from "../src/share/anchors.js";
import { buildShareModel, type ShareModel } from "../src/share/model.js";
import { renderVoicePage } from "../src/share/voice-page.js";
import {
  VOICE_PART_PAGES,
  voicePartCount,
  voicePartName,
  voicePartNames,
  voicePartOf,
} from "../src/share/voice-parts.js";
import { voiceDetails } from "../src/share/words.js";
import { lineText } from "../src/share/line.js";
import { shareRun } from "./helpers/share-data.js";
import {
  inputOf,
  LINES,
  recordedVoice,
  recordingsOf,
  storeOf,
  TRANSCRIPTS,
  VOICE_PAGE,
} from "./helpers/share-model.js";
import { speechAndPauses } from "./helpers/voice-signal.js";

describe("the voice page's parts", () => {
  it("has one part for up to 100 pages, and one more for each 100 after", () => {
    expect(VOICE_PART_PAGES).toBe(100);
    expect(voicePartCount(0)).toBe(1);
    expect(voicePartCount(1)).toBe(1);
    expect(voicePartCount(100)).toBe(1);
    expect(voicePartCount(101)).toBe(2);
    expect(voicePartCount(301)).toBe(4);
    expect(voicePartOf(0)).toBe(1);
    expect(voicePartOf(99)).toBe(1);
    expect(voicePartOf(100)).toBe(2);
    expect(voicePartOf(300)).toBe(4);
  });

  it("keeps the voice page's name for the first part, and numbers the others before .voice.html", () => {
    expect(voicePartName(VOICE_PAGE, 1)).toBe(VOICE_PAGE);
    expect(voicePartName(VOICE_PAGE, 2)).toBe("example.illinois.gov_2026-09-30.part-2.voice.html");
    // A name that doesn't end .voice.html has the part on its end.
    expect(voicePartName("other.html", 3)).toBe("other.html.part-3");
    expect(voicePartNames(VOICE_PAGE, 250)).toEqual([
      VOICE_PAGE,
      "example.illinois.gov_2026-09-30.part-2.voice.html",
      "example.illinois.gov_2026-09-30.part-3.voice.html",
    ]);
    // Each still ends .voice.html, the ending the website knows a voice page by.
    for (const name of voicePartNames(VOICE_PAGE, 301)) expect(name).toMatch(/\.voice\.html$/);
  });

  describe("a report of 205 recorded pages", () => {
    let model: ShareModel;
    let recordings: Map<string, Uint8Array>;
    let run: RunJson;

    beforeAll(async () => {
      const { record } = await recordedVoice(speechAndPauses());
      run = shareRun({
        id: "2026-11-10_0804",
        createdAt: "2026-11-10T08:04:54-06:00",
        voicecapVersion: "0.24.1",
        pages: Array.from({ length: 205 }, (_, index) => ({
          path: `/page-${index + 1}/`,
          files: TRANSCRIPTS,
          passes: LINES,
          voice: record,
        })),
      });
      recordings = recordingsOf([run]);
      model = buildShareModel(
        inputOf([run], { transcripts: storeOf(), voiceName: VOICE_PAGE, recordings }),
      );
    });

    it("links each card to the part that holds its page", () => {
      const names = voicePartNames(VOICE_PAGE, 205);
      expect(names).toHaveLength(3);
      model.pages.forEach((card, index) => {
        expect(card.voice?.href).toBe(
          `${names[Math.floor(index / 100)]}#${voiceAnchor(card.slug)}`,
        );
      });
    });

    it("names every part in the details", () => {
      const line = voiceDetails(model);
      expect(line).not.toBeNull();
      const words = lineText(line ?? []);
      for (const name of voicePartNames(VOICE_PAGE, 205)) expect(words).toContain(name);
      expect(words).toContain("It's in 3 parts, of up to 100 pages each; the others:");
    });

    it("writes each part with its own pages, says which they are, and links the others", () => {
      const names = voicePartNames(VOICE_PAGE, 205);
      const parts = names.map((_, at) =>
        renderVoicePage(model, recordings, { fontCss: "" }, { number: at + 1, names }),
      );
      const sectionCount = (html: string | null): number =>
        (html ?? "").match(/<audio\b/g)?.length ?? 0;
      expect(parts.map(sectionCount)).toEqual([100, 100, 5]);
      expect(parts[1]).toContain("Part 2 of 3: pages 101 to 200.");
      expect(parts[2]).toContain("Part 3 of 3: pages 201 to 205.");
      // Its own number isn't a link, and the others are, each named for a screen reader.
      expect(parts[1]).toContain('<span aria-current="page">2</span>');
      expect(parts[1]).toContain(
        `<a href="${names[0]}">1<span class="sr"> (part 1 of the voice page)</span></a>`,
      );
      expect(parts[1]).toContain("(part 2 of 3)</title>");
      // A part has the section of each of its pages, and none of another part's.
      const second = parts[1] ?? "";
      expect(second).toContain(`id="${voiceAnchor(model.pages[100]?.slug ?? "")}"`);
      expect(second).not.toContain(`id="${voiceAnchor(model.pages[99]?.slug ?? "")}"`);
    });

    it("is one voice page, as before, for a report of up to 100 pages", () => {
      const small = buildShareModel(
        inputOf([{ ...run, pages: run.pages.slice(0, 100) }], {
          transcripts: storeOf(),
          voiceName: VOICE_PAGE,
          recordings,
        }),
      );
      for (const card of small.pages)
        expect(card.voice?.href.startsWith(`${VOICE_PAGE}#`)).toBe(true);
      const html = renderVoicePage(small, recordings, { fontCss: "" });
      expect(html).not.toContain("Part 1 of");
      expect(lineText(voiceDetails(small) ?? [])).not.toContain("parts");
    });
  });
});
