/**
 * What the website tells Netlify about its own pages, which each build writes again: the hashes of
 * the code a page holds, the Content Security Policy that allows exactly that code, the text of
 * _headers (each page's policy, and each download's headers), the text of _redirects (where the
 * page of a report the site no longer shows sends its reader), and robots.txt.
 *
 * Each page was written by the voicecap version that shared it, so each is hashed from its own
 * bytes. A page holds one style block and one script, and no inline style attribute (see
 * src/share/html/document.ts), so its hashes are all its policy needs.
 */
import { createHash } from "node:crypto";

/**
 * The first line of _headers. A build takes a folder whose _headers starts with it as one it made
 * itself, and so one it may empty.
 */
export const HEADERS_FIRST_LINE =
  "# Made by voicecap site. Each build empties this folder and writes it again.";

/** robots.txt: every crawler is turned away from every page. */
export const ROBOTS_TXT = "User-agent: *\nDisallow: /\n";

/**
 * The hashes a Content Security Policy allows a page's own code by, each as 'sha256-<base64>': the
 * SHA-256 of an element's text, taken as UTF-8. `styles` holds one for each <style> element.
 * `scripts` holds one for each <script> element that a browser runs from its own text: one with no
 * `src`, and a `type` that's missing, empty, text/javascript, application/javascript, or module. A
 * data block, such as application/json, never runs, so it has no hash. Each hash comes once, in the
 * order found.
 *
 * The parts of `html` that matter are read as the HTML parser reads them:
 * - tags and attributes in any case, a value in double quotes, in single quotes, or bare, and a ">"
 *   inside quotes not ending a tag;
 * - a tag that never ends is dropped, and the rest of the page with it;
 * - an element's text from its start tag's ">" to the first end tag of its own name, or to the end
 *   of the page when there's none, and read as text, never as markup;
 * - each CR LF, and each CR alone, as a line feed, since that is the text a browser checks the
 *   hashes against;
 * - nothing in a comment as an element.
 *
 * It isn't a full parser. A browser reads some text differently, and each difference fails closed:
 * a script whose hash is missing is blocked, and a hash that no script has allows nothing.
 * - A decoy "<script>" or "<style>" inside a <title>, a <textarea>, or an attribute's value is read
 *   here as an element. It can swallow the real element after it, which the browser then blocks.
 * - A script that holds "<!--" followed by "<script" ends later in a browser than here.
 * - A NUL in a script's or a style's text is a U+FFFD to a browser, and a character reference in a
 *   `type` is the character it names.
 *
 * voicecap's own pages never hold such text. `esc` writes every "<" of their text as "&lt;", the
 * JSON block writes every "<" as a Unicode escape, and SHARE_CSS, SHARE_SCRIPT, and the check's
 * script hold no "<!--", "</style", or "<script". A page is read in one pass, whatever it holds, so
 * no page can make the read slow.
 */
export function inlineHashes(html: string): { styles: string[]; scripts: string[] } {
  const styles = new Set<string>();
  const scripts = new Set<string>();
  for (const { name, attributes, text } of inlineElements(html.replace(/\r\n?/g, "\n"))) {
    if (name === "style") {
      styles.add(sourceOf(text));
    } else if (runsFromItsText(attributes)) {
      scripts.add(sourceOf(text));
    }
  }
  return { styles: [...styles], scripts: [...scripts] };
}

/**
 * A page's Content Security Policy: its own style block and scripts by their hashes, images and
 * fonts only as data: URIs, and nothing else. No connection, no form, no <base>, and no frame
 * around the page. A kind with no hash is 'none'.
 */
