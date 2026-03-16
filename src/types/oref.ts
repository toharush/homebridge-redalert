export interface OrefRealtimeAlert {
  id: string;
  cat: string;
  title: string;
  data: string[];
  desc: string;
}

export const EVENT_ENDED_TITLE = 'האירוע הסתיים';

export enum OrefCategory {
  Rockets = 1,
  NonConventional = 2,
  Earthquake = 3,
  CBRNE = 4,
  Tsunami = 5,
  UAVIntrusion = 6,
  HazardousMaterials = 7,
  Warning = 8,
  HeadsUpNotice = 10,
  TerroristInfiltration = 13,
}
