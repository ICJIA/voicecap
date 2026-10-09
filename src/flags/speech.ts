/**
 * NVDA's speech, item by item. The flag rules and the cards of what needs attention split what NVDA
 * said the same way (speechItems), and the cards read three things from the items: a graphic's name
 * as NVDA said it (graphicName), the link or button an item sits in (insideOf), and the page part a
 * line names (partOf). Pure. It reads NVDA's English phrasing, and Chrome's English hint after an
 * image whose name Chrome counts as missing.
 */
import { DEFAULT_CONFIG } from "../config/defaults.js";
import { normalizeSpeech } from "../passes/steps.js";
import type { FlagRules } from "./evaluate.js";

/** What a caller may know of a line beside its words. */
export interface LineOptions {
  /**
   * The item the unlabeled rule matched on the line (ItemLine.item): the graphic's own item. Without
   * it, the graphic is the first item the rule calls unlabeled that's a graphic, else "graphic".
   */
  item?: string;
  /** The rules whose states, links' roles, and phrases apply: the default config's when not given. */
  rules?: FlagRules;
}

/**
 * Chrome's hint after an image it counts as having no name, in English: "To get missing image
 * descriptions, open the context menu." It follows the image's name, when it has one.
 */
const HINT = "to get missing image descriptions";

/** The hint's second item. */
const CONTEXT_MENU = "open the context menu";

/** Where a link goes, as NVDA says it beside the link: never a name, nor a link's own words. */
const LINK_PLACES = new Set(["same page", "current page", "visited"]);

/** The page parts NVDA names, by the landmark it says. */
const PARTS = new Map([
  ["banner landmark", "header"],
  ["main landmark", "main content"],
  ["navigation landmark", "navigation"],
  ["content info landmark", "footer"],
  ["complementary landmark", "sidebar"],
  ["search landmark", "search"],
]);

/**
 * NVDA's speech as items: on one line (normalizeSpeech), split at ", " (within an utterance) and
 * ". " (between utterances), each without a final "." or ",", in its own capitals, and with no empty
 * item. The flag rules split speech this way too, then lowercase it.
 */
export function speechItems(spoken: string): string[] {
  return normalizeSpeech(spoken)
    .split(/, |\. /)
    .map((item) => item.replace(/[.,]$/, ""))
    .filter((item) => item !== "");
}

/**
 * The name NVDA said for a graphic, as it said it, or null when it said none. Its items
 * (speechItems) are compared lowercased, and the graphic is its own item (see LineOptions.item),
 * never a link's words that happen to say "graphic".
 * - Chrome puts its hint right after the name of an image whose name it counts as missing. When the
 *   hint is there, the item before it is the name ("…, Unlabeled graphic, i 2i Logo. To get missing
 *   image descriptions, …", and at a Tab stop, "i 2i Logo. To get missing image descriptions, …,
 *   Unlabeled graphic, …"), unless that's the graphic itself or never a name (see neverAName): then
 *   the image has none, and what follows the graphic is a link's own words, not its name.
 * - Without the hint, the item right after the graphic is the name ("Unlabeled graphic, i 2i logo"),
 *   unless it's never a name.
 */
export function graphicName(spoken: string, options: LineOptions = {}): string | null {
  const rules = options.rules ?? DEFAULT_CONFIG.flags;
  const list = speechItems(spoken);
  const said = list.map(lower);
  const graphic = graphicIndex(said, options.item, rules);
  const hint = said.findIndex((item) => item.startsWith(HINT));
  const at = hint === -1 ? (graphic === -1 ? -1 : graphic + 1) : hint - 1;
  const name = said[at];
  return name === undefined || at === graphic || neverAName(name, rules)
    ? null
    : (list[at] ?? null);
}

/**
 * The graphic's own item: the one the unlabeled rule matched (`item`), else the first item the rule
 * calls unlabeled (rules.unlabeled.phrases) that's a graphic, else the role alone, "graphic". -1
 * when there's none.
 */
function graphicIndex(said: string[], item: string | undefined, rules: FlagRules): number {
  const matched = item === undefined ? -1 : said.indexOf(lower(item));
  if (matched !== -1) return matched;
  const phrases = rules.unlabeled.phrases.map(lower);
  const unlabeled = said.findIndex(
    (each) => each.includes("graphic") && phrases.some((phrase) => each.includes(phrase)),
  );
  return unlabeled === -1 ? said.indexOf("graphic") : unlabeled;
}

/**
 * An item NVDA says around a name that is never one: a landmark, a state
 * (rules.unlabeled.stateItems), where a link goes ("same page", "current page", "visited"), a link's
 * role (rules.genericLinkText.linkRoles), or "button".
 */
function neverAName(item: string, rules: FlagRules): boolean {
  const { states, linkRoles } = wordsOf(rules);
  return (
    isLandmark(item) ||
    states.has(item) ||
    LINK_PLACES.has(item) ||
    linkRoles.has(item) ||
    item === "button"
  );
}

/**
 * The link or button an item sits in, from its Tab stop (`spoken`): its other words, as NVDA said
 * them, joined by ", ", and its role. Its other words are the stop's items without its landmarks,
 * its states (rules.unlabeled.stateItems), where a link goes ("same page", "current page",
 * "visited"), the graphic's own item (see LineOptions.item), the item's name (`name`), Chrome's hint,
 * and the role itself. The role is "link" when a link's role (rules.genericLinkText.linkRoles) was
 * among the items, else "button" when "button" was. Null with no such role, or no words left.
 */
export function insideOf(
  spoken: string,
  name: string | null,
  options: LineOptions = {},
): { words: string; role: "link" | "button" } | null {
  const rules = options.rules ?? DEFAULT_CONFIG.flags;
  const { states, linkRoles } = wordsOf(rules);
  const list = speechItems(spoken);
  const said = list.map(lower);
  const graphic = graphicIndex(said, options.item, rules);
  const named =
    name === null ? -1 : said.findIndex((item, i) => i !== graphic && item === lower(name));
  const role = said.some((item) => linkRoles.has(item))
    ? "link"
    : said.includes("button")
      ? "button"
      : null;
  const words = list.filter((_, i) => {
    const item = said[i] ?? "";
    return !(
      i === graphic ||
      i === named ||
      isLandmark(item) ||
      states.has(item) ||
      LINK_PLACES.has(item) ||
      item.startsWith(HINT) ||
      item === CONTEXT_MENU ||
      linkRoles.has(item) ||
      item === "button"
    );
  });
  return role === null || words.length === 0 ? null : { words: words.join(", "), role };
}

/**
 * The page part a line names: its first item that ends in " landmark", as a part ("banner
 * landmark" is the header); null when it names no landmark, or one that's no part here.
 */
export function partOf(spoken: string): string | null {
  const landmark = speechItems(spoken)
    .map(lower)
    .find((item) => item.endsWith(" landmark"));
  return (landmark === undefined ? undefined : PARTS.get(landmark)) ?? null;
}

/** An item NVDA says for a landmark: "banner landmark". */
function isLandmark(item: string): boolean {
  return /(^| )landmark$/.test(item);
}

/** The states, and the roles a link is said with, that `rules` know, lowercased. */
function wordsOf(rules: FlagRules): { states: Set<string>; linkRoles: Set<string> } {
  return {
    states: new Set(rules.unlabeled.stateItems.map(lower)),
    linkRoles: new Set(rules.genericLinkText.linkRoles.map(lower)),
  };
}

function lower(text: string): string {
  return text.toLowerCase();
}
