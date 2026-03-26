import { OrefCategory, OrefRealtimeAlert, EVENT_ENDED_TITLE } from '../types';
import rocketMissilePayload from '../mock/rocket-missile-alert.mock.json';
import headsupNoticePayload from '../mock/headsup-notice-alert.mock.json';

export const ROCKET_MISSILE_ALERT = rocketMissilePayload as unknown as OrefRealtimeAlert;
export const HEADSUP_NOTICE_ALERT = headsupNoticePayload as unknown as OrefRealtimeAlert;
export const EARTHQUAKE_ALERT: OrefRealtimeAlert = {
  ...ROCKET_MISSILE_ALERT,
  cat: String(OrefCategory.Earthquake),
};

export function makeAlert(cat: OrefCategory, cities: string[]): OrefRealtimeAlert {
  return { id: '134180679120000000', cat: String(cat), title: 'ירי רקטות וטילים', data: cities, desc: 'היכנסו מייד למרחב המוגן' };
}

/** Raw OREF event-ended: cat 10 with EVENT_ENDED_TITLE — OrefClient remaps to cat 99 */
export function makeEventEnded(cities: string[]): OrefRealtimeAlert {
  return {
    id: '134180724020000000',
    cat: String(OrefCategory.HeadsUpNotice),
    title: EVENT_ENDED_TITLE,
    data: cities,
    desc: 'השוהים במרחב המוגן יכולים לצאת.',
  };
}

export function makeHeadsUpNotice(cities: string[]): OrefRealtimeAlert {
  return {
    id: '134181295300000000',
    cat: String(OrefCategory.HeadsUpNotice),
    title: 'בדקות הקרובות צפויות להתקבל התרעות באזורך',
    data: cities,
    desc: 'על תושבי האזורים הבאים לשפר את המיקום למיגון המיטבי בקרבתך.',
  };
}

export { rocketMissilePayload, headsupNoticePayload };
