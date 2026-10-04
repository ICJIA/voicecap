/**
 * The files an operating system leaves in a folder someone opened: macOS's Finder writes .DS_Store,
 * and Windows's Explorer Thumbs.db and desktop.ini. They hold nothing anyone made, so they're not
 * counted against a folder: `voicecap verify` doesn't take one for a file a run didn't record, and
 * `voicecap site` doesn't take one for more than a build writes.
 */
export const OS_LITTER: ReadonlySet<string> = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
