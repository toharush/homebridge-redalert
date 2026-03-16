# Troubleshooting

---

## Plugin Not Starting

<details>
<summary><strong>"No cities found in configuration file, disabling plugin"</strong></summary>

You haven't configured any cities. Open the plugin settings in the Homebridge UI and add at least one city name in Hebrew.

</details>

<details>
<summary><strong>"Cities not configured, disabling plugin"</strong></summary>

The cities field still contains the default placeholder value. Replace it with your actual city names in Hebrew.

</details>

---

## No Alerts Being Detected

<details>
<summary><strong>City name mismatch</strong></summary>

City names must match Pikud HaOref naming **exactly**, including:
- Dashes and spaces (e.g., `תל אביב - מרכז העיר`)
- Parentheses and special characters
- Exact Hebrew spelling

> [!TIP]
> Enable debug mode (`"debug": true`) to see raw API responses and verify what city names the API returns.

</details>

<details>
<summary><strong>Wrong categories selected</strong></summary>

If you've selected specific categories, make sure the relevant ones are included. For rocket alerts, ensure `rockets` is in your categories list.

> [!TIP]
> Remove the `categories` option entirely to monitor **all** alert types.

</details>

<details>
<summary><strong>Network / firewall issues</strong></summary>

The plugin needs outbound HTTPS access to `www.oref.org.il`. If running behind a firewall or proxy, ensure this domain is accessible.

Check logs for errors like:
```
[RedAlert] Failed to fetch alerts: ...
```

</details>

---

## Sensor Stuck ON

<details>
<summary><strong>"Event Ended" not received</strong></summary>

Sometimes the API doesn't send an "Event Ended" signal. The plugin has a safety fallback — alerts auto-clear after the configured `alert_timeout` (default: 10 minutes).

If alerts are stuck longer, verify your timeout value in the config.

</details>

<details>
<summary><strong>Stale accessory from previous version</strong></summary>

If you upgraded from a previous version that used per-city accessories, the plugin automatically removes stale accessories. Check logs for:

```
[RedAlert] Removing X stale accessory(ies)
```

If the sensor still appears stuck, try removing and re-adding the accessory in the Home app.

</details>

---

## Motion Sensor Not Appearing

1. Make sure the plugin is running (check Homebridge logs)
2. Restart Homebridge
3. Check the **Default Room** in the Home app — new accessories appear there
4. If still missing, try removing the Homebridge bridge from HomeKit and re-pairing

---

## Debug Mode

Enable verbose logging to diagnose issues:

```json
{
  "platform": "RedAlert",
  "cities": "תל אביב",
  "debug": true
}
```

Debug logs include:
- Raw API responses
- Alert matching decisions
- Sensor state changes
- Active city tracking

---

## Log Message Reference

| Log Message | Meaning |
|:------------|:--------|
| `Pikud HaOref polling started (every Xms)` | Plugin is running and polling |
| `ALERT: <title> - <city>` | An alert matched your config |
| `Event ended: <city>` | Pikud HaOref confirmed alert ended |
| `All clear - safe to leave shelter` | All active alerts have ended |
| `Alert for <city> expired after X minutes (safety fallback)` | Alert auto-cleared via timeout |
| `Failed to fetch alerts: ...` | Network error polling the API |

---

## Still Having Issues?

[Open an issue on GitHub](https://github.com/toharush/homebridge-redalert/issues) with:

- Homebridge version
- Node.js version
- Relevant log output (with `debug: true`)
- Your configuration (redact personal info)

---

**Next:** [API Reference](API-Reference.md)
