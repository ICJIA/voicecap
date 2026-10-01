import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ensureGitFiles, GITIGNORE } from "../src/run/git-files.js";

const tmp = () => mkdtemp(path.join(os.tmpdir(), "voicecap-git-files-"));

/** Runs git, never throwing: missing status means git isn't on PATH. */
function git(args: string[], cwd: string): number | null {
  try {
    return spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).status;
  } catch {
    return null;
  }
}

const gitAvailable = git(["--version"], os.tmpdir()) === 0;

describe("ensureGitFiles", () => {
  it("writes .gitattributes and .gitignore at the home's top", async () => {
    const home = await tmp();
    await ensureGitFiles(home);
    expect(await readFile(path.join(home, ".gitattributes"), "utf8")).toContain("* -text");
    expect(await readFile(path.join(home, ".gitignore"), "utf8")).toBe(GITIGNORE);
  });

  it("never overwrites them", async () => {
    const home = await tmp();
    await writeFile(path.join(home, ".gitignore"), "mine\n");
    await ensureGitFiles(home);
    expect(await readFile(path.join(home, ".gitignore"), "utf8")).toBe("mine\n");
  });

  it.skipIf(!gitAvailable)(
    "keeps raw NVDA logs, the run lock, crash leftovers, and OS files out of Git",
    async () => {
      const home = await tmp();
      expect(git(["init"], home)).toBe(0);
      await ensureGitFiles(home);

      const ignored = (relativePath: string) => git(["check-ignore", "-q", relativePath], home);

      expect(ignored("dvfr.illinois.gov/2026-09-27/1415_manual_faq/raw/nvda-log.txt")).toBe(0);
      expect(ignored("dvfr.illinois.gov/.voicecap.lock")).toBe(0);
      // A temporary file an atomic write left behind when it crashed.
      expect(ignored("dvfr.illinois.gov/.report.html.123.ab12.tmp")).toBe(0);
      expect(ignored("dvfr.illinois.gov/.DS_Store")).toBe(0);
      expect(ignored("dvfr.illinois.gov/2026-09-27/1102/pages/home/Thumbs.db")).toBe(0);
      expect(ignored("dvfr.illinois.gov/2026-09-27/desktop.ini")).toBe(0);
      expect(ignored("dvfr.illinois.gov/2026-09-27/1102/run.json")).toBe(1);
      expect(ignored("dvfr.illinois.gov/report.html")).toBe(1);
    },
  );

  it.skipIf(!gitAvailable)(
    "keeps the shareable page that's written again after every run out of Git, and not the copies that are sent",
    async () => {
      const home = await tmp();
      expect(git(["init"], home)).toBe(0);
      await ensureGitFiles(home);

      const ignored = (relativePath: string) => git(["check-ignore", "-q", relativePath], home);

      expect(ignored("dvfr.illinois.gov/share/current.html")).toBe(0);
      expect(ignored("dvfr.illinois.gov/share/current.docx")).toBe(0);
      expect(ignored("voicecap-demo/127.0.0.1_4848/share/current.html")).toBe(0);
      // The dated copies a person sends, and the record of what was sent, stay in Git.
      expect(ignored("dvfr.illinois.gov/share/dvfr.illinois.gov_2026-09-30.html")).toBe(1);
      expect(ignored("dvfr.illinois.gov/share/shares.json")).toBe(1);
    },
  );
});
