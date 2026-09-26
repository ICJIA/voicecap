import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// This file lives in src/util/ (tests) or dist/util/ (published): the package root is two levels up.
const ROOT = new URL("../../", import.meta.url);

let cachedVersion: string | undefined;

/** voicecap's own version, from its package.json. */
export function voicecapVersion(): string {
  if (cachedVersion === undefined) {
    const pkg = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8")) as {
      version: string;
    };
    cachedVersion = pkg.version;
  }
  return cachedVersion;
}

/** voicecap's installed package directory (where its pinned dependencies resolve from). */
export function packageRoot(): string {
  return fileURLToPath(ROOT);
}
