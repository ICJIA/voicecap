import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseCsv } from "csv-parse/sync";
import {
  type Node as JsonNode,
  parseTree,
  printParseErrorCode,
  type ParseError,
} from "jsonc-parser";

import type { InvalidEntry } from "../model.js";
import { UsageError } from "../util/errors.js";
import { sha256 } from "../util/hash.js";
import { decodeText } from "./decode.js";

/** One page in a page list file, before its URL is resolved against the site. */
export interface ListedEntry {
  /** The URL or root-relative path as written in the file. */
  value: string;
  /** 1-based line in the file where the entry starts. */
  line: number | null;
  label?: string;
  template?: string;
  notes?: string;
}

export interface ParsedPageList {
  format: "csv" | "json";
  encoding: "utf-8" | "windows-1252";
  /** SHA-256 of the file's bytes as read. */
  sha256: string;
  entries: ListedEntry[];
  /** Rows without a usable url value. */
  invalid: InvalidEntry[];
  warnings: string[];
}

const OPTIONAL_FIELDS = ["label", "template", "notes"] as const;
type OptionalField = (typeof OPTIONAL_FIELDS)[number];

/**
 * Read a page list file: JSON (.json) or CSV (.csv), detected by extension. Rows with a missing
 * or empty url are reported in `invalid` with their line numbers; everything else is returned.
 * File-level problems (unreadable, wrong shape, no url column) throw UsageError.
 */
export async function readPageList(file: string): Promise<ParsedPageList> {
  const ext = path.extname(file).toLowerCase();
  if (ext !== ".json" && ext !== ".csv") {
    throw new UsageError(
      `--pages must be a .csv or .json file (got "${path.basename(file)}"). See the README for both formats.`,
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = await readFile(file);
  } catch (error) {
    throw new UsageError(`Can't read the page list ${file}: ${(error as Error).message}`, {
      cause: error,
    });
  }
  const decoded = decodeText(bytes);
  const warnings: string[] = [];
  if (decoded.encoding === "windows-1252") {
    warnings.push(
      ext === ".csv"
        ? `${path.basename(file)} isn't UTF-8, so it was read as Windows-1252 (Excel's plain "CSV (Comma delimited)" format). ` +
            `To keep accented letters and symbols exact, save it from Excel as "CSV UTF-8 (Comma delimited)".`
        : `${path.basename(file)} isn't UTF-8, so it was read as Windows-1252. Save it as UTF-8 to be sure characters are read correctly.`,
    );
  }
  const parsed =
    ext === ".json" ? parseJsonList(decoded.text, file) : parseCsvList(decoded.text, file);
  return {
    format: ext === ".json" ? "json" : "csv",
    encoding: decoded.encoding,
    sha256: sha256(bytes),
    entries: parsed.entries,
    invalid: parsed.invalid,
    warnings: [...warnings, ...parsed.warnings],
  };
}

interface ParsedRows {
  entries: ListedEntry[];
  invalid: InvalidEntry[];
  warnings: string[];
}

function parseJsonList(text: string, file: string): ParsedRows {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, { allowTrailingComma: true, disallowComments: false });
  const lineOf = lineLocator(text);
  if (errors.length > 0) {
    const first = errors[0]!;
    const { line, column } = lineOf(first.offset);
    throw new UsageError(
      `${path.basename(file)} is not valid JSON: ${describeJsonError(first)} at line ${line}, column ${column}.`,
    );
  }
  if (!root || root.type !== "array") {
    throw new UsageError(
      `${path.basename(file)} must contain a JSON array of URLs, or of objects with a "url" and optional "label", "template", and "notes".`,
    );
  }

  const entries: ListedEntry[] = [];
  const invalid: InvalidEntry[] = [];
  const unknownKeys = new Set<string>();
  for (const element of root.children ?? []) {
    const line = lineOf(element.offset).line;
    const raw = snippet(text.slice(element.offset, element.offset + element.length));
    if (element.type === "string") {
      pushEntry(entries, invalid, { value: String(element.value), line }, raw);
      continue;
    }
    if (element.type !== "object") {
      invalid.push({ line, value: raw, reason: "expected a URL string or an object with a url" });
      continue;
    }
    const fields = objectFields(element);
    for (const key of fields.keys()) {
      if (key !== "url" && !(OPTIONAL_FIELDS as readonly string[]).includes(key)) {
        unknownKeys.add(key);
      }
    }
    const urlNode = fields.get("url");
    if (!urlNode) {
      invalid.push({ line, value: raw, reason: 'missing "url"' });
      continue;
    }
    if (urlNode.type !== "string") {
      invalid.push({
        line: lineOf(urlNode.offset).line,
        value: raw,
        reason: '"url" must be a string',
      });
      continue;
    }
    const entry: ListedEntry = { value: String(urlNode.value), line: lineOf(urlNode.offset).line };
    for (const field of OPTIONAL_FIELDS) {
      const valueNode = fields.get(field);
      if (valueNode && valueNode.value !== null && valueNode.value !== undefined) {
        setOptional(entry, field, String(valueNode.value));
      }
    }
    pushEntry(entries, invalid, entry, raw);
  }
  const warnings =
    unknownKeys.size > 0
      ? [
          `${path.basename(file)}: ignored unknown key${unknownKeys.size === 1 ? "" : "s"} ${[...unknownKeys].map((k) => `"${k}"`).join(", ")} (known keys: url, label, template, notes).`,
        ]
      : [];
  return { entries, invalid, warnings };
}

