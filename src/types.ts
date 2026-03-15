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

// History alert from AlertsHistory.json
export interface OrefHistoryAlert {
  alertDate: string;
  title: string;
  data: string;
  category: number;
}

// Category IDs from https://www.oref.org.il/alerts/alertCategories.json
export enum OrefCategory {
  Rockets = 1,
  UAVIntrusion = 2,
  NonConventional = 3,
  Warning = 4,
  EarthquakeAlert = 7,
  EarthquakeWarning = 8,
  CBRNE = 9,
  TerroristInfiltration = 10,
  Tsunami = 11,
  HazardousMaterials = 12,
  EventEnded = 13,
  Flash = 14,
}

const CATEGORY_NAMES = new Map<number, string>([
  [OrefCategory.Rockets, 'rockets'],
  [OrefCategory.UAVIntrusion, 'uav'],
  [OrefCategory.NonConventional, 'nonconventional'],
  [OrefCategory.Warning, 'warning'],
  [OrefCategory.EarthquakeAlert, 'earthquake'],
  [OrefCategory.EarthquakeWarning, 'earthquake'],
  [OrefCategory.CBRNE, 'cbrne'],
  [OrefCategory.TerroristInfiltration, 'terror'],
  [OrefCategory.Tsunami, 'tsunami'],
  [OrefCategory.HazardousMaterials, 'hazmat'],
  [OrefCategory.EventEnded, 'event_ended'],
  [OrefCategory.Flash, 'flash'],
]);

export function getCategoryName(category: number): string {
  return CATEGORY_NAMES.get(category) || 'unknown';
}

// Maps config checkbox values to OrefCategory IDs
export const CATEGORY_MAP: Record<string, number[]> = {
  rockets: [OrefCategory.Rockets],
  uav: [OrefCategory.UAVIntrusion],
  nonconventional: [OrefCategory.NonConventional],
  warning: [OrefCategory.Warning],
  earthquake: [OrefCategory.EarthquakeAlert, OrefCategory.EarthquakeWarning],
  cbrne: [OrefCategory.CBRNE],
  terror: [OrefCategory.TerroristInfiltration],
  tsunami: [OrefCategory.Tsunami],
  hazmat: [OrefCategory.HazardousMaterials],
};

export const ALL_CATEGORY_KEYS = _.keys(CATEGORY_MAP);
