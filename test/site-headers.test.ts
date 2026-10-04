/**
 * What Netlify reads of each page the website serves: the hashes of a page's own code, the Content
 * Security Policy made from them, and the text of _headers and robots.txt. The shareable page is
 * the real one, from the demo's runs. The other pages are small ones, with only what a case needs.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { CHECK_SCRIPT } from "../src/share/check.js";
import { SHARE_SCRIPT } from "../src/share/html/client.js";
import { renderSharePage } from "../src/share/html/document.js";
import { SHARE_CSS } from "../src/share/html/style.js";
import {
  contentSecurityPolicy,
  type HeaderRule,
  HEADERS_FIRST_LINE,
  headersFile,
  inlineHashes,
  ROBOTS_TXT,
} from "../src/site/headers.js";
import { demoModel } from "./helpers/share-model.js";

/** How a policy names the hash of `text`: 'sha256-' and its SHA-256 as base64, in single quotes. */
function hashOf(text: string): string {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

/** What a page with no code of its own has. */
const NONE = { styles: [], scripts: [] };

/** The message of the Error that `run` throws. */
function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return (error as Error).message;
  }
  throw new Error("It threw nothing.");
}

describe("inlineHashes", () => {
  it("hashes the shareable page's one style block and one script, and not its data", async () => {
    const page = renderSharePage(await demoModel(), { fontCss: "" });
    // The page holds its data too, in a block that a browser never runs.
    expect(page).toContain('<script type="application/json" id="fp-data">');

    expect(inlineHashes(page)).toEqual({
      styles: [hashOf(`\n\n${SHARE_CSS}`)],
      scripts: [hashOf(SHARE_SCRIPT + CHECK_SCRIPT)],
    });
  });

  it("hashes inline code only, in any case, once each", () => {
    const html = [
      "<STYLE>b{}</STYLE>",
      "<style>a{}</style>",
      "<SCRIPT>one()</SCRIPT>",
      "<script>two()</script>",
      "<script>one()</script>",
      '<script src="x.js"></script>',
      '<script type="application/json">{"a":1}</script>',
      "<style>b{}</style>",
    ].join("\n");

    expect(inlineHashes(html)).toEqual({
      styles: [hashOf("b{}"), hashOf("a{}")],
      scripts: [hashOf("one()"), hashOf("two()")],
    });
  });

  it("hashes the text's UTF-8 bytes, and writes the hash as sha256- and its base64", () => {
    // The text is e with an acute accent: two bytes in UTF-8, where a legacy encoding has one.
    expect(inlineHashes("<script>\u{e9}</script><style>\u{e9}</style>")).toEqual({
      styles: ["'sha256-SplVfkAzw1Od4utlRyAXytX5VX96BiWgnxw/biumnEw='"],
      scripts: ["'sha256-SplVfkAzw1Od4utlRyAXytX5VX96BiWgnxw/biumnEw='"],
    });
    // The same for text with an em dash, Japanese, and an emoji, which UTF-16 holds as two units.
    expect(
      inlineHashes(
        '<script>var s = "\u{e9} \u{2014} \u{65e5}\u{672c}\u{8a9e} \u{1f600}";</script>',
      ),
    ).toEqual({
      styles: [],
      scripts: ["'sha256-syao8eoFp23tOZ8ud93pxDy7e/lMZqevEN/CvOOlmvU='"],
    });
  });

  it.each([
    "<script>",
    '<script type="">',
    "<script type>",
    '<script type="text/javascript">',
    '<script type="application/javascript">',
    '<script type="module">',
    '<script TYPE="Module">',
    '<script type="TEXT/JavaScript">',
    "<script type='module'>",
    "<script type=module>",
    "<script type = module >",
    '<script type=" text/javascript ">',
    "<script async type=module defer>",
    '<script data-note="a>b" type="module">',
    "<script data-note='a>b'>",
    "<script/>",
    "<script />",
    "<script/type=module>",
  ])("hashes the code of %s", (tag) => {
    expect(inlineHashes(`${tag}code()</script>`)).toEqual({
      styles: [],
      scripts: [hashOf("code()")],
    });
  });

  it.each([
    '<script type="application/json">',
    "<script type='application/json'>",
    "<script type=application/json>",
    '<script type="application/ld+json">',
    '<script type="text/plain">',
    '<script type="importmap">',
    '<script type="module/json">',
    '<script type=" ">',
    '<script type="text/javascript;charset=utf-8">',
    '<script src="x.js">',
    "<script src='x.js'>",
    "<script src=x.js>",
    '<script SRC="x.js">',
    '<script src="">',
    "<script src>",
    '<script type="module" src="x.js">',
    '<script data-note="a>b" src="x.js">',
    "<script/type=application/json>",
    "<script src/>",
    "<script type = application/json >",
    '<script type = "application/json">',
  ])("leaves out the code of %s, which a browser doesn't run from its own text", (tag) => {
    expect(inlineHashes(`${tag}code()</script>`)).toEqual(NONE);
  });

  it("reads the first of an attribute that is written twice, as the parser does", () => {
    expect(inlineHashes('<script type="application/json" type="module">a()</script>')).toEqual(
      NONE,
    );
    expect(inlineHashes('<script type="module" type="application/json">a()</script>')).toEqual({
      styles: [],
      scripts: [hashOf("a()")],
    });
  });

  it("reads a tag that spans lines", () => {
    expect(inlineHashes('<script\f\ttype="module"\n  async\f>a()</script>')).toEqual({
      styles: [],
      scripts: [hashOf("a()")],
    });
  });

  it.each([
    ["a space", " "],
    ["a tab", "\t"],
    ["a line feed", "\n"],
    ["a form feed", "\f"],
  ])("ends a name and a bare value at %s", (_name, space) => {
    // The name src ends at the white space, so the script has a src, and no hash.
    expect(inlineHashes(`<script${space}src${space}>a()</script>`)).toEqual(NONE);
    // The value module ends there too, so the script is a module, and has one.
    expect(inlineHashes(`<script type=module${space}async>a()</script>`)).toEqual({
      styles: [],
      scripts: [hashOf("a()")],
    });
  });

  it.each([
    ["a space", " "],
    ["a tab", "\t"],
    ["a line feed", "\n"],
    ["a form feed", "\f"],
  ])("strips %s from each end of a type", (_name, space) => {
    expect(inlineHashes(`<script type="${space}text/javascript${space}">a()</script>`)).toEqual({
      styles: [],
      scripts: [hashOf("a()")],
    });
  });

  it("hashes each style block, whatever its attributes", () => {
    const html = [
      "<style>a{}</style>",
      '<style media="print">b{}</style>',
      "<STYLE type=text/css>c{}</STYLE>",
      "<style/>d{}</style>",
    ].join("");

    expect(inlineHashes(html)).toEqual({
      styles: [hashOf("a{}"), hashOf("b{}"), hashOf("c{}"), hashOf("d{}")],
      scripts: [],
    });
  });

  it("doesn't take a longer name for a script or a style", () => {
    const html = [
      "<scripts>a()</scripts>",
      "<styles>b{}</styles>",
      "<script-x>c()</script-x>",
      "<stylesheet>d{}</stylesheet>",
      "<scriptx>e()</scriptx>",
    ].join("");

    expect(inlineHashes(html)).toEqual(NONE);
  });

  it("takes an element's text from its start tag's > to the first end tag of its own name", () => {
    const html = [
      // Not an end tag: a longer name, another element's end tag, and a tag that begins one.
      '<script>a("</scripts>", "</style>", "<script>");</script >',
      '<style>b::before { content: "</script>" }</STYLE\n>',
      "<script>c()</script/>",
    ].join("");

    expect(inlineHashes(html)).toEqual({
      styles: [hashOf('b::before { content: "</script>" }')],
      scripts: [hashOf('a("</scripts>", "</style>", "<script>");'), hashOf("c()")],
    });
  });

  it("hashes the text as a browser reads it, with each line break a line feed", () => {
    // The text is a();, a line break, b();, a line break, c();. A browser's parser reads each
    // CR LF, and each CR alone, as a line feed, so that is the text the browser checks.
    expect(inlineHashes("<script>a();\r\nb();\rc();</script>")).toEqual({
      styles: [],
      scripts: ["'sha256-VdchsQXMF4B+6HyWonTG3jDVuro98k0jCZ1GcYTVXu4='"],
    });
    expect(inlineHashes("<script>a();\nb();\nc();</script>")).toEqual(
      inlineHashes("<script>a();\r\nb();\rc();</script>"),
    );
  });

  it("reads no element in a comment, and reads on where the parser ends the comment", () => {
    const html = [
      "<!-- <script>skipped()</script> -->",
      "<script>a()</script>",
      // <!--> and <!---> are whole comments: the parser ends each at once.
      "<!--><script>b()</script>",
      "<!---><script>c()</script>",
      // --!> ends a comment too.
      "<!-- text --!><script>d()</script>",
      // A comment that never ends takes the rest of the page.
      "<!-- <style>skipped{}</style>",
      "<script>never()</script>",
    ].join("\n");

    expect(inlineHashes(html)).toEqual({
      styles: [],
      scripts: [hashOf("a()"), hashOf("b()"), hashOf("c()"), hashOf("d()")],
    });
  });

  it("reads an element that never ends to the end of the page, as the parser does", () => {
    expect(inlineHashes("<p>x</p><style>a{}")).toEqual({ styles: [hashOf("a{}")], scripts: [] });
  });

  it("reads a quote inside an attribute's name as part of the name", () => {
    expect(inlineHashes('<script a"b>code()</script>')).toEqual({
      styles: [],
      scripts: [hashOf("code()")],
    });
  });

  it("drops a tag that never ends, and the rest of the page, as the parser does", () => {
    // The quote opens a value that runs to the page's end, so the tag never ends.
    const unfinishedValue =
      '<script>a()</script><script type="module>b()</script><script>c()</script>';
    expect(inlineHashes(unfinishedValue)).toEqual({ styles: [], scripts: [hashOf("a()")] });

    expect(inlineHashes("<style>a{}</style><script type=module")).toEqual({
      styles: [hashOf("a{}")],
      scripts: [],
    });
  });

  it("reads past the attributes of an end tag, so that a tag in them is no tag", () => {
    expect(inlineHashes("<script>a()</script <style>b{}</style>")).toEqual({
      styles: [],
      scripts: [hashOf("a()")],
    });
  });

  it("ends an element's text where its end tag starts, even when that tag never ends", () => {
    // The end tag's attributes run to the page's end, so the parser drops them and the rest of the
    // page. The element's text is only what came before the tag.
    expect(inlineHashes("<script>a()</script x")).toEqual({
      styles: [],
      scripts: [hashOf("a()")],
    });
    expect(inlineHashes('<style>b{}</style x="y')).toEqual({
      styles: [hashOf("b{}")],
      scripts: [],
    });
  });

  it("reads a page in one pass, however it is made: not once for each tag, nor each space", () => {
    const spaces = " ".repeat(200_000);

    const started = performance.now();
    const noQuote = inlineHashes("<script ".repeat(50_000));
    const openQuotes = inlineHashes('<script a="b '.repeat(50_000));
    // A type with a long run of white space in its middle, and one with a run at each end.
    const spacedType = inlineHashes(`<script type="x${spaces}y">`);
    const paddedType = inlineHashes(
      `<script type="${spaces}text/javascript${spaces}">a()</script>`,
    );
    const elapsed = performance.now() - started;

    expect(noQuote).toEqual(NONE);
    expect(openQuotes).toEqual(NONE);
    expect(spacedType).toEqual(NONE);
    expect(paddedType).toEqual({ styles: [], scripts: [hashOf("a()")] });
    expect(elapsed).toBeLessThan(2_000);
  });

  it("has nothing to hash in a page with no code of its own", () => {
    expect(inlineHashes("")).toEqual(NONE);
    expect(inlineHashes("<!doctype html><title>Plain</title><p>Words</p>")).toEqual(NONE);
  });
});

