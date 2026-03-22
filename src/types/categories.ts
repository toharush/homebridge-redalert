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

// Categories within the same group can refresh each other's timestamps.
// Security threats (rockets, UAV, terror, etc.) are grouped with notice/warning.
// Natural disasters (earthquake, tsunami) form a separate group.
const RELATED_GROUPS: number[][] = [
  [
    OrefCategory.Rockets,
    OrefCategory.UAVIntrusion,
    OrefCategory.NonConventional,
    OrefCategory.CBRNE,
    OrefCategory.TerroristInfiltration,
    OrefCategory.Warning,
    OrefCategory.HeadsUpNotice,
  ],
  [OrefCategory.Earthquake, OrefCategory.Tsunami],
  [OrefCategory.HazardousMaterials],
];

const relatedMap = new Map<number, Set<number>>();
for (const group of RELATED_GROUPS) {
  const groupSet = new Set(group);
  for (const cat of group) {
    relatedMap.set(cat, groupSet);
  }
}

export function getRelatedCategories(category: number): Set<number> {
  return relatedMap.get(category) ?? new Set();
}
