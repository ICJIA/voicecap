/**
 * The voice page in parts. A recording is about 150 KB of the voice page for each page, and its
 * screenshot more, so a site of several hundred pages would make one voice page of more than a
 * hundred megabytes: more than a Git host takes in one file (GitHub warns at 50 MB and refuses
 * 100 MB), and slow to open. So a report of more than VOICE_PART_PAGES pages has its voice page in
 * parts, each the sections of up to that many pages in the report's order, and each a whole page
 * of its own: it plays, checks, and works offline as the one voice page does. The first part keeps
 * the voice page's name, and the others are named for it with their number before `.voice.html`
 * (`dvfr.illinois.gov_2027-01-15.part-2.voice.html`), which still ends `.voice.html`, the ending
 * the website knows a voice page by. A report of up to VOICE_PART_PAGES pages has one voice page,
 * as it always had.
 */

/** At most this many of the report's pages in one part of its voice page. */
export const VOICE_PART_PAGES = 100;

/** How many parts the voice page of a report of `pages` pages has: one for up to 100 pages. */
export function voicePartCount(pages: number): number {
  return Math.max(1, Math.ceil(pages / VOICE_PART_PAGES));
}

/** The number of the part, from 1, that holds the page at `index`, from 0, in the report's order. */
export function voicePartOf(index: number): number {
  return Math.floor(index / VOICE_PART_PAGES) + 1;
}

/**
 * The file name of part `part` of the voice page named `voiceName`: its own name for the first, and
 * the others with `.part-<n>` before `.voice.html`. A name that doesn't end `.voice.html` has
 * `.part-<n>` on its end.
 */
export function voicePartName(voiceName: string, part: number): string {
  if (part <= 1) return voiceName;
  return voiceName.endsWith(".voice.html")
    ? `${voiceName.slice(0, -".voice.html".length)}.part-${part}.voice.html`
    : `${voiceName}.part-${part}`;
}

/** The file names of every part of the voice page of a report of `pages` pages, in order. */
export function voicePartNames(voiceName: string, pages: number): string[] {
  return Array.from({ length: voicePartCount(pages) }, (_, at) => voicePartName(voiceName, at + 1));
}
