/**
 * Reads the text of NVDA's Speech Viewer window through UI Automation (Windows PowerShell).
 * Guidepup's NVDA build opens Speech Viewer when it starts. Its text is one line per utterance,
 * with an utterance's items separated by two spaces (NVDA's speechViewer.py).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$byName = New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, "NVDA Speech Viewer")
$window = $A::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $byName)
if (-not $window) { [Console]::Error.Write("The NVDA Speech Viewer window isn't open."); exit 2 }
$all = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($element in $all) {
  $type = $element.Current.ControlType.ProgrammaticName
  if ($type -ne "ControlType.Document" -and $type -ne "ControlType.Edit") { continue }
  $pattern = $null
  if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
    [Console]::Out.Write($pattern.DocumentRange.GetText(-1)); exit 0
  }
  if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
    [Console]::Out.Write($pattern.Current.Value); exit 0
  }
}
[Console]::Error.Write("The Speech Viewer has no readable text."); exit 3
`;

/** The Speech Viewer's whole text, as it is now. */
export async function readSpeechViewer(): Promise<string> {
  const { stdout } = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", SCRIPT],
    { encoding: "utf8", windowsHide: true, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout;
}

/**
 * Symbols NVDA speaks by name at its default symbol level ("some"), from NVDA 2026.2's English
 * symbols.dic. Speech Viewer shows the text before NVDA replaces them; Guidepup's capture (NVDA
 * Remote Access) receives it after, so a transcript says "copyright 2026" where Speech Viewer
 * shows "© 2026". The period is left out: NVDA keeps sentence-ending periods and says "dot" only
 * inside words (complex rules this comparison doesn't reproduce).
 */
const SPOKEN_SYMBOLS = new Map<string, string>([
  ["₹", "rupee"],
  ["%", "percent"],
  ["‰", "per mille"],
  ["&", "and"],
  ["*", "star"],
  ["/", "slash"],
  ["@", "at"],
  ["¡", "inverted exclamation point"],
  ["¿", "inverted question mark"],
  ["′", "prime"],
  ["″", "double prime"],
  ["‴", "triple prime"],
  ["•", "bullet"],
  ["■", "black square"],
  ["▪", "black square"],
  ["◾", "black square"],
  ["□", "white square"],
  ["◦", "white bullet"],
  ["⇨", "right white arrow"],
  ["➔", "right-pointing arrow"],
  ["➢", "right arrowhead"],
  ["❖", "black diamond minus white X"],
  ["♣", "black club"],
  ["♦", "black diamond"],
  ["◆", "black diamond"],
  ["°", "degrees"],
  ["µ", "micro"],
  ["⁰", "superscript 0"],
  ["¹", "superscript 1"],
  ["²", "superscript 2"],
  ["³", "superscript 3"],
  ["⁴", "superscript 4"],
  ["⁵", "superscript 5"],
  ["⁶", "superscript 6"],
  ["⁷", "superscript 7"],
  ["⁸", "superscript 8"],
  ["⁹", "superscript 9"],
  ["⁺", "superscript plus"],
  ["⁼", "superscript equals"],
  ["⁽", "superscript left paren"],
  ["⁾", "superscript right paren"],
  ["ⁿ", "superscript n"],
  ["₀", "subscript 0"],
  ["₁", "subscript 1"],
  ["₂", "subscript 2"],
  ["₃", "subscript 3"],
  ["₄", "subscript 4"],
  ["₅", "subscript 5"],
  ["₆", "subscript 6"],
  ["₇", "subscript 7"],
  ["₈", "subscript 8"],
  ["₉", "subscript 9"],
  ["₊", "subscript plus"],
  ["₋", "subscript minus"],
  ["₌", "subscript equals"],
  ["₍", "subscript left paren"],
  ["₎", "subscript right paren"],
  ["®", "registered"],
  ["™", "trademark"],
  ["©", "copyright"],
  ["℠", "ServiceMark"],
  ["←", "left arrow"],
  ["↑", "up arrow"],
  ["→", "right arrow"],
  ["↓", "down arrow"],
  ["✓", "check"],
  ["✔", "check"],
  ["🡺", "right arrow"],
  ["†", "dagger"],
  ["‡", "double dagger"],
  ["+", "plus"],
  ["−", "minus"],
  ["×", "times"],
  ["⋅", "times"],
  ["∕", "divided by"],
  ["⁄", "divided by"],
  ["÷", "divide by"],
  ["∓", "minus or plus"],
  ["±", "plus or Minus"],
  ["=", "equals"],
  ["<", "less"],
  [">", "greater"],
  ["⁻", "inverse"],
]);

/**
 * Speech Viewer lines in the transcripts' format, for comparing the two: items (separated by two
 * or more spaces) are trimmed, empty ones dropped, and joined with ", ", and symbols NVDA speaks by
 * name are replaced by the name.
 */
export function speechViewerLines(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => comparable(line.split(/\s{2,}/).map(spokenSymbols)));
}

/** A transcript step in the same comparable form (Guidepup keeps empty items; Speech Viewer doesn't). */
export function comparableStep(spoken: string): string {
  return comparable(spoken.split(", "));
}

function comparable(items: string[]): string {
  return items
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item !== "")
    .join(", ");
}

function spokenSymbols(item: string): string {
  let result = "";
  for (const char of item) {
    const name = SPOKEN_SYMBOLS.get(char);
    result += name === undefined ? char : ` ${name} `;
  }
  return result;
}
