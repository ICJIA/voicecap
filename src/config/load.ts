import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

import { ConfigError, errorMessage } from "../util/errors.js";
import { fromGitBash, resolveUserPath } from "../util/git-bash.js";
import { hashJson } from "../util/hash.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { configSchema, type UserConfig, type VoicecapConfig } from "./schema.js";

export const CONFIG_FILE_NAMES = [
  "voicecap.config.ts",
  "voicecap.config.mts",
  "voicecap.config.js",
  "voicecap.config.mjs",
  "voicecap.config.json",
] as const;

/** The one config file voicecap finds in a folder. The other names above are code. */
const JSON_CONFIG_NAME = "voicecap.config.json";

export interface LoadedConfig {
  config: VoicecapConfig;
  /** The config file used, or null when running on defaults. */
  file: string | null;
  /** SHA-256 of the effective config, recorded in every run. */
  sha256: string;
}

/**
 * Type helper for a config written as code: `export default defineConfig({ ... })`. voicecap runs
 * such a config only when `VOICECAP_CONFIG` names it (see loadConfig).
 */
export function defineConfig(config: UserConfig): UserConfig {
  return config;
}

/**
 * Load a config, merged over the defaults. The file read is, in this order:
 *
 * 1. `file`;
 * 2. the file `env.VOICECAP_CONFIG` names, trimmed, by its full path (Git Bash's `/c/...` form
 *    too). A relative path is refused with a ConfigError: set once, in a profile, it would name a
 *    file in whichever folder voicecap runs in. `env` is `process.env` unless the caller gives one;
 * 3. `voicecap.config.json` in `cwd`.
 *
 * A config written as code (`.ts`, `.mts`, `.js`, `.mjs`) runs only when it's named, by 1 or 2. One
 * found in `cwd` is refused and never run: `cwd` can be a folder many people write to, such as a
 * shared transcripts repository, and anyone who can add a file to it could have put the code there.
 */
export async function loadConfig(
  options: { cwd?: string; file?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<LoadedConfig> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const file = namedConfigFile(cwd, options.file, env) ?? findConfigFile(cwd);
  const user = file ? await readConfigFile(file) : {};
  const config = resolveConfig(user, file);
  return { config, file, sha256: configSha256(config) };
}

/**
 * voicecap's own settings, with no config file read: what loadConfig gives in a folder without
 * one. voicecap demo uses it, so a project's config in the current folder never changes the demo.
 */
export function defaultConfig(): LoadedConfig {
  const config = resolveConfig({});
  return { config, file: null, sha256: configSha256(config) };
}

/**
 * The SHA-256 of the effective config, which every run records. report.canonical came in 0.10.0,
 * null by default: a null one is left out, so a config that doesn't set it hashes as it did in
 * 0.9.x, and runs on either side of the upgrade don't differ for it. One that's set is hashed.
 */
function configSha256(config: VoicecapConfig): string {
  if (config.report.canonical !== null) return hashJson(config);
  const { canonical: _canonical, ...report } = config.report;
  return hashJson({ ...config, report });
}

/** Merge a user config over the defaults and validate the result. */
export function resolveConfig(user: unknown, source: string | null = null): VoicecapConfig {
  if (!isPlainObject(user)) {
    throw new ConfigError(`${describe(source)} must export an object of settings.`);
  }
  const merged = deepMerge(DEFAULT_CONFIG, user);
  const result = configSchema.safeParse(merged);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const where = issue.path.length > 0 ? issue.path.join(".") : "(top level)";
      return `  - ${where}: ${issue.message}`;
    });
    throw new ConfigError(`${describe(source)} is invalid:\n${problems.join("\n")}`);
  }
  return result.data;
}

/**
 * The config file the caller named with `file` or `VOICECAP_CONFIG`, or null when it named none.
 * `VOICECAP_CONFIG` must be a full path, once Git Bash's form is read (fromGitBash), or it's
 * refused: a relative one names a file in the folder voicecap runs in, which can be a folder many
 * people write to, such as a shared transcripts repository.
 */
function namedConfigFile(
  cwd: string,
  file: string | undefined,
  env: NodeJS.ProcessEnv,
): string | null {
  if (file) return path.resolve(cwd, file);
  const fromEnv = env.VOICECAP_CONFIG?.trim();
  if (!fromEnv) return null;
  if (!path.isAbsolute(fromGitBash(fromEnv))) {
    throw new ConfigError(
      `VOICECAP_CONFIG must be a full path (it is "${fromEnv}"), so that it names one file wherever voicecap runs.`,
    );
  }
  return resolveUserPath(cwd, fromEnv);
}

/**
 * The config file in `cwd` that no one named: voicecap.config.json, or null when there is none. A
 * config written as code is refused with a ConfigError, and is not run, not even to see what it
 * holds.
 */
function findConfigFile(cwd: string): string | null {
  const code = CONFIG_FILE_NAMES.find(
    (name) => name !== JSON_CONFIG_NAME && existsSync(path.join(cwd, name)),
  );
  if (code) {
    throw new ConfigError(
      `${code} in ${path.resolve(cwd)} is code, and voicecap runs a config's code only when you name it: anyone who can add a file to this folder could have put it there. Write the same settings as ${JSON_CONFIG_NAME}, or set VOICECAP_CONFIG to the file's full path to run it.`,
    );
  }
  const json = path.join(cwd, JSON_CONFIG_NAME);
  return existsSync(json) ? json : null;
}

async function readConfigFile(file: string): Promise<unknown> {
  if (!existsSync(file)) throw new ConfigError(`Config file not found: ${file}`);
  try {
    if (file.endsWith(".json")) {
      return JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
    }
    const jiti = createJiti(import.meta.url, {
      fsCache: false,
      moduleCache: false,
      // Run with npx, the site folder has no node_modules: point the package's own name at this
      // copy, so `import { defineConfig } from "@icjia/voicecap"` works in any config.
      alias: { "@icjia/voicecap": selfEntry() },
    });
    return await jiti.import(file, { default: true });
  } catch (error) {
    throw new ConfigError(`Could not load ${file}: ${errorMessage(error)}`, { cause: error });
  }
}

/** voicecap's entry point: dist/index.js when installed, src/index.ts when running from source. */
function selfEntry(): string {
  const built = fileURLToPath(new URL("../index.js", import.meta.url));
  return existsSync(built) ? built : fileURLToPath(new URL("../index.ts", import.meta.url));
}

function describe(source: string | null): string {
  return source ? `The config in ${path.basename(source)}` : "The config";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Objects merge recursively; arrays and other values replace. `undefined` leaves the default. */
function deepMerge(base: unknown, override: unknown): unknown {
  if (override === undefined) return base;
  if (isPlainObject(base) && isPlainObject(override)) {
    const merged: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override)) {
      merged[key] = deepMerge(base[key], value);
    }
    return merged;
  }
  return override;
}
