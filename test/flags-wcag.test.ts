/**
 * The WCAG success criteria each of voicecap's built-in flag rules may relate to
 * (src/flags/wcag.ts), and the criteria axe's tags name (`axeCriteriaList`, in
 * src/share/axe-view.ts). Both give criteria as numbers in strings ("2.4.4") for the report for AI
 * tools; neither is a verdict, only a hint for a person to check.
 */
import { describe, expect, it } from "vitest";

import { BUILT_IN_RULES } from "../src/flags/evaluate.js";
import { RULE_WCAG, wcagOf } from "../src/flags/wcag.js";
import { axeCriteria, axeCriteriaList } from "../src/share/axe-view.js";
import { names } from "../src/share/format.js";

/** A criterion as a number: a principle, a guideline, and a success criterion. */
const CRITERION = /^[1-4]\.\d{1,2}\.\d{1,2}$/;

describe("RULE_WCAG", () => {
  it("maps each built-in rule to the criteria it may relate to, as the plan's table has them", () => {
    expect(RULE_WCAG).toEqual({
      "generic-link-text": ["2.4.4"],
      unlabeled: ["1.1.1", "4.1.2"],
      headings: ["1.3.1", "2.4.6"],
      "tab-no-stops": ["2.1.1"],
      "tab-before-main": ["2.4.1"],
      "read-not-finished": [],
      "repeated-phrase": [],
    });
  });

  it("has a key for every built-in rule and for nothing else, in the rules' own order", () => {
    expect(Object.keys(RULE_WCAG)).toEqual([...BUILT_IN_RULES]);
    for (const rule of BUILT_IN_RULES) expect(Object.hasOwn(RULE_WCAG, rule)).toBe(true);
  });

  it("gives each criterion as its number in a string, once for a rule", () => {
    for (const rule of BUILT_IN_RULES) {
      const criteria = RULE_WCAG[rule];

      expect(Array.isArray(criteria)).toBe(true);
      for (const criterion of criteria) expect(criterion).toMatch(CRITERION);
      expect(new Set(criteria).size).toBe(criteria.length);
    }
  });

  it("names no criterion for the two rules that point to none", () => {
    expect(RULE_WCAG["read-not-finished"]).toEqual([]);
    expect(RULE_WCAG["repeated-phrase"]).toEqual([]);
  });

  it("can't be changed by a caller: not the table, and not a rule's list", () => {
    const table = RULE_WCAG as unknown as Record<string, string[]>;

    expect(Object.isFrozen(RULE_WCAG)).toBe(true);
    expect(() => {
      table["headings"] = [];
    }).toThrow(TypeError);
    expect(() => {
      table["extra"] = [];
    }).toThrow(TypeError);
    for (const rule of BUILT_IN_RULES) {
      const criteria = RULE_WCAG[rule] as string[];

      expect(Object.isFrozen(criteria)).toBe(true);
      expect(() => criteria.push("9.9.9")).toThrow(TypeError);
    }
    expect(RULE_WCAG.unlabeled).toEqual(["1.1.1", "4.1.2"]);
  });
});

describe("wcagOf", () => {
  it("gives a built-in rule's criteria, as the table has them", () => {
    for (const rule of BUILT_IN_RULES) expect(wcagOf(rule)).toEqual(RULE_WCAG[rule]);
    expect(wcagOf("generic-link-text")).toEqual(["2.4.4"]);
    expect(wcagOf("unlabeled")).toEqual(["1.1.1", "4.1.2"]);
  });

  it("gives none for a rule the table doesn't have: a custom rule, or one a record names that no longer exists", () => {
    expect(wcagOf("my-own-rule")).toEqual([]);
    expect(wcagOf("")).toEqual([]);
    expect(wcagOf("Headings")).toEqual([]);
    expect(wcagOf("headings ")).toEqual([]);
  });

  it("gives none for a name every object has, which a rule's id may be: a custom rule's id is its own word", () => {
    for (const name of [
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "isPrototypeOf",
      "__proto__",
      "__defineGetter__",
      "prototype",
    ]) {
      expect(wcagOf(name)).toEqual([]);
    }
  });
});

describe("axeCriteriaList", () => {
  it("gives the success criteria axe's tags name, as numbers in strings, leaving the rest", () => {
    expect(axeCriteriaList(["wcag2a", "wcag111", "wcag412", "best-practice"])).toEqual([
      "1.1.1",
      "4.1.2",
    ]);
    expect(axeCriteriaList(["cat.color", "wcag2aa", "wcag143", "ACT", "TTv5"])).toEqual(["1.4.3"]);
    // A criterion with two digits in its last place: 1.4.10 and 2.4.11 are not 1.4.1 and 2.4.1.
    expect(axeCriteriaList(["cat.color", "wcag21aa", "wcag1410"])).toEqual(["1.4.10"]);
    expect(axeCriteriaList(["cat.keyboard", "wcag22aa", "wcag2411"])).toEqual(["2.4.11"]);
    expect(axeCriteriaList(["cat.sensory", "wcag22aa", "wcag258"])).toEqual(["2.5.8"]);
  });

  it("gives none for a rule that names no criterion: a best practice, a level alone, other tags", () => {
    expect(axeCriteriaList(["cat.best-practice", "best-practice"])).toEqual([]);
    expect(
      axeCriteriaList(["wcag2a", "wcag2aa", "wcag2aaa", "wcag21a", "wcag21aa", "wcag22aa"]),
    ).toEqual([]);
    expect(axeCriteriaList(["cat.parsing", "TTv5", "section508.22.a"])).toEqual([]);
    expect(axeCriteriaList([])).toEqual([]);
  });

  it("reads only a tag that is a criterion whole, not one that holds one", () => {
    expect(
      axeCriteriaList(["xwcag111", "wcag111x", "WCAG111", "wcag11", "wcag-111", " wcag111"]),
    ).toEqual([]);
  });

  it("keeps the order axe's tags give them in, and names each once", () => {
    expect(axeCriteriaList(["wcag412", "wcag244", "wcag111"])).toEqual(["4.1.2", "2.4.4", "1.1.1"]);
    expect(axeCriteriaList(["wcag111", "wcag412", "wcag111"])).toEqual(["1.1.1", "4.1.2"]);
  });

  it("gives a list of its own each time, and leaves the tags as they were", () => {
    const tags = Object.freeze(["wcag2a", "wcag111"]);
    const first = axeCriteriaList(tags);

    first.push("9.9.9");
    expect(axeCriteriaList(tags)).toEqual(["1.1.1"]);
    expect(tags).toEqual(["wcag2a", "wcag111"]);
  });

  it("names the criteria the card's line names, never others", () => {
    const lists = [
      ["cat.name-role-value", "wcag2a", "wcag244", "wcag412", "section508", "ACT"],
      ["cat.color", "wcag2aa", "wcag143"],
      ["cat.color", "wcag21aa", "wcag1410"],
      ["cat.sensory", "wcag22aa", "wcag258"],
      ["cat.text-alternatives", "wcag2a", "wcag111", "wcag412", "best-practice"],
      ["cat.aria", "best-practice"],
      ["cat.parsing", "TTv5"],
    ];

    for (const tags of lists) {
      const criteria = axeCriteriaList(tags);
      const line = axeCriteria(tags);

      if (criteria.length > 0) expect(line).toContain(names(criteria));
      // Every number in the card's line is one of the list's: the line says the versions and the
      // levels as "2.0 A", which are no criteria of three numbers.
      expect(line.match(/\d\.\d{1,2}\.\d{1,2}/g) ?? []).toEqual(criteria);
    }
  });
});
