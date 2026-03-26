export interface OrefRealtimeAlert {
  id: string;
  cat: string;
  title: string;
  data: string[];
  desc: string;
}

export const EVENT_ENDED_TITLE = 'האירוע הסתיים';
export const EVENT_ENDED_PATTERN = new RegExp(EVENT_ENDED_TITLE);

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
  /** Synthetic category — OREF sends Event Ended as cat 10, we remap it in parseAlerts. */
  EventEnded = 99,
}
