/**
 * What voicecap demo says in its own words: each step's text, as pure functions of what the tour
 * knows, with no I/O. What it borrows is said elsewhere: the preflight (readiness/render.ts), the
 * live test's checks, and a run's own lines. Prose wraps at 96 columns, as in the spec's example;
 * questions, commands, and lines of a transcript never wrap, so a command can be copied whole.
 */
import type { PageRecord } from "../model.js";
import { displayPath } from "../pages/url.js";
import type { Check } from "../readiness/model.js";
import { wrap } from "../readiness/render.js";
import { DEMO_SITEMAP } from "./server.js";

/** Where prose wraps: the spec's example wraps at 96 columns. */
export const TOUR_WIDTH = 96;
/**
 * How long things take, as the tour says them: the whole tour and step 4's audit in minutes, the
 * live test in seconds. Measured on the Windows PC (2026-09-29, NVDA 2026.2, Chrome 153 and 154):
 * a clean audit of the seven pages holds NVDA for about 6½ minutes, about 6:40 from Enter to the
 * next pause. The whole tour adds the live test and the reading at each pause.
 */
export const TOUR_MINUTES = 9;
export const AUDIT_MINUTES = 7;
export const LIVE_TEST_SECONDS = 20;
/** The demo run's transcripts home, in the current folder: the run's --out. */
export const DEMO_OUT = "voicecap-demo";
/** How many lines of the home page's read.txt step 5 shows. */
export const EXCERPT_LINES = 5;

/**
 * The tour's own command: what the audit, when it's stopped, says to run to start again (runAudit's
 * `again`), since its run is --fresh, on a demo site that stops with the tour.
 */
export const TOUR_COMMAND = "npx @icjia/voicecap demo";

export const TOUR_TITLE = "voicecap demo: a guided first run";
/** Git Bash's own window (mintty) doesn't always let Node see a terminal, so it names two that do. */
export const NOT_A_TERMINAL =
  "voicecap demo is interactive: run it in a terminal. On Windows, use PowerShell or Windows Terminal, not Git Bash's own window.";
/** Ctrl+D at a pause ends the terminal's input. Nothing runs at a pause. */
export const INPUT_ENDED = "Stopped: the input ended (Ctrl+D). Nothing is left running.";
export const NOT_READY_AGAIN = "When this computer is ready, run npx @icjia/voicecap demo again.";
/**
 * Step 2's last line where there's no screen reader to drive (Linux), in place of NOT_READY_AGAIN:
 * this computer can't become ready, so it says where the tour runs.
 */
export const WHERE_THE_TOUR_RUNS = `The tour runs on a Windows PC, or on a Mac for the checks: run ${TOUR_COMMAND} there.`;
/** After the audit stopped on failed pages in a row, which the run has explained. */
export const STOPPED_RUN_NEXT = `Run npx @icjia/voicecap preflight to see what to fix, then ${TOUR_COMMAND} again.`;
export const STOPPED = "Stopped. Nothing is left running.";
export const OPEN_REPORT = "Open the report now?";
export const OPENING_REPORT = "Opening the report…";

export type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const STEP_TITLES: Record<Step, string> = {
  1: "Welcome",
  2: "Checking this computer",
  3: "The live test",
  4: "Auditing the demo site",
  5: "The transcripts",
  6: "The report",
  7: "Your own site",
};

/** A paragraph of prose, wrapped at TOUR_WIDTH. */
function paragraph(text: string): string {
  return wrap(text, TOUR_WIDTH, "", "").join("\n");
}

/** What the tour calls this computer where it can't audit yet: "Mac" on a Mac. */
function computerName(os: NodeJS.Platform): string {
  if (os === "darwin") return "Mac";
  return os === "win32" ? "PC" : "computer";
}

/** "Step 2 of 7 · Checking this computer" */
export function stepHeading(step: Step): string {
  return `Step ${step} of 7 · ${STEP_TITLES[step]}`;
}

/**
 * The question at the pause before `step`, to which the prompter adds ": ". Where voicecap can't
 * audit yet, step 4 needs no hands off.
 */
