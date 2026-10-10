import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { ForegroundError } from "../src/drivers/types.js";
import { StepTimeoutError, withTimeout } from "../src/passes/steps.js";
import {
  accountFolders,
  causeOf,
  homeFolder,
  redactAccount,
  redactHome,
  redactTemp,
  type AccountFolders,
} from "../src/run/failure.js";
import { EnvironmentError, programOf } from "../src/util/errors.js";
import { isoLocal, isoLocalMs } from "../src/util/time.js";

describe("causeOf", () => {
  it("reads the code voicecap's own errors carry", () => {
    expect(causeOf(new ForegroundError("The browser lost the foreground."))).toBe("foreground");
    expect(causeOf(new EnvironmentError("Windows is locked.", { failure: "locked" }))).toBe(
      "locked",
    );
    expect(causeOf(new StepTimeoutError("nextLine", 30_000))).toBe("step-timeout");
    expect(causeOf(new StepTimeoutError("Opening the page", 30_000, "open-timeout"))).toBe(
      "open-timeout",
    );
    expect(
      causeOf(
        new EnvironmentError("The page couldn't be reached: net::ERR_NAME_NOT_RESOLVED", {
          failure: "unreachable",
        }),
      ),
    ).toBe("unreachable");
  });

  it("calls every other error unexpected", () => {
    expect(causeOf(new TypeError("Cannot read properties of undefined"))).toBe("unexpected");
    expect(causeOf(new EnvironmentError("No code given."))).toBe("unexpected");
    expect(causeOf("a thrown string")).toBe("unexpected");
  });

  it("takes a code only from voicecap's own errors, not from anything with a failure property", () => {
    expect(causeOf(Object.assign(new Error("boom"), { failure: "locked" }))).toBe("unexpected");
    expect(causeOf({ failure: "browser" })).toBe("unexpected");
    expect(causeOf(null)).toBe("unexpected");
    expect(causeOf(undefined)).toBe("unexpected");
  });

  it("keeps the error's own cause beside its code", () => {
    const cause = new Error("it exited (1)");
    const error = new EnvironmentError("Chrome didn't start", { cause, failure: "browser" });
    expect(error.cause).toBe(cause);
    expect(error.failure).toBe("browser");
    const plain = new EnvironmentError("Chrome isn't installed", { cause });
    expect(plain.cause).toBe(cause);
    expect(plain.failure).toBeUndefined();
    expect(new EnvironmentError("No options").failure).toBeUndefined();
  });
});

describe("programOf", () => {
  const LOST = "The browser lost the foreground to another window.";

  it("gives the program a ForegroundError names, or null when Windows didn't say", () => {
    expect(programOf(new ForegroundError(LOST, { program: "Microsoft Teams" }))).toBe(
      "Microsoft Teams",
    );
    expect(programOf(new ForegroundError(LOST, { program: null }))).toBeNull();
  });

  it("gives nothing for a ForegroundError that names no program, and for every other error", () => {
    expect(programOf(new ForegroundError(LOST))).toBeUndefined();
    expect(programOf(new ForegroundError(LOST, {}))).toBeUndefined();
    expect(
      programOf(new EnvironmentError("Windows is locked.", { failure: "locked" })),
    ).toBeUndefined();
    expect(programOf(new StepTimeoutError("nextLine", 30_000))).toBeUndefined();
    expect(programOf(new TypeError("Cannot read properties of undefined"))).toBeUndefined();
    expect(programOf("a thrown string")).toBeUndefined();
    expect(programOf(null)).toBeUndefined();
    expect(programOf(undefined)).toBeUndefined();
  });

  it("takes a program only from a ForegroundError, not from anything with a program property", () => {
    const named = { failure: "foreground", program: "Microsoft Teams" };
    expect(programOf(Object.assign(new Error(LOST), named))).toBeUndefined();
    expect(programOf(named)).toBeUndefined();
  });

  it("keeps the program beside the message and the code", () => {
    const error = new ForegroundError(LOST, { program: "Microsoft Teams" });
    expect(error).toMatchObject({
      name: "ForegroundError",
      message: LOST,
      failure: "foreground",
      program: "Microsoft Teams",
    });
    expect(causeOf(error)).toBe("foreground");
  });
});

