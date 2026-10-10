import { afterEach, describe, expect, it, vi } from "vitest";

import { createConsoleLogger } from "../src/util/log.js";

/** A stream that records what's written to it, and says whether it's a terminal. */
function stream(terminal: boolean) {
  let text = "";
  return {
    stream: { write: (chunk: string) => ((text += chunk), true), ...(terminal && { isTTY: true }) },
    text: () => text,
  };
}

/**
 * node:util's styleText checks that process.stdout can show color too, and under vitest it's a
 * pipe. FORCE_COLOR makes that check pass, so what's tested is the logger's own decision: whether
 * the stream it writes to is a terminal, and whether NO_COLOR is set.
 */
function allowNodeToColor(): void {
  vi.stubEnv("FORCE_COLOR", "1");
  vi.stubEnv("NO_COLOR", undefined);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the console logger's outcome lines", () => {
  it("shows a passing line in green and a failing line in red at a terminal, with its words", () => {
    allowNodeToColor();
    const out = stream(true);
    const logger = createConsoleLogger(out.stream, stream(true).stream);

    logger.info("✓ Ready: all good.", "pass");
    logger.info("✗ Not ready: 2 things to fix.", "fail");

    expect(out.text()).toBe(
      "\u001b[32m✓ Ready: all good.\u001b[39m\n\u001b[31m✗ Not ready: 2 things to fix.\u001b[39m\n",
    );
  });

  it("leaves a line with no outcome plain, even at a terminal", () => {
    allowNodeToColor();
    const out = stream(true);

    createConsoleLogger(out.stream, stream(true).stream).info("Checks");

    expect(out.text()).toBe("Checks\n");
  });

  it("is plain when the output isn't a terminal", () => {
    allowNodeToColor();
    const out = stream(false);
    const logger = createConsoleLogger(out.stream, stream(false).stream);

    logger.info("✓ Ready: all good.", "pass");
    logger.info("✗ Not ready: 2 things to fix.", "fail");

    expect(out.text()).toBe("✓ Ready: all good.\n✗ Not ready: 2 things to fix.\n");
  });

  it("is plain when NO_COLOR is set, even at a terminal", () => {
    allowNodeToColor();
    vi.stubEnv("NO_COLOR", "1");
    const out = stream(true);
    const logger = createConsoleLogger(out.stream, stream(true).stream);

    logger.info("✓ Ready: all good.", "pass");
    logger.info("✗ Not ready: 2 things to fix.", "fail");

    expect(out.text()).toBe("✓ Ready: all good.\n✗ Not ready: 2 things to fix.\n");
  });
});

// Text from a website, a sitemap, a server's reply, or a record reaches the console through these
// four levels, so each writes a control character, an invisible formatting character, or a line
// separator as an escape (see inertText), and can't move the cursor, clear the screen, set the
// terminal's title, or turn the words around.
describe("the console logger's text", () => {
  /** A logger on two capture streams that aren't terminals: what it writes to each. */
  function plainLogger() {
    const out = stream(false);
    const err = stream(false);
    return { logger: createConsoleLogger(out.stream, err.stream), out, err };
  }

  it("writes an escape sequence in an info line as text", () => {
    const { logger, out } = plainLogger();

    logger.info("a\u{1b}[2Jb");

    expect(out.text()).toBe("a\\u{1b}[2Jb\n");
  });

  it("writes a right-to-left override in a warning as text", () => {
    const { logger, err } = plainLogger();

    logger.warn("x\u{202e}y");

    expect(err.text()).toBe("Warning: x\\u{202e}y\n");
  });

  it("ends a CR LF in an error as a line break, and keeps a tab", () => {
    const { logger, err } = plainLogger();

    logger.error("one\r\ntwo\tthree");

    expect(err.text()).toBe("Error: one\ntwo\tthree\n");
  });

  it("writes the message of an alert as text, between its rules", () => {
    const { logger, err } = plainLogger();

    logger.alert("Close it\u{7}\u{1b}[2J");

    const rule = "=".repeat(72);
    expect(err.text()).toBe(`${rule}\nWARNING: Close it\\u{7}\\u{1b}[2J\n${rule}\n`);
  });

  it("writes a lone carriage return as text, so it can't take the cursor back to the line's start", () => {
    const { logger, out, err } = plainLogger();

    logger.info("Checked 100%\rChecked 0%");
    logger.warn("one\rtwo");

    expect(out.text()).toBe("Checked 100%\\u{d}Checked 0%\n");
    expect(err.text()).toBe("Warning: one\\u{d}two\n");
  });

  it("writes a run id from a record as text in the warning that names it", () => {
    const { logger, err } = plainLogger();
    const runId = "2027-01-15_1000\u{1b}]0;pwned\u{7}";

    logger.warn(`Run ${runId}'s walkthrough file can't be made, so it isn't shared: no pages.`);

    expect(err.text()).toBe(
      "Warning: Run 2027-01-15_1000\\u{1b}]0;pwned\\u{7}'s walkthrough file can't be made, so it isn't shared: no pages.\n",
    );
  });

  it("writes a file's name and a time from a record as text in a result line", () => {
    const { logger, out } = plainLogger();

    logger.info("share/page\u{202e}fdp.exe: not recorded in shares.json");
    logger.info("share 1 (2027-01-15T10:00:00\u{2028}x) changed since it was recorded");

    expect(out.text()).toBe(
      "share/page\\u{202e}fdp.exe: not recorded in shares.json\n" +
        "share 1 (2027-01-15T10:00:00\\u{2028}x) changed since it was recorded\n",
    );
  });

  it("leaves a message with nothing in it to write as it was", () => {
    const { logger, out, err } = plainLogger();

    logger.info("Checks:\n  ✓ NVDA 2025.3.2\t(installed)");
    logger.warn("Close the browser…");

    expect(out.text()).toBe("Checks:\n  ✓ NVDA 2025.3.2\t(installed)\n");
    expect(err.text()).toBe("Warning: Close the browser…\n");
  });

  it("still colors at a terminal: the colors come after the text is made inert", () => {
    allowNodeToColor();
    const out = stream(true);
    const err = stream(true);
    const logger = createConsoleLogger(out.stream, err.stream);

    logger.info("✓ a\u{1b}[2Jb", "pass");
    logger.info("✗ c\u{9b}d", "fail");
    logger.info("e\u{1b}[2Jf");
    logger.warn("x\u{202e}y");
    logger.error("one\r\ntwo");
    logger.alert("Close it\u{7}");

    expect(out.text()).toBe(
      "\u001b[32m✓ a\\u{1b}[2Jb\u001b[39m\n" +
        "\u001b[31m✗ c\\u{9b}d\u001b[39m\n" +
        "e\\u{1b}[2Jf\n",
    );
    const rule = "=".repeat(72);
    expect(err.text()).toBe(
      "\u001b[33mWarning: x\\u{202e}y\u001b[39m\n" +
        "\u001b[31mError: one\ntwo\u001b[39m\n" +
        `\u001b[1m\u001b[33m${rule}\nWARNING: Close it\\u{7}\n${rule}\u001b[39m\u001b[22m\n`,
    );
  });
});
