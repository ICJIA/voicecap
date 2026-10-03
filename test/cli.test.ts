import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import { XMLValidator } from "fast-xml-parser";
import { describe, expect, it, vi } from "vitest";

import { main } from "../src/cli/main.js";
import { listManualSessions } from "../src/manual/list.js";
import type { ReviewsFile, RunJson, SharesFile } from "../src/model.js";
import type { PlatformReadiness } from "../src/readiness/model.js";
import type { RunAuditOptions } from "../src/run/audit.js";
import { manualSessionDir, runDir, shareDir, sharesPath } from "../src/run/paths.js";
import { longDate } from "../src/share/format.js";
import { sizeLine } from "../src/share/share.js";
import { sha256 } from "../src/util/hash.js";
import type { OutputStream } from "../src/util/log.js";
import { unzipDocx } from "./helpers/docx.js";
import { gitBashForm } from "./helpers/git-bash.js";
import { realSitesFetch } from "./helpers/real-sites.js";
import { homeWithCountedRun, MACHINE_PROBE, SITE as EXAMPLE_SITE } from "./helpers/run-site.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const fixture = (...parts: string[]) => path.join(ROOT, "fixture", ...parts);
const SITE = "http://127.0.0.1:4747";

function capture() {
  let text = "";
  return {
    stream: { write: (chunk: string) => ((text += chunk), true) },
    text: () => text,
  };
}

/**
 * A terminal's screen: a real stream, as readline's terminal mode needs, that says it's a terminal.
 * `onWrite` sees each thing written to it, as it's written.
 */
function terminalScreen(onWrite: (chunk: string) => void = () => {}) {
  let text = "";
  const stream = Object.assign(
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        const shown = chunk.toString();
        text += shown;
        onWrite(shown);
        callback();
      },
    }),
    { isTTY: true },
  );
  return { stream, text: () => text };
}

/** Extra CliContext fields only some tests need; every other call leaves these at their defaults. */
interface CliExtra {
  stdin?: NodeJS.ReadableStream;
  interactive?: boolean;
  fetch?: typeof fetch;
  platformReadiness?: () => Promise<PlatformReadiness>;
  platform?: NodeJS.Platform;
}

async function cli(
  args: string[],
  cwd?: string,
  env: NodeJS.ProcessEnv = {},
  extra: CliExtra = {},
) {
  const stdout = capture();
  const stderr = capture();
  const dir = cwd ?? (await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-")));
  const code = await main(args, {
    stdout: stdout.stream,
    stderr: stderr.stream,
    cwd: dir,
    env,
    signal: new AbortController().signal,
    interactive: false,
    ...extra,
    // Never the real platform: a test that forgets platformReadiness fails safely on Linux's
    // module instead of running the real Mac (or Windows) readiness on the owner's machine.
    platform: extra.platform ?? "linux",
  });
  return { code, out: stdout.text(), err: stderr.text(), cwd: dir };
}

/** Piped input for `init`: each line answers one question in order ("" is Enter), then it ends. */
function linesStream(lines: readonly string[] = []): PassThrough {
  const input = new PassThrough();
  input.end(lines.map((line) => `${line}\n`).join(""));
  return input;
}

/**
 * A command at a terminal: `lines` typed ahead ("" is Enter), and a real stdout stream, since
 * readline's terminal mode needs one. Linux, unless `extra` says otherwise, as in cli(), in a new
 * empty folder with an empty environment unless `extra` gives them. `run` is main, or a copy of it
 * loaded with some modules mocked.
 */
async function atTerminal(
  args: string[],
  lines: readonly string[],
  extra: CliExtra & { cwd?: string; env?: NodeJS.ProcessEnv } = {},
  run: typeof main = main,
) {
  const stdin = Object.assign(new PassThrough(), { isTTY: true });
  let screen = "";
  const stdout = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      screen += chunk.toString();
      callback();
    },
  });
  const cwd = extra.cwd ?? (await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-")));
  stdin.write(lines.map((line) => `${line}\n`).join(""));
  try {
    const code = await run(args, {
      stdout,
      stderr: capture().stream,
      env: {},
      signal: new AbortController().signal,
      interactive: false,
      stdin,
      ...extra,
      cwd,
      platform: extra.platform ?? "linux",
    });
    return { code, out: screen, cwd };
  } finally {
    stdin.end();
  }
}

/** `init` at a terminal, as atTerminal. */
function initAtTerminal(lines: readonly string[], extra: CliExtra = {}) {
  return atTerminal(["init"], lines, extra);
}

/** A default home with one site's folder in it, from a replay run. Returns the folder it's in. */
async function oneSiteHome(): Promise<string> {
  const run = await cli([
    "--site",
    SITE,
    "--pages",
    fixture("pages.json"),
    "--replay-from",
    fixture("replay-run"),
  ]);
  expect(run.code).toBe(0);
  return run.cwd;
}

/** Every file and folder under `dir`, relative to it, sorted. */
async function contents(dir: string): Promise<string[]> {
  return (await readdir(dir, { recursive: true })).sort();
}

/** A computer that isn't ready: one quick check FAILs, with its problem. */
const NOT_READY: PlatformReadiness = {
  screenReader: "NVDA",
  cannotRunYet: null,
  readyTip: null,
  liveTestNotice: [],
  checkingNotice: [],
  liveTest: null,
  machineInfo: () => Promise.resolve({ lines: [], screenReader: "NVDA", system: "Fake OS" }),
  quickChecks: () => [
    {
      id: "quick",
      run: () =>
        Promise.resolve({
          id: "quick",
          status: "FAIL",
          summary: "Quick check is broken",
          problem: {
            title: "Something's wrong",
            whatsWrong: "It's broken.",
            fix: ["Fix it."],
            setupHelps: false,
          },
        }),
    },
  ],
};

/** A computer that's ready to run, with nothing to walk through and no live test unless overridden. */
function readyPlatform(overrides: Partial<PlatformReadiness> = {}): PlatformReadiness {
  return {
    screenReader: "NVDA",
    cannotRunYet: null,
    readyTip: null,
    liveTestNotice: [],
    checkingNotice: [],
    liveTest: null,
    machineInfo: () => Promise.resolve({ lines: [], screenReader: "NVDA", system: "Fake OS" }),
    quickChecks: () => [],
    ...overrides,
  };
}
const READY = readyPlatform();