describe("a timeout's code", () => {
  const hung = () => new Promise<never>(() => {});

  it("is step-timeout unless the caller says what timed out", async () => {
    await expect(withTimeout("nextLine", hung, 5)).rejects.toMatchObject({
      failure: "step-timeout",
    });
    await expect(
      withTimeout("Opening the page", hung, 5, undefined, "open-timeout"),
    ).rejects.toMatchObject({ failure: "open-timeout" });
  });

  it("keeps the message the same whatever the code", () => {
    expect(new StepTimeoutError("nextLine", 30_000).message).toBe(
      "nextLine did not finish within 30s",
    );
    expect(new StepTimeoutError("The whole page", 120_000, "page-timeout").message).toBe(
      "The whole page did not finish within 2m 0s",
    );
  });

  it("survives as the reason the whole page was called off", async () => {
    const pageTimeout = new AbortController();
    pageTimeout.abort(new StepTimeoutError("The whole page", 120_000, "page-timeout"));
    await expect(withTimeout("nextLine", hung, 60_000, pageTimeout.signal)).rejects.toMatchObject({
      failure: "page-timeout",
    });
  });
});

describe("redactHome", () => {
  it("replaces the home folder however it's written, on Windows", () => {
    const stack = [
      "TypeError: x",
      "    at f (C:\\Users\\cschw\\code\\voicecap\\dist\\a.js:1:2)",
      "    at g (c:/users/cschw/code/b.js:3:4)",
    ].join("\n");
    expect(redactHome(stack, "C:\\Users\\cschw", "win32")).toBe(
      [
        "TypeError: x",
        "    at f (%USERPROFILE%\\code\\voicecap\\dist\\a.js:1:2)",
        "    at g (%USERPROFILE%/code/b.js:3:4)",
      ].join("\n"),
    );
  });

  it("replaces it with ~ elsewhere, and only as a whole folder", () => {
    expect(
      redactHome("at f (/Users/pat/voicecap/a.js:1:2) /Users/patrick/x", "/Users/pat", "darwin"),
    ).toBe("at f (~/voicecap/a.js:1:2) /Users/patrick/x");
  });

  it("replaces it wherever the next character can't continue the folder's name", () => {
    expect(
      redactHome(
        "Cannot read properties of undefined (C:\\Users\\cschw)",
        "C:\\Users\\cschw",
        "win32",
      ),
    ).toBe("Cannot read properties of undefined (%USERPROFILE%)");
    expect(
      redactHome("open 'C:\\Users\\cschw', then C:\\Users\\cschw", "C:\\Users\\cschw", "win32"),
    ).toBe("open '%USERPROFILE%', then %USERPROFILE%");
    expect(redactHome("failed (/Users/pat) in /Users/pat", "/Users/pat", "linux")).toBe(
      "failed (~) in ~",
    );
  });

  it.each(["patrick", "pat2", "pat_x", "pat.old", "pat-x", "paté"])(
    "leaves /Users/%s alone: the name goes on",
    (folder) => {
      const text = `at f (/Users/${folder}/a.js:1:2)`;
      expect(redactHome(text, "/Users/pat", "darwin")).toBe(text);
    },
  );

  it("leaves another Windows folder with the same start alone, too", () => {
    const text = "at f (C:\\Users\\cschwab\\a.js:1:2) C:\\Users\\cschw.old\\b.js";
    expect(redactHome(text, "C:\\Users\\cschw", "win32")).toBe(text);
  });

  it("matches the case of the home folder exactly, except on Windows", () => {
    expect(redactHome("/users/pat/a.js", "/Users/pat", "linux")).toBe("/users/pat/a.js");
  });

  it("takes a home folder on a network share, whose name starts with two slashes", () => {
    expect(redactHome("open '\\\\srv\\share\\pat\\x'", "\\\\srv\\share\\pat", "win32")).toBe(
      "open '%USERPROFILE%\\x'",
    );
  });

  it("ignores a separator left at the end of the home folder", () => {
    expect(redactHome("at f (/Users/pat/a.js:1:2)", "/Users/pat/", "darwin")).toBe(
      "at f (~/a.js:1:2)",
    );
    expect(redactHome("at f (C:\\Users\\cschw\\a.js:1:2)", "C:\\Users\\cschw\\", "win32")).toBe(
      "at f (%USERPROFILE%\\a.js:1:2)",
    );
  });

  it("doesn't read the home folder's own characters as a pattern", () => {
    expect(redactHome("at f (/Users/p+t/a.js) /Users/pt/b.js", "/Users/p+t", "linux")).toBe(
      "at f (~/a.js) /Users/pt/b.js",
    );
  });

  // The stack frames of voicecap's own ES modules are file: URLs, which spell a space as %20 and a
  // letter such as é as %C3%A9.
  it("replaces the home folder as a file: URL spells it, on Windows", () => {
    expect(
      redactHome(
        "at f (file:///C:/Users/Jane%20Doe/code/voicecap/dist/a.js:1:2)",
        "C:\\Users\\Jane Doe",
        "win32",
      ),
    ).toBe("at f (file:///%USERPROFILE%/code/voicecap/dist/a.js:1:2)");
  });

  it("replaces the URL form of a home folder with a letter that isn't ASCII, in either case", () => {
    const home = "C:\\Users\\José";
    expect(redactHome("at f (file:///C:/Users/Jos%C3%A9/code/a.js:1:2)", home, "win32")).toBe(
      "at f (file:///%USERPROFILE%/code/a.js:1:2)",
    );
    expect(redactHome("at g (file:///c:/users/jos%c3%a9/b.js:3:4)", home, "win32")).toBe(
      "at g (file:///%USERPROFILE%/b.js:3:4)",
    );
  });

  it("replaces the URL form with ~ elsewhere, and the plain form beside it", () => {
    expect(
      redactHome(
        "at f (file:///Users/Jos%C3%A9%20Doe/a.js:1:2) and /Users/José Doe/b.js",
        "/Users/José Doe",
        "darwin",
      ),
    ).toBe("at f (file://~/a.js:1:2) and ~/b.js");
  });

  it("ends the name of either form by the same rule", () => {
    const home = "C:\\Users\\Jane Doe";
    expect(redactHome("(file:///C:/Users/Jane%20Doe) 'C:\\Users\\Jane Doe'", home, "win32")).toBe(
      "(file:///%USERPROFILE%) '%USERPROFILE%'",
    );
    const longer = [
      "at f (file:///C:/Users/Jane%20Doey/a.js:1:2)",
      "at g (file:///C:/Users/Jane%20Doe.old/b.js:3:4)",
      "at h (C:\\Users\\Jane Doey\\c.js:5:6)",
    ].join("\n");
    expect(redactHome(longer, home, "win32")).toBe(longer);
  });

  // encodeURI leaves # ? and ~ as they are; Node's file: URLs write %23 %3F, and (Node 24) %7E.
  it("replaces the URL form as Node's own file: URLs spell a # in the home folder", () => {
    const home = "C:\\Users\\Jane#Doe";
    expect(redactHome("at f (file:///C:/Users/Jane%23Doe/code/a.js:1:2)", home, "win32")).toBe(
      "at f (file:///%USERPROFILE%/code/a.js:1:2)",
    );
    expect(redactHome("at f (C:\\Users\\Jane#Doe\\code\\a.js:1:2)", home, "win32")).toBe(
      "at f (%USERPROFILE%\\code\\a.js:1:2)",
    );
    expect(redactHome("at f (file:///Users/pat%23x/a.js:1:2)", "/Users/pat#x", "darwin")).toBe(
      "at f (file://~/a.js:1:2)",
    );
  });

  // Spelled as the Node running voicecap writes its stack frames, whatever that Node's spelling:
  // a short (8.3) name, as Windows gives some profile folders (C:\Users\JANEDO~1), has its ~
  // written %7E by Node 24.
  it.each([
    {
      platform: "win32",
      home: "C:\\Users\\JANEDO~1",
      expected: "at f (file:///%USERPROFILE%/code/a.js:1:2)",
    },
    { platform: "darwin", home: "/Users/pat~x", expected: "at f (file://~/code/a.js:1:2)" },
    { platform: "linux", home: "/home/pat?x#y", expected: "at f (file://~/code/a.js:1:2)" },
  ] as const)(
    "replaces $home in a stack frame, however Node spells it as a URL",
    ({ platform, home, expected }) => {
      const windows = platform === "win32";
      const file = windows ? `${home}\\code\\a.js` : `${home}/code/a.js`;
      const frame = pathToFileURL(file, { windows }).href;
      expect(redactHome(`at f (${frame}:1:2)`, home, platform)).toBe(expected);
    },
  );

  it("escapes the URL form as a pattern after encoding it", () => {
    expect(
      redactHome("at f (file:///C:/Users/pat%20(work)/a.js:1:2)", "C:\\Users\\pat (work)", "win32"),
    ).toBe("at f (file:///%USERPROFILE%/a.js:1:2)");
  });

  // encodeURI throws on a lone surrogate, and a failure mustn't be lost to an error while it's recorded.
  it("doesn't fail on a home folder that can't be percent-encoded", () => {
    const text = "at f (/Users/pat/a.js:1:2)";
    expect(redactHome(text, "/Users/\ud800", "linux")).toBe(text);
  });

  it("leaves the text alone when there is no home folder to replace", () => {
    const text = "at f (/Users/pat/a.js:1:2)";
    expect(redactHome(text, "", "darwin")).toBe(text);
    expect(redactHome(text, "/", "darwin")).toBe(text);
    expect(redactHome("at f (C:\\a.js)", "", "win32")).toBe("at f (C:\\a.js)");
  });

  // A drive's root is nobody's home folder either: "C:" would be taken out of every path on it.
  it("leaves the text alone when the home folder is only a drive's root, on Windows", () => {
    const text = "at f (C:\\Windows\\a.js:1:2) at g (c:/windows/b.js:3:4)";
    expect(redactHome(text, "C:\\", "win32")).toBe(text);
    expect(redactHome(text, "C:", "win32")).toBe(text);
    expect(redactHome(text, "c:/", "win32")).toBe(text);
    expect(redactHome(text, "\\", "win32")).toBe(text);
    // A folder on that drive is still a home folder.
    expect(redactHome(text, "C:\\Windows", "win32")).toBe(
      "at f (%USERPROFILE%\\a.js:1:2) at g (%USERPROFILE%/b.js:3:4)",
    );
  });

  // A full stop that ends a sentence ends the folder's name too: the error's words go on after it.
  it("replaces the home folder at the end of a sentence, before its full stop", () => {
    expect(redactHome("Couldn't open C:\\Users\\pat.", "C:\\Users\\pat", "win32")).toBe(
      "Couldn't open %USERPROFILE%.",
    );
    expect(redactHome("It is in C:\\Users\\pat. Open it.", "C:\\Users\\pat", "win32")).toBe(
      "It is in %USERPROFILE%. Open it.",
    );
    expect(redactHome("No such folder: /Users/pat.\nTry again.", "/Users/pat", "darwin")).toBe(
      "No such folder: ~.\nTry again.",
    );
    expect(redactHome("at f (file:///C:/Users/Jane%20Doe.)", "C:\\Users\\Jane Doe", "win32")).toBe(
      "at f (file:///%USERPROFILE%.)",
    );
  });

  // Three full stops after a path are an ellipsis, not more of its name: the words go on after them.
  // A run of full stops ends the name unless a letter, a digit, _ or - comes after it.
  it("replaces the home folder before a run of full stops, an ellipsis", () => {
    expect(redactHome("Couldn't open C:\\Users\\pat...", "C:\\Users\\pat", "win32")).toBe(
      "Couldn't open %USERPROFILE%...",
    );
    expect(redactHome("Opening C:\\Users\\pat... done", "C:\\Users\\pat", "win32")).toBe(
      "Opening %USERPROFILE%... done",
    );
    expect(
      redactHome("(C:\\Users\\pat..) and 'C:\\Users\\pat....'", "C:\\Users\\pat", "win32"),
    ).toBe("(%USERPROFILE%..) and '%USERPROFILE%....'");
    expect(redactHome("No such folder: /Users/pat...\nTry again.", "/Users/pat", "darwin")).toBe(
      "No such folder: ~...\nTry again.",
    );
    // In Git Bash's spelling, and as a file: URL spells it, too.
    expect(redactHome("Couldn't open /c/Users/pat...", "C:\\Users\\pat", "win32")).toBe(
      "Couldn't open %USERPROFILE%...",
    );
    expect(
      redactHome("at f (file:///C:/Users/Jane%20Doe...)", "C:\\Users\\Jane Doe", "win32"),
    ).toBe("at f (file:///%USERPROFILE%...)");
  });

  // The ellipsis of one character (U+2026) is no full stop, a letter, or a digit: it never was part
  // of a name, so the folder before it is replaced, as it is before three full stops.
  it("replaces the home folder before the one-character ellipsis, too", () => {
    expect(redactHome("Opening C:\\Users\\pat\u2026 done", "C:\\Users\\pat", "win32")).toBe(
      "Opening %USERPROFILE%\u2026 done",
    );
    expect(redactHome("Opening /Users/pat\u2026", "/Users/pat", "darwin")).toBe("Opening ~\u2026");
  });

  it("leaves a folder whose name goes on after a full stop, or a run of them, alone", () => {
    const text = [
      "C:\\Users\\pat.old\\a.txt",
      "C:\\Users\\pat..x",
      "C:\\Users\\pat.2\\b.txt",
      "C:\\Users\\pat..old\\c.txt",
      "C:\\Users\\pat...old",
      "C:\\Users\\pat.-x and C:\\Users\\pat._x",
    ].join(", ");
    expect(redactHome(text, "C:\\Users\\pat", "win32")).toBe(text);
  });

  // Git Bash writes C:\Users\pat as /c/Users/pat, and voicecap reads that spelling in a path.
  it("replaces the home folder as Git Bash spells it, on Windows, with either case of the drive", () => {
    expect(redactHome("/c/Users/pat/notes.txt", "C:\\Users\\pat", "win32")).toBe(
      "%USERPROFILE%/notes.txt",
    );
    expect(redactHome("cd '/C/Users/pat' and /c/users/PAT/x", "C:\\Users\\pat", "win32")).toBe(
      "cd '%USERPROFILE%' and %USERPROFILE%/x",
    );
    expect(redactHome("/d/Users/pat/x", "D:\\Users\\pat", "win32")).toBe("%USERPROFILE%/x");
    // A drive in lower case in the folder gives the same spelling.
    expect(redactHome("/c/Users/pat/x", "c:\\Users\\pat", "win32")).toBe("%USERPROFILE%/x");
  });

  it("ends the name of Git Bash's spelling by the same rule", () => {
    const longer = "/c/Users/patrick/x, /c/Users/pat.old/y and /c/Users/pat_2/z";
    expect(redactHome(longer, "C:\\Users\\pat", "win32")).toBe(longer);
    expect(redactHome("Couldn't open /c/Users/pat.", "C:\\Users\\pat", "win32")).toBe(
      "Couldn't open %USERPROFILE%.",
    );
  });

  it("gives a network share's home no Git Bash spelling: it has no drive", () => {
    const text = "open /c/Users/pat/x";
    expect(redactHome(text, "\\\\srv\\share\\pat", "win32")).toBe(text);
    expect(redactHome("open '\\\\srv\\share\\pat\\x'", "\\\\srv\\share\\pat", "win32")).toBe(
      "open '%USERPROFILE%\\x'",
    );
  });
});

