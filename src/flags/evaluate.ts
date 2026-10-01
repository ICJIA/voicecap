import type { VoicecapConfig } from "../config/schema.js";
import type { FlagResult, PassName, StepRecord, StopReason } from "../model.js";
import { lineMatches } from "../passes/read.js";
import { normalizeSpeech } from "../passes/steps.js";
import { hashJson } from "../util/hash.js";

export type FlagRules = VoicecapConfig["flags"];

/** The parts of a pass the rules look at. TranscriptJson and PassResult both fit. */
export interface PassData {
  steps: StepRecord[];
  stopReason: StopReason;
}

export type PagePasses = Partial<Record<PassName, PassData>>;

/** Identifies the rules flags were computed with, so reports know when to recompute them. */
export function flagRulesSha256(rules: FlagRules): string {
  return hashJson(rules);
}

/**
 * Heuristic flags for human attention. They never fail a page. The phrasing they match assumes
 * NVDA's English interface and lives in config.
 */
export function evaluateFlags(passes: PagePasses, rules: FlagRules): FlagResult[] {
  const flags: FlagResult[] = [];
  const contextItems = rules.unlabeled.contextItems.map((source) => new RegExp(source, "i"));
  const stateItems = new Set(rules.unlabeled.stateItems.map(lower));

  if (rules.genericLinkText.enabled) {
    flags.push(...genericLinkText(passes, rules.genericLinkText, contextItems, stateItems));
  }
  if (rules.unlabeled.enabled) {
    flags.push(...unlabeled(passes, rules.unlabeled, contextItems, stateItems));
  }
  if (rules.readNotFinished.enabled && passes.read) {
    const { stopReason, steps } = passes.read;
    if (stopReason === "step-cap") {
      flags.push({
        rule: "read-not-finished",
        pass: "read",
        message: `The read pass stopped at its step cap (${steps.length} steps) instead of reaching the end of the page.`,
      });
    } else if (stopReason === "repeat-limit") {
      flags.push({
        rule: "read-not-finished",
        pass: "read",
        message:
          "The read pass was stopped by the repeat safety net instead of reaching the end of the page.",
      });
    }
  }
  if (rules.headings.enabled && passes.headings) {
    const flag = headings(passes.headings, new RegExp(rules.headings.levelPattern, "i"));
    if (flag) flags.push(flag);
  }
  if (passes.tab) {
    const stops = passes.tab.steps.filter((step) => step.inDocument !== false);
    if (rules.tabNoStops.enabled && stops.length === 0) {
      flags.push({
        rule: "tab-no-stops",
        pass: "tab",
        message: "Tab reached no focusable elements on the page.",
      });
    }
    if (rules.tabBeforeMain.enabled && stops.length > 0) {
      const flag = tabBeforeMain(stops, rules.tabBeforeMain);
      if (flag) flags.push(flag);
    }
  }
  if (rules.repeatedPhrase.enabled) {
    flags.push(...repeatedPhrase(passes, rules.repeatedPhrase.minRun));
  }
  for (const rule of rules.custom) {
    const pattern = new RegExp(rule.pattern, "i");
    for (const pass of rule.passes) {
      const data = passes[pass];
      if (!data) continue;
      const count = contentSteps(pass, data).filter((step) => pattern.test(step.spoken)).length;
      if (count >= rule.minCount) {
        flags.push({
          rule: rule.id,
          pass,
          count,
          message: `${rule.description} (${plural(count, "match", "matches")} in the ${pass} pass).`,
        });
      }
    }
  }
  return flags;
}

/**
 * The steps that carry page content: without the read pass's Ctrl+End (it repeats the last line)
 * and its end-of-page repeats, the final "no next heading", or the step where focus left the page.
 */
export function contentSteps(pass: PassName, data: PassData): StepRecord[] {
  if (pass === "read") {
    const steps = data.steps.filter((step) => step.command !== "toBottom");
    if (data.stopReason !== "end-reached" || steps.length === 0) return steps;
    const final = normalizeSpeech(steps.at(-1)!.spoken);
    let end = steps.length;
    while (end > 0 && normalizeSpeech(steps[end - 1]!.spoken) === final) end--;
    const kept = steps.slice(0, end);
    // Keep the last line once, unless the step before the repeats already spoke it with context.
    const before = kept.at(-1);
    if (!before || !lineMatches(before.spoken, final)) kept.push(steps[end]!);
    return kept;
  }
  if (pass === "headings") {
    return data.stopReason === "no-next-heading" ? data.steps.slice(0, -1) : data.steps;
  }
  return data.steps.filter((step) => step.inDocument !== false);
}

/**
 * Speech split into items (", " within an utterance, ". " between utterances), lowercased: what the
 * rules look at, and what `FlagResult.found` lists.
 */
export function items(speech: string): string[] {
  return normalizeSpeech(speech)
    .split(/, |\. /)
    .map((item) => lower(item).replace(/[.,]$/, ""))
    .filter((item) => item !== "");
}

function withoutLeadingContext(list: string[], contextItems: RegExp[]): string[] {
  let start = 0;
  while (start < list.length && contextItems.some((pattern) => pattern.test(list[start]!))) start++;
  return list.slice(start);
}

