import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { EnvironmentRecord, StepRecord, TranscriptJson } from "../src/model.js";
import {
  bodyLines,
  contentSha256,
  environmentLines,
  extractBody,
  headerLines,
  NO_SPEECH,
  renderTranscriptTxt,
  stepLine,
} from "../src/transcripts/format.js";
import { writeTranscript } from "../src/transcripts/write.js";

const environment: EnvironmentRecord = {
  driver: { name: "guidepup", version: "0.34.0" },
  screenReader: { name: "NVDA", version: "2026.2", build: "0.2.1-2026.2", language: "en" },
  capture: "complete",
  browser: { name: "Chrome", version: "141.0.7390.55" },
  os: "Windows 11 Pro 24H2 (10.0.26100)",
  screenReaderSettings: {
    keyboard: { speakTypedCharacters: true },
    speech: { symbolLevel: 100, synth: "espeak" },
    documentFormatting: { reportHeadings: true },
    virtualBuffers: { autoSayAllOnPageLoad: false },
  },
  pageSource: { kind: "pages", file: "pages.csv", sha256: "ab".repeat(32) },
  voicecap: { version: "0.1.0", configSha256: "cd".repeat(32) },
  runId: "2026-09-26_1405",
  runStartedAt: "2026-09-26T14:05:00-05:00",
};

function transcript(overrides: Partial<TranscriptJson> = {}): TranscriptJson {
  return {
    schemaVersion: 1,
    voicecap: "0.1.0",
    replayed: false,
    run: "2026-09-26_1405",
    pass: "read",
    page: {
      url: "https://example.illinois.gov/grants/fy27-jag",
      key: "https://example.illinois.gov/grants/fy27-jag",
      slug: "grants-fy27-jag-0123456789",
      label: "FY27 JAG",
      template: "grants",
      finalUrl: "https://example.illinois.gov/grants/fy27-jag",
    },
    capturedAt: "2026-09-26T14:32:10-05:00",
    durationMs: 291_000,
    stepCount: 4,
    stopReason: "end-reached",
    warnings: [],
    errors: [],
    environment,
    steps: [
      {
        n: 1,
        command: "toBottom",
        spoken: "content info landmark, © 2026 ICJIA",
        durationMs: 1400,
        offsetMs: 1400,
      },
      {
        n: 2,
        command: "toTop",
        spoken: "banner landmark, link, Skip to main content",
        durationMs: 1300,
        offsetMs: 2700,
      },
      { n: 3, command: "nextLine", spoken: "line one\nline two", durationMs: 1300, offsetMs: 4000 },
      { n: 4, command: "nextLine", spoken: "", durationMs: 1300, offsetMs: 5300 },
    ],
    ...overrides,
  };
}