describe("redactTemp", () => {
  const TEMP = "C:\\Users\\JANEDO~1\\AppData\\Local\\Temp";

  it("writes the temp folder as %TEMP%, in any case and with either slash between its parts, on Windows", () => {
    expect(
      redactTemp(
        "EBUSY: open 'C:\\Users\\JANEDO~1\\AppData\\Local\\Temp\\nvda.log'",
        TEMP,
        "win32",
      ),
    ).toBe("EBUSY: open '%TEMP%\\nvda.log'");
    expect(redactTemp("c:/users/janedo~1/appdata/local/temp/a/1.pcm", TEMP, "win32")).toBe(
      "%TEMP%/a/1.pcm",
    );
    // A Python repr or a JSON string writes each backslash twice.
    expect(
      redactTemp(
        "'C:\\\\Users\\\\JANEDO~1\\\\AppData\\\\Local\\\\Temp\\\\nvda-old.log'",
        TEMP,
        "win32",
      ),
    ).toBe("'%TEMP%\\\\nvda-old.log'");
    expect(redactTemp(`${TEMP} then ${TEMP}`, TEMP, "win32")).toBe("%TEMP% then %TEMP%");
  });

  it("replaces the temp folder where a sentence ends, and only as a whole folder", () => {
    expect(redactTemp(`Couldn't make ${TEMP}.`, TEMP, "win32")).toBe("Couldn't make %TEMP%.");
    // Before an ellipsis, of full stops or of one character.
    expect(redactTemp(`Making ${TEMP}... done`, TEMP, "win32")).toBe("Making %TEMP%... done");
    expect(redactTemp(`Making ${TEMP}…`, TEMP, "win32")).toBe("Making %TEMP%…");
    const longer = `${TEMP}2\\a, ${TEMP}-old\\b, ${TEMP}.old\\c and ${TEMP}..old\\d`;
    expect(redactTemp(longer, TEMP, "win32")).toBe(longer);
  });

  it("doesn't read the folder's own characters as a pattern", () => {
    expect(redactTemp("open D:\\T+mp (x86)\\a.log", "D:\\T+mp (x86)", "win32")).toBe(
      "open %TEMP%\\a.log",
    );
    expect(redactTemp("open D:\\Tmp\\a.log", "D:\\T+mp (x86)", "win32")).toBe(
      "open D:\\Tmp\\a.log",
    );
  });

  it("takes a temp folder on a network share, whose name starts with two slashes", () => {
    expect(redactTemp("open '\\\\srv\\share\\tmp\\a.log'", "\\\\srv\\share\\tmp", "win32")).toBe(
      "open '%TEMP%\\a.log'",
    );
  });

  it("ignores a separator left at the end of the temp folder", () => {
    expect(redactTemp("open C:\\Temp\\a.log", "C:\\Temp\\", "win32")).toBe("open %TEMP%\\a.log");
  });

  it("leaves the text as it was away from Windows", () => {
    const text = "open /tmp/voicecap/a.log and /TMP/VOICECAP/b.log";
    expect(redactTemp(text, "/tmp/voicecap", "linux")).toBe(text);
    expect(redactTemp(text, "/tmp/voicecap", "darwin")).toBe(text);
  });

  it("leaves the text as it was for a temp folder that isn't an absolute path", () => {
    const text = "open Temp\\a.log, .\\a.log, ..\\Temp\\b.log and C:Temp\\c.log";
    for (const temp of ["", ".", "Temp", "..\\Temp", "C:Temp", "C:"]) {
      expect(redactTemp(text, temp, "win32"), temp).toBe(text);
    }
  });

  // "C:\" taken out of every path on the drive would leave nothing of them.
  it("leaves the text as it was for a temp folder that is only a drive's root", () => {
    const text = "open C:\\Windows\\a.log and c:/windows/b.log";
    for (const temp of ["C:\\", "c:/", "\\", "/"]) {
      expect(redactTemp(text, temp, "win32"), temp).toBe(text);
    }
  });
});

