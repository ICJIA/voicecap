import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  attemptsDir,
  manualSessionDir,
  resolveHome,
  runDir,
  sharePath,
  siteFolder,
} from "../src/run/paths.js";

describe("siteFolder", () => {
  it("names a site's folder after its host", () => {
    expect(siteFolder("https://dvfr.illinois.gov")).toBe("dvfr.illinois.gov");
    expect(siteFolder("http://127.0.0.1:4747/")).toBe("127.0.0.1_4747");
    expect(siteFolder("https://WWW.Example.gov/news/")).toBe("www.example.gov");
    expect(siteFolder(new URL("https://www.example.gov/x"))).toBe("www.example.gov");
    expect(siteFolder("http://[::1]:4747/")).toBe("___1__4747");
  });
});

describe("resolveHome", () => {
  it("takes the home from --out, then VOICECAP_TRANSCRIPTS, then transcripts", () => {
    const cwd = path.resolve("/work");
    expect(resolveHome({ out: "records", env: { VOICECAP_TRANSCRIPTS: "/elsewhere" }, cwd })).toBe(
      path.join(cwd, "records"),
    );
    expect(resolveHome({ env: { VOICECAP_TRANSCRIPTS: "vt/" }, cwd })).toBe(path.join(cwd, "vt"));
    expect(resolveHome({ env: {}, cwd })).toBe(path.join(cwd, "transcripts"));
    expect(resolveHome({ env: { VOICECAP_TRANSCRIPTS: "  " }, cwd })).toBe(
      path.join(cwd, "transcripts"),
    );
  });

  // Git Bash translates /d/vt itself, except with MSYS_NO_PATHCONV=1 set.
  it.runIf(process.platform === "win32")("reads a home written Git Bash's way on Windows", () => {
    const cwd = "C:\\work";
    expect(resolveHome({ out: "/d/vt", env: {}, cwd })).toBe("D:\\vt");
    expect(resolveHome({ env: { VOICECAP_TRANSCRIPTS: "/d/vt" }, cwd })).toBe("D:\\vt");
  });
});

describe("runDir", () => {
  it("puts a run in its date's folder", () => {
    const site = path.join("home", "dvfr.illinois.gov");
    expect(runDir(site, "2026-09-27_1102")).toBe(path.join(site, "2026-09-27", "1102"));
    expect(runDir(site, "2026-09-27_1530_before-redesign")).toBe(
      path.join(site, "2026-09-27", "1530_before-redesign"),
    );
    expect(runDir(site, "2026-09-27_1102-2")).toBe(path.join(site, "2026-09-27", "1102-2"));
  });
});

describe("manualSessionDir", () => {
  it("puts a manual session in its date's folder, named by time, _manual_, and page", () => {
    const site = path.join("home", "dvfr.illinois.gov");
    expect(manualSessionDir(site, "2026-09-27_1415", "faq")).toBe(
      path.join(site, "2026-09-27", "1415_manual_faq"),
    );
    expect(manualSessionDir(site, "2026-09-27_1415-2", "faq")).toBe(
      path.join(site, "2026-09-27", "1415_manual_faq-2"),
    );
  });
});

describe("sharePath", () => {
  it("puts the shareable page in the site folder's share folder", () => {
    const site = path.join("home", "dvfr.illinois.gov");
    expect(sharePath(site)).toBe(path.join(site, "share", "current.html"));
  });
});

describe("attemptsDir", () => {
  it("keeps a page's earlier attempts in its run's folder", () => {
    const site = path.join("home", "dvfr.illinois.gov");
    expect(attemptsDir(site, "2026-09-27_1102", "faq")).toBe(
      path.join(runDir(site, "2026-09-27_1102"), "attempts", "faq"),
    );
  });
});