function genericLinkText(
  passes: PagePasses,
  rule: FlagRules["genericLinkText"],
  contextItems: RegExp[],
  stateItems: Set<string>,
): FlagResult[] {
  const phrases = new Set(rule.phrases.map(lower));
  const roles = new Set(rule.linkRoles.map(lower));
  const flags: FlagResult[] = [];
  for (const pass of rule.passes) {
    const data = passes[pass];
    if (!data) continue;
    const found = new Map<string, number>();
    for (const step of contentSteps(pass, data)) {
      const list = items(step.spoken);
      let label: string | null = null;
      for (let i = 0; i < list.length; i++) {
        if (!roles.has(list[i]!)) continue;
        const after = list[i + 1];
        const before = list[i - 1];
        if (after !== undefined && phrases.has(after))
          label = after; // browse: "link, Read more"
        else if (before !== undefined && phrases.has(before)) label = before; // focus: "Read more, link"
        if (label) break;
      }
      if (!label && rule.countNameless) {
        const rest = withoutLeadingContext(list, contextItems).filter(
          (item) => !stateItems.has(item),
        );
        if (rest.length === 1 && roles.has(rest[0]!)) label = "(no name)";
      }
      if (label) found.set(label, (found.get(label) ?? 0) + 1);
    }
    const count = [...found.values()].reduce((sum, n) => sum + n, 0);
    if (count >= rule.minCount) {
      const ranked = rankFound(found);
      flags.push({
        rule: "generic-link-text",
        pass,
        count,
        found: ranked,
        message: `Generic link text announced ${plural(count, "time", "times")} in the ${pass} pass: ${summarize(ranked)}.`,
      });
    }
  }
  return flags;
}

function unlabeled(
  passes: PagePasses,
  rule: FlagRules["unlabeled"],
  contextItems: RegExp[],
  stateItems: Set<string>,
): FlagResult[] {
  const roles = new Set(rule.roles.map(lower));
  const tabOnly = new Set(rule.tabOnlyRoles.map(lower));
  const browseRoles = new Set([...roles].filter((role) => !tabOnly.has(role)));
  const phrases = rule.phrases.map(lower);
  const flags: FlagResult[] = [];
  for (const pass of rule.passes) {
    const data = passes[pass];
    if (!data) continue;
    const found = new Map<string, number>();
    for (const step of contentSteps(pass, data)) {
      const list = items(step.spoken);
      const phrase = list.find((item) => phrases.some((p) => item.includes(p)));
      const rest = withoutLeadingContext(list, contextItems);
      let label: string | null = phrase ?? null;
      if (!label && pass === "tab") {
        // Focus speech puts the name first, so a leading role means the control has no name.
        if (rest[0] !== undefined && roles.has(rest[0])) label = rest[0];
      } else if (!label) {
        // Browse speech: flag a line that is nothing but a role (and states), unless it's a role
        // whose label NVDA reads as separate text (tabOnlyRoles).
        const meaningful = rest.filter((item) => !stateItems.has(item));
        if (meaningful.length === 1 && browseRoles.has(meaningful[0]!)) label = meaningful[0]!;
      }
      if (label) found.set(label, (found.get(label) ?? 0) + 1);
    }
    const count = [...found.values()].reduce((sum, n) => sum + n, 0);
    if (count > 0) {
      const ranked = rankFound(found);
      flags.push({
        rule: "unlabeled",
        pass,
        count,
        found: ranked,
        message: `Unlabeled or poorly labeled items in the ${pass} pass: ${summarize(ranked)}.`,
      });
    }
  }
  return flags;
}

function headings(data: PassData, levelPattern: RegExp): FlagResult | null {
  const found = contentSteps("headings", data);
  if (found.length === 0) {
    return { rule: "headings", pass: "headings", message: "The page has no headings." };
  }
  const level = levelPattern.exec(normalizeSpeech(found[0]!.spoken))?.[1];
  if (level !== undefined && level !== "1") {
    return {
      rule: "headings",
      pass: "headings",
      message: `The first heading is level ${level}, not level 1.`,
    };
  }
  return null;
}

function tabBeforeMain(stops: StepRecord[], rule: FlagRules["tabBeforeMain"]): FlagResult | null {
  const firstInMain = stops.findIndex((step) => step.focused?.inMain === true);
  const before = firstInMain === -1 ? stops.length : firstInMain;
  const first = stops[0]?.focused;
  const skipName = new RegExp(rule.skipLinkName, "i");
  const firstIsSkipLink =
    first !== undefined &&
    first !== null &&
    ((first.href?.startsWith("#") ?? false) || skipName.test(first.name));
  if (before < rule.maxStops || firstIsSkipLink) return null;
  const where =
    firstInMain === -1
      ? `${plural(before, "focus stop", "focus stops")}, and focus never reached the main landmark`
      : `${plural(before, "focus stop", "focus stops")} before main content`;
  return {
    rule: "tab-before-main",
    pass: "tab",
    count: before,
    message: `${where}, and the first stop isn't a skip link (possible missing skip link).`,
  };
}

function repeatedPhrase(passes: PagePasses, minRun: number): FlagResult[] {
  const flags: FlagResult[] = [];
  for (const pass of ["read", "headings", "tab"] as const) {
    const data = passes[pass];
    if (!data) continue;
    let best = { phrase: "", run: 0 };
    let run = 0;
    let prev: string | null = null;
    for (const step of contentSteps(pass, data)) {
      const speech = normalizeSpeech(step.spoken);
      run = speech === prev ? run + 1 : 1;
      prev = speech;
      if (run > best.run) best = { phrase: speech, run };
    }
    if (best.run >= minRun) {
      flags.push({
        rule: "repeated-phrase",
        pass,
        count: best.run,
        message: `"${best.phrase || "(silence)"}" repeated ${best.run} times in a row in the ${pass} pass (possible focus trap or duplicated content).`,
      });
    }
  }
  return flags;
}

/** What a rule found, most often first, and alphabetical among those found as often. */
function rankFound(found: Map<string, number>): { text: string; count: number }[] {
  return [...found.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([text, count]) => ({ text, count }));
}

function summarize(found: { text: string; count: number }[]): string {
  return found.map(({ text, count }) => `"${text}" ×${count}`).join(", ");
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function lower(text: string): string {
  return text.toLowerCase();
}
