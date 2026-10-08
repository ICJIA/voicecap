import { existsSync } from "node:fs";
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename as fsRename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import { XMLValidator } from "fast-xml-parser";
import { afterEach, describe, expect, it, vi } from "vitest";

import { main, nvdaRunningOn } from "../src/cli/main.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { listManualSessions } from "../src/manual/list.js";
import type { ReviewsFile, RunJson, SharesFile } from "../src/model.js";
import type { PlatformReadiness } from "../src/readiness/model.js";
import { REPLAY_TEXT } from "../src/review-replay/text.js";
import type { Voice } from "../src/review-replay/voice.js";
import type { RunAuditOptions } from "../src/run/audit.js";
import { manualSessionDir, runDir, shareDir, sharesPath, shareWordPath } from "../src/run/paths.js";
import { longDate, sizeLine } from "../src/share/format.js";
import { parseWalkthrough } from "../src/share/walkthrough.js";
import { writeShareFiles } from "../src/share/write.js";
import { formatCommand } from "../src/util/command-line.js";
import { EnvironmentError } from "../src/util/errors.js";
import { sha256 } from "../src/util/hash.js";
import { createMemoryLogger, type OutputStream } from "../src/util/log.js";
import { paragraphsOf, unzipDocx } from "./helpers/docx.js";
import { gitBashForm } from "./helpers/git-bash.js";
import { realSitesFetch } from "./helpers/real-sites.js";
import { fakeVoice, ttyInput } from "./helpers/replay.js";
import { homeWithCountedRun, MACHINE_PROBE, SITE as EXAMPLE_SITE } from "./helpers/run-site.js";
import { homeWithShares } from "./helpers/site-home.js";

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
  replayVoice?: () => Promise<Voice>;
  nvdaRunning?: () => Promise<boolean>;
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

/**
 * A command line split into its arguments, as Git Bash splits what `formatCommand` writes (and
 * PowerShell too, unless a value has a single quote in it): words apart at spaces, a value in
 * single quotes whole, a backslash in it just a backslash, and `'\''` for a single quote inside one.
 */
