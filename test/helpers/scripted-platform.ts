/**
 * A PlatformReadiness whose quick checks answer from a script, for tests of anything that runs
 * checks and runs them again (the guided loop, setup). Each id's list gives the preflight's result
 * first, then one per later run, and its last entry repeats; an Error in the list is thrown by the
 * runner instead. `runs` records the ids in the order their runners ran, and `preflights()` counts
 * machineInfo calls: one per preflight.
 */
import type { Check, PlatformReadiness } from "../../src/readiness/model.js";

export interface ScriptedPlatform {
  platform: PlatformReadiness;
  runs: string[];
  preflights(): number;
}

export function scriptedPlatform(
  script: Record<string, (Check | Error)[]>,
  overrides: Partial<PlatformReadiness> = {},
): ScriptedPlatform {
  const runs: string[] = [];
  let preflights = 0;
  const platform: PlatformReadiness = {
    screenReader: "VoiceOver",
    cannotRunYet: null,
    readyTip: null,
    liveTestNotice: [],
    checkingNotice: [],
    liveTest: null,
    machineInfo: () => {
      preflights++;
      return Promise.resolve({ lines: [], screenReader: "VoiceOver 10", system: "macOS 26.6.2" });
    },
    quickChecks: () =>
      Object.entries(script).map(([id, results]) => ({
        id,
        run: () => {
          const earlier = runs.filter((ran) => ran === id).length;
          runs.push(id);
          const result = results[Math.min(earlier, results.length - 1)];
          if (result === undefined) return Promise.reject(new Error(`No result for ${id}.`));
          return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
        },
      })),
    ...overrides,
  };
  return { platform, runs, preflights: () => preflights };
}
