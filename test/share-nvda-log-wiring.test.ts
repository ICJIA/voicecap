/**
 * The commands that make the shareable page give it NVDA's keys, which the check of NVDA's own log
 * goes by and the page never imports from a driver: a run that completes, `voicecap report`,
 * `voicecap share`, and the functions under them. The real run of 6 October 2026 stands in for a
 * run of the voicecap that keeps NVDA's log (fixture/nvda-io-run, with its copy and its record laid
 * out as 0.17.0 would), and a scripted run does, with the version said to be 0.17.0.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { main } from "../src/cli/main.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { gestureOf } from "../src/drivers/guidepup/nvda-log.js";
import { runAudit } from "../src/run/audit.js";
import { regenerateLiveFiles } from "../src/run/live-report.js";
import { sharePath } from "../src/run/paths.js";
import { shareReport } from "../src/share/share.js";
import { writeShareFiles } from "../src/share/write.js";
import { createMemoryLogger } from "../src/util/log.js";
import type * as VersionModule from "../src/util/version.js";
import { copyOf, keyAt, nvdaFixtureSite, saidAt } from "./helpers/nvda-log.js";
import { options, setup, sitePages } from "./helpers/run-site.js";
import { ScriptedDriver } from "./helpers/scripted-driver.js";

// A run made now says it used voicecap 0.17.0, the first version to keep NVDA's log.
vi.mock("../src/util/version.js", async (importOriginal) => {
  const actual = await importOriginal<typeof VersionModule>();
  return { ...actual, voicecapVersion: () => "0.17.0" };
});

/** What the part says in place of the check, for a page made without NVDA's keys. */
const WITHOUT_KEYS =
  "Not shown: this copy was made without the keys NVDA presses for each step, which the check needs.";

/** Something the check's tiles say, which a page that shows the check has and no other does. */
const TILE = "lines in voicecap&#39;s transcripts for this run";

const SITE = "http://127.0.0.1:4848";

/** What `main` is given, and what it printed. */
async function cli(args: string[], cwd: string) {
  let out = "";
  let err = "";
  const code = await main(args, {
    stdout: { write: (chunk: string) => ((out += chunk), true) },
    stderr: { write: (chunk: string) => ((err += chunk), true) },
    cwd,
    env: {},
    signal: new AbortController().signal,
    interactive: false,
    platform: "linux",
  });
  return { code, out, err };
}

describe("a run that completes", () => {
  /** A copy of NVDA's log with speech in it, as a driver hands one over when its NVDA stops. */
  const COPY = copyOf(keyAt(32_400_000, "downArrow"), saidAt(32_400_040, "Welcome"));

  it("gives its live page NVDA's keys, so the page checks NVDA's log of the run", async () => {
    const dir = await setup(["/", "/about"]);
    const driver = new ScriptedDriver(sitePages());
    const stop = driver.stop.bind(driver);
    driver.stop = (stopOptions) => {
      driver.recorder?.screenReaderLog?.(COPY);
      return stop(stopOptions);
    };
    const result = await runAudit(options(dir, driver));
    expect(result.outcome).toBe("completed");

    const page = await readFile(sharePath(result.siteDir), "utf8");
    expect(page).toContain(TILE);
    expect(page).not.toContain("made without the keys");

    // A page made without them says so where it would show the check, whatever else it has.
    const logger = createMemoryLogger();
    await writeShareFiles({ siteDir: result.siteDir, config: DEFAULT_CONFIG, logger });
    const without = await readFile(sharePath(result.siteDir), "utf8");
    expect(without).toContain(esc(WITHOUT_KEYS));
    expect(without).not.toContain(TILE);

    await writeShareFiles({ siteDir: result.siteDir, config: DEFAULT_CONFIG, logger, gestureOf });
    expect(await readFile(sharePath(result.siteDir), "utf8")).toContain(TILE);
  });
});

