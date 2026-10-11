/**
 * Made-up passes with NVDA's own log, from a seed, for the check of NVDA's log (checkAgainstLog):
 * a timing model of voicecap's capture and of NVDA, with what can go wrong in it, and what the
 * check should list for each pass. voicecap's capture presses a step's key once NVDA is quiet; a
 * step lasts until NVDA has been quiet for a while after its words. What can go wrong:
 * - `late`: NVDA took a step's key late, after the capture had stopped listening, so the step's line
 *   is empty, and the key and NVDA's words come in a later step's time;
 * - `late2`: two steps in a row, each so;
 * - `pile2`, `pile3`, `pile4`: NVDA stalled, the capture heard nothing for the first steps, and NVDA
 *   then took their keys and the last step's together, 5 ms apart, saying only the last one's words;
 * - `missing`: NVDA logged no key for a step, nor words (`missingSaid`: but its words);
 * - `doubled`: NVDA logged a step's key twice, 30 ms apart;
 * - `stray`: a key no step pressed, of the pass's own kind, somewhere in the pass's time;
 * - `diff`: NVDA's log has other words for a step than its line;
 * - `busyStart`: NVDA was still talking as a step began, so its key came seconds into it.
 */
import type { StepRecord } from "../../src/model.js";
import type { LogCheck, PassSteps } from "../../src/share/log-check.js";

export type Anomaly =
  | "late"
  | "late2"
  | "pile2"
  | "pile3"
  | "pile4"
  | "missing"
  | "missingSaid"
  | "stray"
  | "doubled"
  | "diff"
  | "busyStart";

/** The kind of pass, by the command its steps press, and the key NVDA logs for it. */
const KINDS = {
  read: {
    command: "nextLine",
    gesture: "downArrow",
    words: (n: number) => `Line ${n} of the page`,
  },
  headings: {
    command: "nextHeading",
    gesture: "h",
    words: (n: number) => `Heading ${n}, heading, level 2`,
  },
  tab: { command: "nextFocusable", gesture: "tab", words: (n: number) => `Item ${n}, link` },
} as const;

type Kind = keyof typeof KINDS;

/** What a step was, in truth: whether NVDA logged its key, what it said after it, and its line. */
interface Truth {
  logWords: string;
  spoken: string;
}

/** A made-up pass: its copy of NVDA's log, its steps, and what each step truly was. */
export interface MadeUp {
  log: string;
  pass: PassSteps;
  truth: Truth[];
}

