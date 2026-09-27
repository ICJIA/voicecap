import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { main } from "../src/cli/main.js";
import type { ReviewsFile } from "../src/model.js";

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

async function cli(args: string[], cwd?: string, env: NodeJS.ProcessEnv = {}) {
  const stdout = capture();
  const stderr = capture();
  const dir = cwd ?? (await mkdtemp(path.join(os.tmpdir(), "voicecap-cli-")));
  const code = await main(args, {
    stdout: stdout.stream,
    stderr: stderr.stream,
    cwd: dir,
    env,
    signal: new AbortController().signal,
  });
  return { code, out: stdout.text(), err: stderr.text(), cwd: dir };
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
    expect(neither.err).toContain("exactly one page source");
    const both = await cli([
      "--site",
      SITE,
      "--sitemap",
      `${SITE}/sitemap.xml`,
      "--pages",
      "p.csv",
    ]);
    expect(both.code).toBe(1);
    expect(both.err).toContain("not both");
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
    const out = path.join(run.cwd, "transcripts");
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
    expect(existsSync(path.join(out, "manual", "home"))).toBe(true);

    const report = await cli(["report"], run.cwd);
    expect(report.code).toBe(0);
    const html = await readFile(path.join(out, "report.html"), "utf8");
    expect(html).toContain("Unlabeled button");
    expect((await cli(["report", "--run", "no-such-run"], run.cwd)).code).toBe(1);
  });

  it("refuses a report before there's any completed run", async () => {
    const result = await cli(["report"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("no completed run");
  });
});
