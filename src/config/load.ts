import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createJiti } from "jiti";

import { ConfigError, errorMessage } from "../util/errors.js";
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

export interface LoadedConfig {
  config: VoicecapConfig;
  /** The config file used, or null when running on defaults. */
  file: string | null;
  /** SHA-256 of the effective config, recorded in every run. */
  sha256: string;
}

/** Type helper for voicecap.config.ts: `export default defineConfig({ ... })`. */
export function defineConfig(config: UserConfig): UserConfig {
  return config;
}

/** Find and load voicecap.config.* in `cwd` (or load `file`), merged over the defaults. */
export async function loadConfig(
  options: { cwd?: string; file?: string } = {},
): Promise<LoadedConfig> {
  const cwd = options.cwd ?? process.cwd();
  const file = options.file ? path.resolve(cwd, options.file) : findConfigFile(cwd);
  const user = file ? await readConfigFile(file) : {};
  const config = resolveConfig(user, file);
  return { config, file, sha256: hashJson(config) };
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

function findConfigFile(cwd: string): string | null {
  const found = CONFIG_FILE_NAMES.map((name) => path.join(cwd, name)).filter((file) =>
    existsSync(file),
  );
  if (found.length > 1) {
    const names = found.map((file) => path.basename(file)).join(", ");
    throw new ConfigError(`Found more than one config file (${names}). Keep just one.`);
  }
  return found[0] ?? null;
}

async function readConfigFile(file: string): Promise<unknown> {
  if (!existsSync(file)) throw new ConfigError(`Config file not found: ${file}`);
  try {
    if (file.endsWith(".json")) {
      return JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
    }
    const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: false });
    return await jiti.import(file, { default: true });
  } catch (error) {
    throw new ConfigError(`Could not load ${file}: ${errorMessage(error)}`, { cause: error });
  }
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
