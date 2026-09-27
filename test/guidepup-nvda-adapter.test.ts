import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { withoutAddedListeners, withoutDeprecationWarnings } from "../src/drivers/guidepup/nvda.js";
import { readGuidepupPackage } from "../src/drivers/guidepup/paths.js";

describe("Guidepup's signal handlers", () => {
  it("are removed after starting NVDA, leaving voicecap's own in place", async () => {
    const voicecaps = () => {};
    const guidepups = () => {};
    process.on("SIGINT", voicecaps);
    try {
      await withoutAddedListeners(["SIGINT", "SIGTERM", "beforeExit"], () => {
        process.on("SIGINT", guidepups);
        process.on("SIGTERM", guidepups);
        process.on("beforeExit", guidepups);
        return Promise.resolve();
      });
      expect(process.listeners("SIGINT")).toContain(voicecaps);
      expect(process.listeners("SIGINT")).not.toContain(guidepups);
      expect(process.listeners("SIGTERM")).not.toContain(guidepups);
      expect(process.listeners("beforeExit")).not.toContain(guidepups);
    } finally {
      process.off("SIGINT", voicecaps);
      process.off("SIGINT", guidepups);
      process.off("SIGTERM", guidepups);
      process.off("beforeExit", guidepups);
    }
  });

  it("are removed even when starting NVDA fails", async () => {
    const guidepups = () => {};
    await expect(
      withoutAddedListeners(["SIGINT"], () => {
        process.on("SIGINT", guidepups);
        return Promise.reject(new Error("NVDA cannot be started"));
      }),
    ).rejects.toThrow("NVDA cannot be started");
    expect(process.listeners("SIGINT")).not.toContain(guidepups);
  });
});

describe("Node's shell-arguments deprecation warning (DEP0190)", () => {
  it("is hidden while Guidepup launches nvda.exe, and only then", async () => {
    const warnings: string[] = [];
    const onWarning = (warning: Error & { code?: string }) => warnings.push(warning.code ?? "");
    process.on("warning", onWarning);
    const before = process.noDeprecation;
    try {
      await withoutDeprecationWarnings(() => {
        process.emitWarning("args are concatenated", "DeprecationWarning", "DEP0190");
        return Promise.resolve();
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(warnings).toEqual([]);
      expect(process.noDeprecation).toBe(before);
    } finally {
      process.off("warning", onWarning);
    }
  });
});

describe("the pinned Guidepup package", () => {
  it("is read from voicecap's own dependencies, with the NVDA build its manifest names", () => {
    const pinned = (
      JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
        dependencies: Record<string, string>;
      }
    ).dependencies["@guidepup/guidepup"];
    const guidepup = readGuidepupPackage();
    expect(guidepup.version).toBe(pinned);
    expect(guidepup.nvdaBuild).toMatch(/^\d+\.\d+\.\d+-\d{4}\.\d+/);
  });
});
