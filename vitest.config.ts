import { defineConfig } from "vitest/config";

/**
 * Windows CI runners pause now and then, for tens of seconds, long enough for a file-heavy test
 * that takes a second or three to pass 30 seconds, or a hook that starts Chrome to pass 60, so
 * there a test and a hook get longer. Everywhere else, the limits are as they were.
 */
const windowsCi = process.platform === "win32" && Boolean(process.env.CI);

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // One temp folder for the whole run, which is removed when the run ends.
    globalSetup: ["test/global-setup.ts"],
    setupFiles: ["test/setup.ts"],
    testTimeout: windowsCi ? 180_000 : 30_000,
    hookTimeout: windowsCi ? 120_000 : 60_000,
  },
});
