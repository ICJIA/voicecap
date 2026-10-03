/**
 * The shareable page's fingerprint check: what the page carries so a reader can check, offline and
 * in one click, that the transcripts it shows are the ones its sealed records list.
 *
 * The page carries the data (`checkDataJson`) and a small script (`CHECK_SCRIPT`). The script
 * recomputes what voicecap recorded: each transcript file's SHA-256, each run record's seal (the
 * record without its `seal`, as JSON with its keys sorted, hashed), and each review entry's seal
 * and the review chain, by the rules `verify` uses (see `chainProblems` in src/verify.ts). It also
 * compares each transcript the page shows (in its appendix) with the body of the file the page
 * carries for it, so the transcripts shown are exactly the ones the sealed records list. It uses
 * the browser's own SHA-256 (Web Crypto) where there is one, and a small one of its own where
 * there isn't (a page opened from an address that isn't secure).
 *
 * Both scripts are plain browser JavaScript (ES2020, no imports), held as strings the way
 * src/report/client.ts holds the report's script. The check proves the page is consistent with
 * itself, not that the page itself is unchanged: whoever changed it could have changed the
 * fingerprints too. The page says so beside the button.
 */
import type { ReviewsFile, RunJson } from "../model.js";

export interface CheckData {
  /**
   * The sealed run records the page draws on, exactly as on disk. A seal covers every field of its
   * record, so one with any field changed, flags recomputed with the current rules included (see
   * withCurrentFlags), no longer matches it.
   */
  runs: RunJson[];
  /** Each transcript file the page shows: its run, slug, file name ("read.txt"), and exact text. */
  files: { run: string; slug: string; name: string; text: string }[];
  /** reviews.json's pages, or null when there's none. */
  reviews: ReviewsFile["pages"] | null;
}

/**
 * The data as the body of the page's `<script type="application/json" id="fp-data">`: JSON with
 * every "<" written \u003c, so nothing in a transcript, "</script>" or "<!--" included, can end the
 * block or start a comment in it. JSON.parse gives back exactly what went in.
 */
export function checkDataJson(data: CheckData): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/**
 * The check's library, as plain browser JavaScript (ES2020, no imports, nothing but TextEncoder
 * from outside): `sha256Hex(bytes)` (FIPS 180-4, over a Uint8Array), `canonicalJson(value)` and
 * `sealOf(record)` (the same as src/util/hash.ts gives), and `checkAll(data, digest, shown)`.
 *
 * `checkAll` resolves to `{ files, runs, reviewProblems, line }`:
 * - `files` has each transcript's label ("Run 1402 · /about/ · read.txt") and whether it matches:
 *   the SHA-256 of its text is the one its run records for it, and the text the page shows for it
 *   is its body;
 * - `runs` has each run's id and whether its record still matches its seal;
 * - `reviewProblems` lists, in words, each review entry that doesn't match its seal and each break
 *   in the chain (seq running from 1 with no gaps or repeats, entry 1's prev null, each prev the
 *   seal of the entry before); entries from before seals are left out;
 * - `line` is the result in words, without its closing full stop: a sentence for each mismatch,
 *   naming what doesn't match, then the count ("21 of 21 transcripts match their fingerprints, and
 *   both runs' seals check out").
 *
 * `digest(bytes)` gives the SHA-256 of a Uint8Array as hex, now or as a promise: Web Crypto's where
 * the browser has it, else `sha256Hex`, which is also the default.
 *
 * `shown(file)` gives the text the page shows for one of the data's files (its appendix shows each
 * file's body: the file without its header block), "" for one it shows as having no lines, and
 * null for one it doesn't show. The text shown matches when it's the file's body, with line
 * endings read as one, and the null characters a browser leaves out of a page's text left out of
 * both. It's compared only for a file that matches its fingerprint (one that doesn't is named for
 * that), and without `shown`, never.
 */
