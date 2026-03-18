import _ from 'lodash';
import { Logger } from 'homebridge';

export interface DebugLogger extends Logger {
  easyDebug: (message: string | (() => string)) => void;
}

export class DebugLoggerWrapper implements DebugLogger {
  constructor(
    private readonly logger: Logger,
    private readonly debugEnabled: boolean,
  ) {}

  easyDebug(message: string | (() => string)): void {
    if (!this.debugEnabled) {
      return;
    }
    const msg = _.isFunction(message) ? message() : message;
    this.logger.info(msg);
  }

  info(message: string, ...parameters: any[]): void {
    this.logger.info(message, ...parameters);
  }

  warn(message: string, ...parameters: any[]): void {
    this.logger.warn(message, ...parameters);
  }

  error(message: string, ...parameters: any[]): void {
    this.logger.error(message, ...parameters);
  }

  debug(message: string, ...parameters: any[]): void {
    this.logger.debug(message, ...parameters);
  }

  log(level: any, message: string, ...parameters: any[]): void {
    this.logger.log(level, message, ...parameters);
  }

  success(message: string, ...parameters: any[]): void {
    this.logger.success(message, ...parameters);
  }

  get prefix(): string {
    return this.logger.prefix ?? '';
  }
}

export function createDebugLogger(log: Logger, debug: boolean): DebugLogger {
  return new DebugLoggerWrapper(log, debug);
}