function parseCsvList(text: string, file: string): ParsedRows {
  // csv-parse counts a CRLF inside a quoted field as two lines; with LF only, its line numbers
  // are exact, which the "record starts at" arithmetic below relies on.
  const normalized = text.replace(/\r\n?/g, "\n");
  let records: { record: string[]; raw: string; info: { lines: number } }[];
  try {
    records = parseCsv(normalized, {
      bom: true,
      info: true,
      raw: true,
      columns: false,
      relax_column_count: true,
      skip_empty_lines: true,
    }) as unknown as { record: string[]; raw: string; info: { lines: number } }[];
  } catch (error) {
    throw new UsageError(`${path.basename(file)} is not valid CSV: ${(error as Error).message}`, {
      cause: error,
    });
  }

  const rows = records
    .map((item) => ({ cells: item.record, line: recordStartLine(item.raw, item.info.lines) }))
    // A line of spaces is as blank as an empty line.
    .filter((row) => row.cells.some((cell) => cell.trim() !== ""));
  const header = rows.shift();
  if (!header) {
    throw new UsageError(
      `${path.basename(file)} is empty. A page list CSV needs a header row with a "url" column.`,
    );
  }
  const columns = header.cells.map((name) => name.trim().toLowerCase());
  const urlIndex = columns.indexOf("url");
  if (urlIndex === -1) {
    throw new UsageError(
      `${path.basename(file)} has no "url" column. The first row must be a header such as: url,label,template,notes`,
    );
  }
  const warnings: string[] = [];
  const duplicateColumns = columns.filter(
    (name, index) => name !== "" && columns.indexOf(name) !== index,
  );
  if (duplicateColumns.length > 0) {
    const names = [...new Set(duplicateColumns)];
    warnings.push(
      `${path.basename(file)}: ${names.length === 1 ? "column" : "columns"} ${names.map((c) => `"${c}"`).join(", ")} ${names.length === 1 ? "appears" : "appear"} more than once; the first is used.`,
    );
  }
  const fieldIndex = new Map<OptionalField, number>();
  for (const field of OPTIONAL_FIELDS) {
    const index = columns.indexOf(field);
    if (index !== -1) fieldIndex.set(field, index);
  }

  const entries: ListedEntry[] = [];
  const invalid: InvalidEntry[] = [];
  for (const row of rows) {
    const entry: ListedEntry = { value: row.cells[urlIndex] ?? "", line: row.line };
    for (const [field, index] of fieldIndex) {
      const value = row.cells[index];
      if (value !== undefined) setOptional(entry, field, value);
    }
    pushEntry(entries, invalid, entry, row.cells.join(","));
  }
  return { entries, invalid, warnings };
}

/** Where a record starts: csv-parse reports the line it ends on, and the raw text spans the rest. */
function recordStartLine(raw: string, endLine: number): number {
  // Skipped blank lines are prepended to the next record's raw text.
  const own = raw.replace(/^\n+/, "").replace(/\n$/, "");
  return endLine - (own.match(/\n/g)?.length ?? 0);
}

function pushEntry(
  entries: ListedEntry[],
  invalid: InvalidEntry[],
  entry: ListedEntry,
  raw: string,
): void {
  const value = entry.value.trim();
  if (value === "") {
    invalid.push({ line: entry.line, value: snippet(raw), reason: "empty url" });
    return;
  }
  entries.push({ ...entry, value });
}

function setOptional(entry: ListedEntry, field: OptionalField, value: string): void {
  const trimmed = value.trim();
  if (trimmed !== "") entry[field] = trimmed;
}

function objectFields(node: JsonNode): Map<string, JsonNode> {
  const fields = new Map<string, JsonNode>();
  for (const property of node.children ?? []) {
    const [keyNode, valueNode] = property.children ?? [];
    if (keyNode && valueNode && !fields.has(String(keyNode.value))) {
      fields.set(String(keyNode.value), valueNode);
    }
  }
  return fields;
}

function describeJsonError(error: ParseError): string {
  // "CommaExpected" -> "comma expected"
  return printParseErrorCode(error.error)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

/** Maps a character offset to a 1-based line and column. */
function lineLocator(text: string): (offset: number) => { line: number; column: number } {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\n") starts.push(i + 1);
    else if (char === "\r" && text[i + 1] !== "\n") starts.push(i + 1);
  }
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid]! <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: offset - starts[low]! + 1 };
  };
}

function snippet(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 117)}...` : oneLine;
}
