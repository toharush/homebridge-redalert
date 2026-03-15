# homebridge-redalert

Homebridge plugin for Israeli Red Alert (Pikud HaOref) notifications via HomeKit motion sensor.

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

Configure via the Homebridge UI or manually in `config.json`:

```json
{
  "platform": "RedAlert",
  "cities": "תל אביב, חיפה",
  "categories": ["rockets", "uav", "earthquake", "terror"],
  "alert_timeout": 10,
  "polling_interval": 1000,
  "debug": false
}
```

### Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `cities` | Yes | — | City names in Hebrew, comma-separated. Must match Pikud HaOref naming exactly. |
| `categories` | No | All | Alert types to monitor. If empty, all categories are enabled. |
| `alert_timeout` | No | 10 | Safety fallback: auto-clear alerts after this many minutes if "Event Ended" is never received (1–60). |
| `polling_interval` | No | 1000 | How often to poll the API in milliseconds (500–5000). |
| `debug` | No | false | Enable extra debug logging. |

### Available Categories

| Key | Description |
|-----|-------------|
| `rockets` | Rockets & Missiles (ירי רקטות וטילים) |
| `uav` | UAV Intrusion (חדירת כלי טיס) |
| `nonconventional` | Non-conventional Threat |
| `warning` | Heads-up Notice (התראה מוקדמת) |
| `earthquake` | Earthquake (רעידת אדמה) |
| `cbrne` | Chemical/Bio/Nuclear |
| `terror` | Terrorist Infiltration (חדירת מחבלים) |
| `tsunami` | Tsunami (צונאמי) |
| `hazmat` | Hazardous Materials (חומרים מסוכנים) |

## How It Works

- The plugin creates a single **motion sensor** in HomeKit.
- It polls the Pikud HaOref API every second (configurable).
- When an alert matches your cities and selected categories, the motion sensor turns **ON**.
- The sensor stays **ON** until Pikud HaOref sends an "Event Ended" message for your city.
- If "Event Ended" is never received (API issue), the alert auto-clears after the configured timeout (default: 10 minutes).
- You can create HomeKit automations based on the motion sensor (e.g. flash lights, play a sound, send a notification).

## License

Apache-2.0