describe("contentSecurityPolicy", () => {
  const STYLE = "'sha256-X1RutGBrXCt9KkSaXMK7tHftWiRscFHOhxsS8tv8hBk='";
  const SCRIPT_ONE = "'sha256-HR7iaask9daLMRRskMI++QeJtjWDOjyPA6lGzYGzKW4='";
  const SCRIPT_TWO = "'sha256-iMrPAWirDC2X0OhZzLsM2MRIWSmepJGI4r7D8ZlwBOw='";

  it("writes the policy with each page's hashes, and 'none' for a kind it has none of", () => {
    expect(contentSecurityPolicy({ styles: [STYLE], scripts: [SCRIPT_ONE, SCRIPT_TWO] })).toBe(
      `default-src 'none'; script-src ${SCRIPT_ONE} ${SCRIPT_TWO}; style-src ${STYLE}; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    );
    expect(contentSecurityPolicy({ styles: [STYLE], scripts: [] })).toBe(
      `default-src 'none'; script-src 'none'; style-src ${STYLE}; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    );
    expect(contentSecurityPolicy({ styles: [], scripts: [SCRIPT_ONE] })).toBe(
      `default-src 'none'; script-src ${SCRIPT_ONE}; style-src 'none'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    );
    expect(contentSecurityPolicy(NONE)).toBe(
      "default-src 'none'; script-src 'none'; style-src 'none'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
  });

  it("allows the code of the shareable page by its own hashes", async () => {
    const page = renderSharePage(await demoModel(), { fontCss: "" });
    const policy = contentSecurityPolicy(inlineHashes(page));

    expect(policy).toContain(`script-src ${hashOf(SHARE_SCRIPT + CHECK_SCRIPT)};`);
    expect(policy).toContain(`style-src ${hashOf(`\n\n${SHARE_CSS}`)};`);
  });
});

describe("headersFile", () => {
  it("writes _headers as Netlify reads it", () => {
    const text = headersFile([
      {
        path: "/index.html",
        headers: [["Content-Security-Policy", "default-src 'none'; script-src 'none'"]],
      },
      {
        path: "/dvfr.illinois.gov/dvfr.illinois.gov_2027-01-15.docx",
        headers: [
          ["Content-Disposition", "attachment"],
          ["Cache-Control", "public, max-age=0"],
        ],
      },
    ]);

    expect(text).toBe(
      [
        "# Made by voicecap site. Each build empties this folder and writes it again.",
        "",
        "/index.html",
        "  Content-Security-Policy: default-src 'none'; script-src 'none'",
        "",
        "/dvfr.illinois.gov/dvfr.illinois.gov_2027-01-15.docx",
        "  Content-Disposition: attachment",
        "  Cache-Control: public, max-age=0",
        "",
      ].join("\n"),
    );
  });

  it("is its first line and a line break when there's no rule", () => {
    expect(headersFile([])).toBe(`${HEADERS_FIRST_LINE}\n`);
  });

  it("starts with the line that tells a later build that voicecap made the folder", () => {
    expect(HEADERS_FIRST_LINE).toBe(
      "# Made by voicecap site. Each build empties this folder and writes it again.",
    );
  });

  it("allows a colon in a value, as a policy has in data:", () => {
    const rule: HeaderRule = {
      path: "/a.html",
      headers: [["Content-Security-Policy", "img-src data:; font-src data:"]],
    };

    expect(headersFile([rule])).toBe(
      `${HEADERS_FIRST_LINE}\n\n/a.html\n  Content-Security-Policy: img-src data:; font-src data:\n`,
    );
  });

  it.each<[string, HeaderRule, string]>([
    [
      "a path with a line feed",
      { path: "/a\nb.html", headers: [["X-A", "b"]] },
      "its path holds a line break",
    ],
    [
      "a path with a carriage return",
      { path: "/a\rb.html", headers: [["X-A", "b"]] },
      "its path holds a line break",
    ],
    [
      "a path that doesn't start with a slash",
      { path: "index.html", headers: [["X-A", "b"]] },
      'its path doesn\'t start with "/"',
    ],
    ["an empty path", { path: "", headers: [["X-A", "b"]] }, 'its path doesn\'t start with "/"'],
    [
      "a header name with a line feed",
      { path: "/a.html", headers: [["X-A\nX-B", "b"]] },
      "a header's name holds a line break",
    ],
    [
      "a header name with a carriage return",
      { path: "/a.html", headers: [["X-A\rX-B", "b"]] },
      "a header's name holds a line break",
    ],
    ["an empty header name", { path: "/a.html", headers: [["", "b"]] }, "a header has no name"],
    [
      "a header name with a colon",
      { path: "/a.html", headers: [["X-A:X-B", "b"]] },
      'a header\'s name holds a ":"',
    ],
    [
      "a header value with a line feed",
      { path: "/a.html", headers: [["X-A", "b\nX-B: c"]] },
      "a header's value holds a line break",
    ],
    [
      "a header value with a carriage return",
      { path: "/a.html", headers: [["X-A", "b\rX-B: c"]] },
      "a header's value holds a line break",
    ],
  ])("refuses %s, and names the rule's path", (_name, rule, problem) => {
    expect(messageOf(() => headersFile([rule]))).toBe(
      `The _headers rule for ${JSON.stringify(rule.path)} can't be written: ${problem}.`,
    );
  });

  it("names the rule that has the problem, whichever it is", () => {
    const fine: HeaderRule = { path: "/index.html", headers: [["X-A", "b"]] };
    const bad: HeaderRule = {
      path: "/bad.html",
      headers: [
        ["X-A", "b"],
        ["X:B", "c"],
      ],
    };

    expect(messageOf(() => headersFile([fine, bad, fine]))).toBe(
      `The _headers rule for "/bad.html" can't be written: a header's name holds a ":".`,
    );
  });

  it("writes each control character of the path it names as an escape, so its message is safe to print", () => {
    const path = "/a\n\u{1b}\u{7f}\u{85}\u{2028}\u{2029}b";
    const escape = (code: number) => `\\u${code.toString(16).padStart(4, "0")}`;

    const message = messageOf(() => headersFile([{ path, headers: [["X-A", "b"]] }]));

    expect(message).toBe(
      `The _headers rule for "/a\\n${escape(0x1b)}${escape(0x7f)}${escape(0x85)}${escape(0x2028)}${escape(0x2029)}b" can't be written: its path holds a line break.`,
    );
    expect(message).not.toMatch(/[\p{Cc}\u{2028}\u{2029}]/u);
  });
});

describe("ROBOTS_TXT", () => {
  it("turns every crawler away from everything", () => {
    expect(ROBOTS_TXT).toBe("User-agent: *\nDisallow: /\n");
  });
});
