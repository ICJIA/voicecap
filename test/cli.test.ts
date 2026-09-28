import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { main } from "../src/cli/main.js";
import type { Readiness } from "../src/init/readiness.js";
import { listManualSessions } from "../src/manual/list.js";
import type { ReviewsFile, RunJson } from "../src/model.js";
import { manualSessionDir, runDir } from "../src/run/paths.js";
import { realSitesFetch } from "./helpers/real-sites.js";

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

/** Extra CliContext fields only the init tests need; every other call leaves these at their defaults. */
interface CliExtra {
  stdin?: NodeJS.ReadableStream;
  interactive?: boolean;
  fetch?: typeof fetch;
  readiness?: () => Readiness;
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
  });
  return { code, out: stdout.text(), err: stderr.text(), cwd: dir };
}

/** Piped input for `init`: each line answers one question in order ("" is Enter), then it ends. */
function linesStream(lines: readonly string[] = []): PassThrough {
  const input = new PassThrough();
  input.end(lines.map((line) => `${line}\n`).join(""));
  return input;
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

  // On Windows these do real work (download NVDA, start it); test/setup-doctor.test.ts covers them.
  it.skipIf(process.platform === "win32")(
    "setup and doctor explain that NVDA needs Windows (exit 2)",
    async () => {
      const setup = await cli(["setup"]);
      expect(setup.code).toBe(2);
      expect(setup.err).toContain("only runs on Windows");
      const doctor = await cli(["doctor"]);
      expect(doctor.code).toBe(2);
      expect(doctor.out).toContain("FAIL  Windows:");
    },
  );

  it("exits 2 when the default driver can't run here", async () => {
    if (process.platform === "win32") return;
    const result = await cli(["--site", SITE, "--pages", fixture("pages.json")]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("only runs on Windows");
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

describe("voicecap init", () => {
  it("init asks the questions and prints the command", async () => {
    const run = await cli(
      ["init"],
      undefined,
      {},
      {
        stdin: linesStream(["dvfr.illinois.gov", "", "", "", ""]),
        fetch: realSitesFetch(),
      },
    );
    expect(run.code).toBe(0);
    expect(run.out).toContain(
      "npx @icjia/voicecap --site https://dvfr.illinois.gov --sitemap https://dvfr.illinois.gov/sitemap.xml",
    );
  });

  it("starts init with no arguments in a terminal", async () => {
    const run = await cli([], undefined, {}, { interactive: true, stdin: linesStream() });
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
      },
    );
    expect(run.code).toBe(1);
    // Proves the wizard actually ran (asked and got past the website) rather than failing some
    // other way, e.g. "init" not being a recognized command.
    expect(run.out).toContain("Website:");
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
        stdin: linesStream([SITE, "", "", "", "y"]),
        fetch: fetchHomeOnly,
        readiness: () => ({ canRun: true }),
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
