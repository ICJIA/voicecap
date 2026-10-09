/**
 * The Word copy's "The details, for reviewers and auditors", as blocks (./blocks.ts): the section
 * after the pages that gathers how the test was run, what it covered, and the evidence behind it,
 * for the people who check the work. Its words and its parts are the page's (../html/details.ts), in
 * the same order: one heading 1 with a line under it that says what is here, and each part under a
 * heading 2 of its own, where the page's are headings 3 under its heading 2.
 *
 * - What's still to do, How complete the test was, and When and how: the summary's panels;
 * - What changed since the last run, Problems during the runs, and What these results cover;
 * - Flags by rule and The human review: the summary's bars;
 * - The evidence behind these results, How voicecap works, and How voicecap came to be.
 *
 * The sections that came after the pages are built as they always were, and then set one level down
 * (`demoted`): a section's heading 1 is a part's heading 2, and what is inside it is one level lower
 * than it was, so no heading skips a level. The five parts that were the summary's are headings 2
 * already (./top.ts).
 *
 * Where no run counts there is nothing to count, so the five parts that were the summary's panels
 * and bars, which are all counts, are left out, as the page leaves them out. Pure.
 */
import type { ShareModel } from "../model.js";
import { DETAILS_TEXT } from "../text.js";
import { demoted, heading, para, type Block } from "./blocks.js";
import { wordChanges } from "./changes.js";
import { wordCoverage, wordEvidence, wordStory } from "./evidence.js";
import { wordProblems } from "./problems.js";
import {
  completeBlocks,
  reviewBlocks,
  rulesBlocks,
  todoBlocks,
  whenHowBlocks,
  wordHow,
} from "./top.js";

/**
 * The details: their heading and line, then each part in the page's order. A site with a run that
 * counts has all eleven; one where none does has the six that aren't counts.
 */
export function wordDetails(model: ShareModel): Block[] {
  const { summary } = model;
  const counted = model.header.tested !== null;
  return [
    heading(1, DETAILS_TEXT.title),
    para(DETAILS_TEXT.gist),
    ...(counted
      ? [...todoBlocks(summary), ...completeBlocks(summary), ...whenHowBlocks(summary)]
      : []),
    ...demoted(wordChanges(model)),
    ...demoted(wordProblems(model)),
    ...demoted(wordCoverage(model)),
    ...(counted ? [...rulesBlocks(summary), ...reviewBlocks(summary)] : []),
    ...demoted(wordEvidence(model)),
    ...demoted(wordHow(model)),
    ...demoted(wordStory(model)),
  ];
}
