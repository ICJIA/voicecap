/**
 * The readiness text: the dated header, "This computer", "Checks", the "Not ready" blocks, the
 * verdicts, and the one-line run summary. Pure functions only: no I/O, no clock, no drivers.
 */
import type { Check, CheckStatus, MachineInfo, PreflightResult, Problem } from "./model.js";

/**
 * Width the "What's wrong" paragraph and fix steps wrap at. 92, not a round 96: the longest line
 * in the owner-approved spec example ("   What's wrong: … linking them into") is 92 characters,
 * and that example is the binding authority.
 */
const WRAP_WIDTH = 92;

const SETUP_LINE = "   Or run npx @icjia/voicecap setup, which walks you through it.";

/** Whether a problem's own fix steps already say to run setup, so SETUP_LINE would say it twice. */
function fixRunsSetup(problem: Problem): boolean {
  return problem.fix.some((step) => step.includes("npx @icjia/voicecap setup"));
}

/**
 * A platform's checking notice as one block that ends in a blank line, for saying just before the
 * quick checks start; null when it has none.
 */
export function renderCheckingNotice(notice: readonly string[]): string | null {
  return notice.length === 0 ? null : `${notice.join("\n")}\n`;
}

/** Zero-padded local date and time, e.g. 2026-09-28 11:10. */
function localWhen(when: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
  return `${date} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

/** The dated header, e.g. "voicecap preflight, 2026-09-28 11:10". */
export function renderHeader(kind: "preflight" | "doctor", when: Date): string {
  return `voicecap ${kind}, ${localWhen(when)}`;
}

/** "This computer" plus one line per machine info entry. */
export function renderMachineInfo(info: MachineInfo): string {
  const lines = info.lines.map((line) => `  ${line.label.padEnd(16)}${line.value}`);
  return ["This computer", ...lines].join("\n");
}

/** One status line, as used by both the Checks list and the run summary's WARN lines. */
function statusLine(status: CheckStatus, summary: string): string {
  return `  ${status.padEnd(6)}${summary}`;
}

/** "Checks" plus one line per check. */
export function renderChecks(checks: Check[]): string {
  const lines = checks.map((check) => statusLine(check.status, check.summary));
  return ["Checks", ...lines].join("\n");
}

/**
 * Break text at spaces into lines no longer than width, unless a single word alone is. The first
 * line starts with firstPrefix, later lines with restPrefix; both count toward the line's width.
 */
export function wrap(
  text: string,
  width: number,
  firstPrefix: string,
  restPrefix: string,
): string[] {
  const words = text.split(" ").filter((word) => word.length > 0);
  const lines: string[] = [];
  let line = firstPrefix;
  let lineHasWords = false;
  for (const word of words) {
    if (!lineHasWords) {
      line += word;
      lineHasWords = true;
    } else if (line.length + 1 + word.length <= width) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = restPrefix + word;
    }
  }
  lines.push(line);
  return lines;
}

/** A FAIL check that carries the problem its summary promises. */
function isFailWithProblem(check: Check): check is Check & { problem: Problem } {
  return check.status === "FAIL" && check.problem !== undefined;
}

function problemBlock(n: number, problem: Problem, options: { offerSetup: boolean }): string {
  const whatsWrong = wrap(problem.whatsWrong, WRAP_WIDTH, "   What's wrong: ", "   ");
  const fix = problem.fix.flatMap((step, index) =>
    wrap(step, WRAP_WIDTH, `     ${index + 1}. `, "        "),
  );
  const lines = [
    `${n}. ${problem.title}`,
    ...whatsWrong,
    "   How to fix:",
    ...fix,
    ...(problem.setupHelps && options.offerSetup && !fixRunsSetup(problem) ? [SETUP_LINE] : []),
  ];
  return lines.join("\n");
}

/**
 * "Not ready: N problem(s).", a blank line, then a numbered block per FAIL check that carries a
 * problem. Blocks are separated by a blank line.
 */
export function renderProblems(checks: Check[], options: { offerSetup: boolean }): string {
  const problems = checks.filter(isFailWithProblem);
  const heading = `Not ready: ${problems.length} ${problems.length === 1 ? "problem" : "problems"}.`;
  const blocks = problems.map((check, index) => problemBlock(index + 1, check.problem, options));
  return [heading, ...blocks].join("\n\n");
}

/**
 * Ready: "Ready: this computer can run <screenReader> for voicecap.", then the tip line if there
 * is one. Otherwise: renderProblems.
 */
export function renderVerdict(
  result: PreflightResult,
  options: { screenReader: string | null; tip: string | null; offerSetup: boolean },
): string {
  if (!result.ready) return renderProblems(result.checks, { offerSetup: options.offerSetup });
  const lines = [`Ready: this computer can run ${options.screenReader} for voicecap.`];
  if (options.tip) lines.push(options.tip);
  return lines.join("\n");
}

/** The header, "This computer", "Checks", and the verdict, each separated by a blank line. */
export function renderPreflight(
  result: PreflightResult,
  options: {
    kind: "preflight" | "doctor";
    when: Date;
    screenReader: string | null;
    tip: string | null;
    offerSetup: boolean;
  },
): string {
  return [
    renderHeader(options.kind, options.when),
    renderMachineInfo(result.info),
    renderChecks(result.checks),
    renderVerdict(result, options),
  ].join("\n\n");
}

/** One-line pass summary, plus a WARN line per warning check. */
export function renderRunSummary(result: PreflightResult): string {
  const warnings = result.checks.filter((check) => check.status === "WARN");
  const lines = [
    `Checks passed: ${result.info.screenReader} on ${result.info.system}`,
    ...warnings.map((check) => statusLine(check.status, check.summary)),
  ];
  return lines.join("\n");
}
