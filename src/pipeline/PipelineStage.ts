import { OrefRealtimeAlert } from '../types';

export interface PipelineStage {
  process(alerts: OrefRealtimeAlert[]): OrefRealtimeAlert[];
}
