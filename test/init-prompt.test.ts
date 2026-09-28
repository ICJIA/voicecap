import { PassThrough, Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createPrompter, InputEndedError } from "../src/init/prompt.js";
import { InterruptedError } from "../src/passes/steps.js";

/** A collecting OutputStream: not a real stream, just enough to satisfy Prompter's writes. */
function capture() {
  let text = "";
  return {
    stream: { write: (chunk: string) => ((text += chunk), true) },
    text: () => text,
  };
}

/** A collecting real stream, as readline's terminal mode needs for its output. */
function streamCapture() {
  let text = "";
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  return { stream, text: () => text };
}

describe("ask", () => {
  it("asks without brackets and trims the answer when there's no default", async () => {
    const input = new PassThrough();
    const output = capture();
    const prompter = createPrompter({ input, output: output.stream });
    input.write("  Alice  \n");

    await expect(prompter.ask("Name")).resolves.toBe("Alice");
    expect(output.text()).toBe("Name: ");

    prompter.close();
    input.end();
  });

  it("uses the default for an empty answer", async () => {
    const input = new PassThrough();
    const output = capture();
    const prompter = createPrompter({ input, output: output.stream });
    input.write("\n");

    await expect(prompter.ask("Name", { default: "Alice" })).resolves.toBe("Alice");
    expect(output.text()).toBe("Name [Alice]: ");

    prompter.close();
    input.end();
  });

  it("asks again, with the reason, after an answer that fails its check", async () => {
    const input = new PassThrough();
    const output = capture();
    const prompter = createPrompter({ input, output: output.stream });
    input.write("wrong\nright\n");
    const check = (answer: string) => (answer === "right" ? null : "Type right.");

    await expect(prompter.ask("Word", { check })).resolves.toBe("right");
    expect(output.text()).toBe("Word: Type right.\nWord: ");

    prompter.close();
    input.end();
  });
});

describe("choose", () => {
  it("numbers the choices and returns the one picked", async () => {
    const input = new PassThrough();
    const output = capture();
    const prompter = createPrompter({ input, output: output.stream });
    input.write("2\n");

    await expect(prompter.choose("Pick one", ["A", "B", "C"], 0)).resolves.toBe(1);
    expect(output.text()).toBe("Pick one\n  1. A\n  2. B\n  3. C\nChoose [1]: ");

    prompter.close();
    input.end();
  });

  it("asks again after a number out of range", async () => {
    const input = new PassThrough();
    const output = capture();
    const prompter = createPrompter({ input, output: output.stream });
    input.write("9\n1\n");

    await expect(prompter.choose("Pick one", ["A", "B"], 0)).resolves.toBe(0);
    expect(output.text()).toBe(
      "Pick one\n  1. A\n  2. B\nChoose [1]: " +
        "Enter a number from 1 to 2.\n" +
        "Pick one\n  1. A\n  2. B\nChoose [1]: ",
    );

    prompter.close();
    input.end();
  });

  it("uses the default index for an empty answer", async () => {
    const input = new PassThrough();
    const output = capture();
    const prompter = createPrompter({ input, output: output.stream });
    input.write("\n");

    await expect(prompter.choose("Pick one", ["A", "B"], 1)).resolves.toBe(1);
    expect(output.text()).toBe("Pick one\n  1. A\n  2. B\nChoose [2]: ");

    prompter.close();
    input.end();
  });
});

