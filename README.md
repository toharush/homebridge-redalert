<div align="center">

<a href="https://github.com/toharush/homebridge-redalert"><img src="branding/homebridge-redalert-banner.png" alt="Homebridge Red Alert – Pikud HaOref Tzeva Adom alerts for HomeKit" width="420"></a>

# Homebridge Red Alert

### Israel Pikud HaOref (Home Front Command) Red Alert – Tzeva Adom – for Apple HomeKit

**Rocket, missile, UAV, terror and earthquake alerts for your city, as HomeKit sensors you can automate.**

<p dir="rtl"><strong>תוסף Homebridge להתרעות צבע אדום של פיקוד העורף ב-HomeKit – ירי רקטות וטילים, חדירת כלי טיס עוין, חדירת מחבלים ורעידות אדמה.</strong></p>

[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=for-the-badge&logoColor=%23FFFFFF&logo=homebridge)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![Downloads](https://img.shields.io/npm/dt/@toharush/homebridge-redalert?color=%23D32F2F&logo=npm&logoColor=%23FFFFFF&style=for-the-badge&label=downloads)](https://www.npmjs.com/package/@toharush/homebridge-redalert)
[![Version](https://img.shields.io/npm/v/@toharush/homebridge-redalert?color=%23D32F2F&label=latest&logo=npm&logoColor=%23FFFFFF&style=for-the-badge)](https://www.npmjs.com/package/@toharush/homebridge-redalert)
[![Stars](https://img.shields.io/github/stars/toharush/homebridge-redalert?color=%23D32F2F&logo=github&logoColor=%23FFFFFF&style=for-the-badge)](https://github.com/toharush/homebridge-redalert/stargazers)

![Homebridge](https://img.shields.io/badge/homebridge-%5E1.6.0%20%7C%7C%20%5E2.0.0-491F59?style=flat-square)
![Node](https://img.shields.io/badge/node-22%20%7C%2024%20%7C%2025-339933?style=flat-square&logo=node.js&logoColor=white)
![Tests](https://img.shields.io/badge/tests-340%2B-success?style=flat-square)
![License](https://img.shields.io/npm/l/@toharush/homebridge-redalert?style=flat-square)
![Last update](https://img.shields.io/npm/last-update/@toharush/homebridge-redalert?style=flat-square)

**[Quick Start](#quick-start)** · **[Features](#why-homebridge-red-alert)** · **[Screenshots](#screenshots)** · **[Apple TV](#apple-tv-alerts-beta)** · **[Automations](#automation-ideas)** · **[Configuration](#configuration)** · **[FAQ](#faq)** · **[עברית](#בעברית)**

</div>

---

> **The siren sounds. Your lights turn red, the hallway to the shelter (ממ"ד) lights up and your HomePod sounds the alarm – before you even reach your phone.**

Homebridge Red Alert turns every Pikud HaOref (פיקוד העורף) alert into a HomeKit **motion sensor** that switches ON for the cities you choose and OFF when the Home Front Command announces the event has ended. Build any automation you want on top of it.

> 🆕 **New (beta): alerts on your Apple TV.** A live map of the alerted cities pops up over whatever you're watching, and lands on your iPhone, iPad, Mac and Apple Watch too. [See how it works ↓](#apple-tv-alerts-beta)

<p align="center">
  <img src="assets/readme/apple-tv-rockets.jpg" alt="Red Alert on Apple TV: rockets and missiles alert picture with Tel Aviv area cities highlighted on a map of Israel" width="720">
  <br><sub>The picture your Apple TV shows when a siren sounds – drawn live at alert time.</sub>
</p>

<p align="center">
  <img src="branding/screenshots/coverage-map.png" alt="Homebridge Red Alert coverage map: monitored cities per sensor and live pulsing Tzeva Adom alerts" width="900">
  <br><sub>The built-in coverage map: your monitored cities per sensor, with live alerts pulsing in red.</sub>
</p>

<div align="center">

| ⚡ **~50 ms** | 🛰️ **2 sources at once** | 🏙️ **1,450 cities** | 🚨 **9 alert types** | 🧪 **340+ tests** |
|:---:|:---:|:---:|:---:|:---:|
| Tzofar WebSocket push | Pikud HaOref + Tzofar | every Home Front Command zone | rockets to tsunami | incl. life-safety suite |

</div>

## Why Homebridge Red Alert

### 🚀 Fast and redundant
- **Two sources at the same time** – Pikud HaOref (HTTP, polled every second) and Tzofar / tzevaadom.co.il (WebSocket push, ~50 ms). Whichever reports first triggers your sensor.
- **No duplicates** – a 30-second sliding window merges the same alert from different sources, so your automation fires once.
- **Self-healing connections** – after a failure the Pikud HaOref timeout tightens to retry faster, and the WebSocket reconnects with backoff and drops connections that went silently dead.
- **Backup sources in one click** – add Mako, Prog.co.il or Kumta Telegram channels from the built-in marketplace (beta).

### 🛡️ Built for when it matters
- **Drills never set off your house** – Tzofar drill messages are ignored.
- **Never stuck ON** – sensors clear on "Event Ended", and a separate timer auto-clears them after a timeout even if every source is offline.
- **Life-safety tested** – a dedicated test suite checks that a new alert always beats an "ended" message, that another city's all-clear can't switch off yours, and that webhooks fire once.
- **Robust parsing** – "Event Ended" is recognized even when Pikud HaOref sends it under the wrong category, and Tzofar early warnings and all-clears are detected from structured data or Hebrew text.
- **Health check switch** – an optional HomeKit switch turns OFF when no alert source is reachable, so you know your alerts are working.

### 🏠 Made for HomeKit
- **As many locations as you want** – home, office, parents, kids' school. Each is its own HomeKit sensor with its own cities and alert types.
- **Every alert type** – rockets & missiles, hostile UAVs, terrorist infiltration, early warnings, earthquakes, tsunami, hazardous materials, non-conventional threats.
- **Nationwide alerts handled** – `רחבי הארץ` triggers every configured city, still respecting your alert-type filter.
- **Automations survive restarts** – accessories keep the same identity, and removed sensors are cleaned up automatically.
- **Alerts on Apple TV (beta)** – a HomeKit doorbell rings on every alert, so Apple TV shows a banner with a live map of the alerted cities over whatever is playing. Also on iPhone, iPad, Mac and Apple Watch.
- **Webhooks** – POST/PUT to Home Assistant, Node-RED, n8n or your own server on every alert and every all-clear.

### ⚙️ A config UI you'll actually enjoy
- Searchable picker for all **1,450** Hebrew city zones, with their area shown
- Interactive coverage map with live alerts, collapsible alert history with filters, live source status
- Dark mode, inline validation, one-click sensor duplication, automatic migration from v1

### 🔒 Private by design
- No account, no sign-up, no telemetry. The plugin talks only to the alert sources and the webhooks you configure. (The config page's map loads its tiles from OpenStreetMap.)
- Homebridge Verified, free and open source (MIT).

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="branding/screenshots/sensor-settings.png" alt="Sensor settings: Hebrew city picker and alert categories"><br><sub><b>Per-sensor settings</b> – pick cities in Hebrew and choose which alert types trigger it.</sub></td>
    <td width="50%"><img src="branding/screenshots/alert-history.png" alt="Alert history with active and ended Red Alert events from Tzofar and Pikud HaOref"><br><sub><b>Alert history</b> – every alert with its source, city and status, filterable.</sub></td>
  </tr>
</table>

<table>
  <tr>
    <td width="50%"><img src="assets/readme/apple-tv-rockets.jpg" alt="Apple TV Red Alert banner picture: rockets and missiles"><br><sub><b>Apple TV – rockets and missiles</b> – the alerted cities glow on the map.</sub></td>
    <td width="50%"><img src="assets/readme/apple-tv-uav.jpg" alt="Apple TV Red Alert banner picture: hostile aircraft intrusion"><br><sub><b>Apple TV – hostile aircraft</b> – every alert type has its own color.</sub></td>
  </tr>
</table>

<sub>Screenshots show demo data.</sub>

## Quick Start

1. In the Homebridge UI, open **Plugins** and search for **`red alert`** or **`pikud haoref`**. Install **Red Alert (Pikud HaOref)** by toharush. Or from the terminal:

   ```bash
   npm install -g @toharush/homebridge-redalert
   ```

2. Open the plugin settings, add a sensor, and pick your cities from the Hebrew city list (e.g. `תל אביב - מרכז העיר`).
3. Restart Homebridge. A motion sensor appears in the Home app. Build automations on it.

## Automation Ideas

| When the sensor… | Do this in the Home app |
|------------------|-------------------------|
| 🔴 Detects motion (alert started) | Turn every light red at 100% |
| 🚪 Detects motion | Turn on the hallway and shelter (ממ"ד) lights, open smart blinds |
| 🔊 Detects motion | Play a sound or a playlist on your HomePod / AirPlay speakers |
| 📱 Detects motion on "Parents" sensor | Get a Home app notification (enable notifications on that sensor) |
| ✅ Stops detecting motion (event ended) | Restore the previous scene |
| ⚠️ Health-check switch turns OFF | Get notified that alerts are not being received |

Need more than HomeKit? Use [webhooks](#webhooks) to forward every alert to Home Assistant, Node-RED or any HTTP endpoint.

## How It Works

1. The plugin creates one **motion sensor** per configured sensor in HomeKit.
2. An **alert pipeline** ingests alerts from multiple sources simultaneously — **Pikud HaOref** (HTTP polling every 1s) and **Tzofar** (WebSocket push, ~50ms delivery) are built-in. Add-on sources (Telegram channels, Mako, Prog.co.il, or custom HTTP/WebSocket) can be added via the UI.
3. On each poll, alerts first pass through an **ExpiryStage** — it reads the dedup's active city timestamps and injects synthetic "Event Ended" alerts for cities that haven't been refreshed within the configured timeout (default: 30 min). This scan runs every ~30 seconds with zero per-poll cost.
4. Alerts (including any synthetic event-ended) then pass through a **DeduplicationStage** — a per-category city-level check (30s sliding window) ensures cross-source duplicates only fire once. The stage simultaneously builds a `ParsedAlerts` structure for downstream consumers (zero extra parsing).
5. Each sensor independently filters deduplicated alerts by its configured cities, categories, and optional prefix matching.
6. When an alert matches, the sensor turns **ON** and webhooks fire. Nationwide alerts (`רחבי הארץ`) activate all configured cities.
7. The sensor stays **ON** until an "Event Ended" message is received from any source, or ExpiryStage auto-clears it after the timeout.
8. A **health check** accessory (optional HomeKit switch) monitors source connectivity and turns OFF when all sources are unreachable.
9. Create HomeKit automations based on each motion sensor (e.g. flash lights, play a sound, send a notification).

---

## Configuration

Configure via the Homebridge UI with the built-in **searchable city selector**, or manually in `config.json`:

```json
{
  "platform": "RedAlert",
  "sensors": [
    {
      "name": "Home",
      "cities": ["תל אביב - מרכז העיר", "חיפה - מערב"],
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
    { "name": "Home", "cities": ["תל אביב - מרכז העיר"], "categories": ["rockets", "uav"] },
    { "name": "Office", "cities": ["חיפה"], "prefix_matching": true },
    { "name": "Parents", "cities": ["באר שבע - צפון"], "categories": ["rockets"] }
  ]
}
```

---

## Alert Sources

### Built-in Sources

The plugin ships with two built-in alert sources that run simultaneously:

| Source | Type | Description |
|--------|------|-------------|
| **Pikud HaOref** | HTTP polling | Official Home Front Command API, polled every second (configurable) with adaptive timeout |
| **Tzofar** | WebSocket | Real-time push alerts from tzevaadom.co.il with automatic reconnection, keep-alive, early warning, and event-ended support (city IDs resolved from Tzofar's city database) |

Both sources feed into the same deduplication pipeline, so you get the fastest possible alert delivery without duplicates.

### Source Marketplace (Beta)

The config UI includes a one-click marketplace for add-on sources. All marketplace sources are in **beta** and are not recommended as your sole alert source:

| Source | Type | Description |
|--------|------|-------------|
| **Mako** | HTTP | Mako/N12 news mirror of Pikud HaOref. No geo-restriction. |
| **Prog.co.il** | HTTP | Independent alert mirror with per-city items and TTL. |
| **Kumta Rockets** | Telegram | Kumta channel for rocket & missile alerts. Requires Telegram API credentials. |
| **Kumta Terror** | Telegram | Kumta channel for terrorist infiltration alerts. Requires Telegram API credentials. |

### Telegram Sources (Beta)

Telegram sources monitor alert channels and parse city names from message content. Setup:

1. Get API credentials from [my.telegram.org](https://my.telegram.org)
2. Add a Telegram source from the **Source Marketplace** (e.g. Kumta Rockets, Kumta Terror)
3. Enter your API ID and API Hash when prompted
4. Scan the QR code in Telegram (Settings > Devices > Link Desktop Device)
5. Once connected, the session is saved — no re-authentication needed on restart

Each Telegram source has a default alert category (e.g. rockets, terror) used when no keyword is detected in the message header. City names are extracted from the message body and matched against the plugin's city database.

### Custom Add-on Sources

You can add custom HTTP, WebSocket, or Telegram sources via the UI or `config.json`. Custom sources support category mapping to translate source-specific alert types to the plugin's categories — including `eventended` to signal that an alert has cleared:

```json
{
  "platform": "RedAlert",
  "sensors": [{ "name": "Home", "cities": ["תל אביב - מרכז העיר"] }],
  "custom_sources": [
    {
      "name": "My Alert API",
      "type": "http",
      "url": "https://my-alert-api.example.com/alerts",
      "headers": { "Authorization": "Bearer ..." },
      "category_field": "type",
      "category_mapping": {
        "ROCKET": "rockets",
        "DRONE": "uav",
        "CLEAR": "eventended"
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
        "0": "rockets",
        "5": "uav",
        "2": "terror",
        "99": "eventended"
      }
    }
  ]
}
```

`category_field` tells the plugin which JSON field holds the category ID in each alert object (defaults to `"cat"`). Then `category_mapping` maps each ID value from your source to a plugin alert type. Map a value to `eventended` to signal that an alert has cleared for the listed cities — this immediately deactivates matching sensors. If no `eventended` mapping is provided, the plugin's ExpiryStage will auto-clear alerts after the configured timeout.

For reference: Pikud HaOref uses field `cat` with values `1`=rockets, `6`=uav; Tzofar uses field `threat` with values `0`=rockets, `5`=uav.

### Webhooks

Send an HTTP request when any sensor activates or deactivates. The payload includes the sensor name, city, alert title, event type, and timestamp — route or filter on the receiving end:

```json
{
  "platform": "RedAlert",
  "sensors": [{ "name": "Home", "cities": ["תל אביב - מרכז העיר"] }],
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
  "city": "תל אביב - מרכז העיר",
  "title": "ירי רקטות וטילים",
  "timestamp": 1700000000000,
  "category": 1
}
```

The `event` field is `"alert"` when a sensor activates and `"ended"` when it deactivates. `category` is the Pikud HaOref category ID of the matched alert (see [Available Categories](#available-categories)) and is omitted on `"ended"` events. Multiple webhook URLs can be configured — all fire for every sensor event.

### Apple TV Alerts (Beta)

tvOS has no notification API for plugins, but it does show HomeKit doorbell rings as a banner over whatever is playing. Turn on **Show Alerts on Apple TV** (`apple_tv_alerts`) and the plugin adds a HomeKit video doorbell, "Red Alert TV", that rings on every alert. The banner's picture is drawn at alert time: a map of Israel with the alerted cities highlighted, the alert type in Hebrew, the city names and the time.

<table>
  <tr>
    <td width="50%"><img src="assets/readme/apple-tv-rockets.jpg" alt="Apple TV alert picture: rockets and missiles, Tel Aviv area cities highlighted on a map of Israel"><br><sub><b>Rockets and missiles</b> – alerted cities glow on the map.</sub></td>
    <td width="50%"><img src="assets/readme/apple-tv-uav.jpg" alt="Apple TV alert picture: hostile aircraft intrusion, Haifa bay cities highlighted on a map of Israel"><br><sub><b>Hostile aircraft</b> – each alert type has its own color.</sub></td>
  </tr>
</table>

Because it works through a HomeKit doorbell:

- **Apple TV** shows a banner with the picture over whatever is playing.
- **iPhone, iPad, Mac and Apple Watch** get a doorbell notification with the picture.
- **HomePod** may play a doorbell chime (no picture or text; set it in the Home app).

**Setup**

1. Enable **Show Alerts on Apple TV** in the plugin settings and restart Homebridge.
2. In the Home app tap **+ → Add Accessory → More options**, pick **Red Alert TV** and enter the bridge PIN (or the child bridge PIN). It is its own accessory, so it is paired separately from the bridge.
3. Open the doorbell's settings and turn **notifications** on.
4. Keep **Camera Status** on **Stream** for both At Home and Away. When it is Off, HomeKit shows no picture.
5. On the Apple TV: same Apple ID and Home, and doorbell notifications on in **Settings → AirPlay and HomeKit**.

```json
{
  "platform": "RedAlert",
  "sensors": [{ "name": "Home", "cities": ["תל אביב - מרכז העיר"] }],
  "apple_tv_alerts": true
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `apple_tv_alerts` | `false` | Ring a HomeKit video doorbell on every alert, so Apple TV shows a banner with the alert picture |
| `apple_tv_name` | `"Red Alert TV"` | Doorbell name in the Home app |
| `apple_tv_sensors` | All sensors | Sensor names whose alerts ring the doorbell |
| `apple_tv_min_ring_interval` | `20000` | Minimum time (ms) between rings; new cities in between only update the picture (minimum 5,000) |
| `apple_tv_max_cities` | `12` | City names listed in the picture before "ועוד N" (1–20) |
| `apple_tv_ffmpeg_path` | Bundled | ffmpeg used for the live picture; leave empty for the ffmpeg installed with the plugin |

**How it behaves**

- HomeKit sensors and webhooks are always updated first. The ring follows, and only then is the picture drawn, in a background worker thread, so drawing never delays a sensor, a webhook or the ring.
- The first new city rings at once. More cities within `apple_tv_min_ring_interval` update the picture without ringing again, and one more ring follows when that time is up. "Event ended" never rings.
- One doorbell serves all sensors (or the ones in `apple_tv_sensors`); a city reported by two sensors is listed once.

**Live picture**

The picture is also sent as live video. Anything showing the camera live (Apple TV picture-in-picture, the Home app camera view, a long-pressed iPhone notification) updates within about a second. The iPhone banner and lock-screen thumbnail keep the picture from the ring; that is Apple's behavior.

- ffmpeg comes with the plugin (`ffmpeg-for-homebridge`, an optional dependency), including in Docker. If it can't run, the plugin logs one warning and the doorbell stays picture-only.
- It runs only while a device is watching, at 5 frames per second, at a lower priority than Homebridge. The picture is drawn once per change and ffmpeg only turns it into video. Measured on an Apple M3: about 2.4% of one core at 640x360 and 3.5% at 1280x720, about 25–35 MB of RAM per viewer, and 150–550 kbit/s. Expect several times more CPU on a Raspberry Pi.
- Up to two devices can watch at once (for example the Apple TV and an iPhone).
- Keep Camera Status on Stream in the Home app.

**Live map or fallback picture**

The fallback picture is decided by the Homebridge server, not by the Apple TV. Every Apple TV gets the ring and a picture either way. When the server can't run the drawing library (`@napi-rs/canvas`, installed automatically as an optional dependency), the picture is the static fallback below instead of the live map.

<p align="center">
  <img src="assets/fallback-alert.jpg" alt="Static fallback Red Alert picture shown on Apple TV when the live map can't be drawn: התרעה – בדקו את ההתרעות באזורכם" width="560">
  <br><sub>The static fallback picture: "התרעה – בדקו את ההתרעות באזורכם" (Alert – check the alerts in your area).</sub>
</p>

The library ships builds for these servers, so they get the live picture:

- Raspberry Pi 2, 3, 4, 5 and Zero 2 W, on a 32-bit or 64-bit OS
- Linux on PC or NAS (x64 or arm64), including Docker and Alpine
- macOS on Intel or Apple Silicon
- Windows (x64 or arm64)

These have no build, so they fall back to the static picture:

- Raspberry Pi Zero, Zero W and Pi 1 (armv6)
- 32-bit x86 Linux or Windows
- 32-bit ARM Alpine (musl)
- FreeBSD
- Any install that skips optional packages, such as `npm install --omit=optional`

**Limits**

- The banner's own text ("Someone is at the door") is set by Apple and can't be changed.

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

### Telegram Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `telegram_api_id` | Yes* | — | Telegram API ID from [my.telegram.org](https://my.telegram.org). Required when using Telegram sources |
| `telegram_api_hash` | Yes* | — | Telegram API Hash from [my.telegram.org](https://my.telegram.org). Required when using Telegram sources |

### General

| Option | Default | Description |
|--------|---------|-------------|
| `debug` | `false` | Enable extra debug logging |

### Available Categories

These categories can be selected per-sensor to filter which alert types trigger the sensor:

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

> **Note:** `eventended` is a special mapping key available only in custom source `category_mapping`. It signals that alerts have cleared for the listed cities. It is not selectable per-sensor — event-ended is always processed automatically to deactivate sensors.

---

## FAQ

**Is this an official Pikud HaOref / Home Front Command app?**
No. It is a community plugin that reads the public Pikud HaOref alert feed plus other public alert sources. Always keep the official Home Front Command app and sirens as your primary warning.

**Is this the same package as `homebridge-redalert` (without `@toharush/`)?**
No. That unscoped npm package is an unrelated plugin from 2021. This plugin is published as **`@toharush/homebridge-redalert`** and is the Homebridge Verified one.

**How fast are the alerts?**
Tzofar pushes alerts over a WebSocket (~50 ms delivery) and Pikud HaOref is polled every second. The first source to report an alert triggers the sensor; the others are deduplicated.

**Which alert types are supported?**
Rockets & missiles (ירי רקטות וטילים), hostile aircraft / UAV intrusion (חדירת כלי טיס עוין), terrorist infiltration (חדירת מחבלים), early warnings (התרעה מוקדמת), earthquake (רעידת אדמה), tsunami, hazardous materials, and non-conventional / CBRNE threats. See [Available Categories](#available-categories).

**Can I monitor more than one city?**
Yes. Every sensor can hold any number of cities, and you can create as many sensors as you like. Prefix matching covers sub-areas (e.g. `תל אביב` matches `תל אביב - מרכז העיר` and `תל אביב - מזרח`). Nationwide alerts (`רחבי הארץ`) trigger every sensor.

**Does it work if Homebridge runs outside Israel?**
The Pikud HaOref API may block requests from outside Israel. Tzofar keeps working, and you can add the Mako source from the marketplace, which has no geo-restriction.

**Can I see alerts on my TV?**
Yes, on Apple TV (beta). Turn on **Show Alerts on Apple TV** and the plugin adds a HomeKit video doorbell that rings on every alert; Apple TV shows it as a banner with a map of the alerted cities over whatever is playing. See [Apple TV Alerts](#apple-tv-alerts-beta).

**Does it cost anything?**
No. It is free and open source under the MIT license.

**Does adding more sensors add more network traffic?**
No. All sensors share one alert pipeline, so 1 sensor or 20 sensors use the same connections.

---

## Under the Hood

<details>
<summary><strong>Architecture</strong></summary>

```
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│  Pikud HaOref  │  │     Tzofar     │  │  Add-on Source │
│  (HTTP poll)   │  │  (WebSocket)   │  │ (HTTP/WS/TG)  │
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

</details>

<details>
<summary><strong>What's new in v2</strong></summary>

- **Multi-source alert pipeline** — Alerts stream from Pikud HaOref (HTTP) and Tzofar (WebSocket) simultaneously. Custom HTTP/WebSocket sources can be added via the UI.
- **Tzofar early warning & event-ended** — Full SYSTEM_MESSAGE support: early warnings (`instructionType=0`) and event-ended (`instructionType=1`) are parsed with city ID resolution from Tzofar's city database (fetched on startup).
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
- **Prefix matching** — Match sub-areas automatically (e.g. "תל אביב" matches "תל אביב - מרכז העיר").
- **Webhooks** — Fire HTTP POST/PUT to any URL when a sensor activates or deactivates. Payload includes sensor name, city, title, and timestamp. Configure multiple endpoints with a 10-second timeout per request.
- **Health check accessory** — Optional HomeKit switch that turns OFF when all sources are unreachable.
- **Source marketplace (Beta)** — One-click add pre-configured add-on sources from the config UI: Mako (HTTP), Prog.co.il (HTTP), and Telegram channels (Kumta Rockets, Kumta Terror). All add-on sources are in beta. Telegram sources use QR-based login — no bot tokens needed.
- **Automatic config migration** — v1.x comma-separated city strings and `custom_cities` fields are auto-migrated atomically on first launch.

</details>

<details>
<summary><strong>v1 vs v2 comparison</strong></summary>

| Metric | v1 | v2 | Notes |
|--------|----|----|-------|
| Alert sources | 1 (Pikud HaOref HTTP) | 2+ (HTTP + WebSocket + add-ons) | Fastest alert wins |
| Deduplication | None | Sliding 30s window | No duplicate sensor triggers |
| Expiry | Per-sensor timer | Centralized ExpiryStage | Zero per-poll overhead |
| Network connections | 1 HTTP poll | 1 HTTP poll + 1 WebSocket | +1 persistent connection |
| Memory overhead | ~2 MB | ~4 MB | +dedup map, history buffer, WebSocket buffers |
| Dependencies | lodash | lodash + ws | +1 production dep (~200 KB) |
| Disk I/O | None | Status + history (on change only) | Async non-blocking writes |
| Recovery time | Up to polling interval | WebSocket: instant reconnect with backoff; HTTP: next poll cycle | Dual-source redundancy |
| Performance | Baseline | 0.64–0.90x (faster) | Pipeline overhead is negative at ≤50 alerts |
| Test coverage | ~60 tests | 340+ tests | ~5x increase |

**Bottom line:** v2 is **10-36% faster** than v1 for realistic workloads (≤50 simultaneous alerts) while adding deduplication, automatic expiry, and full alert history. The pipeline eliminates redundant parsing by building `ParsedAlerts` as a free side effect of dedup.

</details>

---

## בעברית

<div dir="rtl">

**Homebridge Red Alert** הוא תוסף Homebridge מאומת שמחבר את התרעות **צבע אדום** של **פיקוד העורף** ל-Apple HomeKit.

לכל מיקום שתגדירו (בית, עבודה, הורים) נוצר חיישן תנועה ב-HomeKit, שנדלק כשיש התרעה באחת הערים שבחרתם ונכבה כשמתקבלת הודעת "האירוע הסתיים". אפשר לבנות עליו אוטומציות באפליקציית הבית: להדליק את האורות באדום, להדליק את האור בממ"ד, להשמיע צליל ב-HomePod ועוד.

- התרעות מפיקוד העורף ומצופר במקביל, בלי כפילויות
- ירי רקטות וטילים, חדירת כלי טיס עוין, חדירת מחבלים, התרעה מוקדמת, רעידת אדמה ועוד
- בחירת ערים בעברית, מפת כיסוי, היסטוריית התרעות ו-webhooks
- תרגילים לא מפעילים את החיישן, והחיישן נכבה אוטומטית גם אם כל המקורות לא זמינים
- בחירה מתוך 1,450 אזורי התרעה, מפת כיסוי חיה ומצב כהה
- חדש (בטא): התרעות על מסך ה-Apple TV – באנר עם מפה של הערים שבהתרעה, מעל כל מה שמשודר, וגם באייפון, באייפד, במק וב-Apple Watch
- חינמי וקוד פתוח

**התקנה:** בממשק Homebridge חפשו `red alert` או `pikud haoref` והתקינו את **Red Alert (Pikud HaOref)**, או הריצו:

</div>

```bash
npm install -g @toharush/homebridge-redalert
```

---

## Documentation

For detailed docs, automation examples and troubleshooting, see the [Wiki](https://github.com/toharush/homebridge-redalert/wiki). Found a bug or have an idea? [Open an issue](https://github.com/toharush/homebridge-redalert/issues).

If this plugin helps keep your family safe, please ⭐ **star the repo** – it helps other people in Israel find it.

---

## Disclaimer

**חשוב מאוד לקרוא!**

התוסף איננו תוסף רשמי של פיקוד העורף או מערכת הביטחון.
התוסף משתמש ב-API של פיקוד העורף לקבלת התרעות ולכן ייתכנו שיבושים.
בכל מקרה יש להמשיך להשתמש באמצעים הרשמיים של מערכת הביטחון.

1. This plugin is **not** an official Home Front Command product.
2. The plugin uses the Pikud HaOref public API. There may be delays or disruptions.
3. **Always** use the official alert systems alongside this plugin.

---

## License

MIT