export function pauseBefore(step: Exclude<Step, 1>, canAudit: boolean): string {
  const what: Record<Exclude<Step, 1>, string> = {
    2: "checking this computer",
    3: `the ${LIVE_TEST_SECONDS}-second live test`,
    4: canAudit
      ? `auditing the demo site, hands off for about ${AUDIT_MINUTES} minutes`
      : "auditing the demo site",
    5: "the transcripts",
    6: "the report",
    7: "your own site",
  };
  return `Press Enter for step ${step} (${what[step]}), or Ctrl+C to stop here`;
}

const WHAT_VOICECAP_DOES =
  "voicecap drives a real screen reader through a website's pages and saves what it says, so you can hear what a screen reader user hears. This tour runs it against a small demo site on this computer";

/**
 * Step 1. Where voicecap can't audit yet but has a screen reader to check (a Mac, for now), it
 * says up front that a Windows PC runs the full tour.
 */
export function welcome(options: {
  screenReader: string | null;
  canAudit: boolean;
  os: NodeJS.Platform;
}): string {
  const { screenReader, canAudit } = options;
  if (canAudit && screenReader !== null) {
    return paragraph(
      `${WHAT_VOICECAP_DOES}, using ${screenReader}. It takes about ${TOUR_MINUTES} minutes. In step 4, ${screenReader} speaks and takes over the keyboard for about ${AUDIT_MINUTES} minutes.`,
    );
  }
  const intro = paragraph(`${WHAT_VOICECAP_DOES}.`);
  if (screenReader === null) return intro;
  const name = computerName(options.os);
  const forNow = paragraph(
    `For now, a Windows PC runs the full tour. On this ${name}, the tour checks the ${name} and runs the ${screenReader} live test (steps 1–3). The audit, the transcripts, and the report (steps 4–6) come with voicecap's ${screenReader} driver, in a later release.`,
  );
  return `${intro}\n\n${forNow}`;
}

/** Step 2's words before the preflight. */
export const CHECKING_INTRO = paragraph(
  "Before voicecap touches a screen reader, it checks this computer can run one. On its own, that's: npx @icjia/voicecap preflight",
);

/**
 * The tour's own line in step 2's checks, after the platform's own: where the preflight can pass
 * but voicecap can't run the screen reader yet (a Mac, for now). A WARN, so it never makes the
 * computer "not ready".
 */
export function demoFlagCheck(os: NodeJS.Platform): Check {
  return {
    id: "demo",
    status: "WARN",
    summary: `The full demo runs on a Windows PC for now: on this ${computerName(os)}, the tour stops after the live test`,
  };
}

/** The command step 4 runs, as someone would type it. */
export function demoCommand(origin: string): string {
  return `npx @icjia/voicecap --site ${origin} --sitemap ${DEMO_SITEMAP} --out ${DEMO_OUT} --fresh`;
}

/** Step 4's words, before the run's own lines. */
export function auditIntro(origin: string, screenReader: string): string {
  return [
    `The demo site is running at ${origin}. voicecap is now running:`,
    `  ${demoCommand(origin)}`,
    "On its own, that command works only while the demo site is running.",
    paragraph("The tour uses voicecap's own settings, not a voicecap.config file in this folder."),
    paragraph(
      `For about ${AUDIT_MINUTES} minutes, ${screenReader} speaks and takes over the keyboard: keep your hands off. To stop early, click this terminal window first, then press Ctrl+C.`,
    ),
  ].join("\n");
}

/**
 * Step 4, the moment the audit is stopped (Ctrl+C, or a closed window): the run's shutdown can
 * take a minute, with nothing else said until it's done.
 */
export function stoppingAudit(screenReader: string): string {
  return paragraph(
    `Stopping: shutting down ${screenReader} and the browser. This can take a minute.`,
  );
}

/** Step 4 where voicecap can't run the screen reader yet: what the step does on a Windows PC. */
export function cannotAuditYet(screenReader: string | null): string {
  const name = screenReader ?? "this screen reader";
  return [
    paragraph(`voicecap can't run ${name} yet: that comes with its ${name} driver.`),
    paragraph(
      "On a Windows PC, npx @icjia/voicecap demo runs this step and the next two: NVDA reads the seven demo pages, voicecap saves the transcripts, and builds the report.",
    ),
  ].join("\n");
}

/** Step 5's words. `runFolder` is the run's folder, relative to the current one, with "/". */
export function transcriptsIntro(runFolder: string, screenReader: string): string {
  return paragraph(
    `Saved in ${runFolder}/pages/, one folder per page, each with read.txt, headings.txt, and tab.txt: what ${screenReader} said in each pass.`,
  );
}