describe("confirm", () => {
  it("reads y and n, and the default for Enter", async () => {
    const input = new PassThrough();
    const output = capture();
    const prompter = createPrompter({ input, output: output.stream });
    input.write("y\nn\n\n");

    await expect(prompter.confirm("Continue?", false)).resolves.toBe(true);
    await expect(prompter.confirm("Continue?", false)).resolves.toBe(false);
    await expect(prompter.confirm("Continue?", false)).resolves.toBe(false);
    expect(output.text()).toBe("Continue? [y/N]: Continue? [y/N]: Continue? [y/N]: ");

    prompter.close();
    input.end();
  });

  it("asks again, with the reason, after neither y nor n", async () => {
    const input = new PassThrough();
    const output = capture();
    const prompter = createPrompter({ input, output: output.stream });
    input.write("maybe\ny\n");

    await expect(prompter.confirm("Continue?", false)).resolves.toBe(true);
    expect(output.text()).toBe("Continue? [y/N]: Answer y or n.\nContinue? [y/N]: ");

    prompter.close();
    input.end();
  });

  it("shows [Y/n] and defaults to yes for Enter when defaultYes is true", async () => {
    const input = new PassThrough();
    const output = capture();
    const prompter = createPrompter({ input, output: output.stream });
    input.write("\n");

    await expect(prompter.confirm("Continue?", true)).resolves.toBe(true);
    expect(output.text()).toBe("Continue? [Y/n]: ");

    prompter.close();
    input.end();
  });
});

describe("say", () => {
  it("prints one line, ended with a newline", () => {
    const input = new PassThrough();
    const output = capture();
    const prompter = createPrompter({ input, output: output.stream });

    prompter.say("Hello");
    expect(output.text()).toBe("Hello\n");

    prompter.close();
    input.end();
  });
});

describe("reading answers", () => {
  it("keeps answers that arrive all at once", async () => {
    const input = new PassThrough();
    const output = capture();
    const prompter = createPrompter({ input, output: output.stream });
    input.write("a\nb\n");

    await expect(prompter.ask("First")).resolves.toBe("a");
    await expect(prompter.ask("Second")).resolves.toBe("b");
    expect(output.text()).toBe("First: Second: ");

    prompter.close();
    input.end();
  });

  it("throws InputEndedError when the input ends", async () => {
    const input = new PassThrough();
    const output = capture();
    const prompter = createPrompter({ input, output: output.stream });
    input.end();

    await expect(prompter.ask("Name")).rejects.toThrow(InputEndedError);

    prompter.close();
  });

  it("throws InterruptedError on Ctrl+C in a terminal", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const prompter = createPrompter({ input, output, terminal: true });

    const answer = prompter.ask("Name");
    input.write("\u0003");
    await expect(answer).rejects.toThrow(InterruptedError);

    prompter.close();
    input.end();
    output.end();
  });

  it("ends the question's line on Ctrl+C in a terminal, so the shell's prompt starts on its own", async () => {
    const input = new PassThrough();
    const output = streamCapture();
    const prompter = createPrompter({ input, output: output.stream, terminal: true });

    const answer = prompter.ask("Name");
    const shown = output.text();
    expect(shown).toContain("Name: ");
    input.write("\u0003");
    await expect(answer).rejects.toThrow(InterruptedError);
    expect(output.text()).toBe(`${shown}\n`);

    prompter.close();
    input.end();
  });

  it("throws InterruptedError for the next question when Ctrl+C arrives with none pending", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const prompter = createPrompter({ input, output, terminal: true });

    input.write("first\n");
    await expect(prompter.ask("Q1")).resolves.toBe("first");

    // Nothing is pending here (no ask() call in flight) — this is the gap the spec's own flow
    // guarantees, e.g. the site check between the website question and the next one.
    input.write("\u0003");
    await new Promise((resolve) => setImmediate(resolve));

    await expect(prompter.ask("Q2")).rejects.toThrow(InterruptedError);

    prompter.close();
    input.end();
    output.end();
  });
});

describe("interrupted", () => {
  it("aborts interrupted on Ctrl+C, pending question or not", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const prompter = createPrompter({ input, output, terminal: true });

    expect(prompter.interrupted.aborted).toBe(false);

    // No ask() is pending here, mirroring the gap during a site check.
    input.write("\u0003");
    await new Promise((resolve) => setImmediate(resolve));

    expect(prompter.interrupted.aborted).toBe(true);

    prompter.close();
    input.end();
    output.end();
  });
});
