import { describe, expect, it } from "vitest";

import { openFile, openFileCommand, startCommand, type Command } from "../src/drivers/open-file.js";

// A Windows home folder with a space in it, and a folder whose name a shell would split or read.
const REPORT = String.raw`C:\Users\Pat Smith\R&D "tests"\voicecap-demo\127.0.0.1_4848\report.html`;

describe("openFileCommand", () => {
  it("uses open on a Mac, Explorer on Windows, and xdg-open elsewhere", () => {
    expect(openFileCommand("/Users/pat/report.html", "darwin")).toEqual({
      file: "open",
      args: ["/Users/pat/report.html"],
    });
    expect(openFileCommand(REPORT, "win32")).toEqual({ file: "explorer.exe", args: [REPORT] });
    expect(openFileCommand("/home/pat/report.html", "linux")).toEqual({
      file: "xdg-open",
      args: ["/home/pat/report.html"],
    });
  });

  it("passes a path with spaces, & and quotes as one argument, as it is", () => {
    for (const platform of ["darwin", "win32", "linux"] as const) {
      expect(openFileCommand(REPORT, platform).args).toEqual([REPORT]);
    }
  });
});

describe("openFile", () => {
  it("starts the platform's command, and says whether it started", async () => {
    const started: Command[] = [];
    const opened = await openFile(REPORT, {
      platform: "win32",
      start: (command) => {
        started.push(command);
        return Promise.resolve(true);
      },
    });
    expect(opened).toBe(true);
    expect(started).toEqual([{ file: "explorer.exe", args: [REPORT] }]);

    const failed = await openFile("/home/pat/report.html", {
      platform: "linux",
      start: () => Promise.resolve(false),
    });
    expect(failed).toBe(false);
  });
});

// The real starter, with commands that open nothing: Node itself, and one that doesn't exist.
describe("startCommand", () => {
  it("resolves true once the command has started", async () => {
    await expect(startCommand({ file: process.execPath, args: ["-e", ""] })).resolves.toBe(true);
  });

  it("resolves false when the command can't start", async () => {
    await expect(startCommand({ file: "voicecap-no-such-command", args: [] })).resolves.toBe(false);
  });
});
