import type { ScreenReaderDriver } from "../drivers/types.js";
import { InterruptedError, withTimeout } from "../passes/steps.js";
import { EnvironmentError, errorMessage, VoicecapError } from "../util/errors.js";
import type { Logger } from "../util/log.js";

/** Starts, restarts, and stops a driver, and makes the final stop happen exactly once. */
export class DriverSession {
  private stopping: Promise<void> | null = null;

  constructor(
    readonly driver: ScreenReaderDriver,
    private readonly startTimeoutMs: number,
    private readonly logger: Logger,
  ) {}

  async start(signal?: AbortSignal): Promise<void> {
    try {
      await withTimeout(
        `Starting the ${this.driver.name} driver`,
        () => this.driver.start(),
        this.startTimeoutMs,
        signal,
      );
    } catch (error) {
      if (error instanceof VoicecapError || error instanceof InterruptedError) throw error;
      throw new EnvironmentError(
        `Could not start the ${this.driver.name} driver: ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }

  /** Stop and start again: after a timeout, a failed page, or every N pages. */
  async restart(reason: string, signal?: AbortSignal): Promise<void> {
    this.logger.info(`Restarting the screen reader and browser (${reason}).`);
    await this.driver.stop({ restarting: true }).catch((error: unknown) => {
      this.logger.warn(`Stopping the ${this.driver.name} driver failed: ${errorMessage(error)}`);
    });
    await this.start(signal);
  }

  /** Final stop. Safe to call more than once, including while a signal is being handled. */
  stop(): Promise<void> {
    this.stopping ??= this.driver.stop().catch((error: unknown) => {
      this.logger.warn(`Stopping the ${this.driver.name} driver failed: ${errorMessage(error)}`);
    });
    return this.stopping;
  }
}
