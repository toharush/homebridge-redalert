<p align="center">
  <a href="https://github.com/toharush/homebridge-redalert">
    <img src="branding/homebridge-redalert-banner.png" alt="Homebridge + Red Alert" width="400">
  </a>
</p>

<h1 align="center">@toharush/homebridge-redalert</h1>

<p align="center">
  <strong>Homebridge plugin for Israeli Red Alert (Pikud HaOref) notifications via HomeKit motion sensors.</strong>
  <br><br>
  <a href="https://www.npmjs.com/package/@toharush/homebridge-redalert"><img src="https://img.shields.io/npm/v/@toharush/homebridge-redalert.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@toharush/homebridge-redalert"><img src="https://img.shields.io/npm/dt/@toharush/homebridge-redalert.svg" alt="npm downloads"></a>
  <a href="https://www.npmjs.com/package/@toharush/homebridge-redalert"><img src="https://img.shields.io/npm/dw/@toharush/homebridge-redalert.svg" alt="npm weekly downloads"></a>
  <a href="https://github.com/toharush/homebridge-redalert/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@toharush/homebridge-redalert.svg" alt="license"></a>
  <br>
  <a href="https://github.com/homebridge/homebridge/wiki/Verified-Plugins"><img src="https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=flat" alt="verified by homebridge"></a>
  <img src="https://img.shields.io/node/v/@toharush/homebridge-redalert.svg" alt="node version">
  <img src="https://img.shields.io/badge/homebridge-%3E%3D1.6.0-blueviolet.svg" alt="homebridge version">
  <img src="https://img.shields.io/npm/last-update/@toharush/homebridge-redalert.svg" alt="last updated">
  <a href="https://github.com/toharush/homebridge-redalert/graphs/contributors"><img src="https://img.shields.io/github/contributors/toharush/homebridge-redalert.svg" alt="contributors"></a>
  <a href="https://github.com/toharush/homebridge-redalert"><img src="https://img.shields.io/github/stars/toharush/homebridge-redalert.svg?style=social" alt="GitHub stars"></a>
</p>

<p align="center">
  Multi-source alert pipeline — Pikud HaOref HTTP + Tzofar WebSocket built-in, with support for custom add-on sources. No Telegram, no middleman, no authentication required.
</p>

---

## How It Works

1. The plugin creates one **motion sensor** per configured sensor in HomeKit.
2. An **alert pipeline** ingests alerts from multiple sources simultaneously — **Pikud HaOref** (HTTP polling) and **Tzofar** (WebSocket push) are built-in. Custom sources can be added.
3. Alerts pass through a **deduplication stage** so duplicate alerts from different sources are only processed once.
4. Each sensor independently filters alerts by its own cities and categories.
5. When an alert matches, the sensor turns **ON**. Nationwide alerts (`רחבי הארץ`) activate all configured cities.
6. The sensor stays **ON** until an "Event Ended" message is received, or the alert auto-clears after the configured timeout (default: 30 min).
7. Create HomeKit automations based on each motion sensor (e.g. flash lights, play a sound, send a notification).

---

## Architecture

```
┌────────────────┐  ┌──────────────────┐  ┌─────────────────┐
│  Pikud HaOref  │  │     Tzofar       │  │  Custom Source   │
│  (HTTP poll)   │  │  (WebSocket)     │  │  (HTTP / WS)    │
└───────┬────────┘  └────────┬─────────┘  └───────┬─────────┘
        │                    │                     │
        └────────────┬───────┴─────────────────────┘
                     ▼
            ┌─────────────────┐
            │  AlertPipeline  │
            │  (dedup + fan-  │
            │   out to all    │
            │   sensors)      │
            └────────┬────────┘
                     │
        ┌────────────┼─────────────┐
        ▼            ▼             ▼
  ┌───────────┐ ┌───────────┐ ┌───────────┐
  │ Sensor A  │ │ Sensor B  │ │ Sensor C  │
  │ (filter)  │ │ (filter)  │ │ (filter)  │
  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘
        ▼             ▼             ▼
  ┌───────────┐ ┌───────────┐ ┌───────────┐
  │  HomeKit  │ │  HomeKit  │ │  HomeKit  │
  │  Motion   │ │  Motion   │ │  Motion   │
  │  Sensor   │ │  Sensor   │ │  Sensor   │
  └───────────┘ └───────────┘ └───────────┘
```

Adding sensors does **not** add API calls — all sensors share the same pipeline.

---

## Installation

Search for `redalert` in the Homebridge plugin search, or install manually:

```bash
npm install -g @toharush/homebridge-redalert
```

