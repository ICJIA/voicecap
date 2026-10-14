/**
 * The two files Netlify needs at the top of the transcripts home, which `voicecap site` writes
 * there the first time and never again, as it does .gitattributes: netlify.toml, with the build
 * command, the setting that turns npm's install scripts off in the build, the setting that keeps
 * Netlify from rewriting the links in a page, and the headers that every file gets, and .nvmrc,
 * with the Node version of the build. They belong to the home's owner
 * after that, and an edit of theirs stays.
 */
import { writeEachIfMissing } from "../run/git-files.js";

/** The Node version Netlify builds with: 24, and the npm that comes with it. */
export const NVMRC = "24\n";

/**
 * A version that names one release of voicecap: three numbers, and, for a pre-release, a hyphen and
 * its name. It's all a build command may name, so no range, no tag such as `latest`, and no space,
 * quote, or other character that Netlify's shell could read can reach the command.
 */
export const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * netlify.toml, building with exactly `version`: "0.18.0" builds with @icjia/voicecap@0.18.0, so the
 * build installs that release and nothing newer, whatever is published later. The owner changes the
 * version in the command after each release, a patch included. Its `[build.environment]` turns
 * npm's install scripts off, so no package's install script runs in the build, which holds a
 * checkout of the records. Its `[build.processing.html]` turns Netlify's Pretty URLs off, which
 * would otherwise rewrite each link to another page of the site in the pages it publishes (a
 * report's links to its voice page, and the voice page's back), so that the published copy no
 * longer matched the fingerprint recorded for the file; with them off, each page is published as
 * built, byte for byte. `version` is voicecap's own, so one that isn't a version (see
 * EXACT_VERSION) is a mistake, and throws.
 */
export function netlifyToml(version: string): string {
  if (!EXACT_VERSION.test(version)) {
    throw new Error(
      `voicecap's version, ${JSON.stringify(version)}, isn't three numbers like 1.2.3 (a pre-release adds a hyphen and its name), so netlify.toml can't name the exact version that builds the website.`,
    );
  }
  return `# Written by voicecap site, once: voicecap never changes it. Netlify builds the website with it on every push.
# Change the version in the command after each release, a patch included.
[build]
  command = "npx --yes @icjia/voicecap@${version} site --home . --out _site"
  publish = "_site"

[build.environment]
  # No package's install script runs in the build.
  NPM_CONFIG_IGNORE_SCRIPTS = "true"

[build.processing.html]
  # Each page is published as built: no link in it is rewritten (Netlify's Pretty URLs are off).
  pretty_urls = false

[[headers]]
  for = "/*"
  [headers.values]
    X-Robots-Tag = "noindex, nofollow, noarchive"
    Referrer-Policy = "no-referrer"
    X-Content-Type-Options = "nosniff"
    X-Frame-Options = "DENY"
    Permissions-Policy = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    Strict-Transport-Security = "max-age=63072000; includeSubDomains"
    Cross-Origin-Opener-Policy = "same-origin"
    Cross-Origin-Resource-Policy = "same-origin"
`;
}

/**
 * Write netlify.toml and .nvmrc into the home, each only where it's missing: neither is ever
 * written over. The names written, in the order they were written. The home is already there.
 */
export async function ensureNetlifyFiles(home: string, version: string): Promise<string[]> {
  // Both texts are made before either file is written, so a version that can't be named leaves
  // nothing half written.
  return writeEachIfMissing(home, [
    ["netlify.toml", netlifyToml(version)],
    [".nvmrc", NVMRC],
  ]);
}
