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

## What's New in v2

- **Multi-source alert pipeline** — Alerts stream from Pikud HaOref (HTTP) and Tzofar (WebSocket) simultaneously. Custom HTTP/WebSocket sources can be added via the UI.
- **Sliding-window deduplication** — Identical alerts from different sources are merged using a 30-second sliding window so sensors only fire once, with no boundary edge cases.
- **Automatic expiry** — Cities auto-clear after the configured timeout (default 30 min) if no "Event Ended" is received. Zero per-poll overhead — scans only when needed.
- **Coverage map** — Interactive Leaflet map in the config UI shows all monitored cities with per-sensor color-coded markers.
- **Active alert overlay** — Pulsing red markers on the map show currently active alerts in real-time. Click an active alert in history to fly to its location.
- **Live connection status** — Green/red status dots on each built-in source card show real-time connectivity.
- **Alert history** — Collapsible panel with filters (city, active/ended) and configurable item limit. Auto-refreshes every 2 seconds.
- **Collapsible UI** — Sensors and source cards collapse/expand for a cleaner config experience.
- **Duplicate sensor** — One-click clone of any sensor to quickly set up multiple locations with similar settings.
- **Inline validation** — Real-time validation highlights missing sensor names or empty city lists before you save.
- **Onboarding empty state** — Friendly first-run experience guides new users through adding their first sensor.
- **Category mapping UI** — Custom sources now clearly show how to map source-specific IDs to plugin alert types, with a dedicated "Category ID Field" input.
- **Prefix matching** — Match sub-areas automatically (e.g. "תל אביב" matches "תל אביב - יפו").
- **Webhooks** — Fire HTTP POST/PUT to any URL when a sensor activates or deactivates. Payload includes sensor name, city, title, and timestamp. Configure multiple endpoints with a 10-second timeout per request.
- **Health check accessory** — Optional HomeKit switch that turns OFF when all sources are unreachable.
- **Automatic config migration** — v1.x comma-separated city strings and `custom_cities` fields are auto-migrated atomically on first launch.

---

## v1 vs v2 Comparison

| Metric | v1 | v2 | Notes |
|--------|----|----|-------|
| Alert sources | 1 (Pikud HaOref HTTP) | 2+ (HTTP + WebSocket + custom) | Fastest alert wins |
| Deduplication | None | Sliding 30s window | No duplicate sensor triggers |
| Expiry | Per-sensor timer | Centralized ExpiryStage | Zero per-poll overhead |
| Network connections | 1 HTTP poll | 1 HTTP poll + 1 WebSocket | +1 persistent connection |
| Memory overhead | ~2 MB | ~4 MB | +dedup map, history buffer, WebSocket buffers |
| Dependencies | lodash | lodash + ws | +1 production dep (~200 KB) |
| Disk I/O | None | Status + history (on change only) | Async non-blocking writes |
| Recovery time | Up to polling interval | WebSocket: instant reconnect with backoff; HTTP: next poll cycle | Dual-source redundancy |
| Performance | Baseline | 0.74–0.91x (faster) | Pipeline overhead is negative at ≤50 alerts |
| Test coverage | ~60 tests | 270 tests | 4.5x increase |

**Bottom line:** v2 is **9-26% faster** than v1 for realistic workloads (≤50 simultaneous alerts) while adding deduplication, automatic expiry, and full alert history. The pipeline eliminates redundant parsing by building `ParsedAlerts` as a free side effect of dedup.

---

## How It Works

1. The plugin creates one **motion sensor** per configured sensor in HomeKit.
2. An **alert pipeline** ingests alerts from multiple sources simultaneously — **Pikud HaOref** (HTTP polling every 1s) and **Tzofar** (WebSocket push, ~50ms delivery) are built-in. Custom HTTP/WebSocket sources can be added.
3. On each poll, alerts first pass through an **ExpiryStage** — it reads the dedup's active city timestamps and injects synthetic "Event Ended" alerts for cities that haven't been refreshed within the configured timeout (default: 30 min). This scan runs infrequently (every ~7.5 min) with zero per-poll cost.
4. Alerts (including any synthetic event-ended) then pass through a **DeduplicationStage** — a per-category city-level check (30s sliding window) ensures cross-source duplicates only fire once. The stage simultaneously builds a `ParsedAlerts` structure for downstream consumers (zero extra parsing).
5. Each sensor independently filters deduplicated alerts by its configured cities, categories, and optional prefix matching.
6. When an alert matches, the sensor turns **ON** and webhooks fire. Nationwide alerts (`רחבי הארץ`) activate all configured cities.
7. The sensor stays **ON** until an "Event Ended" message is received from any source, or ExpiryStage auto-clears it after the timeout.
8. A **health check** accessory (optional HomeKit switch) monitors source connectivity and turns OFF when all sources are unreachable.
9. Create HomeKit automations based on each motion sensor (e.g. flash lights, play a sound, send a notification).

