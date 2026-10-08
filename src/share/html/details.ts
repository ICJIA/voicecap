/**
 * "The details, for reviewers and auditors": the section after the pages' cards that gathers how
 * the test was run, what it covered, and the evidence behind it, for the people who check the work.
 * A manager who reads nothing else has stopped before it.
 *
 * It has one heading, an `h2` with a line under it that says what is here, and each part has a
 * heading of its own, an `h3`, in the spec's order:
 * - What's still to do, How complete the test was, and When and how: the summary's panels;
 * - What changed since the last run, Problems during the runs, and What these results cover;
 * - Flags by rule and The human review: the summary's bars;
 * - The evidence behind these results, How voicecap works, and How voicecap came to be.
 *
 * The sections that came after the cards are built as they always were, folds and all, and then
 * set one level down (`demoted`): a section's `h2` is a part's `h3`, and what is inside it is one
 * level lower than it was, so no heading skips a level. Each keeps its ids, so every link to one
 * still lands.
 *
 * Where no run counts there is nothing to count, so the five parts that were the summary's panels
 * and bars, which are all counts, are left out, as the summary leaves them out.
 */
import { esc } from "../../report/html.js";
import type { ShareModel } from "../model.js";
import { DETAILS_TEXT } from "../text.js";
import { renderChanges } from "./changes.js";
import { renderCoverage, renderEvidence, renderStory } from "./evidence.js";
import { demoted } from "./parts.js";
import { renderProblems } from "./problems.js";
import { completePart, renderHow, reviewPart, rulesPart, todoPart, whenHowPart } from "./top.js";

/**
 * The details: their heading and line, then each part in the spec's order. A site with a run that
 * counts has all eleven; one where none does has the six that aren't counts.
 */
export function renderDetails(model: ShareModel): string {
  const { summary } = model;
  const counted = model.header.tested !== null;
  const parts = [
    ...(counted ? [todoPart(summary), completePart(model), whenHowPart(summary)] : []),
    demoted(renderChanges(model)),
    demoted(renderProblems(model)),
    demoted(renderCoverage(model)),
    ...(counted ? [rulesPart(summary), reviewPart(summary)] : []),
    demoted(renderEvidence(model)),
    demoted(renderHow(model)),
    demoted(renderStory(model)),
  ];
  return [
    `<section id="details" aria-labelledby="details-h">`,
    `  <h2 id="details-h">${esc(DETAILS_TEXT.title)}</h2>`,
    `  <p class="gist">${esc(DETAILS_TEXT.gist)}</p>`,
    `  ${parts.join("\n  ")}`,
    `</section>`,
  ].join("\n");
}