/** A seeded random number from 0 to 1 (mulberry32). */
function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");
/** "HH:MM:SS.mmm" for milliseconds since midnight. */
const clockOf = (ms: number) =>
  `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
const isoOf = (ms: number) => `2026-10-10T${clockOf(ms)}-05:00`;

/** A pass made up from `seed`, with what `anomalies` names gone wrong in it, of `kind` if given. */
export function madeUpPass(seed: number, anomalies: readonly Anomaly[], kind?: Kind): MadeUp {
  const random = randomFrom(seed);
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
  const between = (low: number, high: number) => Math.round(low + random() * (high - low));
  const pass: Kind = kind ?? pick(["read", "headings", "tab"] as const);
  const { command, gesture, words } = KINDS[pass];
  const count = between(6, 20);
  const T0 = 8 * 3_600_000;
  const begin = T0 + 2300;
  const plan = Array.from({ length: count }, () => ({
    base: random() < 0.15 ? between(1800, 4200) : between(1276, 1290),
    wait: random() < 0.1 ? between(250, 400) : 0,
    late: 0,
    pile: 0,
    missing: false,
    missingSaid: false,
    doubled: false,
    diff: false,
    busyStart: 0,
  }));
  // A Tab pass's first Tab has no key in NVDA's log: it goes to the browser.
  const low = pass === "tab" ? 1 : 0;
  const taken = new Set<number>();
  const slot = (span = 1) => {
    for (let tries = 0; tries < 50; tries += 1) {
      const k = between(low + 1, count - 1 - span);
      let free = k >= low;
      for (let j = k - 1; j <= k + span; j += 1) if (taken.has(j)) free = false;
      if (free) {
        for (let j = k; j < k + span; j += 1) taken.add(j);
        return k;
      }
    }
    return -1;
  };
  const strays: number[] = [];
  for (const anomaly of anomalies) {
    if (anomaly === "late") {
      const k = slot();
      if (k >= 0) plan[k]!.late = between(500, 2200);
    } else if (anomaly === "late2") {
      const k = slot(2);
      if (k >= 0) {
        plan[k]!.late = between(900, 2200);
        plan[k + 1]!.late = between(900, 2200);
      }
    } else if (anomaly.startsWith("pile")) {
      const m = Number(anomaly.slice(4));
      const k = slot(m);
      if (k >= 0) for (let j = 0; j < m; j += 1) plan[k + j]!.pile = m - j;
    } else if (anomaly === "missing" || anomaly === "missingSaid") {
      const k = slot();
      if (k >= 0) {
        plan[k]!.missing = true;
        plan[k]!.missingSaid = anomaly === "missingSaid";
      }
    } else if (anomaly === "doubled") {
      const k = slot();
      if (k >= 0) plan[k]!.doubled = true;
    } else if (anomaly === "diff") {
      const k = slot();
      if (k >= 0) plan[k]!.diff = true;
    } else if (anomaly === "busyStart") {
      const k = slot();
      if (k >= 0) plan[k]!.busyStart = between(1000, 2300);
    } else {
      strays.push(random());
    }
  }

  const events: { at: number; key: boolean; text: string }[] = [
    { at: T0, key: true, text: "NVDA+t" },
    { at: T0 + 3, key: false, text: "Example - Browser" },
    { at: T0 + 1000, key: true, text: "escape" },
    { at: T0 + 1260, key: true, text: "control+home" },
    { at: T0 + 1263, key: false, text: "Top of the page" },
  ];
  const truth: Truth[] = [];
  const steps: StepRecord[] = [];
  let elapsed = 0;
  let lastKey = -Infinity;
  let quietAt = -Infinity;
  const piled: number[] = [];
  plan.forEach((step, k) => {
    const start = begin + elapsed;
    const text = words(k + 1);
    // The capture presses once NVDA has been quiet a while, or after its usual quarter second.
    const pressed = Math.max(start + 270 + step.wait + step.busyStart, quietAt + 300);
    const waited = pressed - start - 270;
    let duration = step.base + waited;
    let spoken = text;
    let logWords = step.diff ? text.replace(/^(\w+) (\d+)/, "$1 $2 changed") : text;
    if (step.late > 0) {
      // NVDA took the key late, after the capture had stopped listening: the line is empty.
      spoken = "";
      duration = (random() < 0.5 ? 1971 : step.base) + waited;
      const at = Math.max(pressed + step.late, lastKey + 5);
      events.push({ at, key: true, text: gesture }, { at: at + 40, key: false, text: logWords });
      lastKey = at;
      quietAt = at + 640;
    } else if (step.pile > 0) {
      piled.push(k);
      if (step.pile > 1) {
        spoken = "";
        logWords = "";
        duration = 1971 + waited;
      } else {
        let at = Math.max(pressed + between(100, 1500), lastKey + 5);
        for (let n = 0; n < piled.length; n += 1) {
          events.push({ at, key: true, text: gesture });
          lastKey = at;
          at += 5;
        }
        const said = lastKey + 40;
        events.push({ at: said, key: false, text: logWords });
        quietAt = said + 600;
        // Heard when said while the capture still listened (about 1.5 s after the press).
        if (said - pressed > 1500) {
          spoken = "";
          duration = Math.max(1971, said - start + 50);
        } else {
          duration = Math.max(step.base + waited, said - start + 1000);
        }
        piled.length = 0;
      }
    } else {
      const at = Math.max(pressed, lastKey + 5);
      const keyed = !(pass === "tab" && k === 0) && !step.missing;
      if (keyed) {
        events.push({ at, key: true, text: gesture });
        lastKey = at;
        if (step.doubled) {
          events.push({ at: at + 30, key: true, text: gesture });
          lastKey = at + 30;
        }
      }
      if (!step.missing || step.missingSaid) {
        const said = (step.doubled ? at + 30 : at) + 40;
        events.push({ at: said, key: false, text: logWords });
        quietAt = said + 200;
      } else {
        logWords = "";
      }
    }
    elapsed += duration;
    truth.push({ logWords, spoken });
    steps.push({ n: k + 1, command, spoken, durationMs: duration, offsetMs: elapsed });
  });
  // A stray: a key of the pass's own kind, 100 ms or more from any other key, anywhere from 2 s
  // before the first step to 2 s after the last.
  strays.forEach((fraction, n) => {
    const [from, to] = [begin - 2000, begin + elapsed + 2000];
    for (let tries = 0; tries < 100; tries += 1) {
      const at = Math.round(from + ((fraction + tries * 0.137) % 1) * (to - from));
      if (at < T0 + 1400) continue;
      if (events.some((event) => event.key && Math.abs(event.at - at) < 100)) continue;
      events.push(
        { at, key: true, text: gesture },
        { at: at + 40, key: false, text: `Stray ${n + 1} said` },
      );
      break;
    }
  });
  events.sort((a, b) => a.at - b.at);
  const lines = ["# NVDA's own log of one NVDA session in this run."];
  for (const event of events) {
    if (event.key) {
      lines.push(
        `IO - inputCore.InputManager.executeGesture (${clockOf(event.at)}) - winInputHook (1):`,
        `Input: kb(desktop):${event.text}`,
      );
    } else {
      const items = event.text.split(", ").map((item) => `'${item}'`);
      lines.push(
        `IO - speech.speech.speak (${clockOf(event.at)}) - MainThread (2):`,
        `Speaking [LangChangeCommand ('en_US'), ${items.join(", ")}]`,
      );
    }
  }
  lines.push("");
  const within = { from: isoOf(T0 - 60_000), to: isoOf(begin + elapsed + 6000) };
  const page = "https://example.org/";
  return { log: lines.join("\n"), pass: { page, pass, steps, within }, truth };
}

/**
 * What a check made of a made-up pass, against what each step truly was:
 * - `right`: it lists every line that differs, and no other;
 * - `not checked`: the pass wasn't checked (no line of it in the check);
 * - `hidden`: it leaves out a line that differs (a real gap or difference not shown);
 * - `off`: it lists a step with another step's words (one step off);
 * - `listed`: it lists a line that doesn't differ, and hides nothing (the safe direction).
 */
export function verdictOf(check: LogCheck, truth: readonly Truth[]): string {
  if (check.transcriptLines === 0) return "not checked";
  const inLog = new Set(check.onlyInLog.map((line) => `${line.step}:${line.text}`));
  const inTranscripts = new Set(check.onlyInTranscripts.map((line) => `${line.step}:${line.text}`));
  let hidden = false;
  let extra = inLog.size + inTranscripts.size;
  truth.forEach(({ logWords, spoken }, k) => {
    if (logWords.trim() === spoken.trim()) return;
    if (logWords !== "") {
      if (inLog.has(`${k + 1}:${logWords}`)) extra -= 1;
      else hidden = true;
    }
    if (spoken !== "") {
      if (inTranscripts.has(`${k + 1}:${spoken}`)) extra -= 1;
      else hidden = true;
    }
  });
  const off = check.onlyInLog.some((line) =>
    truth.some(
      (step, k) => k + 1 !== line.step && step.logWords !== "" && step.logWords === line.text,
    ),
  );
  if (hidden) return "hidden";
  if (off) return "off";
  return extra > 0 ? "listed" : "right";
}