[![npm](https://nodei.co/npm/@toharush/homebridge-redalert.png)](https://www.npmjs.com/package/@toharush/homebridge-redalert)

---

## Configuration

Configure via the Homebridge UI with the built-in **searchable city selector**, or manually in `config.json`:

```json
{
  "platform": "RedAlert",
  "sensors": [
    {
      "name": "Home",
      "cities": ["תל אביב - יפו", "חיפה"],
      "categories": ["rockets", "uav", "earthquake", "terror"],
      "prefix_matching": false
    }
  ],
  "turnoff_delay": 0,
  "alert_timeout": 1800000,
  "polling_interval": 1000,
  "request_timeout": 3000,
  "reconnect_interval": 10000,
  "max_reconnect_interval": 60000,
  "ping_interval": 60000,
  "pong_timeout": 420000,
  "health_check": false,
  "health_check_threshold": 5,
  "debug": false
}
```

> **Migration note:** Upgrading from v1.x? Your comma-separated `cities` strings will be automatically migrated to the new array format on first launch. No action needed.

### Multi-Sensor Example

Each sensor creates a separate motion sensor in HomeKit with its own cities, categories, and prefix matching:

```json
{
  "platform": "RedAlert",
  "sensors": [
    { "name": "Home", "cities": ["תל אביב - יפו"], "categories": ["rockets", "uav"] },
    { "name": "Office", "cities": ["חיפה"], "prefix_matching": true },
    { "name": "Parents", "cities": ["באר שבע"], "categories": ["rockets"] }
  ]
}
```

---

## Alert Sources

### Built-in Sources

The plugin ships with two alert sources that run simultaneously:

| Source | Type | Description |
|--------|------|-------------|
| **Pikud HaOref** | HTTP polling | Official Home Front Command API, polled every second (configurable) with adaptive timeout |
| **Tzofar** | WebSocket | Real-time push alerts from tzevaadom.co.il with automatic reconnection and keep-alive |

Both sources feed into the same deduplication pipeline, so you get the fastest possible alert delivery without duplicates.

### Custom Add-on Sources

You can add custom HTTP or WebSocket sources via the UI or `config.json`. Custom sources support category mapping to translate source-specific alert types to the plugin's categories:

```json
{
  "platform": "RedAlert",
  "sensors": [{ "name": "Home", "cities": ["תל אביב - יפו"] }],
  "custom_sources": [
    {
      "name": "My Alert API",
      "type": "http",
      "url": "https://my-alert-api.example.com/alerts",
      "headers": { "Authorization": "Bearer ..." },
      "category_mapping": {
        "ROCKET": "rockets",
        "DRONE": "uav"
      }
    },
    {
      "name": "My WS Feed",
      "type": "websocket",
      "url": "wss://my-ws-feed.example.com/alerts",
      "message_type": "ALERT",
      "message_data_field": "data",
      "category_mapping": {
        "1": "rockets",
        "2": "uav"
      }
    }
  ]
}
```

---

## Options Reference

### Sensor Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `name` | Yes | — | Unique sensor name (appears in HomeKit) |
| `cities` | Yes | — | Array of city names in Hebrew. Select from the built-in list or type custom names |
| `categories` | No | All | Alert types to monitor. If empty, all categories are enabled |
| `prefix_matching` | No | `false` | City names match by prefix (e.g. "תל אביב" matches all Tel Aviv sub-areas) |

### HTTP Source Options

| Option | Default | Description |
|--------|---------|-------------|
| `polling_interval` | `1000` | How often to poll HTTP sources in ms (500–5,000) |
| `request_timeout` | `3000` | Max time to wait for HTTP response in ms (1,000–10,000) |

### WebSocket Source Options

| Option | Default | Description |
|--------|---------|-------------|
| `reconnect_interval` | `10000` | Initial delay (ms) before reconnecting after disconnect |
| `max_reconnect_interval` | `60000` | Maximum reconnect delay (ms) after repeated failures (exponential backoff cap) |
| `ping_interval` | `60000` | How often (ms) to send a keep-alive ping |
| `pong_timeout` | `420000` | Max time (ms) to wait for a pong response before terminating (default: 7 min) |

### Sensor Behavior

| Option | Default | Description |
|--------|---------|-------------|
| `turnoff_delay` | `0` | Delay (ms) before turning off after alert ends. Resets if a new alert arrives (0–3,600,000) |
| `alert_timeout` | `1800000` | Auto-clear alerts (ms) if "Event Ended" is never received. Default: 30 min (600,000–3,600,000) |

### Health Monitoring

| Option | Default | Description |
|--------|---------|-------------|
| `health_check` | `false` | Adds a Switch to HomeKit that turns OFF when all sources are unreachable |
| `health_check_threshold` | `5` | Consecutive failures per source before reporting unhealthy (2–30) |

### General

| Option | Default | Description |
|--------|---------|-------------|
| `debug` | `false` | Enable extra debug logging |

### Available Categories

| Key | Description |
|-----|-------------|
| `rockets` | Rockets & Missiles (ירי רקטות וטילים) |
| `uav` | UAV Intrusion (חדירת כלי טיס) |
| `nonconventional` | Non-conventional Threat |
| `warning` | Heads-up Notice (התרעה מוקדמת) |
| `earthquake` | Earthquake (רעידת אדמה) |
| `cbrne` | Chemical / Bio / Nuclear |
| `terror` | Terrorist Infiltration (חדירת מחבלים) |
| `tsunami` | Tsunami (צונאמי) |
| `hazmat` | Hazardous Materials (חומרים מסוכנים) |

---

## Documentation

For detailed docs, architecture, automation examples, and troubleshooting, see the [Wiki](https://github.com/toharush/homebridge-redalert/wiki).

---

## Disclaimer

**חשוב מאוד לקרוא!**

התוסף איננו תוסף רשמי של פיקוד העורף או מערכת הבטחון.
התוסף משתמש ב-API של פיקוד העורף לקבלת התרעות ולכן יתכנו שיבושים.
בכל מקרה יש להמשיך להשתמש באמצעיים הרשמיים של מערכת הבטחון.

1. This plugin is **not** an official Home Front Command product.
2. The plugin uses the Pikud HaOref public API. There may be delays or disruptions.
3. **Always** use the official alert systems alongside this plugin.

---

## License

MIT