describe("redactAccount", () => {
  /** An account whose long name is `jane.doe.smith`, as Windows gives some profile folders a short one. */
  const F: AccountFolders = {
    home: "C:\\Users\\jane.doe.smith",
    temp: "C:\\Users\\JANEDO~1\\AppData\\Local\\Temp",
    realTemp: "C:\\Users\\jane.doe.smith\\AppData\\Local\\Temp",
    platform: "win32",
  };

  it("names the temp folder %TEMP% in its short spelling, as a message from Node does", () => {
    expect(
      redactAccount("EBUSY: open 'C:\\Users\\JANEDO~1\\AppData\\Local\\Temp\\nvda.log'", F),
    ).toBe("EBUSY: open '%TEMP%\\nvda.log'");
  });

  it("finds the home folder's short spelling from the temp folder's two spellings", () => {
    expect(redactAccount("c:/users/janedo~1/Documents/pages.csv", F)).toBe(
      "%USERPROFILE%/Documents/pages.csv",
    );
    // In Git Bash's spelling, and at the end of a sentence, too.
    expect(redactAccount("Couldn't open /c/Users/JANEDO~1/Documents.", F)).toBe(
      "Couldn't open %USERPROFILE%/Documents.",
    );
    // The short spelling is the folder's name at the end of a sentence, or before an ellipsis.
    expect(redactAccount("Couldn't open C:\\Users\\JANEDO~1.", F)).toBe(
      "Couldn't open %USERPROFILE%.",
    );
    expect(redactAccount("Opening C:\\Users\\JANEDO~1... done", F)).toBe(
      "Opening %USERPROFILE%... done",
    );
    // And its long spelling, as before.
    expect(redactAccount("C:\\Users\\jane.doe.smith\\Documents\\pages.csv", F)).toBe(
      "%USERPROFILE%\\Documents\\pages.csv",
    );
  });

  it("names the temp folder first, in whichever spelling, so that it isn't taken for the home folder's", () => {
    expect(redactAccount("C:\\Users\\jane.doe.smith\\AppData\\Local\\Temp\\a", F)).toBe(
      "%TEMP%\\a",
    );
    expect(redactAccount("C:\\Users\\JANEDO~1\\AppData\\Local\\Temp\\a", F)).toBe("%TEMP%\\a");
    expect(
      redactAccount(
        "from C:\\Users\\jane.doe.smith\\AppData\\Local\\Temp to C:\\Users\\jane.doe.smith\\x",
        F,
      ),
    ).toBe("from %TEMP% to %USERPROFILE%\\x");
  });

  it("knows no short spelling when the temp folder isn't in the home folder", () => {
    const elsewhere: AccountFolders = { ...F, temp: "D:\\Temp", realTemp: "D:\\Temp" };
    expect(redactAccount("C:\\Users\\JANEDO~1\\x", elsewhere)).toBe("C:\\Users\\JANEDO~1\\x");
    expect(redactAccount("C:\\Users\\jane.doe.smith\\x", elsewhere)).toBe("%USERPROFILE%\\x");
    expect(redactAccount("D:\\Temp\\x", elsewhere)).toBe("%TEMP%\\x");
    // Nor when the real path can't be had.
    const unresolved: AccountFolders = { ...F, realTemp: null };
    expect(redactAccount("C:\\Users\\JANEDO~1\\x", unresolved)).toBe("C:\\Users\\JANEDO~1\\x");
    expect(redactAccount("C:\\Users\\JANEDO~1\\AppData\\Local\\Temp\\x", unresolved)).toBe(
      "%TEMP%\\x",
    );
  });

  it("knows no short spelling when the temp folders are in the home folder but share no tail", () => {
    const moved: AccountFolders = {
      ...F,
      temp: "C:\\Users\\JANEDO~1\\Scratch",
      realTemp: "C:\\Users\\jane.doe.smith\\AppData\\Local\\Temp",
    };
    expect(redactAccount("C:\\Users\\JANEDO~1\\x", moved)).toBe("C:\\Users\\JANEDO~1\\x");
  });

  it("takes a home folder written with a separator at its end, and a short spelling in any case", () => {
    const folders: AccountFolders = {
      ...F,
      home: "C:\\Users\\jane.doe.smith\\",
      temp: "c:\\users\\janedo~1\\appdata\\local\\temp",
    };
    expect(redactAccount("C:\\Users\\JANEDO~1\\Documents", folders)).toBe(
      "%USERPROFILE%\\Documents",
    );
  });

  it("leaves a home folder that isn't the account's alone, in any spelling", () => {
    const text =
      "C:\\Users\\JANEDO~12\\a, C:\\Users\\jane.doe.smith.old\\b and /c/Users/janedo~1x/c";
    expect(redactAccount(text, F)).toBe(text);
  });

  it("writes the home folder as ~ away from Windows, and leaves the temp folder alone", () => {
    const linux: AccountFolders = {
      home: "/home/pat",
      temp: "/tmp",
      realTemp: "/tmp",
      platform: "linux",
    };
    expect(redactAccount("/home/pat/x", linux)).toBe("~/x");
    expect(redactAccount("open /tmp/a and /home/pat/b", linux)).toBe("open /tmp/a and ~/b");
  });

  it("still names the temp folder when the home folder isn't known", () => {
    const noHome: AccountFolders = { ...F, home: null };
    expect(
      redactAccount(
        "C:\\Users\\JANEDO~1\\AppData\\Local\\Temp\\a and C:\\Users\\jane.doe.smith\\b",
        noHome,
      ),
    ).toBe("%TEMP%\\a and C:\\Users\\jane.doe.smith\\b");
  });

  it("leaves the text as it was when it names neither folder, and gives the same on a second go", () => {
    const text = "net::ERR_NAME_NOT_RESOLVED at https://example.illinois.gov/a";
    expect(redactAccount(text, F)).toBe(text);
    const once = redactAccount(
      "C:\\Users\\JANEDO~1\\AppData\\Local\\Temp\\a and C:\\Users\\jane.doe.smith\\b",
      F,
    );
    expect(redactAccount(once, F)).toBe(once);
  });

  it("takes this computer's folders when it's given none", () => {
    const mark = process.platform === "win32" ? "%USERPROFILE%" : "~";
    const file = path.join(os.homedir(), "secret.txt");
    expect(redactAccount(`can't read ${file}`)).toBe(`can't read ${mark}${path.sep}secret.txt`);
  });
});

