import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  attemptsDir,
  folderSafe,
  manualSessionDir,
  resolveHome,
  runDir,
  shareDir,
  sharePath,
  shareWordPath,
  siteDirFor,
  siteFolder,
} from "../src/run/paths.js";
import { UsageError } from "../src/util/errors.js";

describe("siteFolder", () => {
  it("names a site's folder after its host", () => {
    expect(siteFolder("https://dvfr.illinois.gov")).toBe("dvfr.illinois.gov");
    expect(siteFolder("http://127.0.0.1:4747/")).toBe("127.0.0.1_4747");
    expect(siteFolder("https://WWW.Example.gov/news/")).toBe("www.example.gov");
    expect(siteFolder(new URL("https://www.example.gov/x"))).toBe("www.example.gov");
    expect(siteFolder("http://[::1]:4747/")).toBe("___1__4747");
    expect(siteFolder(new URL("http://127.0.0.1:4747/"))).toBe("127.0.0.1_4747");
  });

  // A folder named only of dots is the home or the folder that holds it, and Windows keeps some
  // names for itself. A site's address that parseSiteUrl or a walkthrough file's reader takes never
  // gives one; this is the backstop for any other way a host gets here.
  it.each([
    ["two dots", "http://../"],
    ["two dots written percent-encoded", "http://%2e%2e/"],
    ["three dots", "http://.../"],
    ["one dot", "http://./"],
  ])("refuses a host of %s: it would be the home, or the folder that holds it", (_name, site) => {
    expect(() => siteFolder(new URL(site))).toThrow(UsageError);
    expect(() => siteFolder(site)).toThrow(UsageError);
    expect(() => siteFolder(new URL(site))).toThrow(/only dots/);
    expect(() => siteDirFor("home", site)).toThrow(UsageError);
  });

  it.each([
    "http://con/",
    "http://CON/",
    "http://nul/",
    "http://prn/",
    "http://aux/",
    "http://com1/",
    "http://lpt9/",
    "http://con.example.org/",
    "http://aux.illinois.gov/",
  ])("refuses %s, a name Windows keeps for itself", (site) => {
    expect(() => siteFolder(new URL(site))).toThrow(UsageError);
    expect(() => siteFolder(new URL(site))).toThrow(/Windows keeps/);
    expect(() => siteDirFor("home", new URL(site))).toThrow(UsageError);
  });

  it("refuses a site with no host, whose folder would be the home itself", () => {
    expect(() => siteFolder(new URL("file:///C:/x"))).toThrow(UsageError);
  });

  it("takes a name that only starts like one Windows keeps, or holds one after its first part", () => {
    expect(siteFolder(new URL("http://console.example.org/"))).toBe("console.example.org");
    expect(siteFolder(new URL("http://example.con/"))).toBe("example.con");
    expect(siteFolder(new URL("http://com10.example.org/"))).toBe("com10.example.org");
    // A port makes the folder's name another name, which Windows doesn't keep.
    expect(siteFolder(new URL("http://con:8080/"))).toBe("con_8080");
    expect(siteFolder(new URL("http://localhost:3000/"))).toBe("localhost_3000");
  });

  it("names the folder of a site under the home, however the site is given", () => {
    expect(siteDirFor("home", "http://127.0.0.1:4747/")).toBe(path.join("home", "127.0.0.1_4747"));
    expect(siteDirFor("home", new URL("https://dvfr.illinois.gov"))).toBe(
      path.join("home", "dvfr.illinois.gov"),
    );
  });
});

describe("folderSafe", () => {
  it("keeps lower-case letters, digits, dots, and hyphens, and makes anything else an underscore", () => {
    expect(folderSafe("dvfr.illinois.gov")).toBe("dvfr.illinois.gov");
    expect(folderSafe("dvfr.illinois.gov:8443")).toBe("dvfr.illinois.gov_8443");
    expect(folderSafe("my-site.example.gov")).toBe("my-site.example.gov");
    expect(folderSafe('a"b&c<s>')).toBe("a_b_c_s_");
    expect(folderSafe("a b/c\\d")).toBe("a_b_c_d");
  });

  it("is the rule that names a site's folder after its host", () => {
    for (const site of [
      "http://127.0.0.1:4747/",
      "https://dvfr.illinois.gov:8443/",
      "http://[::1]/",
    ]) {
      expect(folderSafe(new URL(site).host)).toBe(siteFolder(site));
    }
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

describe("shareDir and shareWordPath", () => {
  it("put the Word copy beside the shareable page, in the site folder's share folder", () => {
    const site = path.join("home", "dvfr.illinois.gov");
    expect(shareDir(site)).toBe(path.join(site, "share"));
    expect(shareWordPath(site)).toBe(path.join(site, "share", "current.docx"));
    expect(path.dirname(shareWordPath(site))).toBe(path.dirname(sharePath(site)));
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
