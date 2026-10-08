/**
 * voicecap's programmatic API. The CLI (voicecap) is a thin layer over these functions.
 *
 *   import { runAudit } from "@icjia/voicecap";
 *   const result = await runAudit({ site: "https://dvfr.illinois.gov", pages: "pages.csv" });
 */
export { runAudit } from "./run/audit.js";
export type { RunAuditOptions, RunAuditResult } from "./run/audit.js";
export { listUrls } from "./list-urls.js";
export { addReview } from "./reviews/review.js";
export type { AddReviewOptions, AddReviewResult } from "./reviews/review.js";
export { addManualSession } from "./manual-add.js";
export type { AddManualSessionOptions, AddManualSessionResult } from "./manual-add.js";
export { regenerateLiveReport as generateReport } from "./run/live-report.js";
export type { LiveReportOptions as GenerateReportOptions } from "./run/live-report.js";
// The site folder generateReport takes: siteDirFor(resolveHome(...), site), or chooseSiteDir's
// pick, as review and manual add make it.
export { resolveHome, siteDirFor, siteFolder } from "./run/paths.js";
export { chooseSiteDir } from "./run/site-dir.js";
export { shareReport } from "./share/share.js";
export type { ShareReportOptions, ShareReportResult } from "./share/share.js";
// What `voicecap share` recorded in a site's share/shares.json, and the type readShares gives it
// back as: each entry an object whose fields are unknown, since only that is checked.
export { readShares } from "./share/shares.js";
export type { SharesAsRead } from "./share/shares.js";
// A walkthrough file: a run's recipe, so anyone can repeat the run. `voicecap walkthrough` writes
// one from a completed run; parseWalkthrough reads one back strictly.
export { writeWalkthrough } from "./share/write-walkthrough.js";
export type { WriteWalkthroughOptions, WriteWalkthroughResult } from "./share/write-walkthrough.js";
export {
  parseWalkthrough,
  walkthroughJson,
  walkthroughOf,
  walkthroughProblem,
} from "./share/walkthrough.js";
export type {
  Walkthrough,
  WalkthroughOrigin,
  WalkthroughPage,
  WalkthroughSettings,
} from "./share/walkthrough.js";
// The website of each site's newest shared reports, as `voicecap site` builds it from the home's
// records of what was shared. The types describe what it published.
export { buildSite } from "./site/build.js";
export type { BuildSiteOptions, BuildSiteResult } from "./site/build.js";
export type { PublishedFile, PublishedReport, SiteContent } from "./site/render.js";
// What the website's "Can I trust this?" page states (`BuildSiteOptions.voicecapFacts`): of
// voicecap, of each release its CHANGELOG records, of what a release recorded, and of the records.
export type { RecordFacts, ReleaseFacts, VoicecapFacts, VoicecapRelease } from "./site/facts.js";
export { verifyHome } from "./verify.js";
export type { VerifyHomeOptions, VerifyResult, VerifySiteResult } from "./verify.js";
export { defineConfig, loadConfig, resolveConfig } from "./config/load.js";
export type { LoadedConfig } from "./config/load.js";
export type { UserConfig, VoicecapConfig } from "./config/schema.js";
export { DEFAULT_CONFIG } from "./config/defaults.js";
export { evaluateFlags } from "./flags/evaluate.js";
export { ReplayDriver } from "./drivers/replay.js";
export type {
  CaptureMode,
  EnvironmentInfo,
  EventRecorder,
  FocusedElement,
  PageInfo,
  PageScreenshot,
  ScreenReaderDriver,
  Speech,
} from "./drivers/types.js";
export { ForegroundError } from "./drivers/types.js";
export * from "./model.js";
export {
  ConfigError,
  EnvironmentError,
  ExitCode,
  NotImplementedError,
  UsageError,
  VoicecapError,
} from "./util/errors.js";
export { createConsoleLogger, createMemoryLogger, silentLogger } from "./util/log.js";
export type { Logger } from "./util/log.js";
