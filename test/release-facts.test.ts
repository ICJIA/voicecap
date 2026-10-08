/**
 * The script that records a release's facts (scripts/release-facts.mjs): the counts of the
 * release's own run of the tests, the commits behind it, and CI's matrix, in
 * dist/release-facts.json. A run that failed or ran nothing is refused, so no failed run's counts
 * ever ship. The git tests make a repository of their own in a temporary folder, with fixed dates,
 * and take it away at the end. The command's tests run the script with Node, as publish.sh does,
 * and write only into temporary folders.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { ciOf, systemName, testsOf, writeReleaseFacts } from "../scripts/release-facts.mjs";

const REPOSITORY = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = path.join(REPOSITORY, "scripts", "release-facts.mjs");
const CI_WORKFLOW = path.join(REPOSITORY, ".github", "workflows", "ci.yml");

/** A parsed Vitest 5 JSON report of a passing run, with the fields the script reads. */
const PASSING = {
  success: true,
  numTotalTests: 5014,
  numPassedTests: 5012,
  numFailedTests: 0,
  numPendingTests: 2,
  numTodoTests: 0,
  testResults: Array<unknown>(125),
};

/** What the repository's own workflow says CI runs on. */
const CI = { systems: ["Ubuntu", "macOS", "Windows"], node: ["22", "24"] };

/** The facts a passing run on a Mac gives, in a history of two commits, as the file holds them. */
const MACOS_FACTS = {
  schema: 1,
  tests: { passed: 5012, skipped: 2, files: 125, system: "macOS" },
  commits: { count: 2, first: "2026-09-26" },
  ci: CI,
};

const gitAvailable = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
})();
/** A checkout, where the command reads its commits: .git is a folder, or a worktree's file. */
const inCheckout = gitAvailable && existsSync(path.join(REPOSITORY, ".git"));

/** Each folder made here, to remove at the end. */
const folders: string[] = [];

async function newFolder(): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), "voicecap-release-facts-"));
  folders.push(folder);
  return folder;
}

afterAll(async () => {
  for (const folder of folders) await rm(folder, { recursive: true, force: true });
});

/**
 * Runs git in `cwd`, with no shell, and gives what it printed. It's given an author and a
 * committer, since a CI computer has none, and, with `at`, the time of the commit it makes.
 */
function git(cwd: string, args: string[], at?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "voicecap test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "voicecap test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      ...(at === undefined ? {} : { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at }),
    },
  });
}

/**
 * Whether this checkout is a shallow clone, which has only part of the history, as CI's checkout
 * has unless it fetches all of it: the command refuses to count the commits behind it.
 */
const shallowCheckout =
  inCheckout && git(REPOSITORY, ["rev-parse", "--is-shallow-repository"]).trim() === "true";

describe("testsOf", () => {
  it("reads a passing run's counts", () => {
    expect(testsOf(PASSING)).toEqual({ passed: 5012, skipped: 2, files: 125 });
  });

  it("counts a test that's only planned (todo) with the ones skipped", () => {
    const report = { ...PASSING, numTotalTests: 5017, numPendingTests: 2, numTodoTests: 3 };
    expect(testsOf(report)).toEqual({ passed: 5012, skipped: 5, files: 125 });
  });

  it("refuses a run that failed or ran nothing", () => {
    expect(() => testsOf({ ...PASSING, success: false })).toThrow(/did not succeed/);
    expect(() => testsOf({ ...PASSING, numFailedTests: 1 })).toThrow(/1 test failed/);
    expect(() => testsOf({ ...PASSING, numFailedTests: 3 })).toThrow(/3 tests failed/);
    const nothing = { ...PASSING, numTotalTests: 0, numPassedTests: 0, numPendingTests: 0 };
    expect(() => testsOf(nothing)).toThrow(/no tests/);
  });

  it("refuses what isn't a Vitest report, rather than write a count it can't trust", () => {
    expect(() => testsOf(null)).toThrow(/Vitest JSON report/);
    expect(() => testsOf("text")).toThrow(/Vitest JSON report/);
    expect(() => testsOf([])).toThrow(/Vitest JSON report/);
    expect(() => testsOf({ success: true })).toThrow(/Vitest JSON report/);
    expect(() => testsOf({ ...PASSING, numPassedTests: "5012" })).toThrow(/numPassedTests/);
    expect(() => testsOf({ ...PASSING, numPendingTests: 1.5 })).toThrow(/numPendingTests/);
    expect(() => testsOf({ ...PASSING, numTodoTests: -1 })).toThrow(/numTodoTests/);
    expect(() => testsOf({ ...PASSING, testResults: undefined })).toThrow(/testResults/);
  });
});

