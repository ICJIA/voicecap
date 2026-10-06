import { defineConfig } from "vitest/config";

/**
 * Windows CI runners pause now and then, long enough for a file-heavy test that takes a second or
 * three to pass 30 seconds, so there a test gets longer. Everywhere else, the limit is as it was.
 */
const windowsCi = process.platform === "win32" && Boolean(process.env.CI);

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    testTimeout: windowsCi ? 90_000 : 30_000,
    hookTimeout: 60_000,
  },
});
