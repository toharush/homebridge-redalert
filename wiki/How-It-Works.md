# How It Works

## Overview

The plugin creates a single **HomeKit motion sensor**.
When an alert is active for your configured cities, the sensor turns **ON**.
When all alerts clear, it turns **OFF**.
You build automations on top of this sensor.

---

## Architecture

```
                    +-----------------------------+
                    |    Pikud HaOref API          |
                    |  alerts.json endpoint        |
                    +-------------+---------------+
                                  |
                                  | HTTPS (every 1s)
                                  v
                    +-----------------------------+
                    |        OrefClient            |
                    |  Fetch, parse, clean data    |
                    +-------------+---------------+
                                  |
                                  | OrefRealtimeAlert[]
                                  v
                    +-----------------------------+
                    |       AlertHandler           |
                    |  Filter cities & categories  |
                    |  Track active alerts         |
                    |  Handle "Event Ended"        |
                    +-------------+---------------+
                                  |
                                  | Motion ON / OFF
                                  v
                    +-----------------------------+
                    |     RedAlertPlatform         |
                    |  Homebridge integration      |
                    +-------------+---------------+
                                  |
                                  v
                    +-----------------------------+
                    |    HomeKit / Home App         |
                    |  Automations & notifications |
                    +-----------------------------+
```

---

## Components

<details>
<summary><strong>OrefClient</strong> — <code>src/oref/orefClient.ts</code></summary>

Handles communication with the Pikud HaOref API:

- Polls `https://www.oref.org.il/WarningMessages/alert/alerts.json` on a configurable interval
- Sends required headers (`Referer`, `X-Requested-With`) to match the official website
- Handles BOM characters, empty responses, and request timeouts (5s)
- Passes parsed `OrefRealtimeAlert[]` to the AlertHandler callback

</details>

<details>
<summary><strong>AlertHandler</strong> — <code>src/oref/alertHandler.ts</code></summary>

Core alert processing logic:

- **City matching** — Filters alerts against your configured city set
- **Category filtering** — Only processes alerts whose category you've enabled
- **Event ended** — When the API sends category `10`, removes matching cities from active set
- **Stale expiry** — Auto-clears alerts after the configured timeout (safety fallback)
- **Sensor control** — ON when any city is active, OFF when all clear

</details>

<details>
<summary><strong>RedAlertPlatform</strong> — <code>src/RedAlertPlatform.ts</code></summary>

The main Homebridge platform plugin:

- Validates configuration at startup
- Creates and manages the motion sensor accessory
- Wires together OrefClient and AlertHandler
- Cleans up stale accessories from previous plugin versions

</details>

<details>
<summary><strong>Config Validator</strong> — <code>src/utils/configValidator.ts</code></summary>

Validates the user's configuration. Disables the plugin entirely if cities are missing or still set to the placeholder value.

</details>

<details>
<summary><strong>Debug Logger</strong> — <code>src/utils/debugLogger.ts</code></summary>

Wraps the Homebridge logger with an `easyDebug()` method that only logs when debug mode is on. Supports lazy evaluation via callbacks to avoid unnecessary string construction.

</details>

---

## Alert Lifecycle

```
  Poll API
    |
    v
  Response has alerts? ---- No ----> Expire stale --> Update sensor
    |
   Yes
    |
    v
  For each alert:
    |
    +-- Category = Event Ended (10)?
    |     |
    |    Yes --> Remove cities from active set
    |
    +-- Category in allowed set?
    |     |
    |    No  --> Skip
    |
    +-- Any cities match config?
          |
         No  --> Skip
          |
         Yes --> Add to active set (with timestamp)
                   |
                   v
              Expire stale alerts (past timeout)
                   |
                   v
              Update sensor:
                active cities > 0 ? ON : OFF
```

---

## Alert Data Format

Each alert from the API:

```json
{
  "id": "133456789012345678",
  "cat": "1",
  "title": "ירי רקטות וטילים",
  "data": ["תל אביב - מרכז העיר", "חיפה - כרמל"],
  "desc": "היכנסו למרחב המוגן ושהו בו 10 דקות"
}
```

| Field | Type | Description |
|:------|:-----|:------------|
| `id` | `string` | Unique alert identifier |
| `cat` | `string` | Category ID (numeric string) |
| `title` | `string` | Alert title in Hebrew |
| `data` | `string[]` | Affected city/area names |
| `desc` | `string` | Safety instructions in Hebrew |

---

## Sensor State

| Condition | Sensor | Meaning |
|:----------|:-------|:--------|
| No alerts for your cities | **OFF** | All clear |
| Alert matches city + category | **ON** | Active alert — take shelter |
| "Event Ended" received | **OFF** | Pikud HaOref confirmed all clear |
| Timeout reached | **OFF** | Safety fallback — auto-cleared |

---

**Next:** [Automation Examples](Automation-Examples.md)