describe("TXT transcripts", () => {
  it("has a # header block, a blank line, then one line per step", () => {
    const txt = renderTranscriptTxt(transcript());
    const [header, body] = txt.split("\n\n");
    for (const line of header!.split("\n")) expect(line.startsWith("# ")).toBe(true);
    expect(header).toContain("# voicecap transcript: read pass");
    expect(header).toContain("# Page: https://example.illinois.gov/grants/fy27-jag");
    expect(header).toContain("# Label: FY27 JAG");
    expect(header).toContain("# Notes: -");
    expect(header).toContain("# Steps: 4 (stopped: end reached)");
    expect(header).toContain("# Duration: 4m 51s");
    expect(header).toContain("# Page source: page list pages.csv (sha256 " + "ab".repeat(32) + ")");
    expect(header).toContain("# Driver: guidepup 0.34.0 (capture: complete)");
    expect(header).toContain("# Screen reader: NVDA 2026.2 (build 0.2.1-2026.2, language en)");
    expect(header).toContain("# Browser: Chrome 141.0.7390.55");
    // Settings sections in a fixed order, one line each.
    const settings = header!.split("\n").filter((line) => line.startsWith("# NVDA "));
    expect(settings.map((line) => line.split(":")[0])).toEqual([
      "# NVDA speech",
      "# NVDA documentFormatting",
      "# NVDA virtualBuffers",
      "# NVDA keyboard",
    ]);
    expect(settings[0]).toBe('# NVDA speech: symbolLevel=100, synth="espeak"');
    expect(body!.split("\n").filter(Boolean)).toEqual([
      "[to bottom] content info landmark, © 2026 ICJIA",
      "[to top] banner landmark, link, Skip to main content",
      "line one line two",
      "[no speech]",
    ]);
  });

  it("labels replayed output in the second header line", () => {
    const replay = {
      ...environment,
      driver: { name: "replay", version: "0.1.0" },
      replay: { from: "fixture/replay-run", sourceRun: "x", sourceDriver: "hand-written" },
    };
    const txt = renderTranscriptTxt(transcript({ replayed: true, environment: replay }));
    expect(txt.split("\n")[1]).toBe("# REPLAYED from fixture/replay-run: not a live NVDA session");
  });

  it("extracts the body without the header, even from a CRLF checkout", () => {
    const txt = renderTranscriptTxt(transcript());
    const body = extractBody(txt);
    expect(body).toEqual(bodyLines(transcript()));
    expect(extractBody(txt.replace(/\n/g, "\r\n"))).toEqual(body);
  });

  it("hashes content independently of the header", () => {
    const a = transcript();
    const b = transcript({ run: "2026-10-01_0900", capturedAt: "2026-10-01T09:30:00-05:00" });
    expect(renderTranscriptTxt(a)).not.toBe(renderTranscriptTxt(b));
    expect(contentSha256(bodyLines(a))).toBe(contentSha256(bodyLines(b)));
  });

  it("labels only the commands that aren't the pass's main command", () => {
    const step = {
      n: 1,
      command: "nextFocusable" as const,
      spoken: "Home, link",
      durationMs: 1,
      offsetMs: 1,
    };
    expect(stepLine(step, "tab")).toBe("Home, link");
    expect(stepLine({ ...step, command: "toTop" }, "headings")).toBe("[to top] Home, link");
  });
});

/**
 * A header's one-line field as voicecap has always written it: each line break, with the spaces
 * around it, as one space, then trimmed, and "-" for nothing. The fold was made linear, and must
 * still say exactly this, but for a line separator (U+2028) and a paragraph separator (U+2029),
 * which many an editor ends a line at, and which count as line breaks now.
 */
function foldedAsBefore(value: string): string {
  const text = value.replace(/\s*[\r\n\u{2028}\u{2029}]+\s*/gu, " ").trim();
  return text === "" ? "-" : text;
}

/**
 * The header of a transcript whose page's label, template, and notes, and only error and only
 * warning, are `text`.
 */
function headerWith(text: string): string[] {
  const { page } = transcript();
  return headerLines(
    transcript({
      page: { ...page, label: text, template: text, notes: text },
      errors: [text],
      warnings: [text],
    }),
  );
}

