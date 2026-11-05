/**
 * The keys of the forms pass through Guidepup's NVDA, against a fake Guidepup that, like the real
 * one, adds a phrase to its log only for speech it hears while one of its actions is under way.
 */
import type * as GuidepupModule from "@guidepup/guidepup";
import { describe, expect, it } from "vitest";

import { GuidepupNvda } from "../src/drivers/guidepup/nvda.js";

const install = { build: "0.2.1-2026.2", cacheDir: "C:/guidepup", nvdaExe: "nvda.exe" };

/** A fake whose clock moves a second at each reading, so no command looks as if it failed. */
function fake() {
  const log: string[] = [];
  const pressed: string[] = [];
  let listening: string[] | null = null;
  const say = (phrase: string) => listening?.push(phrase);
  const capture = async <T>(action: () => Promise<T>) => {
    const heard: string[] = [];
    listening = heard;
    const result = await action();
    listening = null;
    const spokenPhrase = heard.join(". ");
    log.push(spokenPhrase);
    return { result, spokenPhrase };
  };
  const nvda = {
    version: "0.2.1-2026.2",
    keyboardCommands: {},
    press: async (key: string) => {
      pressed.push(key);
      // The press's own speech comes at once; the page's alert comes after the press has resolved.
      await capture(() => Promise.resolve(void say("Send, button")));
      setTimeout(() => say("Name is required"), 20);
    },
    type: async (text: string) => {
      for (const character of text) await capture(() => Promise.resolve(void say(character)));
    },
    capture,
    lastSpokenPhrase: () => Promise.resolve(log.at(-1) ?? ""),
    spokenPhraseLog: () => Promise.resolve([...log]),
    clearSpokenPhraseLog: () => {
      log.length = 0;
      return Promise.resolve();
    },
  };
  const lib = {
    nvda,
    WindowsKeyCodes: {},
    WindowsModifiers: {},
  } as unknown as typeof GuidepupModule;
  let now = 0;
  return { control: new GuidepupNvda(lib, install, () => (now += 1000)), pressed };
}

describe("a form key through NVDA", () => {
  it("keeps listening through the settle, so an alert that comes after the press is in the speech", async () => {
    const { control, pressed } = fake();
    const spoken = await control.pressFormKey("Enter", { settleMs: 80 });
    expect(pressed).toEqual(["Enter"]);
    expect(spoken).toBe("Send, button. Name is required");
  });

  it("gives only the press's speech when there is no settle", async () => {
    const { control } = fake();
    expect(await control.pressFormKey("Space")).toBe("Send, button");
  });

  it("types a character at a time and gives the echo of each", async () => {
    const { control } = fake();
    expect(await control.typeText("ab")).toBe("a. b");
  });
});
