import { describe, expect, it } from "vitest";

import { describePageUrls } from "../src/pages/describe.js";

describe("describePageUrls", () => {
  it("describes a single URL as one page", () => {
    expect(describePageUrls(["https://dvfr.illinois.gov/faq/"])).toBe(
      "page https://dvfr.illinois.gov/faq/",
    );
  });

  it("describes three URLs by listing all of them", () => {
    const urls = [
      "https://dvfr.illinois.gov/",
      "https://dvfr.illinois.gov/about/",
      "https://dvfr.illinois.gov/faq/",
    ];
    expect(describePageUrls(urls)).toBe(
      "3 pages (https://dvfr.illinois.gov/, https://dvfr.illinois.gov/about/, https://dvfr.illinois.gov/faq/)",
    );
  });

  it("lists only the first three of more URLs, with an ellipsis", () => {
    const urls = [
      "https://dvfr.illinois.gov/",
      "https://dvfr.illinois.gov/about/",
      "https://dvfr.illinois.gov/faq/",
      "https://dvfr.illinois.gov/contact/",
      "https://dvfr.illinois.gov/resources/",
    ];
    const result = describePageUrls(urls);
    expect(result.startsWith("5 pages (")).toBe(true);
    expect(result.endsWith(", …)")).toBe(true);
  });
});
