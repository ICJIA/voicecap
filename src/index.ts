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
  FocusedElement,
  PageInfo,
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
