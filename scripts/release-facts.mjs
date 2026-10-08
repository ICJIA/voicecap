/**
 * Records a release's facts in the package, in dist/release-facts.json, which the website's "Can I
 * trust this?" page reads, so that every number it states about voicecap is generated and none is
 * typed by hand. publish.sh runs it after the tests have passed and the build is done:
 *
 *   node scripts/release-facts.mjs <vitest-report.json> [out]     # out: dist/release-facts.json
 *
 * The facts come from three places, and the file holds nothing else:
 *
 *   - the tests: the counts in the JSON report of the publishing computer's own run of every test,
 *     and that computer's system. The report is written outside dist (the build empties it first);
 *   - the public changes: git's count of the commits behind HEAD, and the date of the first;
 *   - CI: the systems and the Node versions in the matrix of .github/workflows/ci.yml.
 *
 * A run that failed, was cut short, or ran no tests is refused: nothing is written, and the
 * command exits 1 and says why, so a failed run's counts never ship. Plain Node, with no
 * dependencies and no shell (git runs through execFileSync, and CI's matrix is read with regular
 * expressions), so publish.sh needs nothing more to run it. scripts/release-facts.d.mts types it
 * for the tests.
 */
import { execFileSync } from "node:child_process";
import console from "node:console";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

// console, process, and URL are imported though Node has them as globals: eslint.config.js gives a
// plain .mjs file none of Node's (scripts/copy-fonts.mjs imports URL for the same reason).

/** The repository this script is in. */
const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** Where the facts go, from there, unless a path is given. */
const DEFAULT_OUT = "dist/release-facts.json";

/** The systems voicecap's tests run on, by their `process.platform`, and what each is called. */
const PLATFORMS = new Map([
  ["win32", "Windows"],
  ["darwin", "macOS"],
  ["linux", "Linux"],
]);

/** The runners CI's matrix may name, as `<name>-latest`, and what each system is called. */
const RUNNERS = new Map([
  ["ubuntu", "Ubuntu"],
  ["macos", "macOS"],
  ["windows", "Windows"],
]);

/**
 * The counts of a Vitest report that must be whole numbers of 0 or more, if the facts made from it
 * are to be sound.
 */
const COUNTS = [
  "numTotalTests",
  "numPassedTests",
  "numFailedTests",
  "numPendingTests",
  "numTodoTests",
];

/** The name of the system `platform` (a `process.platform`) is: Windows, macOS, or Linux. */
export function systemName(platform) {
  return PLATFORMS.get(platform) ?? platform;
}

/**
 * The counts of a run from `report`, a Vitest 5 JSON report once parsed: the tests that passed,
 * the ones skipped (pending, and todo), and the files that ran. A run that has a test that failed,
 * did not succeed (a file that would not load fails it without failing a test), or has no tests in
 * it is refused with an error that says why, and so is anything that is not a report.
 */
export function testsOf(report) {
  if (report === null || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("This is not a Vitest JSON report: it is not an object.");
  }
  const failed = report.numFailedTests;
  if (typeof failed === "number" && failed > 0) {
    const tests = failed === 1 ? "test" : "tests";
    throw new Error(
      `${failed} ${tests} failed, so the run's counts are not recorded: ` +
        "a release's facts come from a run that passed.",
    );
  }
  if (report.success !== true) {
    throw new Error(
      `The run did not succeed (the report says "success" is ${JSON.stringify(report.success)}): ` +
        "a test file may not have loaded, or the run may have been cut short. " +
        "A release's facts come from a run that passed.",
    );
  }
  if (report.numTotalTests === 0) {
    throw new Error("The run has no tests in it, so there are no counts to record.");
  }
  for (const name of COUNTS) {
    const value = report[name];
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(
        `This is not a Vitest JSON report: its "${name}" is ${JSON.stringify(value)}, ` +
          "not a whole number of 0 or more.",
      );
    }
  }
  if (!Array.isArray(report.testResults)) {
    throw new Error('This is not a Vitest JSON report: its "testResults" is not a list.');
  }
  return {
    passed: report.numPassedTests,
    skipped: report.numPendingTests + report.numTodoTests,
    files: report.testResults.length,
  };
}

/**
 * The items of the `key: [a, b, c]` list in `workflow`, the text of a GitHub Actions workflow: the
 * first line that is such a list, with the quotes taken off the items. Only a list written in
 * brackets on one line is read, and a key that merely begins with `key` (node-version) is not it.
 * Throws when there is no such list, or when it holds nothing.
 */
