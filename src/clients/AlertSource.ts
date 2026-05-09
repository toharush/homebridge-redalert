import { OrefRealtimeAlert } from '../types';

export interface AlertSource {
  readonly name: string;
  readonly type: 'http' | 'websocket';

  start(): void;
  stop(): void;
  isHealthy(): boolean;

  onAlerts(callback: (alerts: OrefRealtimeAlert[]) => void): void;
  onHealthChange(callback: (healthy: boolean) => void): void;
}