// A message can hold a long run of slashes: an address of a page, quoted by an error, with a path of
// them. A folder's pattern that begins with the separator's own (a network share's, Git Bash's
// "/c/Users/pat", a temp folder with no drive) would be tried from every slash of the run, each time
// reading to the end of the run and back, so the time would grow with the square of the run.
describe("a long run of slashes", () => {
  const RUN = 300_000;
  // A pattern that is linear reads this in milliseconds; a quadratic one, in tens of seconds.
  const LIMIT_MS = 5_000;
  const slashes = "/".repeat(RUN);
  const backslashes = "\\".repeat(RUN);
  const DRIVE = "C:\\Users\\jane";
  const SHARE = "\\\\srv\\share\\jane";

  it.each<[name: string, text: string, read: (text: string) => string]>([
    [
      "Git Bash's spelling of a home folder, after an address",
      `https://x.example${slashes}`,
      (text) => redactHome(text, DRIVE, "win32"),
    ],
    [
      "Git Bash's spelling of a home folder, in backslashes",
      backslashes,
      (text) => redactHome(text, DRIVE, "win32"),
    ],
    [
      "Git Bash's spelling of a home folder, after a drive",
      `C:${slashes}`,
      (text) => redactHome(text, DRIVE, "win32"),
    ],
    [
      "a network share's home folder, in both kinds of slash",
      "/\\".repeat(RUN / 2),
      (text) => redactHome(text, SHARE, "win32"),
    ],
    ["a network share's temp folder", backslashes, (text) => redactTemp(text, SHARE, "win32")],
    ["a temp folder with no drive", slashes, (text) => redactTemp(text, "/tmp/voicecap", "win32")],
  ])(
    "is read in linear time: %s",
    (_name, text, read) => {
      const began = Date.now();
      // Nothing in the text names the folder, so it comes back as it was.
      const same = read(text) === text;
      expect(Date.now() - began).toBeLessThan(LIMIT_MS);
      expect(same).toBe(true);
    },
    60_000,
  );

  // A match begins where a run of slashes does, or after any other character: so it still begins
  // with the whole run, however many slashes it is, and nothing before it is taken.
  it("still replaces a folder that a run of slashes comes before, wherever the run begins", () => {
    const share = "\\\\srv\\share\\pat";
    expect(redactHome("///srv/share/pat/x", share, "win32")).toBe("%USERPROFILE%/x");
    expect(
      redactHome(
        "open //srv/share/pat/x, \\\\srv\\share\\pat\\y and a///srv/share/pat",
        share,
        "win32",
      ),
    ).toBe("open %USERPROFILE%/x, %USERPROFILE%\\y and a%USERPROFILE%");
    const drive = "C:\\Users\\pat";
    expect(redactHome("///c/Users/pat/x", drive, "win32")).toBe("%USERPROFILE%/x");
    expect(redactHome("a/c/Users/pat and b//c/Users/pat/z", drive, "win32")).toBe(
      "a%USERPROFILE% and b%USERPROFILE%/z",
    );
    expect(
      redactTemp(
        "open //srv/share/tmp/a, \\\\srv\\share\\tmp\\b and x///srv/share/tmp",
        "\\\\srv\\share\\tmp",
        "win32",
      ),
    ).toBe("open %TEMP%/a, %TEMP%\\b and x%TEMP%");
    expect(redactTemp("open ///tmp/x/a and b//tmp/x", "/tmp/x", "win32")).toBe(
      "open %TEMP%/a and b%TEMP%",
    );
  });

  it("leaves a folder on another drive alone, and takes a share's file: URL form as it always did", () => {
    expect(redactHome("/d/Users/pat/x and /c/Users/pat", "C:\\Users\\pat", "win32")).toBe(
      "/d/Users/pat/x and %USERPROFILE%",
    );
    // The two slashes after "file:" are the share's own, in the URL as in the path.
    expect(redactHome("at f (file://srv/share/pat/a.js:1:2)", "\\\\srv\\share\\pat", "win32")).toBe(
      "at f (file:%USERPROFILE%/a.js:1:2)",
    );
    expect(redactHome("'//srv/share/pat/x'", "\\\\srv\\share\\pat", "win32")).toBe(
      "'%USERPROFILE%/x'",
    );
  });
});

