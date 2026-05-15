import crypto from 'crypto';
import { OrefRealtimeAlert } from '../types';
import { CATEGORY_MAP } from '../types';

export type CategoryKey =
  | 'rockets' | 'uav' | 'nonconventional' | 'warning'
  | 'earthquake' | 'cbrne' | 'terror' | 'tsunami' | 'hazmat';

export type CategoryMapping = Record<string, CategoryKey>;

export function mapAlertCategory(sourceCat: string, mapping: CategoryMapping): number | undefined {
  const key = mapping[sourceCat];
  if (!key) {
    return undefined;
  }
  const ids = CATEGORY_MAP[key];
  return ids?.[0];
}

export function normalizeAlerts(
  rawAlerts: any[],
  mapping: CategoryMapping,
  format: ResponseFormat,
): OrefRealtimeAlert[] {
  const alerts: OrefRealtimeAlert[] = [];

  for (const raw of rawAlerts) {
    const sourceCat = String(raw[format.category_field] ?? '');
    const mappedCat = mapAlertCategory(sourceCat, mapping);
    if (mappedCat === undefined) {
      continue;
    }

    const cities = raw[format.cities_field];
    const data: string[] = Array.isArray(cities) ? cities : typeof cities === 'string' ? [cities] : [];

    alerts.push({
      id: String(raw[format.id_field] ?? crypto.randomUUID()),
      cat: String(mappedCat),
      title: String(raw[format.title_field] ?? ''),
      data,
      desc: String(raw[format.description_field] ?? ''),
    });
  }

  return alerts;
}

export interface ResponseFormat {
  id_field: string;
  category_field: string;
  title_field: string;
  cities_field: string;
  description_field: string;
  alerts_path: string;
}

export const DEFAULT_RESPONSE_FORMAT: ResponseFormat = {
  id_field: 'id',
  category_field: 'cat',
  title_field: 'title',
  cities_field: 'data',
  description_field: 'desc',
  alerts_path: '$',
};

export function extractAlerts(body: any, alertsPath: string): any[] {
  if (alertsPath === '$') {
    return Array.isArray(body) ? body : [body];
  }
  const parts = alertsPath.split('.');
  let current = body;
  for (const part of parts) {
    if (current === null || current === undefined) {
      return [];
    }
    current = current[part];
  }
  return Array.isArray(current) ? current : current ? [current] : [];
}
