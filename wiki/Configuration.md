# Configuration

You can configure the plugin via the **Homebridge UI** or manually in `config.json`.

---

## Minimal Example

```json
{
  "platform": "RedAlert",
  "cities": "תל אביב"
}
```

## Full Example

```json
{
  "platform": "RedAlert",
  "cities": "תל אביב, חיפה, באר שבע",
  "categories": ["rockets", "uav", "earthquake", "terror"],
  "alert_timeout": 10,
  "polling_interval": 1000,
  "debug": false
}
```

---

## Options Reference

### `cities` — Required

| | |
|:--|:--|
| **Type** | `string` |
| **Example** | `"תל אביב, חיפה, באר שבע"` |

Comma-separated list of city names **in Hebrew**. Names must match Pikud HaOref naming exactly.

> [!IMPORTANT]
> City names must be an exact match — including spaces, dashes, and parentheses.
> Check the [Pikud HaOref website](https://www.oref.org.il/) for the correct spelling.

---

### `categories` — Optional

| | |
|:--|:--|
| **Type** | `string[]` |
| **Default** | All categories enabled |

Select which alert types to monitor. If omitted or empty, **all** categories are enabled.

| Key | Description | Hebrew |
|:----|:-----------|:-------|
| `rockets` | Rockets & Missiles | ירי רקטות וטילים |
| `uav` | UAV Intrusion | חדירת כלי טיס |
| `nonconventional` | Non-conventional Threat | — |
| `warning` | Heads-up Notice | התרעה מוקדמת |
| `earthquake` | Earthquake | רעידת אדמה |
| `cbrne` | Chemical / Bio / Nuclear | איום כימי/ביולוגי/גרעיני |
| `terror` | Terrorist Infiltration | חדירת מחבלים |
| `tsunami` | Tsunami | צונאמי |
| `hazmat` | Hazardous Materials | חומרים מסוכנים |

---

### `alert_timeout` — Optional

| | |
|:--|:--|
| **Type** | `number` (minutes) |
| **Default** | `10` |
| **Range** | `1` – `60` |

Safety fallback. If Pikud HaOref never sends an "Event Ended" signal, the alert auto-clears after this many minutes.

> [!NOTE]
> This prevents the motion sensor from being stuck ON indefinitely due to API issues.

---

### `polling_interval` — Optional

| | |
|:--|:--|
| **Type** | `number` (milliseconds) |
| **Default** | `1000` |
| **Range** | `500` – `5000` |

How often the plugin polls the Pikud HaOref API.

| Value | Speed | Note |
|:------|:------|:-----|
| `500` | Fastest | Check every 0.5s |
| `1000` | **Default** | Check every 1s |
| `2000` | Moderate | Check every 2s |
| `5000` | Slowest | Check every 5s |

> [!TIP]
> Lower values = faster detection but more network traffic. The default of 1 second is recommended for most users.

---

### `debug` — Optional

| | |
|:--|:--|
| **Type** | `boolean` |
| **Default** | `false` |

Enables verbose logging including raw API responses and internal state changes. Useful for diagnosing issues.

---

## Homebridge UI

The plugin includes a config schema for the Homebridge UI — all options above are available through the graphical settings form. No manual JSON editing required.

---

**Next:** [How It Works](How-It-Works.md)
