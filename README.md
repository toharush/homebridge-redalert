# homebridge-redalert

Homebridge plugin for Israeli Red Alert (Pikud HaOref) notifications via HomeKit motion sensors.

The plugin polls the official Pikud HaOref API directly — no Telegram, no middleman, no authentication required.

## Disclaimer

**חשוב מאוד לקרוא!**

התוסף איננו תוסף רשמי של פיקוד העורף או מערכת הבטחון.
התוסף משתמש ב-API של פיקוד העורף לקבלת התרעות ולכן יתכנו שיבושים.
בכל מקרה יש להמשיך להשתמש באמצעיים הרשמיים של מערכת הבטחון.

1. This plugin is not an official Home Front Command product.
2. The plugin uses the Pikud HaOref public API for alerts. There may be delays or disruptions.
3. Always use the official alert systems alongside this plugin.

## Installation

Search for `redalert` in the Homebridge plugin search, or install manually:

```
npm install -g @toharush/homebridge-redalert
```

## Configuration

Configure via the Homebridge UI ("Add Sensor" button) or manually in `config.json`:

```json
{
  "platform": "RedAlert",
  "sensors": [
    {
      "name": "Home",
      "cities": "תל אביב, חיפה",
      "categories": ["rockets", "uav", "earthquake", "terror"],
      "prefix_matching": false
    }
  ],
  "turnoff_delay": 0,
  "alert_timeout": 1800000,
  "polling_interval": 1000,
  "debug": false
}
```

### Multi-Sensor Example

Each sensor creates a separate motion sensor in HomeKit with its own cities, categories, and prefix matching:

```json
{
  "platform": "RedAlert",
  "sensors": [
    { "name": "Home", "cities": "תל אביב", "categories": ["rockets", "uav"] },
    { "name": "Office", "cities": "חיפה", "prefix_matching": true },
    { "name": "Parents", "cities": "באר שבע", "categories": ["rockets"] }
  ]
}
```

### Sensor Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `name` | Yes | — | Unique sensor name (appears in HomeKit). |
| `cities` | Yes | — | City names in Hebrew, comma-separated. Must match Pikud HaOref naming exactly (or use prefix matching). |
| `categories` | No | All | Alert types to monitor. If empty, all categories are enabled. |
| `prefix_matching` | No | `false` | When enabled, city names match by prefix (e.g. "תל אביב" matches all Tel Aviv sub-areas). |

### Advanced Options

These options are global and available under the **Advanced** expandable section in the Homebridge UI.

| Option | Default | Description |
|--------|---------|-------------|
| `turnoff_delay` | `0` | Delay in ms before turning off the motion sensor after the alert ends. Useful to prevent rapid on/off or to keep automations running longer. If a new alert arrives during the delay, the timer resets (0–3600000). |
| `alert_timeout` | `1800000` | Auto-clear alerts after this time in ms if "Event Ended" is never received. Resets on each new alert. Default is 30 minutes (600000–3600000). |
| `polling_interval` | `1000` | How often to poll the API in ms (500–5000). |
| `request_timeout` | `3000` | How long to wait for the OREF API to respond before aborting the request in ms. Increase if you have a slow network (1000–10000). |
| `debug` | `false` | Enable extra debug logging. |

### Available Categories

| Key | Description |
|-----|-------------|
| `rockets` | Rockets & Missiles (ירי רקטות וטילים) |
| `uav` | UAV Intrusion (חדירת כלי טיס) |
| `nonconventional` | Non-conventional Threat |
| `warning` | Heads-up Notice (התרעה מוקדמת) |
| `earthquake` | Earthquake (רעידת אדמה) |
| `cbrne` | Chemical/Bio/Nuclear |
| `terror` | Terrorist Infiltration (חדירת מחבלים) |
| `tsunami` | Tsunami (צונאמי) |
| `hazmat` | Hazardous Materials (חומרים מסוכנים) |

## Documentation

For detailed docs, architecture, automation examples, and troubleshooting, see the [Wiki](https://github.com/toharush/homebridge-redalert/wiki).

## How It Works

- The plugin creates one **motion sensor** per configured sensor in HomeKit.
- A single poller fetches the Pikud HaOref API every second (configurable) — adding sensors does not add API calls.
- Each sensor independently filters alerts by its own cities and categories.
- When an alert matches, the sensor turns **ON**.
- The sensor stays **ON** until Pikud HaOref sends an "Event Ended" message for your city.
- If "Event Ended" is never received (API issue), the alert auto-clears after the configured timeout (default: 30 minutes).
- You can create HomeKit automations based on each motion sensor (e.g. flash lights, play a sound, send a notification).

## License

MIT