/**
 * Step 5's excerpt: the first lines of the home page's read.txt after its header, or null when
 * there's none to show (the home page failed, say).
 */
export function homeExcerpt(screenReader: string, lines: string[] | null): string {
  if (lines === null || lines.length === 0) {
    return "There's no read.txt for the home page to show here.";
  }
  const first = lines.length === 1 ? "the first line" : `the first ${lines.length} lines`;
  const shown = [
    `What ${screenReader} said on the home page (read.txt, ${first} after its header):`,
    ...lines.map((line) => `  ${line}`),
  ];
  if (lines.some((line) => line.startsWith("[to "))) {
    shown.push(
      paragraph(
        "The lines marked [to bottom] and [to top] are voicecap finding the page's last and first lines. Then it reads down, a line at a time.",
      ),
    );
  }
  return shown.join("\n");
}

/** The paths of the pages that failed. */
function failedPaths(pages: readonly PageRecord[]): string[] {
  return pages.filter((page) => page.status === "failed").map((page) => displayPath(page.url));
}

/** Step 5's note on the pages that failed, or null when none did. */
export function failedInTranscripts(pages: readonly PageRecord[]): string | null {
  const failed = failedPaths(pages);
  if (failed.length === 0) return null;
  const one = failed.length === 1;
  return paragraph(
    `${failed.length} ${one ? "page" : "pages"} failed, so ${one ? "its folder" : "their folders"} may be missing transcripts: ${failed.join(", ")}.`,
  );
}

/** Step 6's note on the pages that failed, or null when none did. */
export function failedInReport(pages: readonly PageRecord[]): string | null {
  const failed = failedPaths(pages);
  if (failed.length === 0) return null;
  const count = failed.length === 1 ? "1 page" : `${failed.length} pages`;
  return paragraph(`The report shows why ${count} failed: ${failed.join(", ")}.`);
}

/** Step 6's words. `reportFile` is relative to the current folder, with "/". */
export function reportIntro(reportFile: string): string {
  return paragraph(
    `${reportFile} shows every page, what each pass captured, and flags that point to pages worth a closer listen.`,
  );
}

/**
 * Step 6's flags: for each flagged page, how many of voicecap's rules flagged it, and which, in
 * the order the report lists them; then whether the other pages that finished had none.
 */
export function flagsSummary(pages: readonly PageRecord[]): string {
  const done = pages.filter((page) => page.status === "done");
  const flagged = done
    .filter((page) => page.flags.length > 0)
    .map((page) => {
      const rules = [...new Set(page.flags.map((flag) => flag.rule))];
      return `${rules.length} on ${displayPath(page.url)} (${rules.join(", ")})`;
    });
  if (flagged.length === 0) return "Flags: none.";
  const others = done.length - flagged.length;
  const none = others === 0 ? "" : `, none on the other ${others === 1 ? "page" : "pages"}`;
  return paragraph(`Flags: ${flagged.join(", ")}${none}.`);
}

/**
 * Step 6, when the report couldn't be opened. `reportFile` is its whole path, in this computer's
 * own form, to paste into a browser: on one line, so it can be copied whole.
 */
export function couldNotOpen(reportFile: string): string {
  return `Couldn't open it. Open ${reportFile} in your browser.`;
}

/** Step 7: what to do next. */
export function ownSite(options: {
  screenReader: string | null;
  canAudit: boolean;
  os: NodeJS.Platform;
}): string {
  const screenReader = options.screenReader ?? "the screen reader";
  if (options.canAudit) {
    return [
      "To set up a run on your own site: npx @icjia/voicecap init",
      paragraph(
        `Tips: turn on Do Not Disturb, so notifications don't interrupt ${screenReader}. To stop a run, click the terminal window first (the browser is in front), then press Ctrl+C.`,
      ),
      `The demo's files are in ${DEMO_OUT}/. They're safe to delete.`,
    ].join("\n");
  }
  const name = computerName(options.os);
  return [
    `To keep this ${name} ready for ${screenReader}: npx @icjia/voicecap setup`,
    "To check it again: npx @icjia/voicecap doctor",
    "To set up a run on your own site: npx @icjia/voicecap init",
    `On this ${name}, init composes the command for you to run on a Windows PC.`,
  ].join("\n");
}