describe("usage errors (exit 1)", () => {
  it("prints help and the version with exit 0", async () => {
    const help = await cli(["--help"]);
    expect(help.code).toBe(0);
    expect(help.out).toContain("--replay-from");
    expect(help.out).toContain("Exit codes:");
    const version = await cli(["--version"]);
    expect(version.code).toBe(0);
    expect(version.out.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("requires --site and exactly one of --sitemap / --pages", async () => {
    expect((await cli([])).err).toContain("Missing --site");
    const neither = await cli(["--site", SITE]);
    expect(neither.code).toBe(1);
    expect(neither.err).toContain("Give a page source");
    const both = await cli([
      "--site",
      SITE,
      "--sitemap",
      `${SITE}/sitemap.xml`,
      "--pages",
      "p.csv",
    ]);
    expect(both.code).toBe(1);
    expect(both.err).toContain("one kind of page source");
  });

  it("rejects bad numbers, passes, and unknown options", async () => {
    expect((await cli(["--site", SITE, "--pages", "p.json", "--limit", "0"])).code).toBe(1);
    const passes = await cli(["--site", SITE, "--pages", "p.json", "--passes", "read,sing"]);
    expect(passes.code).toBe(1);
    expect(passes.err).toContain("--passes");
    expect((await cli(["--site", SITE, "--bogus"])).code).toBe(1);
    const status = await cli(["review", "--page", `${SITE}/`, "--status", "great"]);
    expect(status.code).toBe(1);
    expect(status.err).toMatch(/Allowed choices are unreviewed, reviewed, issue, fixed/);
  });

  it("explains arguments that Git Bash rewrote into Windows paths", async () => {
    const page = await cli([
      "review",
      "--page",
      "C:/Program Files/Git/about",
      "--status",
      "reviewed",
    ]);
    expect(page.code).toBe(1);
    expect(page.err).toContain("Git Bash rewrote it");
    expect(page.err).toContain("MSYS_NO_PATHCONV=1");
    const pattern = await cli([
      "--site",
      SITE,
      "--pages",
      "p.json",
      "--include",
      "C:/Program Files/Git/news/*",
    ]);
    expect(pattern.code).toBe(1);
    expect(pattern.err).toContain("--include");
  });

  // setup's Mac and Windows paths download files and change VoiceOver's settings, so no CLI test
  // goes near them: test/setup-mac.test.ts and test/setup.test.ts cover them with fakes. This one
  // proves main.ts's wiring on every platform, with Linux and a fake platform injected, and with
  // both setup modules replaced by ones that refuse to run, in case the platform isn't honored.
  it("setup prints the preflight and exits 2 where there's no screen reader to set up", async () => {
    const refuse = () => {
      throw new Error("A test must never run the real setup.");
    };
    vi.resetModules();
    vi.doMock("../src/drivers/voiceover/setup-mac.js", () => ({
      realMacSetupDeps: refuse,
      runMacSetup: refuse,
    }));
    vi.doMock("../src/drivers/guidepup/setup.js", () => ({
      realSetupDeps: refuse,
      runSetup: refuse,
    }));
    try {
      const { main: mainWithoutSetup } = await import("../src/cli/main.js");
      const stdout = capture();
      const stderr = capture();
      const code = await mainWithoutSetup(["setup"], {
        stdout: stdout.stream,
        stderr: stderr.stream,
        cwd: await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-")),
        env: {},
        signal: new AbortController().signal,
        interactive: false,
        stdin: linesStream(),
        platform: "linux",
        platformReadiness: () => Promise.resolve(NOT_READY),
      });

      expect(stderr.text()).toBe("");
      expect(code).toBe(2);
      expect(stdout.text()).toMatch(/^voicecap preflight, \d{4}-\d{2}-\d{2} \d{2}:\d{2}\n/);
      expect(stdout.text()).toContain("  FAIL  Quick check is broken");
      expect(stdout.text()).toContain("Not ready: 1 problem.\n\n1. Something's wrong");
      expect(stdout.text()).not.toContain("Checking this Mac");
    } finally {
      vi.doUnmock("../src/drivers/voiceover/setup-mac.js");
      vi.doUnmock("../src/drivers/guidepup/setup.js");
      vi.resetModules();
    }
  });

  // doctor's own platform checks (Windows, Mac, Linux) are covered by test/doctor.test.ts and
  // test/readiness-*.test.ts; here a fake PlatformReadiness only proves main.ts's wiring, so this
  // runs on every platform, without going near the real Mac or Windows readiness code.
  it("doctor prints the FAIL line and exits 2 when the platform isn't ready", async () => {
    const doctor = await cli(
      ["doctor"],
      undefined,
      {},
      { platformReadiness: () => Promise.resolve(NOT_READY) },
    );
    expect(doctor.code).toBe(2);
    expect(doctor.out).toContain("FAIL  Quick check is broken");
  });

  it("exits 2 when the default driver can't run here", async () => {
    if (process.platform === "win32") return;
    const result = await cli(["--site", SITE, "--pages", fixture("pages.json")]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("only runs on Windows");
  });
});

describe("--sitemap by name", () => {
  /** Serves the fixture site's files, for sitemap fetches, without a server. */
  const fixtureFetch: typeof fetch = async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    try {
      return new Response(await readFile(fixture("site", ...url.pathname.split("/"))));
    } catch {
      return new Response("not found", { status: 404 });
    }
  };

  it("shows the name form in the help's examples", async () => {
    const help = await cli(["--help"]);
    expect(help.out).toContain(
      "npx @icjia/voicecap --site https://dvfr.illinois.gov --sitemap sitemap.xml\n",
    );
  });

  it("runs from a sitemap given by name, and records its full URL", async () => {
    const run = await cli(
      ["--site", SITE, "--sitemap", "sitemap.xml", "--replay-from", fixture("replay-run")],
      undefined,
      {},
      { fetch: fixtureFetch },
    );
    expect(run.err).not.toContain("Error:");
    expect(run.code).toBe(0);
    const out = path.join(run.cwd, "transcripts", "127.0.0.1_4747");
    const runId = (await readFile(path.join(out, "latest.txt"), "utf8")).trim();
    const runJson = JSON.parse(
      await readFile(path.join(runDir(out, runId), "run.json"), "utf8"),
    ) as RunJson;
    expect(runJson.settings.source).toEqual({ kind: "sitemap", url: `${SITE}/sitemap.xml` });

    const list = await cli(
      ["list-urls", "pages.csv", "--site", SITE, "--sitemap", "/sitemaps/pages.xml"],
      undefined,
      {},
      { fetch: fixtureFetch },
    );
    expect(list.err).toBe("");
    expect(list.code).toBe(0);
    expect(list.out).toContain("Wrote 5 URLs to");
  });

  it("explains a --sitemap Git Bash rewrote, suggesting the name without the slash", async () => {
    const run = await cli(["--site", SITE, "--sitemap", "C:/Program Files/Git/sitemap.xml"]);
    expect(run.code).toBe(1);
    expect(run.err).toContain("Git Bash rewrote it");
    expect(run.err).toContain("leave off the leading slash (--sitemap sitemap.xml)");
    expect(run.err).toContain("MSYS_NO_PATHCONV=1 npx @icjia/voicecap --sitemap /sitemap.xml ...");
  });

  it("refuses a --sitemap that starts with a host, before fetching anything", async () => {
    let fetched = 0;
    const counting: typeof fetch = () => {
      fetched += 1;
      return Promise.resolve(new Response("not found", { status: 404 }));
    };
    const value = "dvfr.illinois.gov/sitemap.xml";
    const message = `--sitemap "${value}" looks like an address without https://: give its full URL (https://${value}), or just its name on --site, such as sitemap.xml.`;

    const run = await cli(
      [
        "--site",
        "https://dvfr.illinois.gov",
        "--sitemap",
        value,
        "--replay-from",
        fixture("replay-run"),
      ],
      undefined,
      {},
      { fetch: counting },
    );
    expect(run.code).toBe(1);
    expect(run.err).toContain(message);

    const list = await cli(
      ["list-urls", "pages.csv", "--site", "https://dvfr.illinois.gov", "--sitemap", value],
      undefined,
      {},
      { fetch: counting },
    );
    expect(list.code).toBe(1);
    expect(list.err).toContain(message);
    expect(fetched).toBe(0);
  });

  // A run always needs --site, so that's the error, before --sitemap is read.
  it("asks for --site when a sitemap's name comes without it", async () => {
    const run = await cli(["--sitemap", "sitemap.xml"]);
    expect(run.code).toBe(1);
    expect(run.err).toContain("Missing --site");
  });
});

describe("--page", () => {
  it("accepts --page more than once", async () => {
    const run = await cli([
      "--site",
      SITE,
      "--page",
      "/",
      "--page",
      `${SITE}/duplicates/`,
      "--replay-from",
      fixture("replay-run"),
    ]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("[2/2]");
  });
});

describe("a full session through the CLI", () => {
  it("records a run's --reviewer with its session, and says so", async () => {
    const run = await cli([
      "--site",
      SITE,
      "--pages",
      fixture("pages.json"),
      "--replay-from",
      fixture("replay-run"),
      "--reviewer",
      "Jane Doe",
    ]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("Reviewer: Jane Doe (from --reviewer)");
    const out = path.join(run.cwd, "transcripts", "127.0.0.1_4747");
    const runId = (await readFile(path.join(out, "latest.txt"), "utf8")).trim();
    const record = JSON.parse(
      await readFile(path.join(runDir(out, runId), "run.json"), "utf8"),
    ) as RunJson;
    expect(record.sessions[0]?.reviewer).toEqual({ name: "Jane Doe", source: "option" });
  });

  // A real session can't run here, so runAudit is replaced by one that asks the question, as it
  // does when a session ends. This proves the command hands runAudit the question, and that the
  // question is asked on the command's own terminal, and only when its output is that terminal.
  it("hands runAudit the listener's question at a terminal, and none without one", async () => {
    let answer: string | null | undefined;
    vi.resetModules();
    vi.doMock("../src/run/audit.js", async (importOriginal) => ({
      ...(await importOriginal<object>()),
      runAudit: async (options: RunAuditOptions) => {
        answer = await options.askListener?.({ screenReader: "NVDA", pagesRead: 3 });
        return { exitCode: 0 };
      },
    }));
    try {
      const { main: mainWithQuestion } = await import("../src/cli/main.js");
      const args = ["--site", SITE, "--pages", fixture("pages.json")];
      const cwd = await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-"));
      /** The command, reading `stdin` and writing to `stdout`, as `init`'s own run does. */
      const command = (stdin: NodeJS.ReadableStream, stdout: OutputStream) =>
        mainWithQuestion(args, {
          stdout,
          stderr: capture().stream,
          cwd,
          env: {},
          signal: new AbortController().signal,
          interactive: false,
          stdin,
          platform: "linux",
        });

      // At a terminal: its input and its output. The answer is typed once the question shows.
      const keyboard = Object.assign(new PassThrough(), { isTTY: true });
      const screen = terminalScreen((shown) => {
        if (shown.includes("Choose [3]: ")) setImmediate(() => keyboard.write("2\n"));
      });
      expect(await command(keyboard, screen.stream)).toBe(0);
      expect(screen.text()).toContain("Did you hear NVDA speaking as it read these pages?");
      expect(answer).toBe("part");
      keyboard.end();

      // Input from a script or CI: never asked.
      answer = "not asked";
      const piped = capture();
      expect(await command(linesStream(["2"]), piped.stream)).toBe(0);
      expect(piped.text()).not.toContain("Did you hear");
      expect(answer).toBeUndefined();
    } finally {
      vi.doUnmock("../src/run/audit.js");
      vi.resetModules();
    }
  });

  // voicecap … > log.txt: the question would go into the file, and voicecap would wait for an
  // answer to a question nobody can see.
  it("doesn't hand runAudit the question when the output is redirected from the terminal", async () => {
    let asked: boolean | undefined;
    vi.resetModules();
    vi.doMock("../src/run/audit.js", async (importOriginal) => ({
      ...(await importOriginal<object>()),
      runAudit: (options: RunAuditOptions) => {
        asked = options.askListener !== undefined;
        return Promise.resolve({ exitCode: 0 });
      },
    }));
    try {
      const { main: mainWithQuestion } = await import("../src/cli/main.js");
      const keyboard = Object.assign(new PassThrough(), { isTTY: true });
      const file = capture();
      const code = await mainWithQuestion(["--site", SITE, "--pages", fixture("pages.json")], {
        stdout: file.stream,
        stderr: capture().stream,
        cwd: await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-")),
        env: {},
        signal: new AbortController().signal,
        interactive: false,
        stdin: keyboard,
        platform: "linux",
      });
      keyboard.end();
      expect(code).toBe(0);
      expect(asked).toBe(false);
      expect(file.text()).not.toContain("Did you hear");
    } finally {
      vi.doUnmock("../src/run/audit.js");
      vi.resetModules();
    }
  });

  // A run reads the computer's details with the probe for the platform the CLI says it's on, as
  // every other command honors it, not the host's. On Windows the host's probe starts PowerShell,
  // which takes seconds, in a test that says it's on Linux (on a Linux host the two are the same,
  // so this can't fail there). The probe is replaced here by an instant one, so nothing starts.
  it("reads a run's computer details with the probe for the CLI's own platform", async () => {
    const asked: NodeJS.Platform[] = [];
    vi.resetModules();
    vi.doMock("../src/run/machine-record.js", async (importOriginal) => ({
      ...(await importOriginal<object>()),
      machineProbeFor: (platform: NodeJS.Platform) => {
        asked.push(platform);
        return MACHINE_PROBE;
      },
    }));
    try {
      const { main: mainWithProbeSpy } = await import("../src/cli/main.js");
      const stderr = capture();
      const code = await mainWithProbeSpy(
        ["--site", SITE, "--pages", fixture("pages.json"), "--replay-from", fixture("replay-run")],
        {
          stdout: capture().stream,
          stderr: stderr.stream,
          cwd: await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-")),
          env: {},
          signal: new AbortController().signal,
          interactive: false,
          platform: "linux",
        },
      );

      expect(stderr.text()).not.toContain("Error:");
      expect(code).toBe(0);
      expect(asked).toEqual(["linux"]);
    } finally {
      vi.doUnmock("../src/run/machine-record.js");
      vi.resetModules();
    }
  });

  it("runs with the replay driver, then records a review and a manual session", async () => {
    const run = await cli([
      "--site",
      SITE,
      "--pages",
      fixture("pages.json"),
      "--replay-from",
      fixture("replay-run"),
      "--run-name",
      "cli test",
    ]);
    expect(run.err).not.toContain("Error:");
    expect(run.code).toBe(0);
    expect(run.out).toMatch(/\[1\/3\] \/ — read: \d+ steps \(end reached\)/);
    const out = path.join(run.cwd, "transcripts", "127.0.0.1_4747");
    const runId = (await readFile(path.join(out, "latest.txt"), "utf8")).trim();
    expect(runId).toMatch(/_cli-test$/);

    const review = await cli(
      [
        "review",
        "--page",
        "/flawed/",
        "--status",
        "issue",
        "--note",
        "Unlabeled button",
        "--reviewer",
        "Pat Reviewer",
      ],
      run.cwd,
    );
    expect(review.code).toBe(0);
    const reviews = JSON.parse(
      await readFile(path.join(out, "reviews.json"), "utf8"),
    ) as ReviewsFile;
    const entry = reviews.pages[`${SITE}/flawed`]?.[0];
    expect(entry).toMatchObject({
      status: "issue",
      reviewer: "Pat Reviewer",
      run: runId,
      note: "Unlabeled button",
    });

    const noReviewer = await cli(["review", "--page", "/", "--status", "reviewed"], run.cwd, {});
    // git config user.name may exist on the machine running the tests; only check the message when it fails.
    if (noReviewer.code !== 0) expect(noReviewer.err).toContain("No reviewer name");

    const manual = await cli(
      [
        "manual",
        "add",
        fixture("manual", "nvda-io-log.txt"),
        "--page",
        "/",
        "--redact-typing",
        "--reviewer",
        "Pat Reviewer",
        "--date",
        "2026-09-25",
      ],
      run.cwd,
    );
    expect(manual.err).not.toContain("Error:");
    expect(manual.code).toBe(0);
    expect(existsSync(manualSessionDir(out, "2026-09-25_2357", "home"))).toBe(true);

    const report = await cli(["report"], run.cwd);
    expect(report.code).toBe(0);
    const html = await readFile(path.join(out, "report.html"), "utf8");
    expect(html).toContain("Unlabeled button");
    expect((await cli(["report", "--run", "no-such-run"], run.cwd)).code).toBe(1);
  });

  it("prints where the report is, then where the shareable page and its Word copy are", async () => {
    const run = await cli([
      "--site",
      SITE,
      "--pages",
      fixture("pages.json"),
      "--replay-from",
      fixture("replay-run"),
    ]);
    expect(run.code).toBe(0);
    const site = path.join(run.cwd, "transcripts", "127.0.0.1_4747");
    const page = path.join(site, "share", "current.html");
    const word = path.join(site, "share", "current.docx");
    // Gone, so it's `voicecap report` that writes them.
    await rm(path.dirname(page), { recursive: true, force: true });

    const report = await cli(["report"], run.cwd);

    expect(report.code).toBe(0);
    expect(report.err).toBe("");
    expect(report.out).toContain(
      `Report: ${path.join(site, "report.html")}\nShareable page: ${page}\nWord copy: ${word}\n`,
    );
    expect(await readFile(page, "utf8")).toMatch(/^<!doctype html>/);
    expect(XMLValidator.validate((await unzipDocx(await readFile(word))).document)).toBe(true);
  });

  it("still reports, with a warning for each file and no path, when neither can be written", async () => {
    const run = await cli([
      "--site",
      SITE,
      "--pages",
      fixture("pages.json"),
      "--replay-from",
      fixture("replay-run"),
    ]);
    expect(run.code).toBe(0);
    const site = path.join(run.cwd, "transcripts", "127.0.0.1_4747");
    // A file where their folder would go.
    await rm(path.join(site, "share"), { recursive: true, force: true });
    await writeFile(path.join(site, "share"), "In the way.\n");

    const report = await cli(["report"], run.cwd);

    expect(report.code).toBe(0);
    // The page's warning, then the Word copy's, with one reason, and nothing about closing Word.
    expect(report.err).toMatch(
      /^Warning: The shareable page wasn't updated: (.+)\nWarning: The Word copy wasn't updated: \1\n$/,
    );
    expect(report.out).toContain(`Report: ${path.join(site, "report.html")}\n`);
    expect(report.out).not.toContain("Shareable page:");
    expect(report.out).not.toContain("Word copy:");
  });

  // A warning has said why the other file wasn't written, so the command names only the file that
  // was.
  it.each([
    {
      broken: "the Word copy",
      module: "../src/share/docx.js",
      replacement: { renderWordCopy: () => Promise.reject(new Error("It couldn't be made.")) },
      warning: "Warning: The Word copy wasn't updated: It couldn't be made.\n",
      printed: (site: string) =>
        `Report: ${path.join(site, "report.html")}\nShareable page: ${path.join(site, "share", "current.html")}\n`,
    },
    {
      broken: "the page",
      module: "../src/share/html/document.js",
      replacement: {
        renderSharePage: () => {
          throw new Error("It couldn't be made.");
        },
      },
      warning: "Warning: The shareable page wasn't updated: It couldn't be made.\n",
      printed: (site: string) =>
        `Report: ${path.join(site, "report.html")}\nWord copy: ${path.join(site, "share", "current.docx")}\n`,
    },
  ])(
    "still reports where the other file is, and warns of $broken, when only it can't be made",
    async ({ module, replacement, warning, printed }) => {
      const run = await cli([
        "--site",
        SITE,
        "--pages",
        fixture("pages.json"),
        "--replay-from",
        fixture("replay-run"),
      ]);
      expect(run.code).toBe(0);
      const site = path.join(run.cwd, "transcripts", "127.0.0.1_4747");
      await rm(path.join(site, "share"), { recursive: true, force: true });
      vi.resetModules();
      vi.doMock(module, async (importOriginal) => ({
        ...(await importOriginal<object>()),
        ...replacement,
      }));
      try {
        const { main: mainWithOneBroken } = await import("../src/cli/main.js");
        const stdout = capture();
        const stderr = capture();

        const code = await mainWithOneBroken(["report"], {
          stdout: stdout.stream,
          stderr: stderr.stream,
          cwd: run.cwd,
          env: {},
          signal: new AbortController().signal,
          interactive: false,
          platform: "linux",
        });

        expect(code).toBe(0);
        expect(stderr.text()).toBe(warning);
        expect(stdout.text()).toBe(printed(site));
      } finally {
        vi.doUnmock(module);
        vi.resetModules();
      }
    },
  );

  it("asks which site when the home has several, and takes --site", async () => {
    const run = await cli([
      "--site",
      SITE,
      "--pages",
      fixture("pages.json"),
      "--replay-from",
      fixture("replay-run"),
    ]);
    expect(run.code).toBe(0);
    const home = path.join(run.cwd, "transcripts");
    // A second site with something in it: an empty folder, which a failed run leaves, doesn't count.
    await mkdir(path.join(home, "dvfr.illinois.gov", "2026-09-27"), { recursive: true });

    const review = [
      "review",
      "--page",
      "/flawed/",
      "--status",
      "issue",
      "--reviewer",
      "Pat Reviewer",
    ];
    const unsure = await cli(review, run.cwd);
    expect(unsure.code).toBe(1);
    expect(unsure.err).toContain(
      "transcripts has 127.0.0.1_4747 and dvfr.illinois.gov: add --site, or give --page as a full URL.",
    );
    const chosen = await cli([...review, "--site", SITE], run.cwd);
    expect(chosen.err).not.toContain("Error:");
    expect(chosen.code).toBe(0);
    const reviews = JSON.parse(
      await readFile(path.join(home, "127.0.0.1_4747", "reviews.json"), "utf8"),
    ) as ReviewsFile;
    expect(reviews.pages[`${SITE}/flawed`]?.[0]).toMatchObject({
      status: "issue",
      reviewer: "Pat Reviewer",
    });

    const manual = await cli(
      [
        "manual",
        "add",
        fixture("manual", "nvda-io-log.txt"),
        "--page",
        "/",
        "--site",
        SITE,
        "--redact-typing",
        "--reviewer",
        "Pat Reviewer",
        "--date",
        "2026-09-25",
      ],
      run.cwd,
    );
    expect(manual.code).toBe(0);
    expect(
      existsSync(manualSessionDir(path.join(home, "127.0.0.1_4747"), "2026-09-25_2357", "home")),
    ).toBe(true);

    const report = await cli(["report"], run.cwd);
    expect(report.code).toBe(1);
    expect(report.err).toContain(
      "transcripts has 127.0.0.1_4747 and dvfr.illinois.gov: add --site.",
    );
    expect((await cli(["report", "--site", SITE], run.cwd)).code).toBe(0);
  });

  it("takes the home from VOICECAP_TRANSCRIPTS, and from --out over it", async () => {
    const env = { VOICECAP_TRANSCRIPTS: "records" };
    const run = await cli(
      ["--site", SITE, "--pages", fixture("pages.json"), "--replay-from", fixture("replay-run")],
      undefined,
      env,
    );
    expect(run.code).toBe(0);
    const site = path.join(run.cwd, "records", "127.0.0.1_4747");
    expect(existsSync(path.join(site, "latest.txt"))).toBe(true);
    expect(existsSync(path.join(run.cwd, "transcripts"))).toBe(false);

    const review = await cli(
      ["review", "--page", "/", "--status", "reviewed", "--reviewer", "Pat Reviewer"],
      run.cwd,
      env,
    );
    expect(review.code).toBe(0);
    expect(existsSync(path.join(site, "reviews.json"))).toBe(true);
    expect((await cli(["report"], run.cwd, env)).code).toBe(0);
    const elsewhere = await cli(["report", "--out", "elsewhere"], run.cwd, env);
    expect(elsewhere.code).toBe(1);
    expect(elsewhere.err).toContain(`${path.join(run.cwd, "elsewhere")} has no site folders yet`);
  });

  it("files a manual session under --site in a fresh home", async () => {
    const manual = await cli([
      "manual",
      "add",
      fixture("manual", "nvda-io-log.txt"),
      "--site",
      SITE,
      "--page",
      "/",
      "--redact-typing",
      "--reviewer",
      "Pat Reviewer",
      "--date",
      "2026-09-25",
    ]);
    expect(manual.err).not.toContain("Error:");
    expect(manual.code).toBe(0);
    const sessions = await listManualSessions(
      path.join(manual.cwd, "transcripts", "127.0.0.1_4747"),
    );
    expect(sessions.map((session) => session.json.page.url)).toEqual([`${SITE}/`]);
  });

  it("refuses a --page that isn't on --site", async () => {
    const review = await cli([
      "review",
      "--site",
      "https://dvfr.illinois.gov",
      "--page",
      "https://i2i.illinois.gov/x",
      "--status",
      "reviewed",
      "--reviewer",
      "Pat Reviewer",
    ]);
    expect(review.code).toBe(1);
    expect(review.err).toContain(
      "--page https://i2i.illinois.gov/x is on i2i.illinois.gov, but --site is dvfr.illinois.gov.",
    );

    const manual = (page: string) =>
      cli(
        [
          "manual",
          "add",
          fixture("manual", "nvda-io-log.txt"),
          "--site",
          SITE,
          "--page",
          page,
          "--redact-typing",
          "--reviewer",
          "Pat Reviewer",
          "--date",
          "2026-09-25",
        ],
        review.cwd,
      );
    const elsewhere = await manual("https://dvfr.illinois.gov/faq/");
    expect(elsewhere.code).toBe(1);
    expect(elsewhere.err).toContain(
      "--page https://dvfr.illinois.gov/faq/ is on dvfr.illinois.gov, but --site is 127.0.0.1:4747.",
    );
    // A path can't leave --site either: this one names another host.
    expect((await manual("//dvfr.illinois.gov/faq/")).err).toContain(
      "--page //dvfr.illinois.gov/faq/ is on dvfr.illinois.gov, but --site is 127.0.0.1:4747.",
    );
    // The same host on another scheme is another origin, which only the origins tell apart.
    const https = await manual("https://127.0.0.1:4747/");
    expect(https.code).toBe(1);
    expect(https.err).toContain(
      "--page https://127.0.0.1:4747/ is on https://127.0.0.1:4747, but --site is http://127.0.0.1:4747.",
    );
    const broken = await manual("https://");
    expect(broken.code).toBe(1);
    expect(broken.err).toContain(`--page "https://" isn't a page URL or a path like /about.`);
    expect(existsSync(path.join(review.cwd, "transcripts"))).toBe(false);
  });

  it("refuses a path that names another host when the site comes from the latest run", async () => {
    const cwd = await oneSiteHome();
    const home = path.join(cwd, "transcripts");
    const before = await contents(home);
    const manual = await cli(
      [
        "manual",
        "add",
        fixture("manual", "nvda-io-log.txt"),
        "--page",
        "//dvfr.illinois.gov/faq/",
        "--redact-typing",
        "--reviewer",
        "Pat Reviewer",
        "--date",
        "2026-09-25",
      ],
      cwd,
    );
    expect(manual.code).toBe(1);
    expect(manual.err).toContain(
      `--page "//dvfr.illinois.gov/faq/" resolves to http://dvfr.illinois.gov/faq/, which isn't on ${SITE}. Give the page's full URL, or add --site.`,
    );
    expect(await contents(home)).toEqual(before);
  });

  it("takes a --page that starts with a scheme as a full URL, even with a slash missing", async () => {
    const cwd = await oneSiteHome();
    const manual = await cli(
      [
        "manual",
        "add",
        fixture("manual", "nvda-io-log.txt"),
        "--page",
        "https:/dvfr.illinois.gov/faq/",
        "--redact-typing",
        "--reviewer",
        "Pat Reviewer",
        "--date",
        "2026-09-25",
      ],
      cwd,
    );
    expect(manual.err).not.toContain("Error:");
    expect(manual.code).toBe(0);
    const home = path.join(cwd, "transcripts");
    const dvfr = await listManualSessions(path.join(home, "dvfr.illinois.gov"));
    expect(dvfr.map((session) => session.json.page.url)).toEqual([
      "https://dvfr.illinois.gov/faq/",
    ]);
    expect(await listManualSessions(path.join(home, "127.0.0.1_4747"))).toEqual([]);
  });

  it("refuses a report before there's any completed run", async () => {
    const empty = await cli(["report"]);
    expect(empty.code).toBe(1);
    expect(empty.err).toContain(
      `${path.join(empty.cwd, "transcripts")} has no site folders yet: run voicecap on the site first, or add --site.`,
    );
    const result = await cli(["report", "--site", SITE], empty.cwd);
    expect(result.code).toBe(1);
    expect(result.err).toContain("no completed run");
  });
});

describe("voicecap verify", () => {
  it("exits 0 when everything matches, and 3 after an edit, printing the problem", async () => {
    const env = { VOICECAP_TRANSCRIPTS: "records" };
    const run = await cli(
      ["--site", SITE, "--pages", fixture("pages.json"), "--replay-from", fixture("replay-run")],
      undefined,
      env,
    );
    expect(run.code).toBe(0);

    const clean = await cli(["verify"], run.cwd, env);
    expect(clean.err).toBe("");
    expect(clean.code).toBe(0);
    expect(clean.out).toBe(
      "127.0.0.1_4747: 1 run (0 incomplete), 0 manual sessions, 0 reviews checked: everything matches.\n",
    );

    const site = path.join(run.cwd, "records", "127.0.0.1_4747");
    const runId = (await readFile(path.join(site, "latest.txt"), "utf8")).trim();
    await appendFile(path.join(runDir(site, runId), "pages", "home", "read.txt"), "Added.\n");
    const changed = await cli(["verify", "--site", SITE, "--out", "records"], run.cwd);
    expect(changed.err).toBe("");
    expect(changed.code).toBe(3);
    expect(changed.out).toBe(
      `127.0.0.1_4747/${runId.slice(0, 10)}/${runId.slice(11)}/pages/home/read.txt: changed since it was recorded (SHA-256 differs)\n` +
        "127.0.0.1_4747: 1 run (0 incomplete), 0 manual sessions, 0 reviews checked: 1 problem.\n",
    );
  });
});

describe("voicecap share", () => {
  /** Whatever the help says, on one line, so where it wraps doesn't matter. */
  const squeezed = (text: string) => text.replace(/\s+/g, " ");

  it("makes the dated pair, records it, and prints the line to paste into the email, last", async () => {
    const { dir, siteDir } = await homeWithCountedRun();

    const share = await cli(
      [
        "share",
        "--out",
        path.join(dir, "transcripts"),
        "--site",
        EXAMPLE_SITE,
        "--reviewer",
        "Pat Lee",
      ],
      dir,
    );

    expect(share.err).toBe("");
    expect(share.code).toBe(0);
    const { shares } = JSON.parse(await readFile(sharesPath(siteDir), "utf8")) as SharesFile;
    expect(shares).toHaveLength(1);
    const entry = shares[0]!;
    expect(entry).toMatchObject({ seq: 1, prev: null, by: "Pat Lee" });
    const page = entry.files[0]!;
    const word = entry.files[1]!;
    // Named for the site's folder and the day, as the page, then its Word copy, whole on disk.
    const day = entry.at.slice(0, 10);
    expect([page.name, word.name]).toEqual([
      `example.illinois.gov_${day}.html`,
      `example.illinois.gov_${day}.docx`,
    ]);
    for (const file of [page, word]) {
      const bytes = await readFile(path.join(shareDir(siteDir), file.name));
      expect({ bytes: bytes.length, sha256: sha256(bytes) }).toEqual({
        bytes: file.bytes,
        sha256: file.sha256,
      });
    }
    expect(share.out).toBe(
      [
        `Shared example.illinois.gov, as of ${longDate(entry.at)}: entry 1 in ${sharesPath(siteDir)}.`,
        `  ${path.join(shareDir(siteDir), page.name)}`,
        `    ${sizeLine(page.bytes)}, SHA-256 ${page.sha256}`,
        `  ${path.join(shareDir(siteDir), word.name)}`,
        `    ${sizeLine(word.bytes)}, SHA-256 ${word.sha256}`,
        "To paste into the email that sends them:",
        `  Fingerprints (SHA-256): ${page.name} ${page.sha256}; ${word.name} ${word.sha256}. To check a file you received: Get-FileHash <file> in PowerShell, or shasum -a 256 <file> on a Mac. PowerShell shows the same letters in capitals.`,
        "",
      ].join("\n"),
    );
  });

  it("takes the home's only site, and the home from the folder it's run in, when it's given neither", async () => {
    const { dir, siteDir } = await homeWithCountedRun();

    const share = await cli(["share", "--reviewer", "Pat Lee"], dir);

    expect(share.err).toBe("");
    expect(share.code).toBe(0);
    const { shares } = JSON.parse(await readFile(sharesPath(siteDir), "utf8")) as SharesFile;
    expect(shares).toHaveLength(1);
    expect(share.out).toMatch(/^Shared example\.illinois\.gov, as of /);
  });

  it("exits 1, and says why, when no run counts", async () => {
    const home = await oneSiteHome();
    const site = path.join(home, "transcripts", "127.0.0.1_4747");

    const share = await cli(["share", "--reviewer", "Pat Lee"], home);

    expect(share.code).toBe(1);
    expect(share.out).toBe("");
    expect(share.err).toBe(
      `Error: No completed, sealed, live run in ${site} yet, so there's nothing to share. Replayed, interrupted, and unsealed runs don't count.\n`,
    );
    expect(existsSync(sharesPath(site))).toBe(false);
  });

  it("is listed in the help, with what it does", async () => {
    const help = await cli(["--help"]);

    expect(help.code).toBe(0);
    expect(squeezed(help.out)).toContain(
      "share [options] make a dated copy of the shareable page and its Word copy to send, and record it",
    );
  });

  it("has --site, --out, and --reviewer, each with its own words", async () => {
    const help = await cli(["share", "--help"]);

    expect(help.code).toBe(0);
    const said = squeezed(help.out);
    expect(said).toContain(
      "make a dated copy of the shareable page and its Word copy to send, and record it",
    );
    expect(said).toContain("--site <url> the site's URL (default: the home's only site)");
    expect(said).toContain(
      "--out <dir> transcripts home (default: VOICECAP_TRANSCRIPTS, else ./transcripts)",
    );
    expect(said).toContain(
      "--reviewer <name> who is sharing (default: VOICECAP_REVIEWER, git config user.name, or the config's reviewer)",
    );
  });
});

describe("voicecap init", () => {
  it("init asks the questions and prints the command", async () => {
    const run = await cli(
      ["init"],
      undefined,
      {},
      {
        stdin: linesStream(["dvfr.illinois.gov", "", "", "", "", ""]),
        fetch: realSitesFetch(),
        platformReadiness: () => Promise.resolve(READY),
      },
    );
    expect(run.code).toBe(0);
    expect(run.out).toContain(
      "npx @icjia/voicecap --site https://dvfr.illinois.gov --sitemap https://dvfr.illinois.gov/sitemap.xml --reviewer icjia",
    );
  });

  it("starts init with no arguments in a terminal", async () => {
    const run = await cli(
      [],
      undefined,
      {},
      { interactive: true, stdin: linesStream(), platformReadiness: () => Promise.resolve(READY) },
    );
    expect(run.out).toContain("Website:");
  });

  it("keeps the usage error with no arguments and no terminal", async () => {
    const run = await cli([], undefined, {}, { interactive: false });
    expect(run.code).toBe(1);
    expect(run.err).toContain("Missing --site");
    expect(run.err).toContain("voicecap init");
  });

  it("exits 1 when the answers stop coming", async () => {
    const run = await cli(
      ["init"],
      undefined,
      {},
      {
        stdin: linesStream(["dvfr.illinois.gov"]),
        fetch: realSitesFetch(),
        platformReadiness: () => Promise.resolve(READY),
      },
    );
    expect(run.code).toBe(1);
    // Proves the wizard actually ran (asked and got past the website) rather than failing some
    // other way, e.g. "init" not being a recognized command.
    expect(run.out).toContain("Website:");
  });

  it("says the platform's checking notice before its checks begin", async () => {
    const stdout = capture();
    let shown: string | null = null;
    const platform: PlatformReadiness = {
      ...NOT_READY,
      checkingNotice: ["Checking this computer. Click Allow if you're asked."],
      // The preflight's first call.
      machineInfo: () => {
        shown = stdout.text();
        return NOT_READY.machineInfo();
      },
    };
    const code = await main(["init"], {
      stdout: stdout.stream,
      stderr: capture().stream,
      cwd: await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-")),
      env: {},
      signal: new AbortController().signal,
      interactive: false,
      stdin: linesStream(),
      // A direct main() call, so it skips cli()'s safe default: never the real Mac readiness.
      platform: "linux",
      platformReadiness: () => Promise.resolve(platform),
    });
    expect(code).toBe(2);
    expect(shown).toBe("Checking this computer. Click Allow if you're asked.\n\n");
    expect(stdout.text()).toMatch(
      /^Checking this computer\. Click Allow if you're asked\.\n\nvoicecap preflight, /,
    );
  });

  // A terminal prompter puts the terminal in raw mode, where Ctrl+C reaches only the prompter, and
  // the checks don't listen to it. Made at the first question, it leaves Ctrl+C to stop the checks.
  it("makes no prompter until its first question, leaving the terminal as it is during the checks", async () => {
    const rawModes: boolean[] = [];
    const stdin = Object.assign(new PassThrough(), {
      isTTY: true,
      setRawMode(mode: boolean) {
        rawModes.push(mode);
        return this;
      },
    });
    // A real stream, since readline's terminal mode needs one.
    const stdout = new Writable({
      write(_chunk: Buffer, _encoding, callback) {
        callback();
      },
    });
    let duringChecks: boolean[] | null = null;
    const platform = readyPlatform({
      quickChecks: () => [
        {
          id: "quick",
          run: () => {
            duringChecks = [...rawModes];
            return Promise.resolve({ id: "quick", status: "OK", summary: "Quick is fine" });
          },
        },
      ],
    });
    // Ctrl+C, typed ahead: it reaches the first question.
    stdin.write("\u0003");
    const code = await main(["init"], {
      stdout,
      stderr: capture().stream,
      cwd: await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-")),
      env: {},
      signal: new AbortController().signal,
      interactive: false,
      stdin,
      // A direct main() call, so it skips cli()'s safe default: never the real Mac readiness.
      platform: "linux",
      platformReadiness: () => Promise.resolve(platform),
    });
    expect(duringChecks).toEqual([]);
    // The first question put the terminal in raw mode, and closing the prompter took it out.
    expect(rawModes).toEqual([true, false]);
    expect(code).toBe(130);
    stdin.end();
  });

  it("prints the preflight and stops before any question when the computer isn't ready", async () => {
    const run = await cli(
      ["init"],
      undefined,
      {},
      { stdin: linesStream(), platformReadiness: () => Promise.resolve(NOT_READY) },
    );
    expect(run.code).toBe(2);
    expect(run.out).toContain("Not ready: 1 problem.");
    expect(run.out).not.toContain("Website:");
  });

  it("runs the wizard as today once the live test is declined", async () => {
    const platform = readyPlatform({
      liveTestNotice: ["This starts NVDA and opens a page in a browser, briefly."],
      liveTest: () =>
        Promise.resolve([{ id: "live", status: "OK", summary: "NVDA spoke as expected" }]),
    });
    const run = await initAtTerminal(["n", "dvfr.illinois.gov", "", "", "", "", ""], {
      fetch: realSitesFetch(),
      platformReadiness: () => Promise.resolve(platform),
    });
    expect(run.code).toBe(0);
    expect(run.out).toContain("Test NVDA now?");
    expect(run.out).toContain(
      "npx @icjia/voicecap --site https://dvfr.illinois.gov --sitemap https://dvfr.illinois.gov/sitemap.xml --reviewer icjia",
    );
    // The order the brief pins down: the preflight, then the live-test offer, then the wizard.
    const verdict = run.out.indexOf("Ready: this computer can run NVDA for voicecap.");
    const offer = run.out.indexOf("Test NVDA now?");
    const website = run.out.indexOf("Website:");
    expect(verdict).toBeGreaterThanOrEqual(0);
    expect(verdict).toBeLessThan(offer);
    expect(offer).toBeLessThan(website);
  });

  it("exits 2 with the problem when the live test is accepted and fails", async () => {
    const platform = readyPlatform({
      liveTestNotice: ["This starts NVDA and opens a page in a browser, briefly."],
      liveTest: () =>
        Promise.resolve([
          {
            id: "live",
            status: "FAIL",
            summary: "NVDA never spoke",
            problem: {
              title: "NVDA didn't speak",
              whatsWrong: "The live test got no speech from NVDA.",
              fix: ["Try again."],
              setupHelps: false,
            },
          },
        ]),
    });
    const run = await initAtTerminal(["y"], {
      platformReadiness: () => Promise.resolve(platform),
    });
    expect(run.code).toBe(2);
    expect(run.out).toContain("Test NVDA now?");
    expect(run.out).toContain("Not ready: 1 problem.");
    expect(run.out).toContain("NVDA didn't speak");
    expect(run.out).not.toContain("Website:");
  });

  // As setup does: piped answers are the wizard's, so offering the test would shift them by one.
  it("doesn't offer the live test when its input isn't a terminal", async () => {
    let liveTests = 0;
    const platform = readyPlatform({
      liveTestNotice: ["This starts NVDA and opens a page in a browser, briefly."],
      liveTest: () => {
        liveTests++;
        return Promise.resolve([]);
      },
    });
    const run = await cli(
      ["init"],
      undefined,
      {},
      {
        stdin: linesStream(["dvfr.illinois.gov", "", "", "", "", ""]),
        fetch: realSitesFetch(),
        platformReadiness: () => Promise.resolve(platform),
      },
    );
    expect(run.code).toBe(0);
    expect(run.out).not.toContain("This starts NVDA");
    expect(run.out).not.toContain("Test NVDA now?");
    expect(liveTests).toBe(0);
    expect(run.out).toContain(
      "npx @icjia/voicecap --site https://dvfr.illinois.gov --sitemap https://dvfr.illinois.gov/sitemap.xml --reviewer icjia",
    );
  });

  it("shows cannotRunYet's reason instead of offering to run", async () => {
    // The real reason the Mac's readiness module gives (readiness-mac.ts) until its driver exists.
    const reasonText =
      "voicecap can't run VoiceOver yet: that comes with its VoiceOver driver. For now, run this command on a Windows computer.";
    const platform = readyPlatform({ screenReader: "VoiceOver", cannotRunYet: reasonText });
    const run = await cli(
      ["init"],
      undefined,
      {},
      {
        stdin: linesStream(["dvfr.illinois.gov", "", "", "", ""]),
        fetch: realSitesFetch(),
        platformReadiness: () => Promise.resolve(platform),
      },
    );
    expect(run.code).toBe(0);
    const command = run.out.indexOf("Your command:");
    const reason = run.out.indexOf(reasonText);
    expect(command).toBeGreaterThanOrEqual(0);
    expect(reason).toBeGreaterThan(command);
    expect(run.out).not.toContain("Run it now?");
    // The preflight's own verdict doesn't promise a run either.
    expect(run.out).toContain(
      "Ready: this computer is set up for VoiceOver, but voicecap can't run VoiceOver yet: that comes with its VoiceOver driver.",
    );
    expect(run.out).not.toContain("can run VoiceOver for voicecap");
  });

  it("says the ready screen reader will speak and take over the keyboard", async () => {
    const run = await cli(
      ["init"],
      undefined,
      {},
      {
        stdin: linesStream(["dvfr.illinois.gov", "", "", "", "", ""]),
        fetch: realSitesFetch(),
        platformReadiness: () => Promise.resolve(READY),
      },
    );
    expect(run.code).toBe(0);
    expect(run.out).toContain("NVDA will speak and take over the keyboard until the run ends.");
  });

  it("runs the command when told to", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-init-"));
    await writeFile(
      path.join(dir, "voicecap.config.json"),
      JSON.stringify({ driver: "replay", replayFrom: fixture("replay-run") }),
    );
    // Only the site's home page answers; everything else (robots.txt, sitemap.xml) 404s, so the
    // wizard finds no sitemap and offers "One page" with the home page as its default.
    const fetchHomeOnly: typeof fetch = (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return Promise.resolve(
        url === `${SITE}/`
          ? new Response("<!doctype html><title>Home</title>", {
              status: 200,
              headers: { "content-type": "text/html; charset=utf-8" },
            })
          : new Response("Not found", { status: 404 }),
      );
    };

    const run = await cli(
      ["init"],
      dir,
      {},
      {
        stdin: linesStream([SITE, "", "", "", "", "y"]),
        fetch: fetchHomeOnly,
        platformReadiness: () => Promise.resolve(READY),
      },
    );

    expect(run.code).toBe(0);
    const out = path.join(dir, "transcripts", "127.0.0.1_4747");
    const runId = (await readFile(path.join(out, "latest.txt"), "utf8")).trim();
    const runJson = JSON.parse(
      await readFile(path.join(runDir(out, runId), "run.json"), "utf8"),
    ) as RunJson;
    expect(runJson.status).toBe("completed");
  });

  it("never starts init again from the command it runs, even in a terminal", async () => {
    // The wizard never composes an empty command, but if it did, running it must not start init
    // again, as no arguments at all in a terminal would.
    let asked = 0;
    vi.resetModules();
    vi.doMock("../src/init/wizard.js", () => ({
      runWizard: () => {
        asked += 1;
        return Promise.resolve({ args: [], command: "npx @icjia/voicecap", run: asked === 1 });
      },
    }));
    try {
      const { main: mainWithEmptyCommand } = await import("../src/cli/main.js");
      const stderr = capture();
      const code = await mainWithEmptyCommand(["init"], {
        stdout: capture().stream,
        stderr: stderr.stream,
        cwd: await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-")),
        env: {},
        signal: new AbortController().signal,
        interactive: true,
        stdin: linesStream(),
        // A direct main() call, so it skips cli()'s safe default: never the real Mac readiness.
        platform: "linux",
        platformReadiness: () => Promise.resolve(READY),
      });

      expect(asked).toBe(1);
      expect(code).toBe(1);
      expect(stderr.text()).toContain("Missing --site");
    } finally {
      vi.doUnmock("../src/init/wizard.js");
      vi.resetModules();
    }
  });

  it("exits 130 at once on Ctrl+C during the site check", async () => {
    const stdin = Object.assign(new PassThrough(), { isTTY: true });
    let screen = "";
    // A real stream, since readline's terminal mode needs one.
    const stdout = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        screen += chunk.toString();
        callback();
      },
    });
    let startChecking!: () => void;
    const checking = new Promise<void>((resolve) => (startChecking = resolve));
    // Settles only when its request's signal aborts: Ctrl+C, or the check's own 15-second limit.
    const waitsForAbort: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason as Error));
        startChecking();
      });

    const exit = main(["init"], {
      stdout,
      stderr: capture().stream,
      cwd: await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-")),
      env: {},
      signal: new AbortController().signal,
      interactive: false,
      stdin,
      fetch: waitsForAbort,
      // A direct main() call, so it skips cli()'s safe default: never the real Mac readiness.
      platform: "linux",
      platformReadiness: () => Promise.resolve(READY),
    });
    stdin.write("dvfr.illinois.gov\n");
    await checking;
    const pressed = Date.now();
    stdin.write("\u0003");

    expect(await exit).toBe(130);
    expect(Date.now() - pressed).toBeLessThan(5_000);
    expect(screen).toContain("Checking https://dvfr.illinois.gov…\n");
    stdin.end();
  });
});