---

## Architecture

```
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│  Pikud HaOref  │  │     Tzofar     │  │ Custom Source  │
│  (HTTP poll)   │  │  (WebSocket)   │  │  (HTTP / WS)  │
└───────┬────────┘  └───────┬────────┘  └───────┬────────┘
        │                   │                    │
        └───────────────────┼────────────────────┘
                            ▼
              ┌──────────────────────────────┐
              │        AlertPipeline         │
              │                              │
              │  ┌────────────────────────┐  │
              │  │      ExpiryStage       │  │
              │  │  (auto-clear 30 min)   │  │
              │  │  reads dedup's seen    │  │
              │  └───────────┬────────────┘  │
              │              │               │
              │  ┌───────────┴────────────┐  │
              │  │   DeduplicationStage   │  │──▶ AlertHistory
              │  │  (30s sliding window)  │  │
              │  │  + builds ParsedAlerts │  │
              │  └───────────┬────────────┘  │
              │              │               │
              │  ┌───────────┴────────────┐  │
              │  │    Fan-out to all      │  │
              │  │    listeners           │  │
              │  └───────────┬────────────┘  │
              └──────────────┼───────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
    ┌───────────┐     ┌───────────┐     ┌───────────┐
    │ Sensor A  │     │ Sensor B  │     │ Sensor C  │
    │  filter   │     │  filter   │     │  filter   │
    └─────┬─────┘     └─────┬─────┘     └─────┬─────┘
          │                  │                  │
     ┌────┴────┐       ┌────┴────┐       ┌────┴────┐
     ▼         ▼       ▼         ▼       ▼         ▼
 ┌───────┐ ┌──────┐ ┌───────┐ ┌──────┐ ┌───────┐ ┌──────┐
 │HomeKit│ │Web-  │ │HomeKit│ │Web-  │ │HomeKit│ │Web-  │
 │Motion │ │hook  │ │Motion │ │hook  │ │Motion │ │hook  │
 │Sensor │ │(POST)│ │Sensor │ │(POST)│ │Sensor │ │(POST)│
 └───────┘ └──────┘ └───────┘ └──────┘ └───────┘ └──────┘
```

Adding sensors does **not** add API calls — all sensors share the same pipeline. ExpiryStage runs first (reads dedup's `seen` Map to detect stale cities), then DeduplicationStage ensures each city/category combination only triggers once per 30-second window, regardless of how many sources report it. Both stages share the same Map for zero per-poll overhead.

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
      "category_field": "type",
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
      "category_field": "threat",
      "category_mapping": {
        "1": "rockets",
        "2": "uav"
      }
    }
  ]
}
```

`category_field` tells the plugin which JSON field holds the category ID in each alert object (defaults to `"cat"`). Then `category_mapping` maps each ID value from your source to a plugin alert type. For reference: Pikud HaOref uses field `cat` with values `1`=rockets, `6`=uav; Tzofar uses field `threat` with values `0`=rockets, `5`=uav.

### Webhooks

Send an HTTP request when any sensor activates or deactivates. The payload includes the sensor name, city, alert title, event type, and timestamp — route or filter on the receiving end:

```json
{
  "platform": "RedAlert",
  "sensors": [{ "name": "Home", "cities": ["תל אביב - יפו"] }],
  "webhooks": [
    {
      "url": "https://my-server.example.com/alert-hook",
      "method": "POST",
      "headers": { "Authorization": "Bearer my-token" }
    }
  ]
}
```

**Payload format:**

```json
{
  "event": "alert",
  "sensor": "Home",
  "city": "תל אביב - יפו",
  "title": "ירי רקטות וטילים",
  "timestamp": 1700000000000
}
```

The `event` field is `"alert"` when a sensor activates and `"ended"` when it deactivates. Multiple webhook URLs can be configured — all fire for every sensor event.

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

### Webhooks

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `url` | Yes | — | The endpoint URL to call on alert/ended events |
| `method` | No | `POST` | HTTP method (`POST` or `PUT`) |
| `headers` | No | `{}` | Custom headers (e.g. `{"Authorization": "Bearer ..."}`) |

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
