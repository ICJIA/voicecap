/**
 * Runs voicecap with real NVDA against the fixture site and checks what Phase B has to verify
 * end to end. Windows only, after `voicecap setup`.
 *
 *   pnpm test:nvda          run and check; the fixture is left alone
 *   pnpm fixture:capture    run, check, and (if the checks pass) replace fixture/replay-run,
 *                           fixture/reviews.json, and fixture/manual/speech-viewer.txt
 *
 * The checks:
 * - every read pass ends at the end of the page, including the page with duplicate lines;
 * - every headings pass ends on "no next heading";
 * - the home and duplicates tab passes start at the skip link and end by leaving the page;
 * - complete capture: NVDA's Speech Viewer shows the same speech as the home page's read pass.
 *
 * NVDA speaks and browser windows come and go for about 5 minutes: nobody may use the computer.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveConfig } from "../src/config/load.js";
import { createGuidepupNvdaDriver } from "../src/drivers/guidepup-nvda.js";
import type { PassName, RunJson, TranscriptJson } from "../src/model.js";
import { runAudit } from "../src/run/audit.js";
import { readRunJson } from "../src/run/store.js";
import { handleInterrupts } from "../src/run/signals.js";
import { createConsoleLogger, type Logger } from "../src/util/log.js";
import { REPLAY_RUN_DIR, SPEECH_VIEWER_FILE, writeFixtureReviews } from "./fixture-reviews.js";
import { FIXTURE_HOST, FIXTURE_PORT, startFixtureServer } from "./serve-fixture.js";
import { comparableStep, readSpeechViewer, speechViewerLines } from "./speech-viewer.js";

const SITE = `http://${FIXTURE_HOST}:${FIXTURE_PORT}`;
const EXPECTED_STOP: Record<PassName, string> = {
  read: "end-reached",
  headings: "no-next-heading",
  tab: "left-document",
};

interface Outcome {
  failures: string[];
  notes: string[];
}

async function main(): Promise<number> {
  const write = process.argv.includes("--write");
  const logger = createConsoleLogger();
  if (process.platform !== "win32") {
    logger.error("This needs Windows with NVDA installed (voicecap setup).");
    return 2;
  }
  const server = await startFixtureServer({ port: FIXTURE_PORT }).catch(
    async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EADDRINUSE") throw error;
      // Already served (pnpm fixture:serve): use that server, if it's the fixture.
      const home = await fetch(`${SITE}/`).then((response) => response.text());
      if (!home.includes("Voicecap Test Agency")) {
        throw new Error(`Port ${FIXTURE_PORT} is in use by something that isn't the fixture.`);
      }
      return null;
    },
  );
  const work = await mkdtemp(path.join(os.tmpdir(), "voicecap-capture-"));
  const config = resolveConfig({});
  const outcome: Outcome = { failures: [], notes: [] };
  const controller = new AbortController();
  const unhook = handleInterrupts(controller, logger);
  try {
    // --from <run folder> checks a run made earlier instead of making a new one.
    const from = argumentAfter("--from");
    logger.alert(
      `NVDA speaks and browser windows come and go for about ${from ? "a minute" : "5 minutes"}. Don't use the keyboard or mouse until this finishes.`,
    );
    let runDir: string;
    if (from) {
      runDir = path.resolve(from);
    } else {
      const started = Date.now();
      const result = await runAudit({
        site: SITE,
        sitemap: `${SITE}/sitemap.xml`,
        runName: "real-nvda",
        cwd: work,
        config: { config, file: null, sha256: "default" },
        logger,
        signal: controller.signal,
      });
      runDir = path.join(work, "transcripts", "runs", result.runId);
      if (result.exitCode !== 0) {
        outcome.failures.push(`the run ended with exit code ${result.exitCode}`);
      }
      outcome.notes.push(`Run ${result.runId}: ${Math.round((Date.now() - started) / 1000)} s`);
    }
    const run = await readRunJson(path.dirname(path.dirname(runDir)), path.basename(runDir));
    await checkRun(run, runDir, outcome);

    const home = await transcript(run, runDir, `${SITE}/`, "read");
    const viewer = home ? await captureSpeechViewer(home, config, logger) : null;
    if (home && viewer) checkSpeechViewer(home, viewer, outcome);

    report(logger, outcome);
    if (outcome.failures.length > 0) {
      logger.info(`The run is kept for inspection in ${runDir}`);
      return 1;
    }
    if (write && viewer) {
      await rm(REPLAY_RUN_DIR, { recursive: true, force: true });
      await cp(runDir, REPLAY_RUN_DIR, { recursive: true });
      await writeFile(SPEECH_VIEWER_FILE, viewer);
      await writeFixtureReviews();
      logger.info(
        `Replaced fixture/replay-run with ${run.id}, and rewrote fixture/reviews.json and fixture/manual/speech-viewer.txt. Review the changes with git diff.`,
      );
    }
    await rm(work, { recursive: true, force: true, maxRetries: 5 });
    return 0;
  } finally {
    unhook();
    await server?.close();
  }
}

function argumentAfter(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

async function transcript(
  run: RunJson,
  runDir: string,
  url: string,
  pass: PassName,
): Promise<TranscriptJson | null> {
  const page = run.pages.find((candidate) => candidate.url === url && candidate.status === "done");
  if (!page) return null;
  return JSON.parse(
    await readFile(path.join(runDir, "pages", page.slug, `${pass}.json`), "utf8"),
  ) as TranscriptJson;
}

async function checkRun(run: RunJson, runDir: string, outcome: Outcome): Promise<void> {
  const done = run.pages.filter((page) => page.status === "done");
  if (done.length !== 3) {
    outcome.failures.push(`expected 3 transcribed pages, got ${done.length}`);
  }
  for (const page of done) {
    for (const pass of ["read", "headings", "tab"] as const) {
      const stop = page.passes[pass]?.stopReason;
      if (stop !== EXPECTED_STOP[pass]) {
        outcome.failures.push(
          `${page.slug} ${pass}: stopped on ${stop ?? "nothing"}, not ${EXPECTED_STOP[pass]}`,
        );
      }
    }
  }

  const duplicates = await transcript(run, runDir, `${SITE}/duplicates/`, "read");
  if (duplicates) {
    const lines = duplicates.steps.map((step) => step.spoken);
    const pair = lines.some(
      (line, i) => line === "Applications are due October 31." && lines[i + 1] === line,
    );
    if (!pair) outcome.failures.push("duplicates read: the two identical lines aren't there");
    const last = lines.at(-1) ?? "";
    if (lines.slice(-3).some((line) => line !== last)) {
      outcome.failures.push("duplicates read: doesn't end with the last line repeated");
    }
    if (!lines.slice(2, -4).includes(last)) {
      outcome.failures.push("duplicates read: the last line doesn't also appear earlier");
    }
  }

  for (const url of [`${SITE}/`, `${SITE}/duplicates/`]) {
    const tab = await transcript(run, runDir, url, "tab");
    const first = tab?.steps[0]?.focused;
    if (!tab || first?.href !== "#main" || !/skip/i.test(first.name)) {
      outcome.failures.push(
        `${url} tab: the first stop isn't the skip link (${JSON.stringify(first)})`,
      );
    }
    if (tab && tab.steps.at(-1)?.inDocument !== false) {
      outcome.failures.push(`${url} tab: doesn't end with focus leaving the page`);
    }
  }

  const flawed = run.pages.find((page) => page.url === `${SITE}/flawed/`);
  const flags = flawed?.flags.map((flag) => flag.rule).sort() ?? [];
  outcome.notes.push(`Flawed page flags: ${flags.join(", ") || "none"}`);
  const home = run.pages.find((page) => page.url === `${SITE}/`);
  outcome.notes.push(
    `Home page flags: ${home?.flags.map((flag) => flag.rule).join(", ") || "none"}`,
  );
}

/**
 * Read the home page again with Speech Viewer open, from Ctrl+Home through the first Down Arrow
 * on the last line (the read pass's steps without Ctrl+End and the core's two extra repeats),
 * and return the Speech Viewer text of just those steps, with Windows line endings.
 */