describe("ciOf", () => {
  it("reads CI's matrix from the workflow", async () => {
    expect(ciOf(await readFile(CI_WORKFLOW, "utf8"))).toEqual(CI);
  });

  it("reads a matrix however its lists are written", () => {
    const workflow = [
      "jobs:",
      "  test:",
      "    strategy:",
      "      matrix:",
      "        # os: [ubuntu-latest]",
      '        os: [ "windows-latest" ,macos-latest ]  # two of the three',
      "        node: ['20', 22.x, \"24\"]",
      "        include: []",
      "    steps:",
      "      - uses: actions/setup-node@v4",
      "        with:",
      "          node-version: ${{ matrix.node }}",
      "",
    ].join("\r\n");
    expect(ciOf(workflow)).toEqual({ systems: ["Windows", "macOS"], node: ["20", "22.x", "24"] });
  });

  it("throws when a list isn't there", () => {
    const noOs = /no "os: \[\.\.\.\]" list/;
    const noNode = /no "node: \[\.\.\.\]" list/;
    expect(() => ciOf("matrix:\n  os: [ubuntu-latest]\n")).toThrow(noNode);
    expect(() => ciOf("matrix:\n  node: [22]\n")).toThrow(noOs);
    expect(() => ciOf("")).toThrow(noOs);
    // A list with nothing in it, and a step's node-version, are no more the matrix's lists.
    expect(() => ciOf("matrix:\n  os: []\n  node: [22]\n")).toThrow(noOs);
    expect(() => ciOf("matrix:\n  os: [ubuntu-latest]\n  node-version: [22]\n")).toThrow(noNode);
    // It reads lists written in brackets, and stops at another kind rather than read half of one.
    expect(() => ciOf("matrix:\n  os:\n    - ubuntu-latest\n  node: [22]\n")).toThrow(noOs);
  });

  it("throws for a matrix with an include or an exclude, which changes the combinations its lists make", () => {
    const lists = "matrix:\n  os: [ubuntu-latest, windows-latest]\n  node: [22, 24]\n";
    // An include adds a combination, or changes one, and an exclude takes one away.
    const include = `${lists}  include:\n    - os: macos-latest\n      node: 24\n`;
    expect(() => ciOf(include)).toThrow(/"include:"/);
    const exclude = `${lists}  exclude:\n    - os: windows-latest\n      node: 22\n`;
    expect(() => ciOf(exclude)).toThrow(/"exclude:"/);
    // Written in brackets, on one line, too.
    expect(() => ciOf(`${lists}  include: [{ os: macos-latest, node: 24 }]\n`)).toThrow(
      /"include:"/,
    );
    // An empty one changes nothing, nor does one in a comment.
    const read = { systems: ["Ubuntu", "Windows"], node: ["22", "24"] };
    expect(ciOf(`${lists}  include: []\n  exclude: [ ]  # none\n`)).toEqual(read);
    expect(ciOf(`${lists}  # exclude:\n  #   - os: windows-latest\n`)).toEqual(read);
  });

  it("throws for a system that isn't ubuntu, macos, or windows", () => {
    const mixed = "matrix:\n  os: [ubuntu-latest, freebsd-latest]\n  node: [22]\n";
    expect(() => ciOf(mixed)).toThrow(/freebsd-latest/);
    expect(() => ciOf("matrix:\n  os: [ubuntu-22.04]\n  node: [22]\n")).toThrow(/ubuntu-22\.04/);
    // A name that every object has is no system.
    const inherited = "matrix:\n  os: [constructor-latest]\n  node: [22]\n";
    expect(() => ciOf(inherited)).toThrow(/constructor-latest/);
  });
});

