import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { guardProgramSearch, systemTool, type SystemTool } from "../src/util/system-tools.js";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const TOOLS: SystemTool[] = ["powershell", "tasklist", "taskkill", "reg", "explorer"];
const WINDOWS_ON_D = { SystemRoot: String.raw`D:\Win` };

describe("systemTool", () => {
  it("gives each program's full path in the Windows folder SystemRoot names", () => {
    expect(systemTool("powershell", WINDOWS_ON_D)).toBe(
      String.raw`D:\Win\System32\WindowsPowerShell\v1.0\powershell.exe`,
    );
    expect(systemTool("tasklist", WINDOWS_ON_D)).toBe(String.raw`D:\Win\System32\tasklist.exe`);
    expect(systemTool("taskkill", WINDOWS_ON_D)).toBe(String.raw`D:\Win\System32\taskkill.exe`);
    expect(systemTool("reg", WINDOWS_ON_D)).toBe(String.raw`D:\Win\System32\reg.exe`);
    // Explorer is in the Windows folder itself, not in System32.
    expect(systemTool("explorer", WINDOWS_ON_D)).toBe(String.raw`D:\Win\explorer.exe`);
  });

  it("takes C:\\Windows when the environment names no Windows folder", () => {
    expect(systemTool("reg", {})).toBe(String.raw`C:\Windows\System32\reg.exe`);
    expect(systemTool("explorer", {})).toBe(String.raw`C:\Windows\explorer.exe`);
  });

  it("takes windir when SystemRoot isn't an absolute path", () => {
    expect(systemTool("reg", { SystemRoot: "Windows", windir: String.raw`E:\W` })).toBe(
      String.raw`E:\W\System32\reg.exe`,
    );
  });

  it("takes SystemRoot over windir when both are absolute", () => {
    expect(systemTool("reg", { SystemRoot: String.raw`D:\Win`, windir: String.raw`E:\W` })).toBe(
      String.raw`D:\Win\System32\reg.exe`,
    );
  });

  it("takes C:\\Windows when neither is an absolute path, as a relative one would be a folder to look in", () => {
    const relative = [
      "",
      "Windows",
      String.raw`..\Windows`,
      ".",
      String.raw`D:Win`, // a folder on drive D: relative to where that drive's current folder is
      undefined,
    ];
    for (const root of relative) {
      for (const dir of relative) {
        expect(systemTool("tasklist", { SystemRoot: root, windir: dir }), `${root} ${dir}`).toBe(
          String.raw`C:\Windows\System32\tasklist.exe`,
        );
      }
    }
  });

  it("writes the path the way Windows does, whatever the slashes and the ending of the folder's", () => {
    expect(systemTool("reg", { SystemRoot: "D:/Win/" })).toBe(String.raw`D:\Win\System32\reg.exe`);
    expect(systemTool("reg", { SystemRoot: String.raw`D:\Win\\` })).toBe(
      String.raw`D:\Win\System32\reg.exe`,
    );
  });

  it("always gives an absolute Windows path to the program's own file, whatever the environment says", () => {
    const environments: (NodeJS.ProcessEnv | undefined)[] = [
      undefined, // the process's own, which has no Windows folder off Windows
      {},
      { SystemRoot: "Windows" },
      { windir: "." },
      { SystemRoot: "", windir: "windows" },
      WINDOWS_ON_D,
    ];
    for (const tool of TOOLS) {
      for (const env of environments) {
        const file = env === undefined ? systemTool(tool) : systemTool(tool, env);
        expect(path.win32.isAbsolute(file), `${tool} ${JSON.stringify(env)}`).toBe(true);
        expect(file.endsWith(`\\${tool}.exe`), file).toBe(true);
      }
    }
  });
});

describe("guardProgramSearch", () => {
  it("sets NoDefaultCurrentDirectoryInExePath to 1, which keeps Windows out of the current folder", () => {
    const env: NodeJS.ProcessEnv = {};
    guardProgramSearch(env);
    expect(env.NoDefaultCurrentDirectoryInExePath).toBe("1");
  });

  it("sets it over another value, and leaves every other variable as it is", () => {
    const env: NodeJS.ProcessEnv = { NoDefaultCurrentDirectoryInExePath: "0", Path: "C:\\bin" };
    guardProgramSearch(env);
    expect(env).toEqual({ NoDefaultCurrentDirectoryInExePath: "1", Path: "C:\\bin" });
  });
});

