import { CachedService, OrefRealtimeAlert, OrefCategory } from '../types';
import { DebugLogger } from '../utils/debugLogger';

export class AlertHandler {
  private readonly citySet: Set<string>;
  private readonly activeCities = new Map<string, number>(); // city -> timestamp
  private readonly maxActiveAgeMs: number;

  constructor(
    private readonly log: DebugLogger,
    cities: string[],
    private readonly allowedCategories: Set<number>,
    private readonly sensor: CachedService,
    alertTimeoutMinutes: number,
  ) {
    this.maxActiveAgeMs = alertTimeoutMinutes * 60 * 1000;
    this.citySet = new Set(cities);
  }

  handleRealtimeAlerts(alerts: OrefRealtimeAlert[]): void {
    for (const alert of alerts) {
      const cat = parseInt(alert.cat, 10);
      if (isNaN(cat)) {
        this.log.warn(`Skipping alert with invalid category: ${alert.cat}`);
        continue;
      }

      if (cat === OrefCategory.EventEnded) {
        this.handleEventEnded(alert);
        continue;
      }

      if (!this.allowedCategories.has(cat)) {
        continue;
      }

      const matchedCities = alert.data.filter((city) => this.citySet.has(city));
      for (const city of matchedCities) {
        if (!this.activeCities.has(city)) {
          this.activeCities.set(city, Date.now());
          this.log.info(`ALERT: ${alert.title} - ${city}`);
        }
      }
    }

    this.expireStaleAlerts();
    this.updateSensor();
  }

  private handleEventEnded(alert: OrefRealtimeAlert): void {
    for (const city of alert.data) {
      if (this.activeCities.has(city)) {
        this.activeCities.delete(city);
        this.log.info(`Event ended: ${city}`);
      }
    }
  }

  private expireStaleAlerts(): void {
    const now = Date.now();
    for (const [city, timestamp] of this.activeCities) {
      if (now - timestamp > this.maxActiveAgeMs) {
        this.activeCities.delete(city);
        this.log.warn(`Alert for ${city} expired after ${this.maxActiveAgeMs / 60000} minutes (safety fallback)`);
      }
    }
  }

  private updateSensor(): void {
    const shouldBeOn = this.activeCities.size > 0;
    const currentlyOn = this.sensor.getMotionDetected();

    if (shouldBeOn && !currentlyOn) {
      this.sensor.setMotionDetected(true);
      this.log.easyDebug(() => `Sensor ON, active cities: ${JSON.stringify([...this.activeCities.keys()])}`);
    } else if (!shouldBeOn && currentlyOn) {
      this.sensor.setMotionDetected(false);
      this.log.info('All clear - safe to leave shelter');
    }
  }
}
