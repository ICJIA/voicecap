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
  const context = speechContext(rules);

  if (rules.genericLinkText.enabled) {
    flags.push(...genericLinkText(passes, rules.genericLinkText, context));
  }
  if (rules.unlabeled.enabled) {
    flags.push(...unlabeled(passes, rules.unlabeled, context));
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
    const stops = contentSteps("tab", passes.tab);
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
    for (const pass of rule.passes) {
      const data = passes[pass];
      if (!data) continue;
      const count = customMatches(rule, contentSteps(pass, data)).length;
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

/** The most lines `flagQuotes` gives for a flag. */
const QUOTED = 3;

/**
 * Up to 3 lines NVDA spoke that raised `flag`, each once, in the order spoken: the steps of its pass
 * that its rule, with `rules`, matched, found by the rule's own matching over the steps it looks at
 * (contentSteps).
 * - generic-link-text and unlabeled: the lines where they found a link or an item, a link with no
 *   name included;
 * - headings: the first heading, for a page whose first heading isn't level 1;
 * - tab-before-main: the stops before the main content;
 * - repeated-phrase: the line repeated;
 * - read-not-finished: the last line read;
 * - a custom rule: the lines its pattern matched.
 *
 * None for a page with no headings, for Tab reaching nothing, for a pass not in `passes`, and for a
 * rule `rules` doesn't have.
 */
export function flagQuotes(passes: PagePasses, rules: FlagRules, flag: FlagResult): string[] {
  const { pass } = flag;
  const data = pass === undefined ? undefined : passes[pass];
  if (pass === undefined || data === undefined) return [];
  const steps = contentSteps(pass, data);
  switch (flag.rule) {
    case "generic-link-text": {
      const linkOf = genericLinkMatcher(rules.genericLinkText, speechContext(rules));
      return quoted(steps.filter((step) => linkOf(step.spoken) !== null));
    }
    case "unlabeled": {
      const itemOf = unlabeledMatcher(rules.unlabeled, speechContext(rules));
      return quoted(steps.filter((step) => itemOf(step.spoken, pass) !== null));
    }
    case "headings":
      // The rule reads the first heading's level; with none, the page has no headings to quote.
      return quoted(steps.slice(0, 1));
    case "tab-before-main":
      return quoted(stopsBeforeMain(steps).before);
    case "repeated-phrase": {
      const { phrase } = longestRepeat(steps);
      return phrase === "" ? [] : [phrase];
    }
    case "read-not-finished":
      return quoted(steps.slice(-1));
    case "tab-no-stops":
      return [];
    default: {
      const rule = rules.custom.find((custom) => custom.id === flag.rule);
      return rule === undefined ? [] : quoted(customMatches(rule, steps));
    }
  }
}

/** Steps' speech, each on one line and each line once, at most `QUOTED`; silence isn't a line. */
function quoted(steps: StepRecord[]): string[] {
  const lines: string[] = [];
  for (const step of steps) {
    const line = normalizeSpeech(step.spoken);
    if (line !== "" && !lines.includes(line)) lines.push(line);
    if (lines.length === QUOTED) break;
  }
  return lines;
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

/** Speech split into items (", " within an utterance, ". " between utterances), lowercased. */
function items(speech: string): string[] {
  return normalizeSpeech(speech)
    .split(/, |\. /)
    .map((item) => lower(item).replace(/[.,]$/, ""))
    .filter((item) => item !== "");
}

/** What NVDA says around a control without naming it: context before it, and its states. */
interface SpeechContext {
  /** Landmarks, lists, and the like, spoken before a control. */
  contextItems: RegExp[];
  /** State words, which aren't a name. */
  stateItems: Set<string>;
}

function speechContext(rules: FlagRules): SpeechContext {
  return {
    contextItems: rules.unlabeled.contextItems.map((source) => new RegExp(source, "i")),
    stateItems: new Set(rules.unlabeled.stateItems.map(lower)),
  };
}

function withoutLeadingContext(list: string[], contextItems: RegExp[]): string[] {
  let start = 0;
  while (start < list.length && contextItems.some((pattern) => pattern.test(list[start]!))) start++;
  return list.slice(start);
}

/**
 * The generic link a step announces, as the genericLinkText rule hears it: the link's text ("read
 * more"), "(no name)" for a link announced with no name at all when the rule counts those, or null.
 */
function genericLinkMatcher(
  rule: FlagRules["genericLinkText"],
  context: SpeechContext,
): (speech: string) => string | null {
  const phrases = new Set(rule.phrases.map(lower));
  const roles = new Set(rule.linkRoles.map(lower));
  return (speech) => {
    const list = items(speech);
    for (let i = 0; i < list.length; i++) {
      if (!roles.has(list[i]!)) continue;
      const after = list[i + 1];
      const before = list[i - 1];
      if (after !== undefined && phrases.has(after)) return after; // browse: "link, Read more"
      if (before !== undefined && phrases.has(before)) return before; // focus: "Read more, link"
    }
    if (rule.countNameless) {
      const rest = withoutLeadingContext(list, context.contextItems).filter(
        (item) => !context.stateItems.has(item),
      );
      if (rest.length === 1 && roles.has(rest[0]!)) return "(no name)";
    }
    return null;
  };
}

/**
 * The unlabeled or poorly labeled item a step announces in a pass, as the unlabeled rule hears it:
 * an item NVDA calls unlabeled, or a role with no name ("button"), or null.
 */
function unlabeledMatcher(
  rule: FlagRules["unlabeled"],
  context: SpeechContext,
): (speech: string, pass: PassName) => string | null {
  const roles = new Set(rule.roles.map(lower));
  const tabOnly = new Set(rule.tabOnlyRoles.map(lower));
  const browseRoles = new Set([...roles].filter((role) => !tabOnly.has(role)));
  const phrases = rule.phrases.map(lower);
  return (speech, pass) => {
    const list = items(speech);
    const phrase = list.find((item) => phrases.some((p) => item.includes(p)));
    if (phrase !== undefined) return phrase;
    const rest = withoutLeadingContext(list, context.contextItems);
    if (pass === "tab") {
      // Focus speech puts the name first, so a leading role means the control has no name.
      return rest[0] !== undefined && roles.has(rest[0]) ? rest[0] : null;
    }
    // Browse speech: flag a line that is nothing but a role (and states), unless it's a role whose
    // label NVDA reads as separate text (tabOnlyRoles).
    const meaningful = rest.filter((item) => !context.stateItems.has(item));
    return meaningful.length === 1 && browseRoles.has(meaningful[0]!) ? meaningful[0]! : null;
  };
}

function genericLinkText(
  passes: PagePasses,
  rule: FlagRules["genericLinkText"],
  context: SpeechContext,
): FlagResult[] {
  const linkOf = genericLinkMatcher(rule, context);
  const flags: FlagResult[] = [];
  for (const pass of rule.passes) {
    const data = passes[pass];
    if (!data) continue;
    const found = new Map<string, number>();
    for (const step of contentSteps(pass, data)) {
      const label = linkOf(step.spoken);
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
  context: SpeechContext,
): FlagResult[] {
  const itemOf = unlabeledMatcher(rule, context);
  const flags: FlagResult[] = [];
  for (const pass of rule.passes) {
    const data = passes[pass];
    if (!data) continue;
    const found = new Map<string, number>();
    for (const step of contentSteps(pass, data)) {
      const label = itemOf(step.spoken, pass);
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
  const first = contentSteps("headings", data)[0];
  if (first === undefined) {
    return { rule: "headings", pass: "headings", message: "The page has no headings." };
  }
  const level = levelPattern.exec(normalizeSpeech(first.spoken))?.[1];
  if (level !== undefined && level !== "1") {
    return {
      rule: "headings",
      pass: "headings",
      message: `The first heading is level ${level}, not level 1.`,
    };
  }
  return null;
}

/** The Tab stops before focus first reached the main landmark: every stop, when it never did. */
function stopsBeforeMain(stops: StepRecord[]): { before: StepRecord[]; reachedMain: boolean } {
  const firstInMain = stops.findIndex((step) => step.focused?.inMain === true);
  return firstInMain === -1
    ? { before: stops, reachedMain: false }
    : { before: stops.slice(0, firstInMain), reachedMain: true };
}

function tabBeforeMain(stops: StepRecord[], rule: FlagRules["tabBeforeMain"]): FlagResult | null {
  const { before, reachedMain } = stopsBeforeMain(stops);
  const first = stops[0]?.focused;
  const skipName = new RegExp(rule.skipLinkName, "i");
  const firstIsSkipLink =
    first !== undefined &&
    first !== null &&
    ((first.href?.startsWith("#") ?? false) || skipName.test(first.name));
  if (before.length < rule.maxStops || firstIsSkipLink) return null;
  const where = reachedMain
    ? `${plural(before.length, "focus stop", "focus stops")} before main content`
    : `${plural(before.length, "focus stop", "focus stops")}, and focus never reached the main landmark`;
  return {
    rule: "tab-before-main",
    pass: "tab",
    count: before.length,
    message: `${where}, and the first stop isn't a skip link (possible missing skip link).`,
  };
}

/** The longest run of the same speech in a row among steps, and that speech, on one line. */
function longestRepeat(steps: StepRecord[]): { phrase: string; run: number } {
  let best = { phrase: "", run: 0 };
  let run = 0;
  let prev: string | null = null;
  for (const step of steps) {
    const speech = normalizeSpeech(step.spoken);
    run = speech === prev ? run + 1 : 1;
    prev = speech;
    if (run > best.run) best = { phrase: speech, run };
  }
  return best;
}

function repeatedPhrase(passes: PagePasses, minRun: number): FlagResult[] {
  const flags: FlagResult[] = [];
  for (const pass of ["read", "headings", "tab"] as const) {
    const data = passes[pass];
    if (!data) continue;
    const best = longestRepeat(contentSteps(pass, data));
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

/** The steps whose speech a custom rule's pattern matches. */
function customMatches(rule: FlagRules["custom"][number], steps: StepRecord[]): StepRecord[] {
  const pattern = new RegExp(rule.pattern, "i");
  return steps.filter((step) => pattern.test(step.spoken));
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
