/**
 * Whether `stream` is a real terminal (a TTY), as Node marks one: process.stdin or process.stdout
 * at a terminal, and not when a pipe or a file takes its place.
 */
export function isTerminalStream(stream: object): boolean {
  return (stream as { isTTY?: unknown }).isTTY === true;
}