describe("a header's one-line fields", () => {
  it("fold each line break, with the spaces around it, into one space, as they always have", () => {
    const texts = [
      "a  b",
      "  a\n\n  b  ",
      "a \r\n b",
      "a \t \n \t b",
      "x\r\r\ny",
      "a\u{a0}\nb",
      "\u{feff}\na",
      "a\u{2028}\u{2029}b",
    ];
    // And every text of up to five of these characters.
    const alphabet = [" ", "\t", "\r", "\n", "a", "\u{2028}"];
    let level = [""];
    for (let length = 0; length <= 5; length++) {
      texts.push(...level);
      level = level.flatMap((text) => alphabet.map((character) => text + character));
    }
    for (const text of texts) {
      const folded = foldedAsBefore(text);
      expect(headerWith(text)).toEqual(
        expect.arrayContaining([
          `Label: ${folded}`,
          `Template: ${folded}`,
          `Notes: ${folded}`,
          `Errors: ${folded}`,
          `Warnings: ${folded}`,
        ]),
      );
    }
  });

  it("fold a long run of spaces at once", () => {
    // Folded with one search that began at each space and went to the run's end, 150,000 spaces
    // with no line break took seconds, and a walkthrough file's label can hold millions.
    const label = `a${" ".repeat(150_000)}b`;
    const { page } = transcript();
    const started = performance.now();
    const header = headerLines(transcript({ page: { ...page, label } }));
    const elapsed = performance.now() - started;
    expect(header).toContain(`Label: ${label}`);
    expect(elapsed).toBeLessThan(1_000);
  });

  // A warning or an error is a page's or a server's words, and the file is one a person opens in a
  // terminal (with `type` or `cat`), where an escape sequence would act instead of being shown.
  it("write a control character or an invisible formatting character as an escape: a Tab pass's warning", () => {
    const tab = transcript({
      pass: "tab",
      warnings: ["The page said \u{1b}[2J and \u{202e}drowssap"],
    });
    const txt = renderTranscriptTxt(tab);
    const [header] = txt.split("\n\n");

    expect(headerLines(tab)).toContain("Warnings: The page said \\u{1b}[2J and \\u{202e}drowssap");
    // Nothing in the header is a character that acts: not an escape, not an override, not a bell.
    // (A line feed ends each line, and a tab lays words out.)
    expect(header).not.toMatch(/(?![\n\t])[\p{Cc}\p{Cf}\u{2028}\u{2029}]/u);
  });

  it("write the same text in every one-line field the same way", () => {
    const written = "a\\u{1b}[2J\\u{202e}b\\u{7}c";

    expect(headerWith("a\u{1b}[2J\u{202e}b\u{7}c")).toEqual(
      expect.arrayContaining([
        `Label: ${written}`,
        `Template: ${written}`,
        `Notes: ${written}`,
        `Errors: ${written}`,
        `Warnings: ${written}`,
      ]),
    );
  });

  it("keep a label with a line separator or a paragraph separator on one line", () => {
    const { page } = transcript();
    const txt = renderTranscriptTxt(
      transcript({ page: { ...page, label: "Grants\u{2028}Fund\u{2029}27" } }),
    );
    const [header] = txt.split("\n\n");

    expect(header).toContain("# Label: Grants Fund 27\n");
    expect(header).not.toMatch(/[\u{2028}\u{2029}]/u);
  });

  it("leave the tab between words alone, and what isn't a control character", () => {
    const { page } = transcript();
    const label = "FY27\tJAG \u{a0}\u{e9}t\u{e9} \u{1f600}";

    expect(headerLines(transcript({ page: { ...page, label } }))).toContain(`Label: ${label}`);
  });
});

/**
 * A step's line as voicecap has always folded it: each run of white space that holds a line break
 * becomes one space, then the ends are trimmed, and "[no speech]" stands for nothing. The fold was
 * made linear. A line is hashed (contentSha256), so it must still say exactly this, for every text.
 */
function lineAsBefore(spoken: string): string {
  const text = spoken.replace(/\s*[\r\n]+\s*/g, " ").trim();
  return text === "" ? NO_SPEECH : text;
}

