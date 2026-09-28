/** A Windows path written Git Bash's way: C:\Users\me becomes /c/Users/me. */
export function gitBashForm(windowsPath: string): string {
  return `/${windowsPath[0]!.toLowerCase()}${windowsPath.slice(2).replaceAll("\\", "/")}`;
}
