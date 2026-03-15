import _ from 'lodash';
import { Characteristic, PlatformConfig } from 'homebridge';

export interface ValidatedConfig extends PlatformConfig {
  cities: string;
  polling_interval?: number;
  debug?: boolean;
  categories?: string[];
}

export type CharacteristicType = typeof Characteristic;

export interface CachedService {
  getMotionDetected: () => boolean | null;
  setMotionDetected: (on: boolean) => void;
}

// Real-time alert from alerts.json
export interface OrefRealtimeAlert {
  id: string;
  cat: string;
  title: string;
  data: string[];
  desc: string;
}

// Real-time alert category IDs (matrix_id from alertCategories.json)
export enum OrefCategory {
  Rockets = 1,
  NonConventional = 2,
  Earthquake = 3,
  CBRNE = 4,
  Tsunami = 5,
  UAVIntrusion = 6,
  HazardousMaterials = 7,
  Warning = 8,
  EventEnded = 10,
  TerroristInfiltration = 13,
}

const CATEGORY_NAMES = new Map<number, string>([
  [OrefCategory.Rockets, 'rockets'],
  [OrefCategory.NonConventional, 'nonconventional'],
  [OrefCategory.Earthquake, 'earthquake'],
  [OrefCategory.CBRNE, 'cbrne'],
  [OrefCategory.Tsunami, 'tsunami'],
  [OrefCategory.UAVIntrusion, 'uav'],
  [OrefCategory.HazardousMaterials, 'hazmat'],
  [OrefCategory.Warning, 'warning'],
  [OrefCategory.EventEnded, 'event_ended'],
  [OrefCategory.TerroristInfiltration, 'terror'],
]);

export function getCategoryName(category: number): string {
  return CATEGORY_NAMES.get(category) || 'unknown';
}

// Maps config checkbox values to OrefCategory IDs (matrix_id)
export const CATEGORY_MAP: Record<string, number[]> = {
  rockets: [OrefCategory.Rockets],
  uav: [OrefCategory.UAVIntrusion],
  nonconventional: [OrefCategory.NonConventional],
  warning: [OrefCategory.Warning],
  earthquake: [OrefCategory.Earthquake],
  cbrne: [OrefCategory.CBRNE],
  terror: [OrefCategory.TerroristInfiltration],
  tsunami: [OrefCategory.Tsunami],
  hazmat: [OrefCategory.HazardousMaterials],
};

export const ALL_CATEGORY_KEYS = _.keys(CATEGORY_MAP);
