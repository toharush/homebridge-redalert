export const PLATFORM_NAME = 'RedAlert';
export const PLUGIN_NAME = '@toharush/homebridge-redalert';

export const OREF_ALERTS_URL =
  'https://www.oref.org.il/WarningMessages/alert/alerts.json';
export const OREF_HEADERS = {
  Referer: 'https://www.oref.org.il/',
  'X-Requested-With': 'XMLHttpRequest',
};

export const TZOFAR_WS_URL = 'wss://ws.tzevaadom.co.il/socket?platform=ANDROID';
export function tzofarHeaders(): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36',
    Referer: 'https://www.tzevaadom.co.il',
    Origin: 'https://www.tzevaadom.co.il',
    'X-App-Token': Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''),
  };
}

export const NATIONWIDE_CITY = 'רחבי הארץ';
export const DEFAULT_POLLING_INTERVAL = 1000; // ms
export const DEFAULT_ALERT_TIMEOUT = 1800000; // 30 minutes in ms
export const DEFAULT_REQUEST_TIMEOUT = 3000; // ms
export const DEFAULT_TURNOFF_DELAY = 0; // ms
export const DEFAULT_HEALTH_CHECK_THRESHOLD = 5; // consecutive failures before unhealthy