export const CHECK_LIBRARY = String.raw`
function sha256Hex(bytes) {
  var K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  var H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);
  var W = new Uint32Array(64);
  function block(from, at) {
    var i, a, b, c, d, e, f, g, h, t1, t2, x, y;
    for (i = 0; i < 16; i++, at += 4) {
      W[i] = (from[at] << 24) | (from[at + 1] << 16) | (from[at + 2] << 8) | from[at + 3];
    }
    for (i = 16; i < 64; i++) {
      x = W[i - 15];
      y = W[i - 2];
      W[i] = W[i - 16] + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) +
        W[i - 7] + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10));
    }
    a = H[0]; b = H[1]; c = H[2]; d = H[3]; e = H[4]; f = H[5]; g = H[6]; h = H[7];
    for (i = 0; i < 64; i++) {
      t1 = h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) +
        ((e & f) ^ (~e & g)) + K[i] + W[i];
      t2 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) +
        ((a & b) ^ (a & c) ^ (b & c));
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  var length = bytes.length;
  var whole = length - (length % 64);
  var at, i;
  for (at = 0; at < whole; at += 64) block(bytes, at);
  // What's left, then 0x80, then zeros, then the length in bits as 64 bits: one more block, or two.
  var rest = length - whole;
  var tail = new Uint8Array(rest < 56 ? 64 : 128);
  for (i = 0; i < rest; i++) tail[i] = bytes[whole + i];
  tail[rest] = 0x80;
  var bits = length * 8;
  var high = Math.floor(bits / 4294967296);
  var low = bits >>> 0;
  var end = tail.length;
  for (i = 0; i < 4; i++) {
    tail[end - 1 - i] = low >>> (8 * i);
    tail[end - 5 - i] = high >>> (8 * i);
  }
  for (at = 0; at < end; at += 64) block(tail, at);
  var hex = "";
  for (i = 0; i < 8; i++) hex += H[i].toString(16).padStart(8, "0");
  return hex;
}

function utf8(text) {
  return new TextEncoder().encode(text);
}

// Objects with no prototype, here and in sealedBytes: on them a key named "__proto__" is a key like
// any other. Set on a plain object, it would replace the object's prototype instead, and drop out
// of the JSON a seal hashes.
function canonicalJson(value) {
  function sorted(item) {
    if (Array.isArray(item)) return item.map(sorted);
    if (item !== null && typeof item === "object") {
      var copy = Object.create(null);
      Object.keys(item).sort().forEach(function (key) {
        if (item[key] !== undefined) copy[key] = sorted(item[key]);
      });
      return copy;
    }
    return item;
  }
  return JSON.stringify(sorted(value));
}

function sealedBytes(record) {
  var rest = Object.create(null);
  Object.keys(record).forEach(function (key) {
    if (key !== "seal") rest[key] = record[key];
  });
  return utf8(canonicalJson(rest));
}

function sealOf(record) {
  return sha256Hex(sealedBytes(record));
}

// A transcript's step lines, as voicecap's extractBody gives them: the text after its header
// block's blank line, with every line ending read as one.
function bodyOf(text) {
  var lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  var blank = lines.indexOf("");
  return (blank === -1 ? lines : lines.slice(blank + 1)).join("\n");
}

// Whether the text a page shows is a transcript's body. A browser reads every line ending as one,
// and leaves null characters out of a page's text, so neither counts.
function showsBody(shown, text) {
  function plain(value) {
    return String(value).replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
  }
  return plain(shown) === plain(bodyOf(text));
}

function pathOf(url) {
  var path = String(url).replace(/^[a-z][a-z0-9+.-]*:\/\/[^\/?#]*/i, "").replace(/#.*$/, "");
  return path.charAt(0) === "/" ? path : "/" + path;
}

function runLabel(runs, id) {
  var time = String(id).slice(11);
  var shared = runs.some(function (run) {
    return run.id !== id && String(run.id).slice(11) === time;
  });
  return "Run " + (time === "" || shared ? id : time);
}

function pageOf(runs, file) {
  var run = runs.find(function (candidate) { return candidate.id === file.run; });
  return run && (run.pages || []).find(function (page) { return page.slug === file.slug; });
}

function fileRecord(runs, file) {
  var page = pageOf(runs, file);
  var files = page && page.files;
  var listed = files && Object.prototype.hasOwnProperty.call(files, file.name);
  return listed ? files[file.name] : undefined;
}

function fileLabel(runs, file) {
  var page = pageOf(runs, file);
  var where = page && page.url ? pathOf(page.url) : file.slug;
  return runLabel(runs, file.run) + " · " + where + " · " + file.name;
}

function reviewEntries(reviews) {
  var found = [];
  Object.keys(reviews || {}).forEach(function (key) {
    (reviews[key] || []).forEach(function (entry) {
      var sealedOrNumbered = entry && (entry.seal !== undefined || entry.seq !== undefined);
      if (sealedOrNumbered) found.push({ key: key, entry: entry });
    });
  });
  return found;
}

function entryName(item) {
  var entry = item.entry;
  var path = pathOf(typeof entry.url === "string" ? entry.url : item.key);
  return Number.isInteger(entry.seq) && entry.seq >= 1
    ? "Review entry " + entry.seq + " (" + path + ")"
    : "A review entry for " + path;
}

function chainProblems(chain) {
  var problems = [];
  var bySeq = {};
  chain.forEach(function (link) { (bySeq[link.seq] = bySeq[link.seq] || []).push(link); });
  var next = 1;
  Object.keys(bySeq).map(Number).sort(function (a, b) { return a - b; }).forEach(function (seq) {
    if (seq === next + 1) problems.push("Review entry " + next + " is missing");
    if (seq > next + 1) {
      problems.push("Review entries " + next + " to " + (seq - 1) + " are missing");
    }
    if (bySeq[seq].length > 1) problems.push("More than one review entry is numbered " + seq);
    next = seq + 1;
  });
  chain.slice().sort(function (a, b) { return a.seq - b.seq; }).forEach(function (link) {
    if (!link.intact) return;
    if (link.seq === 1) {
      if (link.entry.prev !== null) {
        problems.push("Review entry 1 follows an entry that isn't there");
      }
      return;
    }
    var before = (bySeq[link.seq - 1] || []).filter(function (other) { return other.intact; });
    var follows = before.some(function (other) { return other.entry.seal === link.entry.prev; });
    if (before.length > 0 && !follows) {
      problems.push("Review entry " + link.seq + " doesn't follow review entry " + (link.seq - 1));
    }
  });
  return problems;
}

async function checkReviews(reviews, digest) {
  var items = reviewEntries(reviews);
  var problems = [];
  var chain = [];
  for (var item of items) {
    var entry = item.entry;
    var intact = (await digest(sealedBytes(entry))) === entry.seal;
    if (!intact) problems.push(entryName(item) + " doesn't match its seal");
    if (Number.isInteger(entry.seq) && entry.seq >= 1) {
      chain.push({ entry: entry, seq: entry.seq, intact: intact });
    } else if (intact) {
      problems.push(entryName(item) + " is outside the chain (it has no number)");
    }
  }
  return { sealed: items.length, problems: problems.concat(chainProblems(chain)) };
}

function sealsPhrase(total, ok) {
  if (ok === total) {
    if (total === 1) return "the run's seal checks out";
    return total === 2 ? "both runs' seals check out" : "all " + total + " runs' seals check out";
  }
  if (total === 1) return "the run's seal doesn't check out";
  return ok + " of " + total + " runs' seals check out";
}

async function checkAll(data, digest, shown) {
  digest = digest || sha256Hex;
  var runs = data.runs || [];
  var files = [];
  var sentences = [];
  for (var file of data.files || []) {
    var label = fileLabel(runs, file);
    var recorded = fileRecord(runs, file);
    var matches = !!recorded && (await digest(utf8(file.text))) === recorded.sha256;
    // A file that doesn't match its fingerprint is named for that, once: what the page shows of it
    // is only compared with a file that does.
    var text = matches && shown ? shown(file) : null;
    var asShown = text === null || text === undefined || showsBody(text, file.text);
    files.push({ label: label, ok: matches && asShown });
    if (!matches) sentences.push(label + " doesn't match its fingerprint.");
    if (!asShown) sentences.push(label + ": the text shown doesn't match its file.");
  }
  var seals = [];
  for (var run of runs) {
    seals.push({ id: run.id, ok: (await digest(sealedBytes(run))) === run.seal });
  }
  var reviews = await checkReviews(data.reviews, digest);
  seals.forEach(function (seal) {
    if (!seal.ok) sentences.push(runLabel(runs, seal.id) + "'s record doesn't match its seal.");
  });
  reviews.problems.forEach(function (problem) { sentences.push(problem + "."); });
  var clauses = [];
  if (files.length > 0) {
    var matching = files.filter(function (file) { return file.ok; }).length;
    clauses.push(matching + " of " + files.length + " transcripts match their fingerprints");
  }
  if (seals.length > 0) {
    var sealed = seals.filter(function (seal) { return seal.ok; }).length;
    clauses.push(sealsPhrase(seals.length, sealed));
  }
  if (reviews.sealed > 0 && reviews.problems.length === 0) {
    clauses.push("the review entries' seals and chain check out");
  }
  var summary = clauses.join(", and ");
  sentences.push(
    summary === ""
      ? "This page holds no transcripts or run records to check"
      : summary.charAt(0).toUpperCase() + summary.slice(1)
  );
  return { files: files, runs: seals, reviewProblems: reviews.problems, line: sentences.join(" ") };
}
`;

