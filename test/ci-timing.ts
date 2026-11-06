/**
 * Time limits for tests that load real pages in Chrome or start real Windows programs.
 *
 * Windows CI runners pause now and then for tens of seconds: a page load, a screenshot, or
 * PowerShell starting can then pass a limit that's ample on any other machine, and a different test
 * fails on each run. There, these limits are longer. Everywhere else, they're as they were.
 */
export const windowsCi = process.platform === "win32" && Boolean(process.env.CI);

/** How long a test gives a page to load. */
export const LOAD_MS = windowsCi ? 45_000 : 15_000;

/** How long a test gives PowerShell to start the computer's voice and answer. */
export const VOICE_READY_MS = windowsCi ? 60_000 : 20_000;