describe("systemName", () => {
  it("names the system it ran on", () => {
    expect(systemName("win32")).toBe("Windows");
    expect(systemName("darwin")).toBe("macOS");
    expect(systemName("linux")).toBe("Linux");
  });

  it("gives any other platform as it is", () => {
    expect(systemName("freebsd")).toBe("freebsd");
  });
});

describe("writeReleaseFacts", () => {
  it.skipIf(!gitAvailable)("writes the facts", async () => {
    const dir = await newFolder();
    git(dir, ["init", "-q"]);
    git(dir, ["commit", "-q", "--allow-empty", "-m", "First"], "2026-09-26T10:00:00");
    git(dir, ["commit", "-q", "--allow-empty", "-m", "Second"], "2026-10-01T10:00:00");
    const report = path.join(dir, "vitest.json");
    const workflow = path.join(dir, "ci.yml");
    // Its folder isn't there yet, and the file is written all the same.
    const out = path.join(dir, "dist", "release-facts.json");
    await writeFile(report, JSON.stringify(PASSING));
    await copyFile(CI_WORKFLOW, workflow);

    const facts = await writeReleaseFacts({ report, workflow, out, cwd: dir, platform: "darwin" });

    expect(facts).toEqual(MACOS_FACTS);
    // The file is exactly the facts, in this order, indented by two spaces, and ends in a newline.
    const written = await readFile(out, "utf8");
    expect(written).toBe(JSON.stringify(MACOS_FACTS, null, 2) + "\n");
    const parsed = JSON.parse(written) as typeof MACOS_FACTS;
    expect(parsed.schema).toBe(1);
    expect(parsed.commits).toEqual({ count: 2, first: "2026-09-26" });
    expect(parsed.tests.system).toBe("macOS");
  });

  it.skipIf(!gitAvailable)("dates the first commit by the earliest of two roots", async () => {
    const dir = await newFolder();
    git(dir, ["init", "-q"]);
    git(dir, ["commit", "-q", "--allow-empty", "-m", "Newer root"], "2026-10-01T10:00:00");
    const newer = git(dir, ["rev-parse", "HEAD"]).trim();
    // A second root, older than the first, joined to it: what a history that took another in has.
    git(dir, ["checkout", "-q", "--orphan", "older"]);
    git(dir, ["commit", "-q", "--allow-empty", "-m", "Older root"], "2026-09-20T10:00:00");
    const join = [
      "merge",
      "-q",
      "--allow-unrelated-histories",
      "--no-ff",
      "-m",
      "Join them",
      newer,
    ];
    git(dir, join, "2026-10-02T10:00:00");
    const report = path.join(dir, "vitest.json");
    await writeFile(report, JSON.stringify(PASSING));

    const facts = await writeReleaseFacts({
      report,
      workflow: CI_WORKFLOW,
      out: path.join(dir, "release-facts.json"),
      cwd: dir,
      platform: "linux",
    });

    expect(facts.commits).toEqual({ count: 3, first: "2026-09-20" });
  });

  it.skipIf(!gitAvailable)(
    "refuses a shallow clone, whose commits it can't count, and writes nothing",
    async () => {
      const dir = await newFolder();
      const source = path.join(dir, "source");
      await mkdir(source);
      git(source, ["init", "-q"]);
      git(source, ["commit", "-q", "--allow-empty", "-m", "First"], "2026-09-26T10:00:00");
      git(source, ["commit", "-q", "--allow-empty", "-m", "Second"], "2026-10-01T10:00:00");
      // A clone of the newest commit alone. Git ignores --depth when it's given a folder's path, so
      // it's given the folder's file:// URL.
      const clone = path.join(dir, "clone");
      git(dir, ["clone", "-q", "--depth", "1", pathToFileURL(source).href, clone]);
      // The clone sees one commit of the two, and would count 1, from 1 October.
      expect(git(clone, ["rev-list", "--count", "HEAD"]).trim()).toBe("1");
      const report = path.join(dir, "vitest.json");
      const out = path.join(dir, "dist", "release-facts.json");
      await writeFile(report, JSON.stringify(PASSING));

      await expect(
        writeReleaseFacts({ report, workflow: CI_WORKFLOW, out, cwd: clone, platform: "win32" }),
      ).rejects.toThrow(/is a shallow clone[^\n]*git fetch --unshallow/);
      expect(existsSync(path.dirname(out))).toBe(false);
    },
  );

  it("writes nothing when the run failed", async () => {
    const dir = await newFolder();
    const report = path.join(dir, "vitest.json");
    const out = path.join(dir, "dist", "release-facts.json");
    const failing = { ...PASSING, success: false, numPassedTests: 5009, numFailedTests: 3 };
    await writeFile(report, JSON.stringify(failing));

    // The folder is no repository: a failed run is refused before git is asked anything.
    await expect(
      writeReleaseFacts({ report, workflow: CI_WORKFLOW, out, cwd: dir, platform: "win32" }),
    ).rejects.toThrow(/3 tests failed/);
    expect(existsSync(out)).toBe(false);
    expect(existsSync(path.dirname(out))).toBe(false);

    // A run that was cut short wrote no report at all.
    const missing = path.join(dir, "never-written.json");
    await expect(
      writeReleaseFacts({
        report: missing,
        workflow: CI_WORKFLOW,
        out,
        cwd: dir,
        platform: "win32",
      }),
    ).rejects.toThrow(/never-written\.json/);
    expect(existsSync(path.dirname(out))).toBe(false);
  });

  it("writes nothing for a report that isn't JSON", async () => {
    const dir = await newFolder();
    const report = path.join(dir, "vitest.json");
    const out = path.join(dir, "release-facts.json");
    await writeFile(report, '{"success": tr');

    await expect(
      writeReleaseFacts({ report, workflow: CI_WORKFLOW, out, cwd: dir, platform: "linux" }),
    ).rejects.toThrow(/isn't JSON/);
    expect(existsSync(out)).toBe(false);
  });
});

describe("the command", () => {
  it.skipIf(!inCheckout)("records the facts in one line, or refuses a shallow clone", async () => {
    const dir = await newFolder();
    const report = path.join(dir, "vitest.json");
    const out = path.join(dir, "facts", "release-facts.json");
    await writeFile(report, JSON.stringify(PASSING));

    if (shallowCheckout) {
      // A checkout of part of the history can't count the commits behind it: the command says how
      // to fetch the rest, and writes nothing.
      const run = spawnSync(process.execPath, [SCRIPT, report, out], {
        encoding: "utf8",
        windowsHide: true,
      });
      expect(run.status).toBe(1);
      expect(run.stdout).toBe("");
      expect(run.stderr).toMatch(/is a shallow clone[^\n]*git fetch --unshallow[^\n]*\n$/);
      expect(existsSync(path.dirname(out))).toBe(false);
      return;
    }
    const said = execFileSync(process.execPath, [SCRIPT, report, out], {
      encoding: "utf8",
      windowsHide: true,
    });

    const system = systemName(process.platform);
    expect(said).toBe(`Recorded the release's facts in ${out}: 5,012 tests passed on ${system}.\n`);
    // The commits are this repository's, and the matrix is its own workflow's.
    const facts = JSON.parse(await readFile(out, "utf8")) as typeof MACOS_FACTS;
    expect(facts.schema).toBe(1);
    expect(facts.tests).toEqual({ passed: 5012, skipped: 2, files: 125, system });
    expect(Number.isInteger(facts.commits.count)).toBe(true);
    expect(facts.commits.count).toBeGreaterThan(0);
    expect(facts.commits.first).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(facts.ci).toEqual(CI);
  });

  it("exits 1, says why, and writes nothing for a run that failed", async () => {
    const dir = await newFolder();
    const report = path.join(dir, "vitest.json");
    const out = path.join(dir, "facts", "release-facts.json");
    await writeFile(report, JSON.stringify({ ...PASSING, success: false, numFailedTests: 2 }));

    const run = spawnSync(process.execPath, [SCRIPT, report, out], {
      encoding: "utf8",
      windowsHide: true,
    });

    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    // The reason, in a line of its own.
    expect(run.stderr).toMatch(/^2 tests failed[^\n]*\n$/);
    expect(existsSync(path.dirname(out))).toBe(false);
  });

  it("exits 2 and says how to use it when it's given no report", () => {
    const run = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", windowsHide: true });

    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toBe("Usage: node scripts/release-facts.mjs <vitest-report.json> [out]\n");
  });
});
