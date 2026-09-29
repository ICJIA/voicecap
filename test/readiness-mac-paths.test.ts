/**
 * The Mac's readiness module with Windows' own path functions, as on CI's windows-latest runner:
 * the Mac's paths must still come out as the Mac writes them. node:path is mocked for this file
 * alone, so this Mac catches what only windows-latest would otherwise show.
 */
import path, { type PlatformPath } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import {
  guidepupCacheDir,
  macReadiness,
  voiceOverLockFile,
  type MacReadinessDeps,
} from "../src/drivers/voiceover/readiness-mac.js";
import { silentLogger } from "../src/util/log.js";
import { fakeCommands } from "./helpers/fake-commands.js";

vi.mock("node:path", async (importOriginal) => {
  const { win32 } = await importOriginal<{ win32: PlatformPath }>();
  return { ...win32, default: win32 };
});

const HOME = "/Users/cschweda";
const CACHE_DIR = "/Users/cschweda/Library/Caches/guidepup";
const ASSET_FILE = `${CACHE_DIR}/voiceover/25/0.0.1-VoiceOver4/guidepup-voiceover-preferences-macos-26.dmg`;
const CHROME_PATH =
  "/Users/cschweda/Library/Caches/ms-playwright/chromium-1243/chrome-mac/Chromium.app/Contents/MacOS/Chromium";
const MANIFEST = {
  screenReaders: [
    {
      id: "voiceover",
      assets: [
        {
          version: "0.0.1-VoiceOver4",
          platformVersion: "25",
          asset: "guidepup-voiceover-preferences-macos-26.dmg",
        },
      ],
    },
  ],
};

/** A Mac whose every command fails: only the paths matter here. */
function mac(overrides: Partial<MacReadinessDeps> = {}) {
  const looked: string[] = [];
  const deps: MacReadinessDeps = {
    run: fakeCommands([]).run,
    pid: 4321,
    home: HOME,
    env: {},
    nodeVersion: "22.22.2",
    voicecapVersion: "0.4.0",
    guidepup: { version: "0.34.0", manifest: MANIFEST },
    darwinMajor: 25,
    exists: (file) => {
      looked.push(file);
      return file === ASSET_FILE;
    },
    writeVoiceOverPrefs: () => Promise.resolve({ ok: true }),
    otherVoicecap: () => Promise.resolve(null),
    lockFile: voiceOverLockFile(HOME),
    resolveBrowser: () => ({ name: "Chromium", path: CHROME_PATH, playwrightBuild: true }),
    transcripts: "/Users/cschweda/webdev/voicecap-transcripts",
    totalmem: () => 16 * 1024 ** 3,
    disk: () => Promise.resolve(null),
    ...overrides,
  };
  const platform = macReadiness(
    {
      platform: "darwin",
      config: DEFAULT_CONFIG,
      logger: silentLogger,
      env: {},
      cwd: HOME,
      again: "npx @icjia/voicecap doctor",
    },
    deps,
  );
  return { platform, looked };
}

describe("the Mac's paths, where Node's path functions are Windows'", () => {
  it("really has Windows' path functions here", () => {
    expect(path.sep).toBe("\\");
    expect(path.join("a", "b")).toBe("a\\b");
  });

  it("puts the VoiceOver lock under the home folder, the Mac's way", () => {
    expect(voiceOverLockFile(HOME)).toBe("/Users/cschweda/Library/Caches/voicecap/voiceover.lock");
  });

  it("puts Guidepup's files under the home folder, or where GUIDEPUP_SCREEN_READERS_PATH says", () => {
    expect(guidepupCacheDir({}, HOME)).toBe(CACHE_DIR);
    expect(guidepupCacheDir({ GUIDEPUP_SCREEN_READERS_PATH: "/tmp/guidepup" }, HOME)).toBe(
      "/tmp/guidepup",
    );
  });

  it("looks for VoiceOver's files for Guidepup at their Mac path", async () => {
    const { platform, looked } = mac();
    const assets = platform.quickChecks().find((runner) => runner.id === "assets");
    expect(await assets?.run()).toMatchObject({ id: "assets", status: "OK" });
    expect(looked).toContain(ASSET_FILE);
  });

  it("looks for VoiceOver's own settings where Guidepup would, at their Mac paths", async () => {
    const { platform, looked } = mac();
    const fullDiskAccess = platform.quickChecks().find((runner) => runner.id === "fullDiskAccess");
    await fullDiskAccess?.run();
    expect(looked).toEqual([
      "/Users/cschweda/Library/Group Containers/group.com.apple.VoiceOver/Library/Preferences",
      "/Users/cschweda/Library/Preferences/com.apple.VoiceOver4.local.plist",
    ]);
  });

  it("names the user, Guidepup's files, and the browser's path the Mac's way", async () => {
    const info = await mac().platform.machineInfo();
    const line = (label: string) => info.lines.find((candidate) => candidate.label === label);
    expect(line("Computer")?.value).toBe("this Mac, user cschweda");
    expect(line("Guidepup files")?.value).toBe(CACHE_DIR);
    expect(line("Browser path")?.value).toBe(
      "~/Library/Caches/ms-playwright/chromium-1243/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    );
  });
});
