export const PLATFORM_NAME = "RedAlert";
export const PLUGIN_NAME = "@toharush/homebridge-redalert";

export const OREF_ALERTS_URL =
  "https://www.oref.org.il/WarningMessages/alert/alerts.json";
export const OREF_HEADERS = {
  Referer: "https://www.oref.org.il/",
  "X-Requested-With": "XMLHttpRequest",
};

export const DEFAULT_POLLING_INTERVAL = 1000; // ms
export const DEFAULT_ALERT_TIMEOUT = 1800000; // 30 minutes in ms
export const DEFAULT_REQUEST_TIMEOUT = 3000; // ms