export function contentSecurityPolicy(hashes: { styles: string[]; scripts: string[] }): string {
  const sources = (list: string[]) => (list.length === 0 ? "'none'" : list.join(" "));
  return [
    "default-src 'none'",
    `script-src ${sources(hashes.scripts)}`,
    `style-src ${sources(hashes.styles)}`,
    "img-src data:",
    "font-src data:",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** The headers Netlify adds to its response for one path. */
export interface HeaderRule {
  /** The exact path, from the site's top: "/index.html". */
  path: string;
  headers: [name: string, value: string][];
}

/** The header that carries a Content Security Policy. */
export const POLICY_HEADER = "Content-Security-Policy";

/**
 * The Content Security Policy of the demo's own pages, which the build publishes in demo-site/ (see
 * demoSiteRules). Unlike a report's it holds no hash: the pages have a style sheet beside them and a
 * form that goes to a page of their own, and no script, no style block, and no style attribute
 * (test/demo-site.test.ts keeps it so). It allows images from the pages' own address and as data:
 * URIs, though they have none.
 */
export const DEMO_SITE_POLICY =
  "default-src 'none'; style-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

/**
 * The rules of _headers for the demo's own pages, which the build publishes in `folder`
 * (demo-site/): each page has DEMO_SITE_POLICY at every address it answers at. `files` are the
 * paths of the files published there, from the folder and with "/" between names, and the rules are
 * made from them, so no page that is published can be left without one. A page is a file whose
 * name ends with .html; the style sheet and the sitemap are none. A page answers at its own
 * address and at the same without ".html", which is how Netlify serves it too (as for a report's
 * page, see rulesFor in ./build.ts), and a page in a folder (index.html) answers at the folder's
 * own address as well, as the site's own page answers at / and at /index.html. The rules come in
 * the order of their addresses.
 *
 * Netlify's documentation doesn't say whether a path that ends with /* also matches the folder's
 * own address, so no rule has a wildcard: each address is written out.
 */
export function demoSiteRules(folder: string, files: readonly string[]): HeaderRule[] {
  const addresses = new Set<string>();
  for (const file of files) {
    if (!file.endsWith(".html")) continue;
    addresses.add(`/${folder}/${file}`);
    addresses.add(`/${folder}/${file.slice(0, -".html".length)}`);
    if (file === "index.html" || file.endsWith("/index.html")) {
      addresses.add(`/${folder}/${file.slice(0, -"index.html".length)}`);
    }
  }
  return [...addresses]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((address): HeaderRule => ({
      path: address,
      headers: [[POLICY_HEADER, DEMO_SITE_POLICY]],
    }));
}

/**
 * _headers as Netlify reads it: HEADERS_FIRST_LINE, then each rule as a blank line, its path on a
 * line of its own, and each of its headers on a line, indented.
 *
 * A rule that couldn't be written as those lines, because it would be read as other headers or
 * other rules, throws an Error that names its path: a path that doesn't start with "/", a header
 * with no name or a ":" in its name, and a line break in a path, a name, or a value.
 */
export function headersFile(rules: HeaderRule[]): string {
  const lines = [HEADERS_FIRST_LINE];
  for (const rule of rules) {
    const problem = problemWith(rule);
    if (problem !== null) {
      throw new Error(`The _headers rule for ${quoted(rule.path)} can't be written: ${problem}.`);
    }
    lines.push("", rule.path, ...rule.headers.map(([name, value]) => `  ${name}: ${value}`));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The first line of _redirects: a comment, which Netlify skips, that says what the file is for.
 */
export const REDIRECTS_FIRST_LINE =
  "# Made by voicecap site: the page of a report the site no longer shows sends its reader on to its site's current report.";

/**
 * A rule of _redirects: Netlify answers a request for `from` with a 302 to `to`, both exact paths
 * from the site's top. It does so only when no file is published at `from`.
 */
export interface RedirectRule {
  from: string;
  to: string;
}

/**
 * _redirects as Netlify reads it: REDIRECTS_FIRST_LINE, then each rule on a line of its own, its
 * path, where it leads, and 302, set apart by spaces. A 302 isn't kept by a browser, as a 301 is, so
 * a later build can send the same path somewhere else: a site's current report changes with each
 * share.
 *
 * A rule that couldn't be written as one such line, because a part of it would be read as another
 * part or another rule, throws an Error that names its path: a path, or where it leads, that doesn't
 * start with "/", or that holds white space or a control character.
 */
export function redirectsFile(rules: readonly RedirectRule[]): string {
  const lines = [REDIRECTS_FIRST_LINE];
  for (const rule of rules) {
    const problem = problemWithRedirect(rule);
    if (problem !== null) {
      throw new Error(`The _redirects rule for ${quoted(rule.from)} can't be written: ${problem}.`);
    }
    lines.push(`${rule.from} ${rule.to} 302`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * White space, which sets the parts of a rule apart, or ends it, and a control character, which no
 * path voicecap writes holds.
 */
const SPACE_OR_CONTROL = /[\s\p{Cc}]/u;

/** What keeps a rule from being written as a line of _redirects, or null when nothing does. */
function problemWithRedirect({ from, to }: RedirectRule): string | null {
  if (!from.startsWith("/")) return 'its path doesn\'t start with "/"';
  if (SPACE_OR_CONTROL.test(from)) return "its path holds white space or a control character";
  if (!to.startsWith("/")) return 'where it leads doesn\'t start with "/"';
  if (SPACE_OR_CONTROL.test(to)) return "where it leads holds white space or a control character";
  return null;
}

/** A CR or an LF. In _headers it ends a line, and what follows is read as a line of its own. */
const LINE_BREAK = /[\r\n]/;

/** What keeps a rule from being written as lines of _headers, or null when nothing does. */
function problemWith({ path, headers }: HeaderRule): string | null {
  if (!path.startsWith("/")) return 'its path doesn\'t start with "/"';
  if (LINE_BREAK.test(path)) return "its path holds a line break";
  for (const [name, value] of headers) {
    if (name === "") return "a header has no name";
    if (name.includes(":")) return 'a header\'s name holds a ":"';
    if (LINE_BREAK.test(name)) return "a header's name holds a line break";
    if (LINE_BREAK.test(value)) return "a header's value holds a line break";
  }
  return null;
}

/**
 * `text` written so that it's safe to print: in double quotes, with each control character, and
 * each of U+2028 and U+2029 (which end a line), as an escape. A path names a file, and an error's
 * words are printed and kept in a log.
 */
function quoted(text: string): string {
  return JSON.stringify(text).replace(
    /[\p{Cc}\u{2028}\u{2029}]/gu,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/**
 * How a policy names the hash of `text`: 'sha256-' and the base64 of its SHA-256 (of its UTF-8
 * bytes), in single quotes.
 */
function sourceOf(text: string): string {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

/**
 * The `type`s of a script that a browser runs, besides a missing or empty one, which is
 * text/javascript.
 */
const CODE_TYPES = new Set(["text/javascript", "application/javascript", "module"]);

/** Whether a script with these attributes is one that a browser runs from its own text. */
function runsFromItsText(attributes: Map<string, string>): boolean {
  if (attributes.has("src")) return false;
  const type = attributes.get("type");
  if (type === undefined || type === "") return true;
  // The parser strips white space from the ends of a type, and reads it in any case.
  return CODE_TYPES.has(trimSpace(type).toLowerCase());
}

/** A script or style element: its name, its attributes, and its text. */
interface InlineElement {
  name: "script" | "style";
  attributes: Map<string, string>;
  text: string;
}

/**
 * What a scan of a page looks for, left to right: a comment, which holds no element, or the name
 * of a script or a style start tag (the group). The name is followed by white space, a "/", or a
 * ">", so <scripts> isn't a script.
 */
const COMMENT_OR_START_TAG = /<!--(?:-?>|[\s\S]*?(?:--!?>|$))|<(script|style)(?=[\t\n\f />])/gi;

/** Each script and style element of `page`, in the order found. Its line breaks are line feeds. */
function* inlineElements(page: string): Generator<InlineElement> {
  const scan = new RegExp(COMMENT_OR_START_TAG);
  for (let found = scan.exec(page); found !== null; found = scan.exec(page)) {
    const tag = found[1];
    if (tag === undefined) continue;
    const name = tag.toLowerCase() === "style" ? "style" : "script";
    const start = readTag(page, scan.lastIndex);
    // The page ends inside a tag that never ends. The parser drops it, and the rest of the page.
    if (start === null) return;
    const { textEnd, resumeAt } = endOf(name, page, start.end);
    yield { name, attributes: start.attributes, text: page.slice(start.end, textEnd) };
    // What the element holds is text, and an end tag's attributes are nothing to read: a tag in
    // either is no tag, so the scan goes on after the end tag.
    scan.lastIndex = resumeAt;
  }
}

/**
 * Where an element's text ends, at its name's first end tag from `from` on, and where the page goes
 * on, after that tag. With no end tag, the text runs to the page's end. With an end tag that never
 * ends, the text still ends where that tag starts, and the page goes on at its end: the parser
 * drops the tag, and the rest of the page with it.
 */
function endOf(
  name: InlineElement["name"],
  page: string,
  from: number,
): { textEnd: number; resumeAt: number } {
  const endTag = new RegExp(`</${name}(?=[\\t\\n\\f />])`, "gi");
  endTag.lastIndex = from;
  const found = endTag.exec(page);
  if (found === null) return { textEnd: page.length, resumeAt: page.length };
  return { textEnd: found.index, resumeAt: readTag(page, endTag.lastIndex)?.end ?? page.length };
}

/** What the parser reads as white space inside a tag. A CR is a line feed by then. */
const SPACE = new Set([" ", "\t", "\n", "\f"]);

/** What ends an attribute's name: white space, "/", ">", or "=". */
const NAME_END = new Set([...SPACE, "/", ">", "="]);

/** A tag's attributes, each by its name in lower case, and where the tag ends. */
interface Tag {
  attributes: Map<string, string>;
  /** Just after the tag's ">". */
  end: number;
}

/**
 * The tag whose name ends at `from`, with its attributes. When a name comes twice, the first is the
 * one: the parser drops the rest. null when the page ends inside the tag.
 */
function readTag(page: string, from: number): Tag | null {
  const attributes = new Map<string, string>();
  let at = from;
  while (at < page.length) {
    const char = page.charAt(at);
    if (char === ">") return { attributes, end: at + 1 };
    // Between attributes the parser skips white space, and "/".
    if (SPACE.has(char) || char === "/") {
      at++;
      continue;
    }
    const attribute = readAttribute(page, at);
    if (attribute === null) return null;
    if (!attributes.has(attribute.name)) attributes.set(attribute.name, attribute.value);
    at = attribute.end;
  }
  return null;
}

/**
 * The attribute that starts at `from`: its name, its value ("" when it has none), and where it
 * ends. A name begins with any character, even "=". A value is in double quotes, in single quotes,
 * or bare, and a bare one ends at white space or ">". null when the page ends inside it.
 */
function readAttribute(
  page: string,
  from: number,
): { name: string; value: string; end: number } | null {
  let at = from + 1;
  while (at < page.length && !NAME_END.has(page.charAt(at))) at++;
  const name = page.slice(from, at).toLowerCase();
  at = skipSpace(page, at);
  if (page.charAt(at) !== "=") return { name, value: "", end: at };

  at = skipSpace(page, at + 1);
  const quote = page.charAt(at);
  if (quote === '"' || quote === "'") {
    const close = page.indexOf(quote, at + 1);
    return close === -1 ? null : { name, value: page.slice(at + 1, close), end: close + 1 };
  }
  const valueStart = at;
  while (at < page.length && !SPACE.has(page.charAt(at)) && page.charAt(at) !== ">") at++;
  return { name, value: page.slice(valueStart, at), end: at };
}

/** The first place at or after `from` that isn't white space. */
function skipSpace(page: string, from: number): number {
  let at = from;
  while (at < page.length && SPACE.has(page.charAt(at))) at++;
  return at;
}

/**
 * `text` without the white space at its ends. Two loops, each looking in from an end, and no
 * pattern: a pattern for white space at the end of a text takes time in proportion to the square of
 * a long run of it with something after it.
 */
function trimSpace(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && SPACE.has(text.charAt(start))) start++;
  while (end > start && SPACE.has(text.charAt(end - 1))) end--;
  return text.slice(start, end);
}
