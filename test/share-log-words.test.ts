/**
 * The sentences of a run's part on NVDA's own log that are worked out from the check's results:
 * what is said of steps that weren't checked, and the words of a check that was made.
 */
import { describe, expect, it } from "vitest";

import { notCheckedLine, nothingCheckedLine, nvdaLogWords } from "../src/share/log-words.js";
import type { NvdaLogChecked } from "../src/share/model.js";
import type { NotChecked, WhyNotChecked } from "../src/share/run-log-check.js";
import { NVDA_LOG_TEXT } from "../src/share/text.js";

const FROM = "2026-09-26T14:04:45.729-05:00";
const WHEN = "26 September 2026, 14:04";

/** Some steps that weren't checked. */
function unchecked(why: WhyNotChecked, extra: Partial<NotChecked> = {}): NotChecked {
  return { steps: 8, from: FROM, why, detail: null, ...extra };
}

describe("notCheckedLine", () => {
  it.each<[WhyNotChecked, string]>([
    ["none", "voicecap kept no copy of NVDA's log for that session"],
    ["altered", "NVDA's log isn't as the run recorded it; voicecap verify names it"],
    [
      "silent",
      "NVDA's log has no speech in it, since NVDA's logging level was below input and output",
    ],
    [
      "initial",
      "this run kept only the first thing NVDA said for each step, so a step can't be compared with all that NVDA's log has",
    ],
    ["times", "the times of the pages couldn't be read"],
    ["unread", "the transcripts' steps couldn't be read here"],
    ["placed", "the event log doesn't show when the pages were read"],
  ])("says why %s, after how many steps and the NVDA session they were read in", (why, because) => {
    expect(notCheckedLine(unchecked(why))).toBe(
      `8 steps from the NVDA session that started ${WHEN} weren't checked: ${because}.`,
    );
  });

  it("says the run's own words for a session it gave a reason for, without its full stop doubled", () => {
    for (const detail of [
      "NVDA's log wasn't there.",
      "NVDA's log wasn't there",
      "  NVDA's log wasn't there. ",
    ]) {
      expect(notCheckedLine(unchecked("reason", { detail }))).toBe(
        `8 steps from the NVDA session that started ${WHEN} weren't checked: NVDA's log wasn't there.`,
      );
    }
    // A reason that says nothing says what none does.
    expect(notCheckedLine(unchecked("reason", { detail: " . " }))).toBe(
      notCheckedLine(unchecked("none")),
    );
  });

  it("names no session for steps that belong to none, and says one step in the singular", () => {
    expect(notCheckedLine(unchecked("unread", { from: null, steps: 1 }))).toBe(
      "1 step wasn't checked: the transcripts' steps couldn't be read here.",
    );
    expect(notCheckedLine(unchecked("placed", { from: null, steps: 2 }))).toBe(
      "2 steps weren't checked: the event log doesn't show when the pages were read.",
    );
  });
});

describe("nothingCheckedLine", () => {
  it("says a run with nothing to check has no transcripts to check NVDA's log against", () => {
    expect(nothingCheckedLine([])).toBe(
      "Not recorded: this run has no transcripts to check NVDA's log against.",
    );
  });

  it("says the plan's sentences when every group is alike: no copy kept, and copies not as recorded", () => {
    expect(nothingCheckedLine([unchecked("none"), unchecked("none", { from: null })])).toBe(
      "Not recorded: this run kept no copy of NVDA's log.",
    );
    expect(nothingCheckedLine([unchecked("altered"), unchecked("altered")])).toBe(
      "Not shown: NVDA's log isn't as the run recorded it; voicecap verify names it.",
    );
  });

  it("says the one reason of any other kind, when every group has it", () => {
    for (const why of ["silent", "initial", "times", "unread", "placed"] as const) {
      expect(nothingCheckedLine([unchecked(why), unchecked(why)]), why).toBe(
        `Not shown: ${NVDA_LOG_TEXT.because[why]}.`,
      );
    }
  });

  it("says that no step could be checked, then each group's own sentence, when the reasons differ", () => {
    expect(
      nothingCheckedLine([
        unchecked("none", { steps: 3 }),
        unchecked("altered", { steps: 1, from: null }),
      ]),
    ).toBe(
      "Not shown: no step could be checked. " +
        `3 steps from the NVDA session that started ${WHEN} weren't checked: voicecap kept no copy of NVDA's log for that session. ` +
        "1 step wasn't checked: NVDA's log isn't as the run recorded it; voicecap verify names it.",
    );
  });

  it("keeps the reasons the run gave, even when every group has one", () => {
    expect(
      nothingCheckedLine([unchecked("reason", { detail: "EBUSY: resource busy or locked" })]),
    ).toBe(
      "Not shown: no step could be checked. " +
        `8 steps from the NVDA session that started ${WHEN} weren't checked: EBUSY: resource busy or locked.`,
    );
  });
});