function splitCommand(line: string): string[] {
  const args: string[] = [];
  let word = "";
  // An empty value, '', is still an argument.
  let started = false;
  let quoted = false;
  for (let at = 0; at < line.length; at++) {
    const char = line.charAt(at);
    if (quoted) {
      if (char === "'") quoted = false;
      else word += char;
    } else if (char === "'") {
      quoted = true;
      started = true;
    } else if (char === "\\" && line.charAt(at + 1) === "'") {
      word += "'";
      started = true;
      at++;
    } else if (char === " ") {
      if (started) args.push(word);
      word = "";
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  if (started) args.push(word);
  return args;
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

describe("--canonical", () => {
  const replay = [
    "--site",
    SITE,
    "--pages",
    fixture("pages.json"),
    "--replay-from",
    fixture("replay-run"),
  ];

  /** The run.json of the run a command made in `cwd`'s home. */
  async function recordIn(cwd: string): Promise<RunJson> {
    const out = path.join(cwd, "transcripts", "127.0.0.1_4747");
    const runId = (await readFile(path.join(out, "latest.txt"), "utf8")).trim();
    return JSON.parse(await readFile(path.join(runDir(out, runId), "run.json"), "utf8")) as RunJson;
  }

  it("is in the help", async () => {
    expect((await cli(["--help"])).out).toContain("--canonical <address>");
  });

  it("records the address it gives as the run's root, and leaves the site as it was read", async () => {
    const run = await cli([...replay, "--canonical", "dvfr.illinois.gov"]);
    expect(run.code).toBe(0);
    const record = await recordIn(run.cwd);
    expect(record.canonical).toBe("https://dvfr.illinois.gov/");
    expect(record.site).toBe(SITE);
    // The terminal says nothing new about it.
    expect(run.out).not.toMatch(/canonical/i);
  });

  it("leaves a replay run without a root when it isn't given, as a replay learns none", async () => {
    const run = await cli(replay);
    expect(run.code).toBe(0);
    expect(await recordIn(run.cwd)).not.toHaveProperty("canonical");
  });

  it.each([
    [
      "ftp://dvfr.illinois.gov",
      `"ftp://dvfr.illinois.gov" isn't a web address, such as https://dvfr.illinois.gov.`,
    ],
    [
      "http://localhost:3000",
      `"http://localhost:3000" is an IP address or a local address, not a site's name; give the address people visit, such as https://dvfr.illinois.gov.`,
    ],
  ])("refuses %s as a usage error, before anything runs", async (value, message) => {
    const run = await cli([...replay, "--canonical", value]);
    expect(run.code).toBe(1);
    expect(run.err).toContain(message);
    expect(existsSync(path.join(run.cwd, "transcripts"))).toBe(false);
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

  // A home of many sites needs --site, and a home that --out gave needs --out, so the warning for a
  // Word copy that Word holds gives the command with both: a person who copies it runs it as it is.
  it("runs the command a held Word copy's warning gives, in a home with two sites, and writes the Word copy", async () => {
    // A folder with a space in its name, so that the home's path is quoted wherever this runs.
    const cwd = await mkdtemp(path.join(os.tmpdir(), "voicecap cli "));
    const run = await cli(
      ["--site", SITE, "--pages", fixture("pages.json"), "--replay-from", fixture("replay-run")],
      cwd,
    );
    expect(run.code).toBe(0);
    const home = path.join(cwd, "transcripts");
    const site = path.join(home, "127.0.0.1_4747");
    // A second site, so that `report` alone can't tell which one is meant.
    await mkdir(path.join(home, "dvfr.illinois.gov", "2026-09-27"), { recursive: true });
    const bare = await cli(["report"], cwd);
    expect(bare.code).toBe(1);
    expect(bare.err).toContain("add --site.");

    // Word holds current.docx: the page is written, and the Word copy isn't.
    await rm(shareDir(site), { recursive: true, force: true });
    const logger = createMemoryLogger();
    await writeShareFiles({
      siteDir: site,
      config: DEFAULT_CONFIG,
      logger,
      rename: async (from, to) => {
        if (to.endsWith("current.docx")) {
          const message = `EPERM: operation not permitted, rename '${from}' -> '${to}'`;
          throw Object.assign(new Error(message), { code: "EPERM" });
        }
        await fsRename(from, to);
      },
    });
    expect(await readdir(shareDir(site))).toEqual(["current.html"]);

    // The command the warning printed, split into its arguments as a shell does: `report`, the site,
    // and the home, whole.
    const [, command = ""] = /then run: (npx @icjia\/voicecap .+)$/.exec(logger.text("warn")) ?? [];
    const [npx, voicecap, ...args] = splitCommand(command);
    expect([npx, voicecap]).toEqual(["npx", "@icjia/voicecap"]);
    expect(args).toEqual(["report", "--site", SITE, "--out", home]);

    // Word has let go. Run from another folder, as a person may, the command works.
    const elsewhere = await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-"));
    const report = await cli(args, elsewhere);

    expect(report.err).toBe("");
    expect(report.code).toBe(0);
    expect(report.out).toContain(`Word copy: ${shareWordPath(site)}\n`);
    expect((await readdir(shareDir(site))).sort()).toEqual(["current.docx", "current.html"]);
    expect(
      XMLValidator.validate((await unzipDocx(await readFile(shareWordPath(site)))).document),
    ).toBe(true);
  });

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

/**
 * `voicecap review --replay`, wired from the command line: its checks, and a session at a terminal.
 * The session itself is test/review-replay-session.test.ts's. Every test here gives the CLI a fake
 * voice and a fake check for NVDA, or stops before either is asked for, and says it's on Linux, so
 * nothing could speak or reach NVDA even if one were missed.
 */
describe("voicecap review --replay", () => {
  /** Each folder these tests made, which is taken away after each test. */
  const made: string[] = [];

  afterEach(async () => {
    await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  /** A new, empty folder, taken away after the test. */
  async function emptyFolder(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-"));
    made.push(dir);
    return dir;
  }

  /**
   * A home with the scripted site's counted run, taken away after the test. Its pages are / and
   * /about, with no flags, and /resources, with 5: so by default only /resources plays.
   */
  async function countedHome() {
    const { dir, siteDir, run } = await homeWithCountedRun();
    made.push(dir);
    return { home: path.join(dir, "transcripts"), siteDir, runId: run.runId };
  }

  /** The keyboard of a person at a terminal: what ttyInput gives. */
  type Keyboard = ReturnType<typeof ttyInput>;

  /**
   * `voicecap review --replay` with `args`, from an empty folder, at a terminal: its input is a
   * keyboard (ttyInput), and its output a terminal's screen, which `onScreen` sees as it's shown,
   * with the keyboard to type on. Its voice says each line at once, and NVDA isn't running, unless
   * `extra` says otherwise. Linux, as in cli(), so nothing real could start even without them.
   */
  async function replayAt(
    args: string[],
    onScreen: (shown: string, keyboard: Keyboard) => void,
    extra: CliExtra & { env?: NodeJS.ProcessEnv } = {},
  ) {
    const keyboard = ttyInput();
    const screen = terminalScreen((shown) => onScreen(shown, keyboard));
    const stderr = capture();
    const voice = fakeVoice({ auto: true });
    const replayVoice = vi.fn((): Promise<Voice> => Promise.resolve(voice));
    const nvdaRunning = vi.fn(() => Promise.resolve(false));
    try {
      const code = await main(["review", "--replay", ...args], {
        stdout: screen.stream,
        stderr: stderr.stream,
        cwd: await emptyFolder(),
        env: {},
        signal: new AbortController().signal,
        interactive: false,
        stdin: keyboard,
        replayVoice,
        nvdaRunning,
        ...extra,
        platform: extra.platform ?? "linux",
      });
      return {
        code,
        screen: screen.text(),
        err: stderr.text(),
        keyboard,
        voice,
        replayVoice,
        nvdaRunning,
      };
    } finally {
      keyboard.end();
    }
  }

  /** The person types `keys` once the question after a page is shown. */
  function answer(keys: string) {
    return (shown: string, keyboard: Keyboard): void => {
      if (shown.includes(REPLAY_TEXT.question)) setImmediate(() => keyboard.write(keys));
    };
  }

  /** Nothing a person does: for a session that stops before it asks anything. */
  const noAnswer = (): void => {};

  /** Whatever the help says, on one line, so where it wraps doesn't matter. */
  const squeezed = (text: string) => text.replace(/\s+/g, " ");

  it("review needs --page and --status, unless --replay is given", async () => {
    const noPage = await cli(["review", "--status", "reviewed"], await emptyFolder());
    expect(noPage.code).toBe(1);
    expect(noPage.err).toBe("Error: --page is required, unless --replay is given.\n");

    const noStatus = await cli(["review", "--page", "/"], await emptyFolder());
    expect(noStatus.code).toBe(1);
    expect(noStatus.err).toBe("Error: --status is required, unless --replay is given.\n");
  });

  it("review --replay takes no --status, --note, or --run, and checks --rate", async () => {
    const replayVoice = vi.fn((): Promise<Voice> => Promise.resolve(fakeVoice({ auto: true })));
    const review = async (args: string[]) =>
      cli(["review", ...args], await emptyFolder(), {}, { replayVoice });

    for (const decided of [
      ["--status", "reviewed"],
      ["--note", "Reads well"],
      ["--run", "x"],
    ]) {
      const refused = await review(["--replay", ...decided]);
      expect(refused.code, decided[0]).toBe(1);
      expect(refused.err, decided[0]).toBe(
        "Error: --replay asks for each decision itself, so it doesn't take --status, --note, or --run.\n",
      );
    }

    for (const rate of ["20", "59", "541", "180.5", "fast", ""]) {
      const refused = await review(["--replay", "--rate", rate]);
      expect(refused.code, rate).toBe(1);
      expect(refused.err, rate).toBe(
        `Error: --rate is in words a minute, a whole number from 60 to 540 (got "${rate}").\n`,
      );
    }
    // The slowest and the fastest are speeds it takes: it goes on, to say it needs a terminal.
    for (const rate of ["60", "540"]) {
      const taken = await review(["--replay", "--rate", rate]);
      expect(taken.err, rate).toBe(`Error: ${REPLAY_TEXT.noTerminal}\n`);
    }

    const both = await review(["--replay", "--all", "--page", "/"]);
    expect(both.code).toBe(1);
    expect(both.err).toBe("Error: --all and --page can't be used together.\n");

    // Without --replay, --all and --rate have nothing to go with.
    for (const alone of [["--all"], ["--rate", "160"]]) {
      const refused = await review(["--page", "/", "--status", "reviewed", ...alone]);
      expect(refused.code, alone[0]).toBe(1);
      expect(refused.err, alone[0]).toBe("Error: --all and --rate go with --replay.\n");
    }
    expect(replayVoice).not.toHaveBeenCalled();
  });

  it("--replay needs a terminal", async () => {
    const replayVoice = vi.fn((): Promise<Voice> => Promise.resolve(fakeVoice({ auto: true })));
    /** `review --replay` with its output captured, as from a script, and its input `stdin`. */
    const fromScript = async (stdin: NodeJS.ReadableStream) =>
      cli(["review", "--replay"], await emptyFolder(), {}, { stdin, replayVoice });

    const piped = await fromScript(linesStream());
    expect(piped.code).toBe(1);
    expect(piped.err).toBe(`Error: ${REPLAY_TEXT.noTerminal}\n`);

    // A keyboard with the output redirected: it stops before taking the keys, so the terminal is
    // never put in raw mode.
    const keyboard = ttyInput();
    const redirected = await fromScript(keyboard);
    keyboard.end();
    expect(redirected.code).toBe(1);
    expect(redirected.err).toBe(`Error: ${REPLAY_TEXT.noTerminal}\n`);
    expect(keyboard.rawModes).toEqual([]);

    // A screen with the input piped in.
    const typedAhead = await replayAt([], noAnswer, { stdin: linesStream(["1"]), replayVoice });
    expect(typedAhead.code).toBe(1);
    expect(typedAhead.err).toBe(`Error: ${REPLAY_TEXT.noTerminal}\n`);
    expect(typedAhead.screen).toBe("");

    expect(replayVoice).not.toHaveBeenCalled();
  });

  it("hears a page at a terminal, and records the decision", async () => {
    const { home, siteDir, runId } = await countedHome();
    /** How many listeners the process has for the signals of a closed window. */
    const closedWindow = () => ["SIGHUP", "SIGTERM"].map((signal) => process.listenerCount(signal));
    const before = closedWindow();
    let during: number[] = [];

    const heard = await replayAt(
      ["--page", "/about", "--reviewer", "Pat Reviewer", "--out", home],
      (shown, keyboard) => {
        if (!shown.includes(REPLAY_TEXT.question)) return;
        during = closedWindow();
        setImmediate(() => keyboard.write("1"));
      },
    );

    expect(heard.err).toBe("");
    expect(heard.code).toBe(0);
    const { pages } = JSON.parse(
      await readFile(path.join(siteDir, "reviews.json"), "utf8"),
    ) as ReviewsFile;
    expect(pages[`${EXAMPLE_SITE}/about`]).toMatchObject([
      { status: "reviewed", reviewer: "Pat Reviewer", run: runId },
    ]);
    expect(heard.keyboard.rawModes).toEqual([true, false]);
    expect(heard.screen).toContain("Page 1 of 1: /about (no flags)\n");
    expect(heard.screen).toContain("Recorded 1 decision.\n");
    // /about's lines, and the session's own, at the speed a session starts at, in the voice the CLI
    // was given, which is closed after.
    expect(heard.voice.said.map(({ text, wpm }) => [text, wpm])).toEqual([
      [REPLAY_TEXT.keysSpoken, 180],
      ["Page 1 of 1: /about (no flags)", 180],
      ["Read transcript, 3 lines:", 180],
      ["heading, level 1, About us", 180],
      ["We are an example.", 180],
      ["© 2026 Example Agency", 180],
      [REPLAY_TEXT.questionSpoken, 180],
      ["Recorded: reviewed, no issues.", 180],
      ["Recorded 1 decision.", 180],
    ]);
    expect(heard.voice.closed).toBe(true);
    expect(heard.nvdaRunning).toHaveBeenCalledTimes(1);
    // A closed window would have ended it while it ran, and nothing is left watching for one.
    expect(during).toEqual(before.map((count) => count + 1));
    expect(closedWindow()).toEqual(before);
  });

  it("exits with 130 when Ctrl+C ends it", async () => {
    const { home, siteDir } = await countedHome();
    const ended = await replayAt(
      ["--page", "/about", "--reviewer", "Pat Reviewer", "--out", home],
      answer("\u0003"),
    );
    expect(ended.err).toBe("");
    expect(ended.code).toBe(130);
    expect(ended.screen).toContain("Recorded no decisions.\n");
    expect(existsSync(path.join(siteDir, "reviews.json"))).toBe(false);
    expect(ended.keyboard.rawModes).toEqual([true, false]);
    expect(ended.voice.closed).toBe(true);
  });

  it("gives the terminal back however the session ends", async () => {
    const { home, siteDir } = await countedHome();
    const args = ["--page", "/about", "--reviewer", "Pat Reviewer", "--out", home];
    /** What every way out leaves: raw mode off, the voice closed, and the count said last. */
    const givenBack = (
      ended: { keyboard: Keyboard; screen: string },
      voice: ReturnType<typeof fakeVoice>,
      way: string,
    ) => {
      expect(ended.keyboard.rawModes, way).toEqual([true, false]);
      expect(voice.closed, way).toBe(true);
      expect(ended.screen.endsWith("Recorded no decisions.\n"), way).toBe(true);
    };

    // The window closed. Its SIGHUP is given only to the listener the CLI added for it, never sent:
    // the process's other listeners aren't the test's to call.
    const before = new Set(process.listeners("SIGHUP"));
    let added: NodeJS.SignalsListener[] = [];
    const closed = await replayAt(args, (shown, keyboard) => {
      if (!shown.includes(REPLAY_TEXT.question) || added.length > 0) return;
      added = process.listeners("SIGHUP").filter((listener) => !before.has(listener));
      // Were there another, the keys end instead, and the length below fails.
      setImmediate(() => (added.length === 1 ? added[0]!("SIGHUP") : keyboard.end()));
    });
    expect(added).toHaveLength(1);
    expect(closed.err).toBe("");
    expect(closed.code).toBe(130);
    givenBack(closed, closed.voice, "the window closed");
    expect(process.listeners("SIGHUP")).toEqual([...before]);

    // The keys ended, as when the terminal's input closes.
    const keysEnded = await replayAt(args, (shown, keyboard) => {
      if (shown.includes(REPLAY_TEXT.question)) setImmediate(() => keyboard.end());
    });
    expect(keysEnded.err).toBe("");
    expect(keysEnded.code).toBe(130);
    givenBack(keysEnded, keysEnded.voice, "the keys ended");

    // The voice stopped working, on the page's first line: this computer can't go on (exit 2).
    const stopped = fakeVoice({ auto: true });
    stopped.fail(new EnvironmentError("The computer's voice stopped."));
    const voiceStopped = await replayAt(args, noAnswer, {
      replayVoice: () => Promise.resolve(stopped),
    });
    expect(voiceStopped.err).toBe("Error: The computer's voice stopped.\n");
    expect(voiceStopped.code).toBe(2);
    givenBack(voiceStopped, stopped, "the voice stopped");

    // A decision addReview refuses: the review history is damaged, and voicecap never overwrites it.
    const refused = await replayAt(args, (shown, keyboard) => {
      if (!shown.includes(REPLAY_TEXT.question)) return;
      void writeFile(path.join(siteDir, "reviews.json"), "{ this is not json").then(() =>
        keyboard.write("1"),
      );
    });
    expect(refused.err).toMatch(/never overwrites review history/);
    expect(refused.code).toBe(1);
    givenBack(refused, refused.voice, "addReview refused");
  });

  it("puts the terminal back when it stops before a page is heard", async () => {
    const { home, siteDir } = await countedHome();
    // A usage error, found before the voice starts.
    const nowhere = await replayAt(
      ["--page", "/nowhere", "--reviewer", "Pat Reviewer", "--out", home],
      noAnswer,
    );
    expect(nowhere.code).toBe(1);
    expect(nowhere.err).toBe(
      `Error: ${EXAMPLE_SITE}/nowhere isn't one of the pages in scope, so there's no transcript of it to hear.\n`,
    );
    expect(nowhere.keyboard.rawModes).toEqual([true, false]);
    expect(nowhere.replayVoice).not.toHaveBeenCalled();

    // No voice to read with: this computer can't do it (exit 2), and nothing is recorded.
    const voiceless = await replayAt(
      ["--page", "/about", "--reviewer", "Pat Reviewer", "--out", home],
      answer("1"),
      {
        replayVoice: () =>
          Promise.reject(
            new EnvironmentError("The computer's voice didn't start: no voice is installed."),
          ),
      },
    );
    expect(voiceless.code).toBe(2);
    expect(voiceless.err).toBe(
      "Error: The computer's voice didn't start: no voice is installed.\n",
    );
    expect(voiceless.screen).toBe("");
    expect(voiceless.keyboard.rawModes).toEqual([true, false]);
    expect(voiceless.nvdaRunning).not.toHaveBeenCalled();
    expect(existsSync(path.join(siteDir, "reviews.json"))).toBe(false);
  });

  it("plays What needs attention's pages by default, or every page with --all, at --rate's speed", async () => {
    const { home, siteDir } = await countedHome();
    // The home VOICECAP_TRANSCRIPTS names, as review finds it without --out.
    const extra = { env: { VOICECAP_TRANSCRIPTS: home } };
    const reviewer = ["--reviewer", "Pat Reviewer"];

    const needsAttention = await replayAt([...reviewer, "--rate", "160"], answer("4"), extra);
    expect(needsAttention.err).toBe("");
    expect(needsAttention.code).toBe(0);
    expect(needsAttention.screen).toContain("Page 1 of 1: /resources (5 flags)\n");
    expect(needsAttention.screen).toContain("Recorded no decisions.\n");
    expect(needsAttention.voice.said).not.toEqual([]);
    expect(needsAttention.voice.said.filter(({ wpm }) => wpm !== 160)).toEqual([]);

    // Every page: Ctrl+C at the first question ends it there.
    const every = await replayAt([...reviewer, "--all"], answer("\u0003"), extra);
    expect(every.err).toBe("");
    expect(every.code).toBe(130);
    expect(every.screen).toContain("Page 1 of 3: / (no flags)\n");
    expect(every.screen).not.toContain("Page 2 of 3");
    expect(existsSync(path.join(siteDir, "reviews.json"))).toBe(false);
  });

  it("says what --replay, --all, and --rate do in review's help", async () => {
    const help = await cli(["review", "--help"], await emptyFolder());
    expect(help.code).toBe(0);
    expect(squeezed(help.out)).toContain(
      "--replay hear each page's saved transcript read aloud at a normal speed, and decide as you go",
    );
    expect(squeezed(help.out)).toContain("--all with --replay: every page with transcripts");
    expect(squeezed(help.out)).toContain(
      "--rate <wpm> with --replay: the voice's speed in words a minute, 60 to 540 (default 180)",
    );
  });

  it("lists review in voicecap --help as a way to hear pages again, as well as to record a review", async () => {
    const help = await cli(["--help"], await emptyFolder());
    expect(help.code).toBe(0);
    expect(squeezed(help.out)).toContain(
      "review [options] add an entry to a page's review history, or hear pages again with --replay",
    );
  });

  // The list doctor reads compiles C# whenever an nvda.exe is running, which can take longer than
  // the 5 seconds the check is given, so the warning would be skipped just when it's needed.
  it("asks whether NVDA is running by counting each nvda.exe in Windows' list of programs", async () => {
    const listProcesses = vi.fn((_image: string) => Promise.resolve([4242]));
    const nvdaProcesses = vi.fn(() => Promise.reject(new Error("It compiles C# while NVDA runs.")));
    vi.resetModules();
    vi.doMock("../src/drivers/guidepup/windows.js", async (importOriginal) => ({
      ...(await importOriginal<object>()),
      listProcesses,
      nvdaProcesses,
    }));
    try {
      const { nvdaRunningOn: byDefault } = await import("../src/cli/main.js");
      await expect(byDefault("win32")()).resolves.toBe(true);
      listProcesses.mockResolvedValueOnce([]);
      await expect(byDefault("win32")()).resolves.toBe(false);
      expect(listProcesses.mock.calls).toEqual([["nvda.exe"], ["nvda.exe"]]);
      expect(nvdaProcesses).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("../src/drivers/guidepup/windows.js");
      vi.resetModules();
    }
  });

  it("asks whether NVDA is running only on Windows, and starts without the answer after 5 seconds", async () => {
    // The process ids of the running nvda.exe, as tasklist lists them.
    const running = [4242];
    await expect(nvdaRunningOn("win32", () => Promise.resolve(running))()).resolves.toBe(true);
    await expect(nvdaRunningOn("win32", () => Promise.resolve([]))()).resolves.toBe(false);
    // A check that fails says so, and the session starts all the same.
    const unanswered = new Error("Command failed: tasklist");
    const failing = nvdaRunningOn("win32", () => Promise.reject(unanswered));
    await expect(failing()).rejects.toBe(unanswered);
    // Nowhere else is there an NVDA to ask about.
    const elsewhere = vi.fn(() => Promise.resolve(running));
    for (const platform of ["darwin", "linux"] as const) {
      await expect(nvdaRunningOn(platform, elsewhere)(), platform).resolves.toBe(false);
    }
    expect(elsewhere).not.toHaveBeenCalled();

    vi.useFakeTimers();
    try {
      // A check that never answers counts as not running after 5 seconds, so the session never
      // waits more than 5 seconds on it.
      let answered: boolean | undefined;
      void nvdaRunningOn("win32", () => new Promise<number[]>(() => {}))().then((value) => {
        answered = value;
      });
      await vi.advanceTimersByTimeAsync(4_999);
      expect(answered).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(answered).toBe(false);
      // One that answers in time leaves no timer behind to hold voicecap open.
      await expect(nvdaRunningOn("win32", () => Promise.resolve([]))()).resolves.toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
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
      "127.0.0.1_4747: 1 run (0 incomplete), 0 manual sessions, 0 reviews, 0 shares checked: everything matches.\n",
    );

    const site = path.join(run.cwd, "records", "127.0.0.1_4747");
    const runId = (await readFile(path.join(site, "latest.txt"), "utf8")).trim();
    await appendFile(path.join(runDir(site, runId), "pages", "home", "read.txt"), "Added.\n");
    const changed = await cli(["verify", "--site", SITE, "--out", "records"], run.cwd);
    expect(changed.err).toBe("");
    expect(changed.code).toBe(3);
    expect(changed.out).toBe(
      `127.0.0.1_4747/${runId.slice(0, 10)}/${runId.slice(11)}/pages/home/read.txt: changed since it was recorded (SHA-256 differs)\n` +
        "127.0.0.1_4747: 1 run (0 incomplete), 0 manual sessions, 0 reviews, 0 shares checked: 1 problem.\n",
    );
  });
});

describe("voicecap share", () => {
  /** Whatever the help says, on one line, so where it wraps doesn't matter. */
  const squeezed = (text: string) => text.replace(/\s+/g, " ");

  it("makes the dated pair, records it, and prints the line to paste into the email, last", async () => {
    const { dir, siteDir, run } = await homeWithCountedRun();

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
    // The site's scripted pages name no canonical address, so the entry records the address voicecap
    // read, as a root.
    expect(entry).toMatchObject({
      seq: 1,
      prev: null,
      by: "Pat Lee",
      site: "https://example.illinois.gov/",
    });
    const page = entry.files[0]!;
    const word = entry.files[1]!;
    const walkthrough = entry.files[2]!;
    // Named for the site (here by the host voicecap read) and the day, as the page, then its Word
    // copy, then the run's walkthrough file, whole on disk.
    const day = entry.at.slice(0, 10);
    expect([page.name, word.name, walkthrough.name]).toEqual([
      `example.illinois.gov_${day}.html`,
      `example.illinois.gov_${day}.docx`,
      `example.illinois.gov_${day}_${run.runId}_walkthrough.json`,
    ]);
    for (const file of [page, word, walkthrough]) {
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
        `  ${path.join(shareDir(siteDir), walkthrough.name)}`,
        `    ${sizeLine(walkthrough.bytes)}, SHA-256 ${walkthrough.sha256}`,
        "To paste into the email that sends the page and its Word copy:",
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

  // Ruling P13a. The demo runs voicecap 0.4.1 recorded read http://127.0.0.1:4848, and named no
  // canonical address.
  it("exits 1, says how to name the site, and writes nothing, for a site read at an IP address with no canonical address", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-"));
    const home = path.join(root, "transcripts");
    await cp(fileURLToPath(new URL("./fixtures/share/demo-2026-09-29", import.meta.url)), home, {
      recursive: true,
    });
    const before = await readdir(root, { recursive: true });

    const share = await cli(["share", "--out", home, "--reviewer", "Pat Lee"], root);

    expect(share.code).toBe(1);
    expect(share.out).toBe("");
    expect(share.err).toBe(
      "Error: voicecap won't share a site by an IP address or a local address (127.0.0.1:4848). Give it the address people visit: set report.canonical in a voicecap config in a folder of the site's own, and share from that folder; or run it again with --canonical <address>.\n",
    );
    expect(await readdir(root, { recursive: true })).toEqual(before);
  });

  it("is listed in the help, with what it does", async () => {
    const help = await cli(["--help"]);

    expect(help.code).toBe(0);
    expect(squeezed(help.out)).toContain(
      "share [options] make a dated copy of the shareable page, its Word copy, and each run's walkthrough file to send, and record them",
    );
  });

  it("has --site, --out, and --reviewer, each with its own words", async () => {
    const help = await cli(["share", "--help"]);

    expect(help.code).toBe(0);
    const said = squeezed(help.out);
    expect(said).toContain(
      "make a dated copy of the shareable page, its Word copy, and each run's walkthrough file to send, and record them",
    );
    expect(said).toContain(
      "--site <url> the site's address, or its canonical address (default: the home's only site)",
    );
    expect(said).toContain(
      "--out <dir> transcripts home (default: VOICECAP_TRANSCRIPTS, else ./transcripts)",
    );
    expect(said).toContain(
      "--reviewer <name> who is sharing (default: VOICECAP_REVIEWER, git config user.name, or the config's reviewer)",
    );
  });
});

describe("voicecap walkthrough", () => {
  /** Whatever the help says, on one line, so where it wraps doesn't matter. */
  const squeezed = (text: string) => text.replace(/\s+/g, " ");

  /**
   * A copy of the demo runs voicecap 0.4.1 recorded, as a home: 1315 and 1402 completed, 1415 and
   * 1419 interrupted, all of 127.0.0.1_4848. `withAnotherSite` adds a second site's folder, so that
   * no site is the only one.
   */
  async function demoHome(withAnotherSite = false): Promise<string> {
    const home = await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-"));
    await cp(path.join(ROOT, "test", "fixtures", "share", "demo-2026-09-29"), home, {
      recursive: true,
    });
    if (withAnotherSite) {
      await mkdir(path.join(home, "example.illinois.gov", "2026-09-29"), { recursive: true });
    }
    return home;
  }

  it("writes the file of the latest completed run, and prints how to repeat it", async () => {
    const { dir, run } = await homeWithCountedRun();
    const file = path.join(dir, "walkthrough.json");

    const walkthrough = await cli(
      ["walkthrough", "--out", path.join(dir, "transcripts"), "--site", EXAMPLE_SITE, file],
      dir,
    );

    expect(walkthrough.err).toBe("");
    expect(walkthrough.code).toBe(0);
    expect(walkthrough.out).toBe(
      [
        `Wrote the walkthrough of run ${run.runId} (3 pages) to ${file}.`,
        `To repeat the run: ${formatCommand(["--walkthrough", file])}`,
        "",
      ].join("\n"),
    );
    expect(parseWalkthrough(await readFile(file, "utf8"), file).original.run).toBe(run.runId);
    // The command, split as a shell splits it, gives the file back whole.
    const [, command = ""] =
      /^To repeat the run: (npx @icjia\/voicecap .+)$/m.exec(walkthrough.out) ?? [];
    expect(splitCommand(command)).toEqual(["npx", "@icjia/voicecap", "--walkthrough", file]);
  });

  it("takes the run --run names, in the site --site names, in the home --out names", async () => {
    // Each option has to get through: without --run it would be 1402, the latest completed; without
    // --site, this home has two sites to choose from; and without --out, the home is the default
    // one where it's run, which has no site folders.
    const home = await demoHome(true);
    const elsewhere = await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-"));
    const file = path.join(elsewhere, "walkthrough.json");

    const walkthrough = await cli(
      [
        "walkthrough",
        "--out",
        home,
        "--site",
        "http://127.0.0.1:4848",
        "--run",
        "2026-09-29_1315",
        file,
      ],
      elsewhere,
    );

    expect(walkthrough.err).toBe("");
    expect(walkthrough.code).toBe(0);
    expect(walkthrough.out.split("\n")[0]).toBe(
      `Wrote the walkthrough of run 2026-09-29_1315 (7 pages) to ${file}.`,
    );
    expect(parseWalkthrough(await readFile(file, "utf8"), file).original.run).toBe(
      "2026-09-29_1315",
    );
  });

  it("takes the home from VOICECAP_TRANSCRIPTS, its only site, and the file as named from where it's run", async () => {
    const home = await demoHome();
    const elsewhere = await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-"));
    const file = path.join(elsewhere, "walkthrough.json");

    const walkthrough = await cli(["walkthrough", "walkthrough.json"], elsewhere, {
      VOICECAP_TRANSCRIPTS: home,
    });

    expect(walkthrough.err).toBe("");
    expect(walkthrough.code).toBe(0);
    // The latest completed run: 1415 and 1419 came after it, and were interrupted.
    expect(walkthrough.out.split("\n")[0]).toBe(
      `Wrote the walkthrough of run 2026-09-29_1402 (7 pages) to ${file}.`,
    );
    expect(parseWalkthrough(await readFile(file, "utf8"), file).original.run).toBe(
      "2026-09-29_1402",
    );
  });

  it("exits 1, and says why, when --run names an interrupted run", async () => {
    const home = await demoHome();

    const walkthrough = await cli(
      ["walkthrough", "--out", home, "--run", "2026-09-29_1415", "walkthrough.json"],
      home,
    );

    expect(walkthrough.code).toBe(1);
    expect(walkthrough.out).toBe("");
    expect(walkthrough.err).toBe(
      "Error: Run 2026-09-29_1415 didn't complete, so it can't be repeated. Run it to the end first.\n",
    );
    expect(existsSync(path.join(home, "walkthrough.json"))).toBe(false);
  });

  it("exits 1, and says why, when the file is already there", async () => {
    const { dir } = await homeWithCountedRun();
    const file = path.join(dir, "walkthrough.json");
    await writeFile(file, "mine");

    const walkthrough = await cli(["walkthrough", file], dir);

    expect(walkthrough.code).toBe(1);
    expect(walkthrough.out).toBe("");
    expect(walkthrough.err).toBe(
      `Error: ${file} is already there. voicecap doesn't overwrite it: give another name, or move that file first.\n`,
    );
    expect(await readFile(file, "utf8")).toBe("mine");
  });

  it("exits 1, and says why, when no run completed", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-"));
    const site = path.join(dir, "transcripts", "example.illinois.gov");

    const walkthrough = await cli(["walkthrough", "--site", EXAMPLE_SITE, "walkthrough.json"], dir);

    expect(walkthrough.code).toBe(1);
    expect(walkthrough.out).toBe("");
    expect(walkthrough.err).toBe(
      `Error: There's no completed run in ${site} yet, so there's nothing to repeat.\n`,
    );
    expect(existsSync(path.join(dir, "walkthrough.json"))).toBe(false);
  });

  it("needs a file to write", async () => {
    const walkthrough = await cli(["walkthrough"]);

    expect(walkthrough.code).toBe(1);
    expect(walkthrough.err).toContain("missing required argument 'file'");
  });

  it("is listed in the help, with what it does", async () => {
    const help = await cli(["--help"]);

    expect(help.code).toBe(0);
    expect(squeezed(help.out)).toContain(
      "walkthrough [options] <file> write a run's walkthrough file: its pages, in order, and its settings, so anyone can repeat the run",
    );
  });

  it("has --site, --run, and --out, each with its own words", async () => {
    const help = await cli(["walkthrough", "--help"]);

    expect(help.code).toBe(0);
    const said = squeezed(help.out);
    expect(said).toContain(
      "write a run's walkthrough file: its pages, in order, and its settings, so anyone can repeat the run",
    );
    expect(said).toContain(
      "--site <url> the site's address, or its canonical address (default: the home's only site)",
    );
    expect(said).toContain(
      "--run <id> the run to write it from (default: the latest completed run)",
    );
    expect(said).toContain(
      "--out <dir> transcripts home (default: VOICECAP_TRANSCRIPTS, else ./transcripts)",
    );
  });
});

describe("--site takes a site's canonical address", () => {
  /** Whatever the help says, on one line, so where it wraps doesn't matter. */
  const squeezed = (text: string) => text.replace(/\s+/g, " ");

  /** The address people visit, which the run on the copy at SITE recorded. */
  const ROOT = "https://dvfr.illinois.gov/";
  /** The folder the copy's records are in: named after the address voicecap read. */
  const FOLDER = "127.0.0.1_4747";
  /** The folder the canonical name would have, which nothing here should make. */
  const NAMED = "dvfr.illinois.gov";

  /**
   * A home (the default one, in the folder this gives) with one replayed run of the copy at SITE,
   * which recorded `root` as the site's canonical address.
   */
  async function homeOfTheCopy(root = ROOT): Promise<string> {
    const run = await cli([
      "--site",
      SITE,
      "--pages",
      fixture("pages.json"),
      "--replay-from",
      fixture("replay-run"),
      "--canonical",
      root,
    ]);
    expect(run.code).toBe(0);
    return run.cwd;
  }

  it.each([
    [["review"], "the site of a full --page URL, else the home's only site"],
    [["manual", "add"], "the site of a full --page URL, else the home's only site"],
    [["report"], "the home's only site"],
    [["verify"], "every site in the home"],
  ])("is said in the help of %s", async (command, fallback) => {
    const help = await cli([...command, "--help"]);

    expect(help.code).toBe(0);
    expect(squeezed(help.out)).toContain(
      `--site <url> the site's address, or its canonical address (default: ${fallback})`,
    );
  });

  it("finds the folder whose run recorded it, for report", async () => {
    const cwd = await homeOfTheCopy();

    const report = await cli(["report", "--site", ROOT], cwd);

    expect(report.err).toBe("");
    expect(report.code).toBe(0);
    expect(report.out).toContain(`Report: ${path.join(cwd, "transcripts", FOLDER, "report.html")}`);
    expect(existsSync(path.join(cwd, "transcripts", NAMED))).toBe(false);
  });

  it("finds the run to write the walkthrough of, as the page's command asks", async () => {
    const cwd = await homeOfTheCopy();
    const runId = (
      await readFile(path.join(cwd, "transcripts", FOLDER, "latest.txt"), "utf8")
    ).trim();
    const file = path.join(cwd, "walkthrough.json");

    // The command the shareable page shows for the run: walkthrough --site <canonical> --run <id>.
    const walkthrough = await cli(["walkthrough", "--site", ROOT, "--run", runId, file], cwd);

    expect(walkthrough.err).toBe("");
    expect(walkthrough.code).toBe(0);
    expect(parseWalkthrough(await readFile(file, "utf8"), file).original.run).toBe(runId);
    expect(existsSync(path.join(cwd, "transcripts", NAMED))).toBe(false);
  });

  // Ruling P17. The demo runs voicecap 0.4.1 recorded named no canonical address, so the demo is
  // named by report.canonical when it's shared, in a config of a folder of its own, as the README
  // says to. The Word copy prints each run's command, which then finds the run by the root the
  // share recorded.
  it("runs the command a shared Word copy prints for each run's walkthrough file, when report.canonical named the site", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-"));
    const home = path.join(root, "transcripts");
    await cp(fileURLToPath(new URL("./fixtures/share/demo-2026-09-29", import.meta.url)), home, {
      recursive: true,
    });
    const named = path.join(root, "demo-share");
    await mkdir(named);
    await writeFile(
      path.join(named, "voicecap.config.json"),
      '{ "report": { "canonical": "https://voicecap.netlify.app/demo-site/" } }\n',
    );
    const share = await cli(["share", "--out", home, "--reviewer", "Pat Lee"], named);
    expect(share.err).toBe("");
    expect(share.code).toBe(0);
    const siteDir = path.join(home, "127.0.0.1_4848");
    const { shares } = JSON.parse(await readFile(sharesPath(siteDir), "utf8")) as SharesFile;
    const word = shares[0]!.files[1]!;
    expect(word.name).toMatch(/^voicecap\.netlify\.app_\d{4}-\d{2}-\d{2}\.docx$/);

    // The commands, as the Word copy prints them: one for each run the copy draws on, the latest
    // first.
    const { document } = await unzipDocx(await readFile(path.join(shareDir(siteDir), word.name)));
    const commands = paragraphsOf(document)
      .map(({ text }) => text)
      .filter((text) => text.startsWith("npx @icjia/voicecap walkthrough "));
    expect(commands).toEqual(
      ["2026-09-29_1402", "2026-09-29_1315"].map(
        (run) =>
          `npx @icjia/voicecap walkthrough --site https://voicecap.netlify.app/demo-site/ --run ${run} voicecap.netlify.app_${run}_walkthrough.json`,
      ),
    );

    // Each is run as printed, in a folder of its own, with the home a person has set.
    const work = path.join(root, "work");
    await mkdir(work);
    for (const command of commands) {
      const args = command.split(" ").slice(2);
      const run = args[args.indexOf("--run") + 1]!;
      const written = await cli(args, work, { VOICECAP_TRANSCRIPTS: home });

      expect(written.err).toBe("");
      expect(written.code).toBe(0);
      const file = path.join(work, args.at(-1)!);
      expect(parseWalkthrough(await readFile(file, "utf8"), file).original.run).toBe(run);
    }
    // Nothing was made in the folder the canonical name would have.
    expect(existsSync(path.join(home, "voicecap.netlify.app"))).toBe(false);
  });

  it("finds the folder to check, for verify", async () => {
    const cwd = await homeOfTheCopy();

    const verify = await cli(["verify", "--site", ROOT], cwd);

    expect(verify.err).toBe("");
    expect(verify.code).toBe(0);
    expect(verify.out).toBe(
      `${FOLDER}: 1 run (0 incomplete), 0 manual sessions, 0 reviews, 0 shares checked: everything matches.\n`,
    );

    // An address no run recorded has no folder, as before.
    const none = await cli(["verify", "--site", "https://i2i.illinois.gov/"], cwd);
    expect(none.code).toBe(1);
    expect(none.err).toBe(
      `Error: ${path.join(cwd, "transcripts")} has no i2i.illinois.gov folder, so there's nothing to check.\n`,
    );
  });

  it("passes over an empty folder named after the address, as a stopped first attempt leaves one", async () => {
    const cwd = await homeOfTheCopy();
    // A first attempt at the live address that stopped before it recorded anything.
    await mkdir(path.join(cwd, "transcripts", NAMED));

    const verify = await cli(["verify", "--site", ROOT], cwd);
    const report = await cli(["report", "--site", ROOT], cwd);

    // Each is of the copy's records, not of the empty folder, which would be checked, or stopped at.
    expect(verify.err).toBe("");
    expect(verify.code).toBe(0);
    expect(verify.out).toBe(
      `${FOLDER}: 1 run (0 incomplete), 0 manual sessions, 0 reviews, 0 shares checked: everything matches.\n`,
    );
    expect(report.err).toBe("");
    expect(report.code).toBe(0);
    expect(report.out).toContain(`Report: ${path.join(cwd, "transcripts", FOLDER, "report.html")}`);
  });

  it("finds a root with a path by what its run recorded, though a folder is named after its host", async () => {
    const root = "https://voicecap.netlify.app/demo-site/";
    const cwd = await homeOfTheCopy(root);
    // The website itself was run once: its folder holds records, and folders are named by host.
    await mkdir(path.join(cwd, "transcripts", "voicecap.netlify.app", "2026-09-28"), {
      recursive: true,
    });
    const runId = (
      await readFile(path.join(cwd, "transcripts", FOLDER, "latest.txt"), "utf8")
    ).trim();
    const file = path.join(cwd, "walkthrough.json");

    // The command the shareable page shows for a run of the demo.
    const walkthrough = await cli(["walkthrough", "--site", root, "--run", runId, file], cwd);

    expect(walkthrough.err).toBe("");
    expect(walkthrough.code).toBe(0);
    expect(parseWalkthrough(await readFile(file, "utf8"), file).original.run).toBe(runId);
  });

  it("finds the folder to share, for share", async () => {
    const { dir, siteDir } = await homeWithCountedRun(undefined, { canonical: ROOT });

    const share = await cli(["share", "--site", ROOT, "--reviewer", "Pat Lee"], dir);

    expect(share.err).toBe("");
    expect(share.code).toBe(0);
    // The terminal names the folder, the address voicecap read, as it always did.
    expect(share.out).toMatch(/^Shared example\.illinois\.gov, as of /);
    const { shares } = JSON.parse(await readFile(sharesPath(siteDir), "utf8")) as SharesFile;
    expect(shares).toHaveLength(1);
    // The copies and their record name the site as the page does: by its canonical address.
    const entry = shares[0]!;
    expect(entry.site).toBe(ROOT);
    expect(entry.files[0]?.name).toBe(`${NAMED}_${entry.at.slice(0, 10)}.html`);
    expect(existsSync(path.join(dir, "transcripts", NAMED))).toBe(false);
  });

  it("files a review under the address its run read, for review", async () => {
    const cwd = await homeOfTheCopy();
    const site = path.join(cwd, "transcripts", FOLDER);

    const review = await cli(
      [
        "review",
        "--site",
        ROOT,
        "--page",
        "/flawed/",
        "--status",
        "issue",
        "--note",
        "Unlabeled button",
        "--reviewer",
        "Pat Reviewer",
      ],
      cwd,
    );

    expect(review.err).toBe("");
    expect(review.code).toBe(0);
    // A path is a page of the copy the run read, which is where the folder's records are.
    const { pages } = JSON.parse(
      await readFile(path.join(site, "reviews.json"), "utf8"),
    ) as ReviewsFile;
    expect(Object.keys(pages)).toEqual([`${SITE}/flawed`]);
    expect(existsSync(path.join(cwd, "transcripts", NAMED))).toBe(false);
    expect((await cli(["verify"], cwd)).code).toBe(0);
  });

  it("files a manual session under the address its run read, for manual add", async () => {
    const cwd = await homeOfTheCopy();
    const site = path.join(cwd, "transcripts", FOLDER);

    const manual = await cli(
      [
        "manual",
        "add",
        fixture("manual", "nvda-io-log.txt"),
        "--site",
        ROOT,
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
    const sessions = await listManualSessions(site);
    expect(sessions.map((session) => session.json.page.url)).toEqual([`${SITE}/`]);
    expect(existsSync(path.join(cwd, "transcripts", NAMED))).toBe(false);
    // Filed where its page's own address puts it, so verify finds it in place.
    const verify = await cli(["verify"], cwd);
    expect(verify.out).toBe(
      `${FOLDER}: 1 run (0 incomplete), 1 manual session, 0 reviews, 0 shares checked: everything matches.\n`,
    );
    expect(verify.code).toBe(0);
  });

  it("refuses a page given on the canonical address, and files nothing", async () => {
    const cwd = await homeOfTheCopy();
    const home = path.join(cwd, "transcripts");
    const before = await contents(home);

    const review = await cli(
      [
        "review",
        "--site",
        ROOT,
        "--page",
        `${ROOT}flawed/`,
        "--status",
        "issue",
        "--reviewer",
        "Pat Reviewer",
      ],
      cwd,
    );
    const manual = await cli(
      [
        "manual",
        "add",
        fixture("manual", "nvda-io-log.txt"),
        "--site",
        ROOT,
        "--page",
        ROOT,
        "--redact-typing",
        "--reviewer",
        "Pat Reviewer",
        "--date",
        "2026-09-25",
      ],
      cwd,
    );

    expect([review.code, manual.code]).toEqual([1, 1]);
    expect(review.err).toContain(`--page ${ROOT}flawed/ is on ${NAMED}, but --site is`);
    expect(manual.err).toContain(`--page ${ROOT} is on ${NAMED}, but --site is`);
    expect(await contents(home)).toEqual(before);
  });
});

describe("voicecap site", () => {
  /** Whatever the help says, on one line, so where it wraps doesn't matter. */
  const squeezed = (text: string) => text.replace(/\s+/g, " ");

  /** What the command is for, as the help says it. */
  const WHAT_IT_DOES =
    "build the website of each site's newest shared reports, for Netlify: index.html, each report's files, robots.txt, _headers, and _redirects";

  /** What a build says it made of the home homeWithShares makes: its reports, its sites, and the demo. */
  const BUILT = "3 reports from 2 sites, and the demo's.";

  /** Each folder these tests made, which is taken away after each test. */
  const made: string[] = [];

  afterEach(async () => {
    await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  /** A new, empty folder. */
  async function newFolder(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-"));
    made.push(dir);
    return dir;
  }

  /** A home with reports shared in it, in a folder of its own. */
  async function homeToBuild(): Promise<string> {
    const home = await homeWithShares();
    made.push(path.dirname(home));
    return home;
  }

  it("builds the site with voicecap site", async () => {
    const home = await homeToBuild();
    const out = await newFolder();

    const site = await cli(["site", "--home", home, "--out", out], await newFolder());

    expect(site.err).toBe("");
    expect(site.code).toBe(0);
    expect(existsSync(path.join(out, "index.html"))).toBe(true);
    expect(site.out).toContain(`Built the site in ${out}: ${BUILT}`);
  });

  it("takes the home from VOICECAP_TRANSCRIPTS, and builds into _site there, when it's given neither", async () => {
    const home = await homeToBuild();

    const site = await cli(["site"], await newFolder(), { VOICECAP_TRANSCRIPTS: home });

    expect(site.err).toBe("");
    expect(site.code).toBe(0);
    const out = path.join(home, "_site");
    expect(existsSync(path.join(out, "index.html"))).toBe(true);
    expect(site.out).toContain(`Built the site in ${out}: ${BUILT}`);
  });

  it("exits 1, and says why, when it's told to build into the home, and writes nothing", async () => {
    const home = await homeToBuild();

    const site = await cli(["site", "--home", home, "--out", home], await newFolder());

    expect(site.code).toBe(1);
    expect(site.out).toBe("");
    expect(site.err).toBe(
      `Error: voicecap site won't build into ${home}: it's the transcripts home itself. Give a folder of its own, such as "${path.join(home, "_site")}".\n`,
    );
    expect(existsSync(path.join(home, "_site"))).toBe(false);
    expect(existsSync(path.join(home, "netlify.toml"))).toBe(false);
  });

  it("lists site in voicecap --help", async () => {
    const help = await cli(["--help"], await newFolder());

    expect(help.code).toBe(0);
    expect(squeezed(help.out)).toContain(`site [options] ${WHAT_IT_DOES}`);
  });

  it("has --home and --out, each with its own words", async () => {
    const help = await cli(["site", "--help"], await newFolder());

    expect(help.code).toBe(0);
    const said = squeezed(help.out);
    expect(said).toContain(WHAT_IT_DOES);
    expect(said).toContain(
      "--home <dir> the transcripts home (default: VOICECAP_TRANSCRIPTS, else ./transcripts)",
    );
    expect(said).toContain(
      "--out <dir> the folder to build it in (default: _site in the home); a folder voicecap site built is emptied first",
    );
  });
});

describe("voicecap --walkthrough", () => {
  /** Whatever the help says, on one line, so where it wraps doesn't matter. */
  const squeezed = (text: string) => text.replace(/\s+/g, " ");

  /** The one site's folder of a home made by oneSiteHome(): a replay of fixture/replay-run. */
  const siteDir = (home: string) => path.join(home, "transcripts", "127.0.0.1_4747");

  /** The latest completed run of the home's site, as its run.json holds it. */
  async function latestRun(home: string): Promise<RunJson> {
    const id = (await readFile(path.join(siteDir(home), "latest.txt"), "utf8")).trim();
    const file = path.join(runDir(siteDir(home), id), "run.json");
    return JSON.parse(await readFile(file, "utf8")) as RunJson;
  }

  /** A home with a replayed run in it, and that run's walkthrough, as walkthrough.json in it. */
  async function homeWithWalkthrough(): Promise<{ home: string; original: RunJson }> {
    const home = await oneSiteHome();
    const original = await latestRun(home);
    const written = await cli(["walkthrough", "walkthrough.json"], home);
    expect(written.code).toBe(0);
    return { home, original };
  }

  /** The runs the home's site has: how many run.json files its folder holds. */
  async function runCount(home: string): Promise<number> {
    return (await contents(siteDir(home))).filter((name) => name.endsWith("run.json")).length;
  }

  it("repeats a run from its walkthrough file, with the replay driver", async () => {
    const { home, original } = await homeWithWalkthrough();
    const file = path.join(home, "walkthrough.json");

    const repeat = await cli(["--walkthrough", file, "--replay-from", fixture("replay-run")], home);

    expect(repeat.code).toBe(0);
    const run = await latestRun(home);
    expect(run.id).not.toBe(original.id);
    expect(run.status).toBe("completed");
    expect(run.settings.source).toEqual({
      kind: "walkthrough",
      file: "walkthrough.json",
      sha256: sha256(await readFile(file)),
      run: original.id,
      from: "pages",
    });
    expect(run.pages.map((page) => page.url)).toEqual(original.pages.map((page) => page.url));
    expect(repeat.out).toContain(`${run.pages.length} pages to transcribe.`);
  });

  it("takes the site from the file, and allows --site when it's the file's own", async () => {
    const { home } = await homeWithWalkthrough();
    const file = path.join(home, "walkthrough.json");
    const replay = ["--replay-from", fixture("replay-run")];

    const without = await cli(["--walkthrough", file, ...replay], home);
    const same = await cli(["--walkthrough", file, "--site", SITE, ...replay], home);

    expect([without.code, same.code]).toEqual([0, 0]);
    expect(await runCount(home)).toBe(3);
  });

  it("still needs --site when there's no --walkthrough", async () => {
    const run = await cli(["--pages", "pages.json"]);

    expect(run.code).toBe(1);
    expect(run.err).toContain("Missing --site <url>");
  });

  it.each<[string, string[]]>([
    ["--site", ["--site", "https://other.example"]],
    ["--sitemap", ["--sitemap", "sitemap.xml"]],
    ["--pages", ["--pages", "pages.json"]],
    ["--page", ["--page", "/about/"]],
    ["--limit", ["--limit", "2"]],
    ["--include", ["--include", "/a*"]],
    ["--exclude", ["--exclude", "/a*"]],
    ["--passes", ["--passes", "read"]],
    ["--max-steps", ["--max-steps", "5"]],
  ])("exits 1, and says why, when it's given with %s", async (flag, given) => {
    const { home } = await homeWithWalkthrough();
    const before = await runCount(home);

    const repeat = await cli(
      ["--walkthrough", "walkthrough.json", ...given, "--replay-from", fixture("replay-run")],
      home,
    );

    expect(repeat.code).toBe(1);
    expect(repeat.out).toBe("");
    expect(repeat.err).toBe(
      `Error: --walkthrough repeats the pages and passes its file lists, so it can't be used with ${flag}.\n`,
    );
    expect(await runCount(home)).toBe(before);
  });

  it("exits 1, and says why, when the file isn't there", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-"));

    const repeat = await cli(
      ["--walkthrough", "nope.json", "--replay-from", fixture("replay-run")],
      dir,
    );

    expect(repeat.code).toBe(1);
    expect(repeat.out).toBe("");
    expect(repeat.err).toMatch(/^Error: Can't read the walkthrough file nope\.json: /);
    expect(existsSync(path.join(dir, "transcripts"))).toBe(false);
  });

  it("exits 1, and says why, when the file isn't a walkthrough", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-"));
    await writeFile(path.join(dir, "walkthrough.json"), "[]");

    const repeat = await cli(
      ["--walkthrough", "walkthrough.json", "--replay-from", fixture("replay-run")],
      dir,
    );

    expect(repeat.code).toBe(1);
    expect(repeat.out).toBe("");
    expect(repeat.err).toBe(
      "Error: walkthrough.json isn't a voicecap walkthrough file: it isn't a JSON object.\n",
    );
    expect(existsSync(path.join(dir, "transcripts"))).toBe(false);
  });

  it("is listed in the help, with what it does", async () => {
    const help = await cli(["--help"]);

    expect(help.code).toBe(0);
    expect(squeezed(help.out)).toContain(
      "--walkthrough <file> repeat a run from its walkthrough file: the same pages, in the same order, with the same passes and limits",
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

    // The site is at an IP address, so init asks for the address people visit, and writes it into
    // the command as --canonical.
    const run = await cli(
      ["init"],
      dir,
      {},
      {
        stdin: linesStream([SITE, "https://dvfr.illinois.gov", "", "", "", "", "y"]),
        fetch: fetchHomeOnly,
        platformReadiness: () => Promise.resolve(READY),
      },
    );

    expect(run.code).toBe(0);
    expect(run.out).toContain(`--site ${SITE} --canonical https://dvfr.illinois.gov/ --page`);
    const out = path.join(dir, "transcripts", "127.0.0.1_4747");
    const runId = (await readFile(path.join(out, "latest.txt"), "utf8")).trim();
    const runJson = JSON.parse(
      await readFile(path.join(runDir(out, runId), "run.json"), "utf8"),
    ) as RunJson;
    expect(runJson.status).toBe("completed");
    // The run took the address from the command it was given.
    expect(runJson.canonical).toBe("https://dvfr.illinois.gov/");
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
    expect(verify.out).toContain("1 review, 0 shares checked: everything matches.");
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
