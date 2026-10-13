import { describe, expect, it } from "vitest";

import {
  composeArgs,
  formatCommand,
  quoteArg,
  urlArg,
  type InitAnswers,
} from "../src/init/compose.js";
import { splitCommand, splitCommandInGitBash } from "./helpers/split-command.js";

describe("composeArgs", () => {
  it("orders --site, a sitemap, then --limit, and --reviewer last, with no --out when home is null", () => {
    const answers: InitAnswers = {
      site: "https://i2i.illinois.gov",
      canonical: null,
      pages: { kind: "sitemap", url: "https://i2i.illinois.gov/sitemap-index.xml" },
      limit: 5,
      home: null,
      reviewer: "jane",
    };
    expect(composeArgs(answers)).toEqual([
      "--site",
      "https://i2i.illinois.gov",
      "--sitemap",
      "https://i2i.illinois.gov/sitemap-index.xml",
      "--limit",
      "5",
      "--reviewer",
      "jane",
    ]);
  });

  it("uses --pages for a page list file, omits --limit when null, and puts --out before --reviewer", () => {
    const answers: InitAnswers = {
      site: "https://dvfr.illinois.gov",
      canonical: null,
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

  it("puts --canonical right after --site when init asked for the address people visit", () => {
    const answers: InitAnswers = {
      site: "http://localhost:3000",
      canonical: "https://dvfr.illinois.gov/",
      pages: { kind: "sitemap", url: "http://localhost:3000/sitemap.xml" },
      limit: 5,
      home: "C:\\vt",
      reviewer: "jane",
    };
    expect(composeArgs(answers)).toEqual([
      "--site",
      "http://localhost:3000",
      "--canonical",
      "https://dvfr.illinois.gov/",
      "--sitemap",
      "http://localhost:3000/sitemap.xml",
      "--limit",
      "5",
      "--out",
      "C:\\vt",
      "--reviewer",
      "jane",
    ]);
  });

  it("uses --page for a single page", () => {
    const answers: InitAnswers = {
      site: "https://dvfr.illinois.gov",
      canonical: null,
      pages: { kind: "page", url: "https://dvfr.illinois.gov/faq/" },
      limit: null,
      home: null,
      reviewer: "jane",
    };
    expect(composeArgs(answers)).toEqual([
      "--site",
      "https://dvfr.illinois.gov",
      "--page",
      "https://dvfr.illinois.gov/faq/",
      "--reviewer",
      "jane",
    ]);
  });

  // A sitemap's address comes from the site's robots.txt, and a canonical root from its pages' tags:
  // the site's own words. A single quote in one is written %27, so neither shell has a quote to read
  // and the address needs no quoting.
  it("writes a single quote in a sitemap's address, a page's, and a canonical root as %27", () => {
    const answers: InitAnswers = {
      site: "https://x.org",
      canonical: "https://x.org/o'brien/",
      pages: { kind: "sitemap", url: "https://x.org/a'b.xml" },
      limit: null,
      home: null,
      reviewer: "jane",
    };
    const sitemap = composeArgs(answers);
    const page = composeArgs({
      ...answers,
      canonical: null,
      pages: { kind: "page", url: "https://x.org/it's" },
    });

    expect(sitemap).toEqual([
      "--site",
      "https://x.org",
      "--canonical",
      "https://x.org/o%27brien/",
      "--sitemap",
      "https://x.org/a%27b.xml",
      "--reviewer",
      "jane",
    ]);
    expect(page).toEqual([
      "--site",
      "https://x.org",
      "--page",
      "https://x.org/it%27s",
      "--reviewer",
      "jane",
    ]);
    // Each address is bare in the command, so there is no quote in it at all.
    for (const args of [sitemap, page]) {
      expect(args.map(quoteArg)).toEqual(args);
      expect(formatCommand(args)).not.toContain("'");
    }
  });

  it("writes a single quote in the site's address as %27 too: a redirect can name any host", () => {
    const answers: InitAnswers = {
      site: "https://o'brien.example.org",
      canonical: null,
      pages: { kind: "page", url: "https://o'brien.example.org/faq/" },
      limit: null,
      home: null,
      reviewer: "jane",
    };

    expect(composeArgs(answers).slice(0, 4)).toEqual([
      "--site",
      "https://o%27brien.example.org",
      "--page",
      "https://o%27brien.example.org/faq/",
    ]);
  });

  it("leaves a page list's file and the home as they are: neither is an address, and a quote in one is quoted", () => {
    const answers: InitAnswers = {
      site: "https://x.org",
      canonical: null,
      pages: { kind: "pages", file: "O'Brien pages.csv" },
      limit: null,
      home: "C:\\Users\\O'Brien\\vt",
      reviewer: "jane",
    };
    const args = composeArgs(answers);

    expect(args).toContain("O'Brien pages.csv");
    expect(args).toContain("C:\\Users\\O'Brien\\vt");
    expect(formatCommand(args)).toBe(
      "npx @icjia/voicecap --site https://x.org --pages 'O''Brien pages.csv' --out 'C:\\Users\\O''Brien\\vt' --reviewer jane",
    );
  });
});

describe("urlArg", () => {
  it("writes each single quote in an address as %27, and changes nothing else", () => {
    expect(urlArg("https://x.org/it's")).toBe("https://x.org/it%27s");
    expect(urlArg("https://x.org/'a'/'b")).toBe("https://x.org/%27a%27/%27b");
    expect(urlArg("https://dvfr.illinois.gov/faq/?a=1&b=2")).toBe(
      "https://dvfr.illinois.gov/faq/?a=1&b=2",
    );
    expect(urlArg("")).toBe("");
  });

  it("gives an address with nothing else to quote that needs no quoting", () => {
    const address = urlArg("https://x.org/a'b.xml");

    expect(quoteArg(address)).toBe(address);
  });

  it("names the same host, query, and fragment as the address it was given", () => {
    const given = "https://o'brien.example.org/search?q='x'#a";
    const written = new URL(urlArg(given));

    expect(written.host).toBe(new URL(given).host);
    expect(written.search).toBe(new URL(given).search);
    expect(written.hash).toBe(new URL(given).hash);
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

  // PowerShell reads '' inside single quotes as one quote, and takes the typographic single quotes
  // for quotes too. The POSIX way of writing a quote ('\'') closes the string in PowerShell, and
  // what follows is read as a command.
  it("doubles a single quote inside the value, as PowerShell reads it", () => {
    expect(quoteArg("it's")).toBe("'it''s'");
    expect(quoteArg("C:\\Users\\O'Brien")).toBe("'C:\\Users\\O''Brien'");
    expect(quoteArg("'")).toBe("''''");
  });

  it("doubles the typographic single quotes too, which PowerShell takes for quotes", () => {
    expect(quoteArg("a\u{2019}b")).toBe("'a\u{2019}\u{2019}b'");
    expect(quoteArg("a\u{2018}b")).toBe("'a\u{2018}\u{2018}b'");
    expect(quoteArg("a\u{201A}b")).toBe("'a\u{201A}\u{201A}b'");
    expect(quoteArg("a\u{201B}b")).toBe("'a\u{201B}\u{201B}b'");
  });

  it("quotes a value with a comma, which PowerShell reads as two arguments", () => {
    expect(quoteArg("Doe, Jane")).toBe("'Doe, Jane'");
    expect(quoteArg("a,b")).toBe("'a,b'");
  });

  it("quotes a value that starts with @, which PowerShell reads as a variable or a hash, and leaves an address bare", () => {
    expect(quoteArg("@x")).toBe("'@x'");
    expect(quoteArg("@")).toBe("'@'");
    expect(quoteArg("me@example.org")).toBe("me@example.org");
    expect(quoteArg("https://x.org/@jane")).toBe("https://x.org/@jane");
  });

  it("quotes an empty value, so it isn't lost as a shell token", () => {
    expect(quoteArg("")).toBe("''");
  });
});

// The point of the quoting: whatever a website put in a value, it is one argument, and no part of it
// is read as a command, in PowerShell or in Git Bash.
describe("a quoted value, as a shell reads it", () => {
  const VALUES = [
    "plain",
    "two words",
    "a,b",
    "Doe, Jane",
    "@x",
    "@(1+1)",
    "@{a=1}",
    "$HOME",
    "$(calc)",
    "`calc`",
    "a;b",
    "a&b",
    "a|b",
    "a>b",
    "a<b",
    "(a)",
    "{a}",
    "a#b",
    "~",
    "*",
    "?",
    "!",
    "C:\\Users\\O'Brien",
    "it's",
    "'",
    "''",
    "'a'",
    "x'; calc; '",
    "a'b'c",
    "a\u{2019}b",
    "x\u{2019}; calc; \u{2018}y",
    "\u{2018}",
    "\u{201A}",
    "\u{201B}",
    "x\ty",
    "x\ny",
    "-",
    "--site",
    "",
    " ",
    "  a  b  ",
  ];

  it.each(VALUES)("is that one argument, whole, in PowerShell: %j", (value) => {
    expect(splitCommand(`before ${quoteArg(value)} after`)).toEqual(["before", value, "after"]);
  });

  // Git Bash reads a doubled straight quote as a quote left out, and a typographic quote as an
  // ordinary character, so a value with one comes out a little different. It is still one argument.
  it.each(VALUES)("is one argument in Git Bash, a quote in it dropped: %j", (value) => {
    const bare = quoteArg(value) === value;
    const read = value.replaceAll("'", "").replace(/[\u{2018}\u{2019}\u{201A}\u{201B}]/gu, "$&$&");

    expect(splitCommandInGitBash(`before ${quoteArg(value)} after`)).toEqual([
      "before",
      bare ? value : read,
      "after",
    ]);
  });
});

describe("formatCommand", () => {
  it("matches the spec's i2i example line", () => {
    const answers: InitAnswers = {
      site: "https://i2i.illinois.gov",
      canonical: null,
      pages: { kind: "sitemap", url: "https://i2i.illinois.gov/sitemap-index.xml" },
      limit: 5,
      home: null,
      reviewer: "jane",
    };
    expect(formatCommand(composeArgs(answers))).toBe(
      "npx @icjia/voicecap --site https://i2i.illinois.gov --sitemap https://i2i.illinois.gov/sitemap-index.xml --limit 5 --reviewer jane",
    );
  });

  it("quotes a reviewer's name with a space", () => {
    const answers: InitAnswers = {
      site: "https://dvfr.illinois.gov",
      canonical: null,
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