describe("accountFolders", () => {
  it("is this computer's home, temp, and real temp folders, and platform", () => {
    expect(accountFolders()).toEqual({
      home: os.homedir(),
      temp: os.tmpdir(),
      realTemp: realpathSync.native(os.tmpdir()),
      platform: process.platform,
    });
  });

  // Node throws where neither HOME (USERPROFILE on Windows) nor the account's entry gives a home
  // folder, and for a folder it can't resolve; neither may fail a page's record.
  it("has no home folder, and no real temp folder, where Node gives none, rather than failing", () => {
    const missing = path.join(os.tmpdir(), `voicecap-no-such-folder-${randomUUID()}`);
    const tmpdir = vi.spyOn(os, "tmpdir").mockReturnValue(missing);
    const homedir = vi.spyOn(os, "homedir").mockImplementation(() => {
      throw new Error("A system error occurred: uv_os_homedir returned ENOENT");
    });
    try {
      expect(accountFolders()).toEqual({
        home: null,
        temp: missing,
        realTemp: null,
        platform: process.platform,
      });
    } finally {
      tmpdir.mockRestore();
      homedir.mockRestore();
    }
  });
});

describe("homeFolder", () => {
  it("is the home folder", () => {
    expect(homeFolder()).toBe(os.homedir());
  });

  // Where neither HOME (USERPROFILE on Windows) nor the account's entry gives one, Node throws.
  it("is null where Node can't give one, rather than failing", () => {
    const homedir = vi.spyOn(os, "homedir").mockImplementation(() => {
      throw new Error("A system error occurred: uv_os_homedir returned ENOENT");
    });
    try {
      expect(homeFolder()).toBeNull();
    } finally {
      homedir.mockRestore();
    }
  });
});

describe("isoLocalMs", () => {
  it("keeps milliseconds in a local ISO time", () => {
    expect(isoLocalMs(new Date(2026, 8, 30, 12, 19, 24, 482))).toMatch(
      /^2026-09-30T12:19:24\.482[+-]\d\d:\d\d$/,
    );
  });

  it("pads the milliseconds to three digits", () => {
    expect(isoLocalMs(new Date(2026, 8, 30, 12, 19, 24, 5))).toMatch(
      /^2026-09-30T12:19:24\.005[+-]\d\d:\d\d$/,
    );
  });

  it("leaves isoLocal's whole seconds alone", () => {
    const date = new Date(2026, 8, 30, 12, 19, 24, 482);
    expect(isoLocal(date)).toMatch(/^2026-09-30T12:19:24[+-]\d\d:\d\d$/);
    expect(isoLocalMs(date).replace(".482", "")).toBe(isoLocal(date));
  });
});
