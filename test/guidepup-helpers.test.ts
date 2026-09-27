import { describe, expect, it } from "vitest";

import { browserCandidates } from "../src/drivers/guidepup/chrome.js";
import { guidepupInstall, nvdaVersionFromBuild } from "../src/drivers/guidepup/paths.js";
import {
  describeWindows,
  nvdaLanguage,
  parseTasklist,
  titleMatches,
} from "../src/drivers/guidepup/windows.js";

describe("Guidepup's NVDA install location", () => {
  it("is under %LOCALAPPDATA%\\guidepup, one folder per NVDA build", () => {
    const install = guidepupInstall(
      "0.2.1-2026.2",
      { LOCALAPPDATA: "C:\\Users\\pat\\AppData\\Local" },
      "C:\\Users\\pat",
    );
    expect(install).toEqual({
      build: "0.2.1-2026.2",
      cacheDir: "C:\\Users\\pat\\AppData\\Local\\guidepup",
      nvdaExe:
        "C:\\Users\\pat\\AppData\\Local\\guidepup\\nvda\\all\\0.2.1-2026.2\\extracted\\nvda.exe",
    });
  });

  it("honors GUIDEPUP_SCREEN_READERS_PATH, as Guidepup does", () => {
    const install = guidepupInstall(
      "0.2.1-2026.2",
      { LOCALAPPDATA: "C:\\Users\\pat\\AppData\\Local", GUIDEPUP_SCREEN_READERS_PATH: "D:\\sr" },
      "C:\\Users\\pat",
    );
    expect(install.nvdaExe).toBe("D:\\sr\\nvda\\all\\0.2.1-2026.2\\extracted\\nvda.exe");
  });

  it("falls back to the home folder when LOCALAPPDATA is unset", () => {
    expect(guidepupInstall("0.2.1-2026.2", {}, "C:\\Users\\pat").cacheDir).toBe(
      "C:\\Users\\pat\\AppData\\Local\\guidepup",
    );
  });
});

describe("NVDA version from Guidepup's build id", () => {
  it("is the part after the dash", () => {
    expect(nvdaVersionFromBuild("0.2.1-2026.2")).toBe("2026.2");
    expect(nvdaVersionFromBuild("1.0.0-2027.1.1")).toBe("2027.1.1");
  });

  it("is unknown when the build id has no NVDA version", () => {
    expect(nvdaVersionFromBuild("0.2.1")).toBeNull();
  });
});

describe("tasklist output", () => {
  it("lists the process ids", () => {
    const csv =
      '"nvda.exe","1234","Console","1","45,120 K"\r\n"nvda.exe","5678","Console","1","3,008 K"\r\n';
    expect(parseTasklist(csv)).toEqual([1234, 5678]);
  });

  it("is empty when nothing matches (tasklist prints an INFO line)", () => {
    expect(
      parseTasklist("INFO: No tasks are running which match the specified criteria.\r\n"),
    ).toEqual([]);
  });
});

describe("Windows version", () => {
  it("includes the feature update when known", () => {
    expect(
      describeWindows({ version: "Windows 11 Pro", release: "10.0.26200", displayVersion: "25H2" }),
    ).toBe("Windows 11 Pro 25H2 (10.0.26200)");
    expect(
      describeWindows({ version: "Windows 11 Pro", release: "10.0.26200", displayVersion: null }),
    ).toBe("Windows 11 Pro (10.0.26200)");
  });
});

describe("NVDA's language", () => {
  it("resolves 'Windows' (follow the Windows display language) to that language", () => {
    expect(nvdaLanguage("Windows", "en-US")).toBe("en-US");
  });

  it("keeps an explicit language", () => {
    expect(nvdaLanguage("de", "en-US")).toBe("de");
  });

  it("is unknown when neither says", () => {
    expect(nvdaLanguage(undefined, null)).toBeNull();
    expect(nvdaLanguage("Windows", null)).toBeNull();
  });
});

describe("NVDA+T window title check", () => {
  it("matches the marker at the start of the spoken window title", () => {
    expect(titleMatches("voicecap check k3m9x2 - Google Chrome", "voicecap check k3m9x2")).toBe(
      true,
    );
  });

  it("ignores case and the punctuation NVDA drops or keeps", () => {
    expect(titleMatches("Voicecap Check K3M9X2 – Google Chrome", "voicecap check k3m9x2")).toBe(
      true,
    );
  });

  it("rejects another window, even one whose title contains the marker later on", () => {
    expect(titleMatches("Inbox - Outlook", "voicecap check k3m9x2")).toBe(false);
    expect(titleMatches("Re: voicecap check k3m9x2 - Outlook", "voicecap check k3m9x2")).toBe(
      false,
    );
    expect(titleMatches("", "voicecap check k3m9x2")).toBe(false);
  });
});

describe("browser executables", () => {
  const env = {
    LOCALAPPDATA: "C:\\Users\\pat\\AppData\\Local",
    PROGRAMFILES: "C:\\Program Files",
    "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
  };

  it("looks for Chrome where its installers put it, per-user first", () => {
    expect(browserCandidates("chrome", env)).toEqual([
      "C:\\Users\\pat\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ]);
  });

  it("knows Edge and the Chrome pre-release channels", () => {
    expect(browserCandidates("msedge", env)).toContain(
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    );
    expect(browserCandidates("chrome-beta", env)).toContain(
      "C:\\Program Files\\Google\\Chrome Beta\\Application\\chrome.exe",
    );
    expect(browserCandidates("chrome-canary", env)).toEqual([
      "C:\\Users\\pat\\AppData\\Local\\Google\\Chrome SxS\\Application\\chrome.exe",
    ]);
  });

  it("has no candidates for an unknown channel", () => {
    expect(browserCandidates("firefox", env)).toEqual([]);
  });
});
