# API Reference

Technical details about the Pikud HaOref API integration.

---

## Endpoint

```
GET https://www.oref.org.il/WarningMessages/alert/alerts.json
```

### Required Headers

| Header | Value |
|:-------|:------|
| `Referer` | `https://www.oref.org.il/` |
| `X-Requested-With` | `XMLHttpRequest` |

> [!WARNING]
> These headers are **required**. Without them, the API may return empty or blocked responses.

---

## Response Format

The API returns a JSON array of alerts, or an empty response when no alerts are active.

```json
[
  {
    "id": "133456789012345678",
    "cat": "1",
    "title": "ירי רקטות וטילים",
    "data": ["תל אביב - מרכז העיר", "חיפה - כרמל"],
    "desc": "היכנסו למרחב המוגן ושהו בו 10 דקות"
  }
]
```

### Fields

| Field | Type | Description |
|:------|:-----|:------------|
| `id` | `string` | Unique alert identifier |
| `cat` | `string` | Category ID (numeric string) |
| `title` | `string` | Alert title in Hebrew |
| `data` | `string[]` | Array of affected city/area names in Hebrew |
| `desc` | `string` | Safety instructions in Hebrew |

### Edge Cases

| Scenario | Response |
|:---------|:---------|
| No active alerts | Empty string, empty array, or whitespace |
| BOM prefix | `\uFEFF` — stripped automatically by the plugin |
| Request timeout | 5-second limit, then rejected |

---

## Alert Categories

Categories are identified by the numeric `cat` field (internally called `matrix_id` by Pikud HaOref).

| ID | Enum Name | Config Key | Description |
|:--:|:----------|:-----------|:------------|
| `1` | `Rockets` | `rockets` | Rockets & Missiles |
| `2` | `NonConventional` | `nonconventional` | Non-conventional Threat |
| `3` | `Earthquake` | `earthquake` | Earthquake |
| `4` | `CBRNE` | `cbrne` | Chemical / Bio / Nuclear |
| `5` | `Tsunami` | `tsunami` | Tsunami |
| `6` | `UAVIntrusion` | `uav` | UAV Intrusion |
| `7` | `HazardousMaterials` | `hazmat` | Hazardous Materials |
| `8` | `Warning` | `warning` | Heads-up Notice |
| `10` | `EventEnded` | — | Event Ended *(system)* |
| `13` | `TerroristInfiltration` | `terror` | Terrorist Infiltration |

> [!NOTE]
> **Category 10 (Event Ended)** is a system category that signals an alert has ended for specific cities. It is **always processed** regardless of the user's category filter. When received, the plugin removes the listed cities from the active alert set.

---

## TypeScript Interfaces

### `OrefRealtimeAlert`

```typescript
interface OrefRealtimeAlert {
  id: string;
  cat: string;
  title: string;
  data: string[];
  desc: string;
}
```

### `OrefCategory`

```typescript
enum OrefCategory {
  Rockets = 1,
  NonConventional = 2,
  Earthquake = 3,
  CBRNE = 4,
  Tsunami = 5,
  UAVIntrusion = 6,
  HazardousMaterials = 7,
  Warning = 8,
  EventEnded = 10,
  TerroristInfiltration = 13,
}
```

### Category Mapping

Maps user-facing config keys to their numeric IDs:

```typescript
const CATEGORY_MAP: Record<string, number[]> = {
  rockets:          [1],
  uav:              [6],
  nonconventional:  [2],
  warning:          [8],
  earthquake:       [3],
  cbrne:            [4],
  terror:           [13],
  tsunami:          [5],
  hazmat:           [7],
};
```

> [!NOTE]
> Each key maps to an **array** of IDs, allowing a single config key to cover multiple API categories if needed in the future.

---

[Back to Home](Home.md)
