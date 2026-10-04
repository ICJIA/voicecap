import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ensureGitFiles, GITIGNORE, writeIfMissing } from "../src/run/git-files.js";

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

  it("has _site/, the website voicecap site builds, ahead of the files an operating system adds", () => {
    expect(GITIGNORE).toContain(
      "# the website voicecap site builds,\n_site/\n# and files the operating system adds.\n",
    );
    expect(GITIGNORE.split("\n").filter((line) => line === "_site/")).toHaveLength(1);
  });

  it.skipIf(!gitAvailable)(
    "keeps the website voicecap site builds out of Git, wherever its folder is, and nothing else",
    async () => {
      const home = await tmp();
      expect(git(["init"], home)).toBe(0);
      await ensureGitFiles(home);

      const ignored = (relativePath: string) => git(["check-ignore", "-q", relativePath], home);

      expect(ignored("_site/index.html")).toBe(0);
      expect(ignored("_site/dvfr.illinois.gov/dvfr.illinois.gov_2026-10-03.html")).toBe(0);
      expect(ignored("_site/_headers")).toBe(0);
      // In any folder, as a build into a folder of that name inside a site's is.
      expect(ignored("dvfr.illinois.gov/_site/index.html")).toBe(0);
      // The records, and the files Netlify reads at the home's top, stay in Git.
      expect(ignored("netlify.toml")).toBe(1);
      expect(ignored(".nvmrc")).toBe(1);
      expect(ignored("dvfr.illinois.gov/share/shares.json")).toBe(1);
      // Only a folder with that name: not a name that holds it.
      expect(ignored("_sites/index.html")).toBe(1);
      expect(ignored("dvfr.illinois.gov/share/_site.html")).toBe(1);
    },
  );

  it.skipIf(!gitAvailable)(
    "keeps the owner file Word writes beside a sent copy that's open out of Git, and not the copy",
    async () => {
      const home = await tmp();
      expect(git(["init"], home)).toBe(0);
      await ensureGitFiles(home);

      const ignored = (relativePath: string) => git(["check-ignore", "-q", relativePath], home);

      // What Word keeps beside dvfr.illinois.gov_2026-09-30.docx while someone reads it.
      expect(ignored("dvfr.illinois.gov/share/~$fr.illinois.gov_2026-09-30.docx")).toBe(0);
      expect(ignored("dvfr.illinois.gov/share/dvfr.illinois.gov_2026-09-30.docx")).toBe(1);
      // Only a name that starts with ~$ is Word's.
      expect(ignored("dvfr.illinois.gov/share/~notes.docx")).toBe(1);
      expect(ignored("dvfr.illinois.gov/share/x~$y.docx")).toBe(1);
    },
  );
});

describe("writeIfMissing", () => {
  it("writes a file that isn't there, and says it wrote it", async () => {
    const file = path.join(await tmp(), "a.txt");
    expect(await writeIfMissing(file, "first\n")).toBe(true);
    expect(await readFile(file, "utf8")).toBe("first\n");
  });

  it("leaves a file that is there as it was, and says it wrote nothing", async () => {
    const file = path.join(await tmp(), "a.txt");
    await writeFile(file, "mine\n");
    expect(await writeIfMissing(file, "first\n")).toBe(false);
    expect(await readFile(file, "utf8")).toBe("mine\n");
  });

  it("doesn't take any other failure for a file that is there", async () => {
    const file = path.join(await tmp(), "no-such-folder", "a.txt");
    await expect(writeIfMissing(file, "first\n")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
