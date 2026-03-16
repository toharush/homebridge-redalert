<p align="center">
  <img src="https://raw.githubusercontent.com/homebridge/branding/latest/logos/homebridge-color-round-stylized.png" width="100">
</p>

<h1 align="center">homebridge-redalert</h1>

<p align="center">
  <strong>Homebridge plugin for Israeli Red Alert (Pikud HaOref) notifications via HomeKit motion sensor.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@toharush/homebridge-redalert"><img src="https://img.shields.io/npm/v/@toharush/homebridge-redalert?style=flat-square&color=red" alt="npm version"></a>
  <a href="https://github.com/toharush/homebridge-redalert/blob/main/LICENSE"><img src="https://img.shields.io/github/license/toharush/homebridge-redalert?style=flat-square" alt="license"></a>
  <img src="https://img.shields.io/badge/node-%5E20%20%7C%20%5E22%20%7C%20%5E24-brightgreen?style=flat-square" alt="node version">
  <img src="https://img.shields.io/badge/homebridge-%5E1.6%20%7C%20%5E2.0-purple?style=flat-square" alt="homebridge version">
</p>

---

The plugin polls the official Pikud HaOref API directly — no Telegram, no middleman, no authentication required.

## Quick Start

```
npm install -g @toharush/homebridge-redalert
```

```json
{
  "platform": "RedAlert",
  "cities": "תל אביב, חיפה"
}
```

> **How it works:** The plugin creates a motion sensor in HomeKit.
> **Motion ON** = active alert | **Motion OFF** = all clear.
> Build any HomeKit automation on top of it.

---

## Wiki Pages

| Page | Description |
|:-----|:------------|
| [Installation](Installation.md) | How to install and set up the plugin |
| [Configuration](Configuration.md) | All configuration options explained in detail |
| [How It Works](How-It-Works.md) | Architecture, polling flow, and alert lifecycle |
| [Automation Examples](Automation-Examples.md) | Ideas for HomeKit automations |
| [Troubleshooting](Troubleshooting.md) | Common issues and how to fix them |
| [API Reference](API-Reference.md) | Technical details about the Pikud HaOref API |

---

> [!CAUTION]
> **This plugin is NOT an official Home Front Command (Pikud HaOref) product.**
>
> - The plugin uses the Pikud HaOref public API. There may be delays or disruptions.
> - Always use the official alert systems alongside this plugin.
> - This is a supplementary tool — **never rely on it as your sole alert source.**

> [!CAUTION]
> **חשוב מאוד לקרוא!**
>
> התוסף איננו תוסף רשמי של פיקוד העורף או מערכת הבטחון.
> התוסף משתמש ב-API של פיקוד העורף לקבלת התרעות ולכן יתכנו שיבושים.
> בכל מקרה יש להמשיך להשתמש באמצעיים הרשמיים של מערכת הבטחון.
