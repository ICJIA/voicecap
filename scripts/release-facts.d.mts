/**
 * The types of scripts/release-facts.mjs, which is plain JavaScript so that publish.sh can run it
 * with Node alone. The tests are TypeScript, and import it through these.
 */

/** The counts of a run of the tests. */
export interface TestCounts {
  passed: number;
  skipped: number;
  files: number;
}

/** Where CI runs: the systems' names, and the Node versions as the matrix writes them. */
export interface CiMatrix {
  systems: string[];
  node: string[];
}

/** What dist/release-facts.json holds, in the order it is written. */
export interface ReleaseFactsFile {
  schema: 1;
  tests: TestCounts & { system: string };
  commits: { count: number; first: string };
  ci: CiMatrix;
}

/** The name of the system `platform` (a `process.platform`) is: Windows, macOS, or Linux. */
export function systemName(platform: string): string;

/** The counts of the passing run in `report`, a parsed Vitest JSON report. Throws for any other. */
export function testsOf(report: unknown): TestCounts;

/** Where CI runs, from the text of .github/workflows/ci.yml. Throws when it can't be read. */
export function ciOf(workflow: string): CiMatrix;

/**
 * Writes the release's facts to `out` and gives them. When it can't, it rejects and writes nothing.
 */
export function writeReleaseFacts(options: {
  /** The Vitest JSON report of the run of the tests. */
  report: string;
  /** The workflow whose matrix says where CI runs. */
  workflow: string;
  /** The file to write. */
  out: string;
  /** The repository whose commits are counted. */
  cwd: string;
  /** The `process.platform` the tests ran on. */
  platform: string;
}): Promise<ReleaseFactsFile>;
