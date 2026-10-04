/**
 * The two files Netlify needs at the top of the transcripts home, which `voicecap site` writes
 * there the first time and never again, as it does .gitattributes: netlify.toml, with the build
 * command and the headers that every file gets, and .nvmrc, with the Node version of the build.
 * They belong to the home's owner after that, and an edit of theirs stays.
 */
import { writeEachIfMissing } from "../run/git-files.js";

/** The Node version Netlify builds with: 24, and the npm that comes with it. */
export const NVMRC = "24\n";

/**
 * netlify.toml, building with the minor version of `version`: "0.9.0" builds with
 * @icjia/voicecap@0.9, which npm reads as the latest 0.9 release. So a patch release is used by the
 * next build, and a new minor only when the owner changes the command. `version` is voicecap's own,
 * so one that doesn't start with two numbers is a mistake, and throws.
 */
export function netlifyToml(version: string): string {
  const minor = /^\d+\.\d+/.exec(version);
  if (minor === null) {
    throw new Error(
      `voicecap's version, ${JSON.stringify(version)}, doesn't start with two numbers, so netlify.toml can't name the version that builds the website.`,
    );
  }
  return `# Written by voicecap site, once: voicecap never changes it. Netlify builds the website with it on every push.
# To build with a newer voicecap, change the version in the command.
[build]
  command = "npx --yes @icjia/voicecap@${minor[0]} site --home . --out _site"
  publish = "_site"

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
