import { OrefRealtimeAlert } from '../types';

export interface PipelineStage {
  process(alerts: OrefRealtimeAlert[], sourceName?: string): OrefRealtimeAlert[];
}