function matrixList(workflow, key) {
  const found = new RegExp(`^[ \\t]*${key}:[ \\t]*\\[([^\\]\\n]*)\\]`, "m").exec(workflow);
  const items =
    found === null
      ? []
      : found[1]
          .split(",")
          .map((item) => item.trim().replace(/^(["'])(.*)\1$/, "$2"))
          .filter((item) => item !== "");
  if (items.length === 0) {
    throw new Error(
      `The workflow's matrix has no "${key}: [...]" list with anything in it. ` +
        "Only a list written in brackets, on one line, is read.",
    );
  }
  return items;
}

/**
 * Where CI runs, from `workflow`, the text of .github/workflows/ci.yml: the matrix's `os` list as
 * the systems' names (ubuntu-latest is Ubuntu, macos-latest macOS, windows-latest Windows), and its
 * `node` list as the versions it names, as the text of each. Throws when either list is not there,
 * or when an `os` entry is not one of the three.
 */
export function ciOf(workflow) {
  const runners = matrixList(workflow, "os");
  const node = matrixList(workflow, "node");
  const systems = runners.map((runner) => {
    const system = RUNNERS.get(/^([a-z]+)-latest$/.exec(runner)?.[1] ?? "");
    if (system === undefined) {
      throw new Error(
        `The workflow's os list has "${runner}", which is none of ubuntu-latest, macos-latest, ` +
          "and windows-latest.",
      );
    }
    return system;
  });
  return { systems, node };
}

/** Runs git in `cwd`, with no shell, and gives what it printed. A failure carries what git said. */
function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

/**
 * The commits behind HEAD in the repository at `cwd`: how many, and the date of the first. A
 * history with more than one root (one that took in another) is dated by the earliest.
 */
function commitsOf(cwd) {
  const count = Number.parseInt(git(cwd, ["rev-list", "--count", "HEAD"]).trim(), 10);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("Git did not give a count of the commits behind HEAD.");
  }
  const roots = git(cwd, ["log", "--max-parents=0", "--format=%cs"])
    .split(/\r?\n/)
    .filter((line) => line !== "");
  const bad = roots.find((line) => !/^\d{4}-\d{2}-\d{2}$/.test(line));
  if (roots.length === 0 || bad !== undefined) {
    const gave = JSON.stringify(bad ?? "");
    throw new Error(`Git gave ${gave} for the date of the first commit, not YYYY-MM-DD.`);
  }
  // Dates written year first sort as dates do.
  return { count, first: roots.sort()[0] };
}

/** The JSON in the file at `file`. */
async function readReport(file) {
  const text = await readFile(file, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(`${file} isn't JSON (${why}), so it isn't a Vitest JSON report.`, {
      cause: error,
    });
  }
}

/**
 * Writes the facts of the release to `out` (its folder is made when it isn't there), and gives
 * them: the counts of the run in the Vitest JSON report at `report`, the commits behind HEAD in
 * the repository at `cwd`, and the matrix of the workflow at `workflow`. `platform` is the
 * `process.platform` the tests ran on. Everything is read and checked before anything is written,
 * so a run that failed, a report that is not there, or a repository git cannot read writes nothing.
 */
export async function writeReleaseFacts({ report, workflow, out, cwd, platform }) {
  const tests = testsOf(await readReport(report));
  const ci = ciOf(await readFile(workflow, "utf8"));
  const facts = {
    schema: 1,
    tests: { ...tests, system: systemName(platform) },
    commits: commitsOf(cwd),
    ci,
  };
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(facts, null, 2) + "\n");
  return facts;
}

async function main() {
  const [report, out] = process.argv.slice(2);
  if (report === undefined) {
    console.error("Usage: node scripts/release-facts.mjs <vitest-report.json> [out]");
    process.exit(2);
  }
  const facts = await writeReleaseFacts({
    report: path.resolve(report),
    workflow: path.join(ROOT, ".github", "workflows", "ci.yml"),
    out: out === undefined ? path.join(ROOT, DEFAULT_OUT) : path.resolve(out),
    cwd: ROOT,
    platform: process.platform,
  });
  const passed = facts.tests.passed.toLocaleString("en-US");
  const where = out ?? DEFAULT_OUT;
  console.log(
    `Recorded the release's facts in ${where}: ${passed} tests passed on ${facts.tests.system}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