/**
 * CHECK_LIBRARY, then the wiring for the evidence section's `#fp-run` and `#fp-demo` buttons, its
 * `#fp-result` line, and the `#fp-list` fold with its `#fp-count` and `#fp-rows`, all in one
 * function so nothing else of the wiring is global. Before the script runs the two buttons are
 * `hidden`, and the `.fp-noscript` line says how to check without scripts; the script un-hides the
 * buttons and hides that line.
 *
 * A click reads `#fp-data` afresh, and the transcripts the page shows, so the check always sees
 * what the page holds now. Each transcript the appendix shows is a `section.tx` that names its file
 * (`data-run`, `data-slug`, and `data-file`), with its text in a `<pre>`, or none for a transcript
 * with no lines. "Show a change being caught" runs the same check on a copy with the first character
 * of the first file changed, in memory only: the page's own data is never changed.
 *
 * A page without that markup is left alone. Each script starts and ends on a new line, so it can
 * follow another in the page's one `<script>`, even one that ends without its semicolon.
 */
export const CHECK_SCRIPT =
  CHECK_LIBRARY +
  String.raw`
(function () {
  "use strict";
  var runButton = document.getElementById("fp-run");
  var demoButton = document.getElementById("fp-demo");
  var result = document.getElementById("fp-result");
  var list = document.getElementById("fp-list");
  var count = document.getElementById("fp-count");
  var rows = document.getElementById("fp-rows");
  var source = document.getElementById("fp-data");
  if (!runButton || !demoButton || !result || !list || !count || !rows || !source) return;

  function hex(buffer) {
    return Array.from(new Uint8Array(buffer), function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
  }
  var subtle = window.crypto && window.crypto.subtle;
  var digest = subtle
    ? function (bytes) { return subtle.digest("SHA-256", bytes).then(hex); }
    : sha256Hex;

  function cell(row, text) {
    var td = document.createElement("td");
    td.textContent = text;
    row.appendChild(td);
    return td;
  }
  function addRow(label, recorded, ok) {
    var row = document.createElement("tr");
    cell(row, label);
    var fingerprint = cell(row, "");
    if (recorded) {
      var code = document.createElement("code");
      code.textContent =
        recorded.length > 20 ? recorded.slice(0, 12) + "…" + recorded.slice(-6) : recorded;
      fingerprint.appendChild(code);
    }
    var chip = document.createElement("span");
    chip.className = "chip " + (ok ? "c-ok" : "c-bad");
    chip.textContent = ok ? "matches" : "doesn’t match";
    cell(row, "").appendChild(chip);
    rows.appendChild(row);
  }

  // The text the page shows for a file: its section's <pre>, "" for a section with none (a
  // transcript with no lines), and null when no section names the file.
  function shownText(file) {
    var sections = document.querySelectorAll("section.tx[data-file]");
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i];
      var named =
        section.getAttribute("data-run") === file.run &&
        section.getAttribute("data-slug") === file.slug &&
        section.getAttribute("data-file") === file.name;
      if (named) {
        var pre = section.querySelector("pre");
        return pre ? pre.textContent : "";
      }
    }
    return null;
  }

  function withFirstCharacterChanged(data) {
    var copy = JSON.parse(JSON.stringify(data));
    var file = copy.files[0];
    var point = file.text.codePointAt(0);
    var from = point === undefined ? "" : String.fromCodePoint(point);
    var to = from === "#" ? "$" : "#";
    file.text = to + file.text.slice(from.length);
    return { data: copy, file: file, from: from, to: to };
  }

  async function check(demo) {
    try {
      var data = JSON.parse(source.textContent);
      var intro = "Checked just now, in this browser. ";
      if (demo) {
        if (!data.files || data.files.length === 0) {
          throw new Error("this page has no transcripts to change a character in");
        }
        var changed = withFirstCharacterChanged(data);
        data = changed.data;
        intro = "Demonstration, on a copy with one character changed (the first character of " +
          fileLabel(data.runs || [], changed.file) + ", “" + changed.from + "” to “" + changed.to +
          "”); the page itself is unchanged. ";
      }
      var runs = data.runs || [];
      var checked = await checkAll(data, digest, shownText);
      var table = [];
      checked.files.forEach(function (file, index) {
        var recorded = fileRecord(runs, data.files[index]);
        table.push([file.label, recorded ? recorded.sha256 : "none recorded", file.ok]);
      });
      checked.runs.forEach(function (run, index) {
        table.push([runLabel(runs, run.id) + " · its record's seal", runs[index].seal, run.ok]);
      });
      var entries = reviewEntries(data.reviews).length;
      if (checked.reviewProblems.length > 0) {
        checked.reviewProblems.forEach(function (problem) { table.push([problem, "", false]); });
      } else if (entries > 0) {
        table.push(["Review entries (" + entries + "): each seal, and the chain", "", true]);
      }
      var failures = table.filter(function (row) { return !row[2]; }).length;
      result.className = "fp-result " + (failures > 0 ? "bad" : "good");
      result.textContent = intro + checked.line + ".";
      count.textContent = table.length + " checked, " + failures + " not matching";
      rows.textContent = "";
      table.forEach(function (row) { addRow(row[0], row[1], row[2]); });
      list.hidden = false;
    } catch (error) {
      result.className = "fp-result bad";
      var reason = error && error.message ? error.message : String(error);
      result.textContent = "The check couldn't run: " + reason + ".";
    }
  }

  document.querySelectorAll(".fp-noscript").forEach(function (line) { line.hidden = true; });
  runButton.hidden = false;
  demoButton.hidden = false;
  runButton.addEventListener("click", function () { check(false); });
  demoButton.addEventListener("click", function () { check(true); });
})();
`;
