/**
 * The programs voicecap closes when one comes in front of the browser: Windows Search and the Start
 * menu. Each opens by itself now and then, with no one at the computer (nothing has been found that
 * starts them), and while one is in front the browser can't be brought forward, so every try at a
 * page fails. One Escape closes either, as it does for a person.
 *
 * A program is known by the name the foreground lookup gives it (foregroundWindow in
 * src/drivers/guidepup/windows.ts): its file's description, else its process's name. On Windows 11
 * (25H2), SearchHost.exe has no description, so the lookup names it "SearchHost", and
 * StartMenuExperienceHost.exe's description is "Windows Start Experience Host". The process's name
 * is kept too, for a Windows whose file has no description.
 *
 * Only these are closed: Escape in another program can cancel what a person was doing, and a name
 * that merely contains "search" or "start" is no reason to press it.
 */
export interface ClosedProgram {
  /** What the run's words call it, after "voicecap closed": "Windows Search". */
  words: string;
  /** The names the lookup gives its program, lowercase. */
  names: readonly string[];
}

const CLOSED_PROGRAMS: readonly ClosedProgram[] = [
  { words: "Windows Search", names: ["searchhost"] },
  { words: "the Start menu", names: ["startmenuexperiencehost", "windows start experience host"] },
];

/**
 * The program voicecap closes that `program`, as the foreground lookup names it, is: compared
 * without regard to letter case, the spaces round it, or a ".exe" ending (the lookup leaves it off,
 * but a process's name may carry it). Null for any other program, for a program that isn't known
 * (null), and for anything but text, as a log written or changed by hand can give.
 */
export function closedProgram(program: unknown): ClosedProgram | null {
  if (typeof program !== "string") return null;
  const name = program
    .trim()
    .toLowerCase()
    .replace(/\.exe$/, "")
    .trim();
  return CLOSED_PROGRAMS.find(({ names }) => names.includes(name)) ?? null;
}
