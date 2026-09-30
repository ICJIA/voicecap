import { describe, expect, it } from "vitest";

import { composeArgs, formatCommand, quoteArg, type InitAnswers } from "../src/init/compose.js";

describe("composeArgs", () => {
  it("orders --site, a sitemap, then --limit, and --reviewer last, with no --out when home is null", () => {
    const answers: InitAnswers = {
      site: "https://i2i.illinois.gov",
      pages: { kind: "sitemap", url: "https://i2i.illinois.gov/sitemap-index.xml" },
      limit: 5,
      home: null,
      reviewer: "cschweda",
    };
    expect(composeArgs(answers)).toEqual([
      "--site",
      "https://i2i.illinois.gov",
      "--sitemap",
      "https://i2i.illinois.gov/sitemap-index.xml",
      "--limit",
      "5",
      "--reviewer",
      "cschweda",
    ]);
  });

  it("uses --pages for a page list file, omits --limit when null, and puts --out before --reviewer", () => {
    const answers: InitAnswers = {
      site: "https://dvfr.illinois.gov",
      pages: { kind: "pages", file: "pages.csv" },
      limit: null,
      home: "C:\\Users\\Jane Doe\\vt",
      reviewer: "Jane Doe",
    };
    expect(composeArgs(answers)).toEqual([
      "--site",
      "https://dvfr.illinois.gov",
      "--pages",
      "pages.csv",
      "--out",
      "C:\\Users\\Jane Doe\\vt",
      "--reviewer",
      "Jane Doe",
    ]);
  });

  it("uses --page for a single page", () => {
    const answers: InitAnswers = {
      site: "https://dvfr.illinois.gov",
      pages: { kind: "page", url: "https://dvfr.illinois.gov/faq/" },
      limit: null,
      home: null,
      reviewer: "cschweda",
    };
    expect(composeArgs(answers)).toEqual([
      "--site",
      "https://dvfr.illinois.gov",
      "--page",
      "https://dvfr.illinois.gov/faq/",
      "--reviewer",
      "cschweda",
    ]);
  });
});

describe("quoteArg", () => {
  it("leaves a plain URL unquoted", () => {
    expect(quoteArg("https://dvfr.illinois.gov/faq/")).toBe("https://dvfr.illinois.gov/faq/");
  });

  it("quotes a URL whose query string has & and =", () => {
    expect(quoteArg("https://dvfr.illinois.gov/faq/?a=1&b=2")).toBe(
      "'https://dvfr.illinois.gov/faq/?a=1&b=2'",
    );
  });

  it("quotes a Windows path with a space", () => {
    expect(quoteArg("C:\\Users\\Jane Doe\\pages.csv")).toBe("'C:\\Users\\Jane Doe\\pages.csv'");
  });

  it("escapes a single quote inside the value", () => {
    expect(quoteArg("it's")).toBe("'it'\\''s'");
  });

  it("quotes an empty value, so it isn't lost as a shell token", () => {
    expect(quoteArg("")).toBe("''");
  });
});

describe("formatCommand", () => {
  it("matches the spec's i2i example line", () => {
    const answers: InitAnswers = {
      site: "https://i2i.illinois.gov",
      pages: { kind: "sitemap", url: "https://i2i.illinois.gov/sitemap-index.xml" },
      limit: 5,
      home: null,
      reviewer: "cschweda",
    };
    expect(formatCommand(composeArgs(answers))).toBe(
      "npx @icjia/voicecap --site https://i2i.illinois.gov --sitemap https://i2i.illinois.gov/sitemap-index.xml --limit 5 --reviewer cschweda",
    );
  });

  it("quotes a reviewer's name with a space", () => {
    const answers: InitAnswers = {
      site: "https://dvfr.illinois.gov",
      pages: { kind: "page", url: "https://dvfr.illinois.gov/" },
      limit: null,
      home: null,
      reviewer: "Jane Doe",
    };
    expect(formatCommand(composeArgs(answers))).toBe(
      "npx @icjia/voicecap --site https://dvfr.illinois.gov --page https://dvfr.illinois.gov/ --reviewer 'Jane Doe'",
    );
  });

  it("keeps an empty argument as its own token instead of losing it", () => {
    expect(formatCommand(["--out", "", "--limit", "5"])).toBe(
      "npx @icjia/voicecap --out '' --limit 5",
    );
  });
});