describe("nvdaLogWords", () => {
  /** A check of 12 steps, all agreed, with 3 lines of speech outside them. */
  function checked(overrides: Partial<NvdaLogChecked> = {}): NvdaLogChecked {
    return {
      transcriptLines: 12,
      logLines: 12,
      agree: 12,
      onlyInLog: [],
      onlyInTranscripts: [],
      outside: 3,
      notChecked: [],
      ...overrides,
    };
  }

  it("gives the three tiles with the numbers as the page writes them, thousands separated", () => {
    expect(
      nvdaLogWords(checked({ transcriptLines: 1204, logLines: 1200, agree: 1198 })).tiles,
    ).toEqual([
      { big: "1,204", label: "lines in voicecap's transcripts for this run" },
      { big: "1,200", label: "lines NVDA's own log has for those steps" },
      { big: "1,198", label: "agree" },
    ]);
  });

  it("says every line agrees only when both lists are empty, and how many steps had no words", () => {
    expect(nvdaLogWords(checked()).same).toBe("Every line agrees.");
    expect(nvdaLogWords(checked({ transcriptLines: 13 })).same).toBe(
      "Every line agrees. 1 step had no words in the transcripts or in NVDA's own log.",
    );
    const one = [{ page: "/", pass: "read" as const, step: 1, text: "x" }];
    expect(nvdaLogWords(checked({ onlyInLog: one })).same).toBeNull();
    expect(nvdaLogWords(checked({ onlyInTranscripts: one })).same).toBeNull();
  });

  it("counts only what it checked when some steps weren't, and says that every line checked agrees", () => {
    const some = [unchecked("reason", { detail: "NVDA's log wasn't there." })];
    const words = nvdaLogWords(checked({ transcriptLines: 13, notChecked: some }));

    expect(words.tiles).toEqual([
      { big: "13", label: "lines in voicecap's transcripts that were checked" },
      { big: "12", label: "lines NVDA's own log has for those steps" },
      { big: "12", label: "agree" },
    ]);
    expect(words.same).toBe(
      "Every line that was checked agrees. 1 step had no words in the transcripts or in NVDA's own log.",
    );
    expect(
      nvdaLogWords(checked({ transcriptLines: 1, logLines: 1, agree: 1, notChecked: some }))
        .tiles[0],
    ).toEqual({ big: "1", label: "line in voicecap's transcripts that was checked" });
    // A line that differs: nothing says the lines agree, whatever was checked.
    const one = [{ page: "/", pass: "read" as const, step: 1, text: "x" }];
    expect(nvdaLogWords(checked({ onlyInLog: one, notChecked: some })).same).toBeNull();
  });

  it("lists the lines that differ, the log's first, each where it is, with its words as they are", () => {
    const words = nvdaLogWords(
      checked({
        onlyInLog: [{ page: "/a/", pass: "tab", step: 3, text: "log's words" }],
        onlyInTranscripts: [
          { page: "Home", pass: "headings", step: 2, text: "transcript's words" },
        ],
      }),
    );

    expect(words.lists).toEqual([
      {
        title: "Said in NVDA's own log, not in the transcripts",
        lines: [{ where: "/a/, Tab pass, step 3", words: "log's words" }],
      },
      {
        title: "In the transcripts, not in NVDA's own log",
        lines: [{ where: "Home, Headings pass, step 2", words: "transcript's words" }],
      },
    ]);
  });

  it("says how much speech was left out, and the steps that weren't checked, whose speech is among it", () => {
    const words = nvdaLogWords(
      checked({
        outside: 1204,
        notChecked: [unchecked("none"), unchecked("unread", { from: null })],
      }),
    );

    expect(words.outside).toBe(
      "1,204 lines NVDA spoke outside voicecap's steps (while pages loaded, before the run, in attempts that were thrown out, or in steps that weren't checked) aren't compared or shown.",
    );
    expect(words.notChecked).toEqual([
      `8 steps from the NVDA session that started ${WHEN} weren't checked: voicecap kept no copy of NVDA's log for that session.`,
      "8 steps weren't checked: the transcripts' steps couldn't be read here.",
    ]);
  });

  it("says the speech left out as it always has when every step was checked", () => {
    expect(nvdaLogWords(checked({ outside: 1 })).outside).toBe(
      "1 line NVDA spoke outside voicecap's steps (while pages loaded, before the run, or in attempts that were thrown out) isn't compared or shown.",
    );
  });
});