describe("stepLine", () => {
  /** A step of the pass's own command that said `spoken`, so its line is the words alone. */
  const said = (spoken: string): StepRecord => ({
    n: 1,
    command: "nextLine",
    spoken,
    durationMs: 1,
    offsetMs: 1,
  });

  it.each([
    ["a\r\n b", "a b"],
    ["a \n\n b", "a b"],
    ["\tx\t", "x"],
    // A line separator isn't a line break to this fold: a line is as it was, so its hash is.
    ["a\u{2028}b", "a\u{2028}b"],
    ["a\u{2029}b", "a\u{2029}b"],
    ["a\u{2028}\nb", "a b"],
    ["a  b", "a  b"],
    ["", NO_SPEECH],
    [" \t \r\n ", NO_SPEECH],
  ])("gives the line the old pattern gave for %j", (spoken, line) => {
    expect(lineAsBefore(spoken)).toBe(line);
    expect(stepLine(said(spoken), "read")).toBe(line);
  });

  it("gives the old pattern's line for every text of up to five of these characters", () => {
    const alphabet = [" ", "\t", "\r", "\n", "a", "\u{2028}", "\u{a0}", "\u{b}"];
    let level = [""];
    let checked = 0;
    for (let length = 0; length <= 5; length++) {
      for (const text of level) {
        expect(stepLine(said(text), "read"), JSON.stringify(text)).toBe(lineAsBefore(text));
        checked++;
      }
      level = level.flatMap((text) => alphabet.map((character) => text + character));
    }
    expect(checked).toBe(37_449);
  });

  it("labels a setup step as it always has, the words folded the same way", () => {
    expect(stepLine({ ...said("Home,\r\n link"), command: "toTop" }, "read")).toBe(
      "[to top] Home, link",
    );
    expect(stepLine({ ...said(""), command: "toBottom" }, "headings")).toBe(
      `[to bottom] ${NO_SPEECH}`,
    );
  });

  it("leaves a transcript's content hash as it was", () => {
    const spoken = [
      "content info landmark, \u{a9} 2026 ICJIA",
      "line one\nline two",
      "a \r\n b",
      "\tx\t",
      "a\u{2028}b",
      "",
      `a${" ".repeat(50)}b`,
      `${" ".repeat(50)}\n${" ".repeat(50)}z`,
    ];
    const t = transcript({
      steps: spoken.map((text, index) => ({ ...said(text), n: index + 1 })),
    });
    const before = createHash("sha256")
      .update(spoken.map((text) => `${lineAsBefore(text)}\n`).join(""))
      .digest("hex");

    expect(contentSha256(bodyLines(t))).toBe(before);
  });

  // Folded with one search that began at each space and went to the end of the run, 200,000 spaces
  // with no line break took about 10 seconds here, under a test's own limit of 30, so the time is
  // checked (as the header's is, above): with no square in it, it takes a few milliseconds.
  it("folds a run of 200,000 spaces before the last word in a moment", () => {
    const started = performance.now();
    const line = stepLine(said(`${" ".repeat(200_000)}x`), "read");
    const elapsed = performance.now() - started;

    expect(line).toBe("x");
    expect(elapsed).toBeLessThan(1_000);
  });

  it("folds 10,000 pairs of a space and a line feed to one space, or to nothing at the ends", () => {
    const pairs = " \n".repeat(10_000);

    expect(stepLine(said(`${pairs}x`), "read")).toBe("x");
    expect(stepLine(said(`a${pairs}b`), "read")).toBe("a b");
    expect(stepLine(said(pairs), "read")).toBe(NO_SPEECH);
  });
});

describe("environmentLines", () => {
  it("describes a --page source with describePageUrls", () => {
    const lines = environmentLines({
      ...environment,
      pageSource: { kind: "urls", urls: ["https://dvfr.illinois.gov/faq/"] },
    });
    expect(lines).toContain("Page source: page https://dvfr.illinois.gov/faq/");
  });

  it("describes a sitemap source by its address", () => {
    const lines = environmentLines({
      ...environment,
      pageSource: { kind: "sitemap", url: "https://example.illinois.gov/sitemap.xml" },
    });
    expect(lines).toContain("Page source: sitemap https://example.illinois.gov/sitemap.xml");
  });

  it("describes a walkthrough source by its file, its run, and its SHA-256", () => {
    const lines = environmentLines({
      ...environment,
      pageSource: {
        kind: "walkthrough",
        file: "w.json",
        sha256: "a".repeat(64),
        run: "2026-09-29_1402",
        from: "sitemap",
      },
    });
    expect(lines).toContain(
      `Page source: walkthrough w.json from run 2026-09-29_1402 (sha256 ${"a".repeat(64)})`,
    );
  });
});

describe("writeTranscript", () => {
  it("writes TXT and JSON and returns hashes that match the files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "voicecap-transcript-"));
    const written = await writeTranscript(dir, transcript());
    for (const name of ["read.txt", "read.json"]) {
      const bytes = await readFile(path.join(dir, name));
      expect(written.files[name]?.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(written.files[name]?.bytes).toBe(bytes.length);
    }
    expect(written.contentSha256).toBe(contentSha256(bodyLines(transcript())));
    const json = JSON.parse(await readFile(path.join(dir, "read.json"), "utf8")) as TranscriptJson;
    expect(json.steps[2]?.spoken).toBe("line one\nline two");
  });
});
