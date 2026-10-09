import { describe, expect, it } from "vitest";

import { closedProgram } from "../src/util/foreground.js";

describe("the programs voicecap closes when they come in front of the browser", () => {
  it.each([
    ["SearchHost", "Windows Search"],
    ["searchhost", "Windows Search"],
    ["  SEARCHHOST  ", "Windows Search"],
    ["SearchHost.exe", "Windows Search"],
    ["StartMenuExperienceHost", "the Start menu"],
    ["StartMenuExperienceHost.EXE", "the Start menu"],
    ["Windows Start Experience Host", "the Start menu"],
    ["windows start experience host", "the Start menu"],
  ])("knows %j as %s", (program, words) => {
    expect(closedProgram(program)?.words).toBe(words);
  });

  it.each([
    "SearchApp",
    "SearchIndexer",
    "Search",
    "Microsoft Search",
    "Windows Search Indexer",
    "SearchHost2",
    "Start",
    "StartIsBack",
    "Windows Start",
    "Microsoft Outlook",
    "Google Chrome",
    "",
    "   ",
    ".exe",
  ])("doesn't know %j", (program) => {
    expect(closedProgram(program)).toBeNull();
  });

  it("knows nothing of a program that isn't text, as a log changed by hand can give", () => {
    for (const program of [null, undefined, 7, {}, ["SearchHost"]]) {
      expect(closedProgram(program), typeof program).toBeNull();
    }
  });
});
