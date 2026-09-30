import { describe, expect, it } from "vitest";

import { ForegroundError } from "../src/drivers/types.js";
import { StepTimeoutError, withTimeout } from "../src/passes/steps.js";
import { causeOf, redactHome } from "../src/run/failure.js";
import { EnvironmentError } from "../src/util/errors.js";
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
