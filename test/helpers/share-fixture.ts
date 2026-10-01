/**
 * The demo runs of 29 September 2026, as voicecap 0.4.1 recorded them on the Windows PC, kept in
 * test/fixtures/share/demo-2026-09-29/: a real case for the shareable page's tests.
 *
 * - 1315 and 1402 are completed and sealed, with every page's transcripts. In 1315 the page
 *   /the-report/ failed (another window took the foreground), and in 1402 /how-a-run-works/ did;
 *   each was read in full in the other run.
 * - 1415 and 1419 were interrupted, and have only their run.json (1419's /before-you-start/
 *   failed when another window took the foreground, while the page was opening).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { RunJson } from "../../src/model.js";

/** The demo site's folder in the transcripts home, for the day: one folder per run. */
export const DEMO_DAY = fileURLToPath(
  new URL("../fixtures/share/demo-2026-09-29/127.0.0.1_4848/2026-09-29/", import.meta.url),
);

/** A demo run's run.json, by the time in its folder's name: "1315", "1402", "1415", or "1419". */
export function demoRun(time: "1315" | "1402" | "1415" | "1419"): RunJson {
  return JSON.parse(readFileSync(`${DEMO_DAY}${time}/run.json`, "utf8")) as RunJson;
}
