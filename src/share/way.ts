import type { PassName } from "../model.js";
import { HOW_TEXT } from "./text.js";

/**
 * The key a pass presses and what it goes by (HOW_TEXT.ways). The forms pass has no words of its
 * own yet, so it goes by its name.
 */
export function wayOf(pass: PassName): { key: string; words: string } {
  return pass === "forms" ? { key: pass, words: pass } : HOW_TEXT.ways[pass];
}