// Git Bash translates /c/Users/me into C:/Users/me for the programs it starts, but not with
// MSYS_NO_PATHCONV=1 set (as for --page /about/), so voicecap reads that form itself.
describe.skipIf(process.platform !== "win32")("paths written Git Bash's way", () => {
  it("runs from a page list and a replay folder written Git Bash's way", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "voicecap-git-bash-"));
    const run = await cli([
      "--site",
      SITE,
      "--pages",
      gitBashForm(fixture("pages.json")),
      "--replay-from",
      gitBashForm(fixture("replay-run")),
      "--out",
      home,
    ]);
    expect(run.err).not.toContain("Error:");
    expect(run.code).toBe(0);
    expect(existsSync(path.join(home, "127.0.0.1_4747", "report.html"))).toBe(true);
  });

  it("finds the home from --out or VOICECAP_TRANSCRIPTS written Git Bash's way", async () => {
    const home = gitBashForm(path.join(await oneSiteHome(), "transcripts"));
    const review = await cli([
      "review",
      "--page",
      "/",
      "--status",
      "reviewed",
      "--reviewer",
      "Pat Reviewer",
      "--out",
      home,
    ]);
    expect(review.err).not.toContain("Error:");
    expect(review.code).toBe(0);
    expect((await cli(["report", "--out", home])).code).toBe(0);
    const verify = await cli(["verify"], undefined, { VOICECAP_TRANSCRIPTS: home });
    expect(verify.code).toBe(0);
    expect(verify.out).toContain("1 review checked: everything matches.");
  });

  it("imports a manual session from a file written Git Bash's way", async () => {
    const cwd = await oneSiteHome();
    const manual = await cli(
      [
        "manual",
        "add",
        gitBashForm(fixture("manual", "nvda-io-log.txt")),
        "--page",
        "/",
        "--redact-typing",
        "--reviewer",
        "Pat Reviewer",
        "--date",
        "2026-09-25",
      ],
      cwd,
    );
    expect(manual.err).not.toContain("Error:");
    expect(manual.code).toBe(0);
    const siteDir = path.join(cwd, "transcripts", "127.0.0.1_4747");
    expect(existsSync(manualSessionDir(siteDir, "2026-09-25_2357", "home"))).toBe(true);
  });
});

