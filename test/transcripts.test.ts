import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { EnvironmentRecord, TranscriptJson } from "../src/model.js";
import {
  bodyLines,
  contentSha256,
  environmentLines,
  extractBody,
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
