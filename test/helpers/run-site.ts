/**
 * A small site for runs with the scripted driver, and the options that run it without anything
 * real: no NVDA, no PowerShell, no Git name or transcripts home of whoever runs the tests.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect } from "vitest";

import { resolveConfig, type LoadedConfig } from "../../src/config/load.js";
import type { UserConfig } from "../../src/config/schema.js";
import { runAudit, type RunAuditOptions, type RunAuditResult } from "../../src/run/audit.js";
import type { MachineProbe } from "../../src/run/machine-record.js";
import { siteFolder } from "../../src/run/paths.js";
import { createMemoryLogger } from "../../src/util/log.js";
import {
  element,
  ScriptedDriver,
  type Command,
  type ScriptedOptions,
  type ScriptedPage,
} from "./scripted-driver.js";

export const SITE = "https://example.illinois.gov";

/** A local ISO time to the millisecond, such as 2026-09-26T14:05:09.482-05:00. */
export const ISO_MS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}[+-]\d\d:\d\d$/;

export function sitePages(
  overrides: Partial<Record<"home" | "about" | "resources", Partial<ScriptedPage>>> = {},
): ScriptedPage[] {
  return [
    {
      url: `${SITE}/`,
      lines: [
        "link, Skip to main content",
        "banner landmark, link, Example Agency",
        "main landmark, heading, level 1, Welcome",
        "Grant applications are open.",
        "content info landmark, © 2026 Example Agency",
      ],
      headings: ["heading, level 1, Welcome", "heading, level 2, News"],
      stops: [
        {
          spoken: "Skip to main content, link",
          focused: element("Skip to main content", { href: "#main" }),
        },
        { spoken: "Example Agency, link", focused: element("Example Agency") },
        { spoken: "Grants, link", focused: element("Grants", { inMain: true, href: "/grants" }) },
      ],
      ...overrides.home,
    },
    {
      url: `${SITE}/about`,
      lines: ["heading, level 1, About us", "We are an example.", "© 2026 Example Agency"],
      headings: ["heading, level 1, About us"],
      stops: [{ spoken: "Home, link", focused: element("Home") }],
      ...overrides.about,
    },
    {
      url: `${SITE}/resources`,
      lines: [
        "heading, level 2, Resources",
        "link, Read more",
        "Text",
        "link, Read more",
        "button",
        "End",
      ],
      headings: ["heading, level 2, Resources"],
      stops: [
        { spoken: "Read more, link", focused: element("Read more", { inMain: true }) },
        { spoken: "Read more, link", focused: element("Read more", { inMain: true }) },
        {
          spoken: "button",
          focused: element("", { tag: "button", role: "button", inMain: true, href: null }),
        },
      ],
      ...overrides.resources,
    },
  ];
}

/** A new folder with a page list of `entries`, as pages.json. */
export async function setup(entries: string[] = ["/", "/about", "/resources"]): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "voicecap-run-"));
  await writeFile(path.join(dir, "pages.json"), JSON.stringify(entries));
  return dir;
}

export function config(user: UserConfig = {}): LoadedConfig {
  const resolved = resolveConfig({
    timeouts: { stepMs: 300, pageMs: 5000, driverStartMs: 2000 },
    readiness: { readySelector: null, settleMs: 0, networkIdleTimeoutMs: 200 },
    reviewer: "Test Reviewer",
    ...user,
  });
  return { config: resolved, file: null, sha256: "test-config" };
}

/** The computer's details, fixed and instant: the real probe starts PowerShell, which takes seconds. */
export const MACHINE_PROBE: MachineProbe = {
  os: () => Promise.resolve({ name: "Test OS 1", build: "1.2.3" }),
  cpu: () => Promise.resolve({ baseMhz: 3000, physicalCores: 4 }),
  display: () => Promise.resolve({ width: 1920, height: 1080, refreshHz: 60, scalePercent: 100 }),
  language: () => Promise.resolve("en-US"),
};

export function options(
  dir: string,
  driver: ScriptedDriver | undefined,
  extra: Partial<RunAuditOptions> = {},
): RunAuditOptions {
  return {
    site: SITE,
    pages: "pages.json",
    cwd: dir,
    // Never the VOICECAP_TRANSCRIPTS, VOICECAP_REVIEWER, or Git name of whoever runs the tests.
    env: {},
    gitUserName: () => null,
    machineProbe: MACHINE_PROBE,
    ...(driver ? { driver } : {}),
    config: config(),
    logger: createMemoryLogger(),
    ...extra,
  };
}

/** SITE's folder in the default home, where these runs go. */
export const outDir = (dir: string) => path.join(dir, "transcripts", siteFolder(SITE));

/**
 * A home with one completed, sealed, live run of the scripted site: the kind of run that counts for
 * the shareable page. It's made in `existing`, a folder from `setup` that the caller has already
 * made (and so can take away afterwards), or in a new one. `extra` changes the run's options (a
 * `canonical` address, say). Gives that folder, which holds the home (its transcripts/), and SITE's
 * folder in the home.
 */
export async function homeWithCountedRun(
  existing?: string,
  extra: Partial<RunAuditOptions> = {},
): Promise<{ dir: string; siteDir: string; run: RunAuditResult }> {
  const dir = existing ?? (await setup());
  const run = await runAudit(options(dir, new ScriptedDriver(sitePages()), extra));
  expect(run.outcome).toBe("completed");
  return { dir, siteDir: outDir(dir), run };
}

/** A scripted driver's `hang` option: the first call of `command` hangs, and no other call does. */
export function hangOnce(command: Command): NonNullable<ScriptedOptions["hang"]> {
  let hung = false;
  return (called) => {
    if (called !== command || hung) return false;
    hung = true;
    return true;
  };
}
