/**
 * The shareable page's fonts: IBM Plex Sans, Sans Condensed, and Mono, in their Latin subsets, the
 * nine faces the page's styles use. They're from @fontsource 5.3.0, under the SIL Open Font License
 * 1.1, whose text ships beside them (fonts/OFL.txt). They aren't a dependency: the files are kept in
 * ./fonts/ beside this module, which is src/share/fonts/ in the source and dist/share/fonts/ once
 * built (scripts/copy-fonts.mjs copies them there).
 *
 * The page embeds them as data URIs in its one style block, so it needs nothing from outside the
 * file.
 */
import { readFile } from "node:fs/promises";

/** A face: its family, as the page's styles name it, its style, and its weight. */
interface Face {
  family: "IBM Plex Sans" | "IBM Plex Sans Condensed" | "IBM Plex Mono";
  style: "normal" | "italic";
  weight: 400 | 500 | 600 | 700;
}

const FACES: Face[] = [
  { family: "IBM Plex Sans", style: "normal", weight: 400 },
  { family: "IBM Plex Sans", style: "italic", weight: 400 },
  { family: "IBM Plex Sans", style: "normal", weight: 500 },
  { family: "IBM Plex Sans", style: "normal", weight: 600 },
  { family: "IBM Plex Sans Condensed", style: "normal", weight: 500 },
  { family: "IBM Plex Sans Condensed", style: "normal", weight: 600 },
  { family: "IBM Plex Sans Condensed", style: "normal", weight: 700 },
  { family: "IBM Plex Mono", style: "normal", weight: 400 },
  { family: "IBM Plex Mono", style: "normal", weight: 500 },
];

/** A face's file, as @fontsource names it: "ibm-plex-sans-latin-400-italic.woff2". */
function fileOf({ family, style, weight }: Face): string {
  return `${family.toLowerCase().replaceAll(" ", "-")}-latin-${weight}-${style}.woff2`;
}

/** A face's rule, with its file's bytes as its source. */
async function faceRule(face: Face): Promise<string> {
  const bytes = await readFile(new URL(`./fonts/${fileOf(face)}`, import.meta.url));
  const source = `url(data:font/woff2;base64,${bytes.toString("base64")}) format("woff2")`;
  return `@font-face { font-family: "${face.family}"; font-style: ${face.style}; font-weight: ${face.weight}; font-display: swap; src: ${source}; }`;
}

let cached: Promise<string> | undefined;

/**
 * The nine `@font-face` rules, one a line, each with its file as a `data:font/woff2;base64,…`
 * source. The files are read once, and the rules kept.
 */
export function fontFaceCss(): Promise<string> {
  cached ??= Promise.all(FACES.map(faceRule)).then((rules) => rules.join("\n"));
  return cached;
}
