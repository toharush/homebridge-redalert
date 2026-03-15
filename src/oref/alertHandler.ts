import _ from 'lodash';
import { CachedService, OrefAlert, OrefCategory } from '../types';
import { DebugLogger } from '../utils/debugLogger';

export class AlertHandler {
  private readonly citySet: Set<string>;

  constructor(
    private readonly log: DebugLogger,
    cities: string[],
    private readonly allowedCategories: Set<number>,
    private readonly sensor: CachedService,
  ) {
    this.citySet = new Set(cities);
  }

  handleAlerts(alerts: OrefAlert[]): void {
    const hasActive = _.some(alerts, (alert) =>
      alert.category !== OrefCategory.EventEnded
      && this.allowedCategories.has(alert.category)
      && this.citySet.has(alert.data),
    );

    if (hasActive) {
      if (!this.sensor.getMotionDetected()) {
        this.sensor.setMotionDetected(true);
        this.log.info('ALERT: Red Alert triggered');
      }
    } else if (this.sensor.getMotionDetected()) {
      this.sensor.setMotionDetected(false);
      this.log.info('Alert ended');
    }
  }
}
