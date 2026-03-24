import { OrefCategory } from './oref';

const CATEGORY_NAMES = new Map<number, string>([
  [OrefCategory.Rockets, 'rockets'],
  [OrefCategory.NonConventional, 'nonconventional'],
  [OrefCategory.Earthquake, 'earthquake'],
  [OrefCategory.CBRNE, 'cbrne'],
  [OrefCategory.Tsunami, 'tsunami'],
  [OrefCategory.UAVIntrusion, 'uav'],
  [OrefCategory.HazardousMaterials, 'hazmat'],
  [OrefCategory.Warning, 'warning'],
  [OrefCategory.HeadsUpNotice, 'headsup'],
  [OrefCategory.TerroristInfiltration, 'terror'],
]);

export function getCategoryName(category: number): string {
  return CATEGORY_NAMES.get(category) || 'unknown';
}

export const CATEGORY_MAP: Record<string, number[]> = {
  rockets: [OrefCategory.Rockets],
  uav: [OrefCategory.UAVIntrusion],
  nonconventional: [OrefCategory.NonConventional],
  warning: [OrefCategory.Warning, OrefCategory.HeadsUpNotice],
  earthquake: [OrefCategory.Earthquake],
  cbrne: [OrefCategory.CBRNE],
  terror: [OrefCategory.TerroristInfiltration],
  tsunami: [OrefCategory.Tsunami],
  hazmat: [OrefCategory.HazardousMaterials],
};

export const ALL_CATEGORY_KEYS = Object.keys(CATEGORY_MAP);