describe("voicecap report", () => {
  it("makes the live page with the check", async () => {
    const { home, siteDir } = await nvdaFixtureSite({ inHome: true });

    const report = await cli(["report", "--site", SITE, "--out", home], home);

    expect(report.err).toBe("");
    expect(report.code).toBe(0);
    const page = await readFile(sharePath(siteDir), "utf8");
    expect(page).toContain(TILE);
    expect(page).toContain("<b>Every line agrees.</b>");
    expect(page).not.toContain("made without the keys");
  });

  it("is the same through regenerateLiveFiles", async () => {
    const { siteDir } = await nvdaFixtureSite({ inHome: true });

    const files = await regenerateLiveFiles({
      outDir: siteDir,
      config: DEFAULT_CONFIG,
      logger: createMemoryLogger(),
    });

    expect(files?.share).toBe(sharePath(siteDir));
    expect(await readFile(sharePath(siteDir), "utf8")).toContain("<b>Every line agrees.</b>");
  });
});

describe("voicecap share", () => {
  it("makes the pair with the check", async () => {
    const { home } = await nvdaFixtureSite({ inHome: true });

    const share = await cli(
      ["share", "--site", SITE, "--out", home, "--reviewer", "Pat Lee"],
      home,
    );

    expect(share.err).toBe("");
    expect(share.code).toBe(0);
    const file = /^ {2}(.*\.html)$/m.exec(share.out)?.[1];
    expect(file).toBeDefined();
    const page = await readFile(file ?? "", "utf8");
    expect(page).toContain(TILE);
    expect(page).toContain("<b>Every line agrees.</b>");
  });

  it("is the same through shareReport, which says it was made without NVDA's keys when it is given none", async () => {
    const { home } = await nvdaFixtureSite({ inHome: true });
    const make = (keys: typeof gestureOf | undefined) =>
      shareReport({
        site: SITE,
        out: home,
        reviewer: "Pat Lee",
        cwd: home,
        env: {},
        logger: createMemoryLogger(),
        now: new Date(2027, 0, 15, 10, 0),
        ...(keys === undefined ? {} : { gestureOf: keys }),
      });

    const keyed = await make(gestureOf);
    const bare = await make(undefined);

    const read = async (shared: Awaited<ReturnType<typeof make>>) =>
      readFile(shared.files[0]?.path ?? "", "utf8");
    expect(path.basename(keyed.files[0]?.path ?? "")).not.toBe(
      path.basename(bare.files[0]?.path ?? ""),
    );
    expect(await read(keyed)).toContain("<b>Every line agrees.</b>");
    expect(await read(bare)).toContain(esc(WITHOUT_KEYS));
  });
});

describe("the package's entry", () => {
  it("exports NVDA's keys, as the driver gives them", async () => {
    const api = await import("../src/index.js");

    expect(api.nvdaGestureOf).toBe(gestureOf);
    // The key each command of a pass's steps presses, as NVDA's log has it.
    const commands = ["toTop", "toBottom", "nextLine", "nextHeading", "nextFocusable"] as const;
    expect(commands.map((command) => api.nvdaGestureOf(command))).toEqual([
      "control+home",
      "control+end",
      "downArrow",
      "h",
      "tab",
    ]);
  });

  it("gives a library caller of shareReport the check when it passes them as gestureOf", async () => {
    const api = await import("../src/index.js");
    const { home } = await nvdaFixtureSite({ inHome: true });

    const shared = await api.shareReport({
      site: SITE,
      out: home,
      reviewer: "Pat Lee",
      cwd: home,
      env: {},
      logger: createMemoryLogger(),
      now: new Date(2027, 0, 15, 10, 0),
      gestureOf: api.nvdaGestureOf,
    });

    const page = await readFile(shared.files[0]?.path ?? "", "utf8");
    expect(page).toContain(TILE);
    expect(page).toContain("<b>Every line agrees.</b>");
    expect(page).not.toContain("made without the keys");
  });
});

/** The text of a message as the page's markup spells it. */
function esc(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
