/**
 * What the website tells Netlify about its own pages, which each build writes again: the hashes of
 * the code a page holds, the Content Security Policy that allows exactly that code, the text of
 * _headers (each page's policy, and each download's headers), and robots.txt.
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
 * It isn't a full parser, and voicecap's pages don't need one. They write every "<" of their text
 * as an entity, so no tag hides in an attribute's value or in another element's text. Their one
 * script holds no "<!--" followed by "<script", which would make the parser read past its first
 * "</script". A page is read in one pass, whatever it holds, so no page can make the read slow.
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

/**
 * _headers as Netlify reads it: HEADERS_FIRST_LINE, then each rule as a blank line, its path on a
 * line of its own, and each of its headers on a line, indented.
 */
export function headersFile(rules: HeaderRule[]): string {
  const lines = [HEADERS_FIRST_LINE];
  for (const { path, headers } of rules) {
    lines.push("", path, ...headers.map(([name, value]) => `  ${name}: ${value}`));
  }
  return `${lines.join("\n")}\n`;
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
  return CODE_TYPES.has(type.replace(/^[\t\n\f ]+|[\t\n\f ]+$/g, "").toLowerCase());
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
 * on, after that tag. With no end tag, or one that never ends, the text and the rest of the page
 * run to the page's end.
 */
function endOf(name: string, page: string, from: number): { textEnd: number; resumeAt: number } {
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
