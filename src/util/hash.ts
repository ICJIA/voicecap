import { createHash } from "node:crypto";

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** JSON with object keys sorted (and undefined values dropped), so equal values always hash the same. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export function hashJson(value: unknown): string {
  return sha256(canonicalJson(value));
}

/** The seal of a record: hashJson of it with its own `seal` field left out (if it has one). */
export function sealOf(record: object): string {
  const { seal: _seal, ...rest } = record as Record<string, unknown>;
  return hashJson(rest);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) sorted[key] = sortKeys(item);
    }
    return sorted;
  }
  return value;
}
