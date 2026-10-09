/**
 * axe-core's results as `axe.run` gives them, built for a test: what the Guidepup driver hands
 * keptAxeResults. They have the parts voicecap keeps, under axe's own names, and some of what it
 * leaves out (each element's checks, a rule's description, the run's options and time), so a test
 * can see it left out.
 */

export interface RawAxeNode {
  html: string;
  /** Selectors, one for each frame; one into shadow roots is a list of its own (axe's form). */
  target: (string | string[])[];
  failureSummary?: string;
  impact?: string | null;
  any: unknown[];
  all: unknown[];
  none: unknown[];
}

export interface RawAxeRule {
  id: string;
  impact?: string | null;
  tags: string[];
  description: string;
  help: string;
  helpUrl: string;
  nodes: RawAxeNode[];
}

/** An element a rule found, at `selector`. */
export function rawNode(selector: string, parts: Partial<RawAxeNode> = {}): RawAxeNode {
  return {
    any: [
      {
        id: "has-visible-text",
        data: null,
        relatedNodes: [],
        impact: "serious",
        message: "Element does not have text that is visible to screen readers",
      },
    ],
    all: [],
    none: [],
    impact: "serious",
    html: `<a href="/next/" class="${selector.slice(1)}"></a>`,
    target: [selector],
    failureSummary:
      "Fix any of the following:\n  Element does not have text that is visible to screen readers",
    ...parts,
  };
}

/** A rule's result, with one element it found unless `parts` gives others. */
export function rawRule(id: string, parts: Partial<RawAxeRule> = {}): RawAxeRule {
  return {
    id,
    impact: "serious",
    tags: ["cat.name-role-value", "wcag2a", "wcag412"],
    description: `Ensure the ${id} rule holds`,
    help: `The ${id} rule's help`,
    helpUrl: `https://dequeuniversity.com/rules/axe/4.13/${id}?application=axeAPI`,
    nodes: [rawNode(`.${id}`)],
    ...parts,
  };
}

/**
 * axe's results for a page: the rules with violations and those needing review as given, and as
 * many rules passed and not applying as asked for (axe gives at most one element for each, since
 * voicecap asks only for the others in full).
 */
export function rawAxe(
  parts: {
    violations?: RawAxeRule[];
    incomplete?: RawAxeRule[];
    passes?: number;
    inapplicable?: number;
  } = {},
): Record<string, unknown> {
  return {
    testEngine: { name: "axe-core", version: "4.13.0" },
    testRunner: { name: "axe" },
    testEnvironment: {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/153.0.0.0",
      windowWidth: 1280,
      windowHeight: 960,
    },
    timestamp: "2026-10-09T19:05:09.482Z",
    url: "http://127.0.0.1:4747/",
    toolOptions: {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"],
      },
      resultTypes: ["violations", "incomplete"],
      reporter: "v1",
    },
    inapplicable: Array.from({ length: parts.inapplicable ?? 0 }, (_, index) =>
      rawRule(`inapplicable-${index}`, { impact: null, nodes: [] }),
    ),
    passes: Array.from({ length: parts.passes ?? 0 }, (_, index) =>
      rawRule(`passed-${index}`, { impact: null }),
    ),
    incomplete: parts.incomplete ?? [],
    violations: parts.violations ?? [],
  };
}