/**
 * Windows' own programs named in quotes, as a program to start: "tasklist", 'reg.exe', `explorer`.
 * The argument of systemTool, which gives the program's full path, is where a name belongs, so it
 * isn't one.
 */
function bareNames(source: string): string[] {
  return (
    source
      .replace(/\bsystemTool\(\s*(["'`])[a-z]+\1/g, "systemTool(")
      .match(/(["'`])(?:powershell|tasklist|taskkill|reg|explorer)(?:\.exe)?\1/g) ?? []
  );
}

describe("the programs voicecap starts", () => {
  it("finds a program named in quotes of any of the three kinds, and none named inside longer words", () => {
    expect(bareNames(`run("tasklist", ["/NH"])`)).toEqual([`"tasklist"`]);
    expect(bareNames(`spawn('powershell.exe', args)`)).toEqual([`'powershell.exe'`]);
    expect(bareNames("spawnSync(`reg`, args)")).toEqual(["`reg`"]);
    expect(bareNames(`{ file: "explorer.exe", args }`)).toEqual([`"explorer.exe"`]);
    // Neither the label "PowerShell", nor a longer name, nor a command with its options is one.
    expect(
      bareNames(`"taskkill.exe" "PowerShell" "Windows PowerShell" "regedit" "tasklist /FI"`),
    ).toEqual([`"taskkill.exe"`]);
    // A quote that closes with another kind of quote isn't one.
    expect(bareNames(`"reg" 'tasklist"`)).toEqual([`"reg"`]);
  });

  it("takes the name systemTool is given for the way to a full path, and no other", () => {
    expect(bareNames(`run(systemTool("tasklist"), ["/NH"])`)).toEqual([]);
    expect(bareNames(`spawn(systemTool( 'powershell' , env), args)`)).toEqual([]);
    expect(bareNames("spawnSync(systemTool(`reg`), args)")).toEqual([]);
    // The name of the file is not a tool's name, and a name beside the call is still a name.
    expect(bareNames(`systemTool("powershell.exe")`)).toEqual([`"powershell.exe"`]);
    expect(bareNames(`[systemTool("reg"), "reg"]`)).toEqual([`"reg"`]);
  });

  it("starts none of Windows' own by name: only src/util/system-tools.ts names them", () => {
    const named: string[] = [];
    for (const file of readdirSync(SRC, { encoding: "utf8", recursive: true })) {
      if (!file.endsWith(".ts")) continue;
      for (const found of bareNames(readFileSync(path.join(SRC, file), "utf8"))) {
        named.push(`${file.replaceAll("\\", "/")}: ${found}`);
      }
    }
    // The scan reads the file that gives the full paths, which names the programs...
    expect(named.some((entry) => entry.startsWith("util/system-tools.ts: "))).toBe(true);
    // ...and no other file does.
    expect(named.filter((entry) => !entry.startsWith("util/system-tools.ts: "))).toEqual([]);
  });
});

// For a program started by name, Windows looks in the folder it is started in before anywhere else,
// unless the process was told not to. So a repository that holds a file named powershell.exe would
// have voicecap, run from it, start that. Checked with a stand-in for tasklist.exe in such a folder,
// and the real tasklist, which Windows has in System32.
describe.runIf(process.platform === "win32")("the program search, on Windows", () => {
  it("keeps a program in the folder a command runs in from starting in place of Windows' own", () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), "voicecap-search-test-"));
    const told = process.env.NoDefaultCurrentDirectoryInExePath;
    try {
      // A program of tasklist.exe's name that isn't it: Windows' ping, which has no TASKLIST help.
      copyFileSync(
        path.join(process.env.SystemRoot ?? String.raw`C:\Windows`, "System32", "PING.EXE"),
        path.join(folder, "tasklist.exe"),
      );
      /** What `tasklist /?` prints when something starts "tasklist" by name from the folder. */
      const printed = (): string =>
        spawnSync("tasklist", ["/?"], {
          cwd: folder,
          encoding: "utf8",
          windowsHide: true,
          timeout: 20_000,
        }).stdout ?? "";

      // A terminal can have told this process already; this is Windows with nobody having told it.
      // If this first check fails, Windows keeps the folder out of the search without being told,
      // and there is nothing left for the second to show.
      delete process.env.NoDefaultCurrentDirectoryInExePath;
      expect(printed()).not.toContain("TASKLIST");

      guardProgramSearch();
      expect(printed()).toContain("TASKLIST");
    } finally {
      if (told === undefined) delete process.env.NoDefaultCurrentDirectoryInExePath;
      else process.env.NoDefaultCurrentDirectoryInExePath = told;
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
