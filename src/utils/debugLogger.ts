import _ from 'lodash';
import { Logger } from 'homebridge';

export interface DebugLogger extends Logger {
  easyDebug: (message: string | (() => string)) => void;
}

export function createDebugLogger(log: Logger, debug: boolean): DebugLogger {
  const debugLog = log as DebugLogger;
  debugLog.easyDebug = (message: string | (() => string)) => {
    if (!debug) {
      return;
    }
    const msg = _.isFunction(message) ? message() : message;
    log.info(msg);
  };
  return debugLog;
}
