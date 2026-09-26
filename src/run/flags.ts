import { existsSync } from "node:fs";
import path from "node:path";

import {
  evaluateFlags,
  flagRulesSha256,
  type FlagRules,
  type PagePasses,
} from "../flags/evaluate.js";
import type { RunJson } from "../model.js";
import { readTranscriptJson } from "../transcripts/write.js";
import { pageDir } from "./paths.js";

/**
 * The run with flags computed by `rules`. Flags stored in run.json are reused when they were
 * computed with the same rules; otherwise they're recomputed from the transcripts, in memory
 * only (a completed run folder is never modified). This is how retuned flag phrasing takes
 * effect without re-running NVDA.
 */
export async function withCurrentFlags(
  outDir: string,
  run: RunJson,
  rules: FlagRules,
): Promise<RunJson> {
  const hash = flagRulesSha256(rules);
  if (run.flagRulesSha256 === hash) return run;
  const copy = structuredClone(run);
  copy.flagRulesSha256 = hash;
  for (const page of copy.pages) {
    if (page.status !== "done") continue;
    const passes: PagePasses = {};
    for (const pass of ["read", "headings", "tab"] as const) {
      const file = path.join(pageDir(outDir, run.id, page.slug), `${pass}.json`);
      if (existsSync(file)) passes[pass] = await readTranscriptJson(file);
    }
    page.flags = evaluateFlags(passes, rules);
  }
  return copy;
}
