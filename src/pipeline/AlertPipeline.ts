import { OrefRealtimeAlert } from '../types';
import { DebugLogger } from '../utils/debugLogger';
import { AlertSource } from '../clients/AlertSource';
import { PipelineStage } from './PipelineStage';
import { AlertListener } from './AlertBus';
import { DeduplicationStage } from './DeduplicationStage';
import { ExpiryStage } from './ExpiryStage';

export interface SourceStatus {
  name: string;
  type: 'http' | 'websocket';
  healthy: boolean;
}

export class AlertPipeline {
  private readonly sources: AlertSource[] = [];
  private readonly stages: PipelineStage[] = [];
  private readonly listeners: AlertListener[] = [];
  private dedupStage: DeduplicationStage;

  private healthCallback: ((status: SourceStatus[]) => void) | null = null;
  private lastHealthy = true;
  private lastHealthSnapshot = '';

  constructor(private readonly log: DebugLogger) {
    this.dedupStage = new DeduplicationStage();
    this.stages.push(this.dedupStage);
  }

  getSourceStatus(): SourceStatus[] {
    return this.sources.map((s) => ({ name: s.name, type: s.type, healthy: s.isHealthy() }));
  }

  set onHealthChange(cb: (status: SourceStatus[]) => void) {
    this.healthCallback = cb;
  }

  addStage(stage: PipelineStage): void {
    if (stage instanceof DeduplicationStage) {
      const idx = this.stages.indexOf(this.dedupStage);
      if (idx >= 0) {
        this.stages.splice(idx, 1);
      }
      this.dedupStage = stage;
      this.stages.push(stage);
    } else if (stage instanceof ExpiryStage) {
      stage.attachSeen(this.dedupStage.seen);
      const dedupIdx = this.stages.indexOf(this.dedupStage);
      this.stages.splice(dedupIdx, 0, stage);
    } else {
      this.stages.push(stage);
    }
  }

  addSource(source: AlertSource): void {
    this.sources.push(source);

    source.onAlerts((alerts) => {
      this.ingest(source.name, alerts);
    });

    source.onHealthChange(() => {
      this.evaluateHealth();
    });
  }

  subscribe(listener: AlertListener): void {
    this.listeners.push(listener);
  }

  start(): void {
    this.log.info(`Pipeline starting ${this.sources.length} source(s), ${this.stages.length} stage(s)`);
    for (let i = 0; i < this.sources.length; i++) {
      this.sources[i].start();
    }
  }

  stop(): void {
    for (let i = 0; i < this.sources.length; i++) {
      this.sources[i].stop();
    }
  }

  isHealthy(): boolean {
    for (let i = 0; i < this.sources.length; i++) {
      if (this.sources[i].isHealthy()) {
        return true;
      }
    }
    return false;
  }

  private ingest(sourceName: string, alerts: OrefRealtimeAlert[]): void {
    let current = alerts;
    const stages = this.stages;
    for (let i = 0; i < stages.length; i++) {
      current = stages[i].process(current, sourceName);
    }

    if (current.length === 0) {
      return;
    }

    this.log.easyDebug(() => `[${sourceName}] ${current.length} alert(s): ${JSON.stringify(current)}`);

    const parsed = this.dedupStage.parsed;
    if (!parsed) {
      return;
    }
    const listeners = this.listeners;
    for (let i = 0; i < listeners.length; i++) {
      listeners[i].handleAlerts(parsed);
    }
  }

  private evaluateHealth(): void {
    const status = this.getSourceStatus();
    const snapshot = status.map((s) => s.healthy ? '1' : '0').join('');
    if (snapshot !== this.lastHealthSnapshot) {
      this.lastHealthSnapshot = snapshot;
      this.healthCallback?.(status);
    }
    const healthy = status.some((s) => s.healthy);
    if (healthy !== this.lastHealthy) {
      this.lastHealthy = healthy;
      if (healthy) {
        this.log.info('At least one source recovered — system healthy');
      } else {
        this.log.warn('All sources unhealthy');
      }
    }
  }
}
