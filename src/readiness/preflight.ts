/**
 * Runs a platform's machine info and quick checks, for init, doctor, setup, and runs.
 */
import type { Check, CheckRunner, PlatformReadiness, PreflightResult } from "./model.js";
import { errorMessage } from "../util/errors.js";

/**
 * Runs machineInfo(), then each of the platform's quick checks in order, one at a time (a check
 * may raise a macOS prompt, so they never run concurrently). A runner that throws becomes a FAIL
 * naming the error, with a generic problem. ready is true when no check is a FAIL.
 */
export async function runPreflight(platform: PlatformReadiness): Promise<PreflightResult> {
  const info = await platform.machineInfo();
  const checks: Check[] = [];
  for (const runner of platform.quickChecks()) checks.push(await runCheck(runner));
  return { info, checks, ready: checks.every((check) => check.status !== "FAIL") };
}

/**
 * Runs one quick check, as the preflight does: a runner that throws becomes a FAIL naming the
 * error, with a generic problem. setup's guided steps check again with this.
 */
export async function runCheck(runner: CheckRunner): Promise<Check> {
  try {
    return await runner.run();
  } catch (error) {
    return {
      id: runner.id,
      status: "FAIL",
      summary: `Couldn't check ${runner.id}: ${errorMessage(error)}`,
      problem: {
        title: "An unexpected error",
        whatsWrong: errorMessage(error),
        fix: ["Run npx @icjia/voicecap doctor and send its output to the voicecap maintainers."],
        setupHelps: false,
      },
    };
  }
}