describe("voicecap demo", () => {
  /** A Mac before the VoiceOver driver: ready, with a passing live test, and no run to start. */
  function macLike(): PlatformReadiness {
    return readyPlatform({
      screenReader: "VoiceOver",
      cannotRunYet: "voicecap can't run VoiceOver yet: that comes with its VoiceOver driver.",
      liveTestNotice: ["The live test takes about 20 seconds."],
      liveTest: () =>
        Promise.resolve([{ id: "liveHear", status: "OK", summary: "VoiceOver hears the page" }]),
    });
  }

  it("needs a terminal, and says so before checking anything", async () => {
    let checked = false;
    const result = await cli(
      ["demo"],
      undefined,
      {},
      {
        stdin: linesStream(["", "", "", ""]),
        platformReadiness: () => {
          checked = true;
          return Promise.resolve(macLike());
        },
      },
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain("voicecap demo is interactive: run it in a terminal.");
    // M6: Git Bash's own window (mintty) doesn't always let Node see a terminal.
    expect(result.err).toContain(
      "voicecap demo is interactive: run it in a terminal. On Windows, use PowerShell or Windows Terminal, not Git Bash's own window.\n",
    );
    expect(checked).toBe(false);
  });

  // M10: Ctrl+D at a pause ends the terminal's input. Nothing is running at a pause.
  it("stops on Ctrl+D at a pause, says so, and exits 1", async () => {
    const run = await atTerminal(["demo"], ["\u0004"], {
      platformReadiness: () => Promise.resolve(NOT_READY),
    });
    expect(run.code).toBe(1);
    expect(run.out).toContain("Stopped: the input ended (Ctrl+D). Nothing is left running.\n");
    expect(run.out).not.toContain("Step 2 of 7");
  });

  // The next three use Linux's real readiness module, which main.ts loads when no test's readiness
  // is given. It's safe: Linux has no screen reader to drive, so the tour stops at step 2.
  it("checks this computer with voicecap's own settings, whatever this folder's config says", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-"));
    // I2: a config that can't even load, which would stop anything that read it.
    await writeFile(
      path.join(cwd, "voicecap.config.json"),
      JSON.stringify({ passes: "every one" }),
    );
    const run = await atTerminal(["demo"], [""], { cwd });
    expect(run.code).toBe(2);
    expect(run.out).toContain("Step 2 of 7 · Checking this computer");
    expect(run.out).toContain("Not ready: 1 problem.");
  });

  it("names the demo's own folder as step 2's transcripts home", async () => {
    // M5: never the person's VOICECAP_TRANSCRIPTS audit record, or ./transcripts.
    const run = await atTerminal(["demo"], [""], {
      env: { VOICECAP_TRANSCRIPTS: path.join(os.tmpdir(), "audit-record") },
    });
    expect(run.code).toBe(2);
    expect(run.out).toContain(`\n  Transcripts     ${path.join(run.cwd, "voicecap-demo")}\n`);
  });

  it("says where the tour runs on Linux, with none of the advice it can't take", async () => {
    // M8: Linux's fix step for runs adds --replay-from, which demo doesn't take.
    const run = await atTerminal(["demo"], [""]);
    expect(run.code).toBe(2);
    expect(run.out).toContain("1. No screen reader to drive here\n");
    expect(run.out).toContain("     1. Run real audits on a Windows computer or a Mac.\n");
    expect(run.out).not.toContain("--replay-from");
    expect(run.out).not.toContain("When this computer is ready");
    expect(run.out).toContain(
      "\n\nThe tour runs on a Windows PC, or on a Mac for the checks: run npx @icjia/voicecap demo there.\n",
    );
  });

  it("stops at step 2 when the computer isn't ready, and exits 2", async () => {
    const run = await atTerminal(["demo"], [""], {
      platformReadiness: () => Promise.resolve(NOT_READY),
    });
    expect(run.code).toBe(2);
    expect(run.out).toContain("Step 1 of 7 · Welcome");
    expect(run.out).toContain("Not ready: 1 problem.");
    expect(run.out).toContain("When this computer is ready, run npx @icjia/voicecap demo again.");
    expect(run.out).not.toContain("Step 3 of 7");
  });

  it("stops on Ctrl+C at the first pause, with nothing left running (130)", async () => {
    const run = await atTerminal(["demo"], ["\u0003"], {
      platformReadiness: () => Promise.resolve(NOT_READY),
    });
    expect(run.code).toBe(130);
    expect(run.out).toContain("Stopped. Nothing is left running.");
    expect(run.out).not.toContain("Step 2 of 7");
  });

  // Every path of the tour is in test/demo-tour.test.ts, with fakes. This proves main.ts's wiring,
  // on a Mac-like computer, with the demo site, runs, and the opener replaced by modules that
  // refuse to run: the Mac's tour must never reach them.
  it("takes a Mac to step 7 without starting the demo site, a run, or the opener", async () => {
    const refuse = () => {
      throw new Error("The Mac's tour must never start this.");
    };
    vi.resetModules();
    vi.doMock("../src/demo/server.js", async (importOriginal) => ({
      ...(await importOriginal<object>()),
      startDemoServer: refuse,
    }));
    vi.doMock("../src/run/audit.js", async (importOriginal) => ({
      ...(await importOriginal<object>()),
      runAudit: refuse,
    }));
    vi.doMock("../src/drivers/open-file.js", async (importOriginal) => ({
      ...(await importOriginal<object>()),
      openFile: refuse,
    }));
    try {
      const { main: mainWithRefusals } = await import("../src/cli/main.js");
      const run = await atTerminal(
        ["demo"],
        ["", "", "", ""],
        { platform: "darwin", platformReadiness: () => Promise.resolve(macLike()) },
        mainWithRefusals,
      );
      expect(run.code).toBe(0);
      expect(run.out).toContain(
        "  WARN  The full demo runs on a Windows PC for now: on this Mac, the tour stops after the live test",
      );
      expect(run.out).toContain("Step 7 of 7 · Your own site");
      expect(run.out).not.toContain("Step 5 of 7");
    } finally {
      vi.doUnmock("../src/demo/server.js");
      vi.doUnmock("../src/run/audit.js");
      vi.doUnmock("../src/drivers/open-file.js");
      vi.resetModules();
    }
  });
});