async function captureSpeechViewer(
  read: TranscriptJson,
  config: ReturnType<typeof resolveConfig>,
  logger: Logger,
): Promise<string> {
  const steps = read.steps.length - 3;
  const driver = createGuidepupNvdaDriver({ config, logger });
  await driver.start();
  try {
    await driver.openPage(`${SITE}/`);
    const before = await readSpeechViewer();
    await driver.toTop();
    for (let i = 1; i < steps; i++) await driver.nextLine();
    const after = await readSpeechViewer();
    if (!after.startsWith(before)) throw new Error("The Speech Viewer text changed unexpectedly.");
    return after
      .slice(before.length)
      .split(/\r\n|\r|\n/)
      .filter((line) => line !== "")
      .map((line) => `${line}\r\n`)
      .join("");
  } finally {
    await driver.stop();
  }
}

function checkSpeechViewer(read: TranscriptJson, viewer: string, outcome: Outcome): void {
  const expected = read.steps.slice(1, -2).map((step) => comparableStep(step.spoken));
  const seen = speechViewerLines(viewer);
  if (JSON.stringify(seen) !== JSON.stringify(expected)) {
    outcome.failures.push(
      `Speech Viewer and the home read pass differ:\n  Speech Viewer: ${JSON.stringify(seen)}\n  transcript:    ${JSON.stringify(expected)}`,
    );
  } else {
    outcome.notes.push(`Speech Viewer matches the home read pass (${seen.length} lines)`);
  }
}

function report(logger: Logger, outcome: Outcome): void {
  for (const note of outcome.notes) logger.info(note);
  if (outcome.failures.length === 0) {
    logger.info(
      "All checks passed: end of page, no next heading, skip link first, complete capture.",
    );
  } else {
    for (const failure of outcome.failures) logger.error(failure);
  }
}

process.exitCode = await main();
