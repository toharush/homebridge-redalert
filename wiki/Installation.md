# Installation

## Prerequisites

| Requirement | Version |
|:------------|:--------|
| **Node.js** | `^20.15.1` \| `^22` \| `^24` \| `^25` |
| **Homebridge** | `^1.6.0` \| `^2.0.0-beta.0` |

---

## Via Homebridge UI (Recommended)

1. Open the Homebridge UI in your browser
2. Go to the **Plugins** tab
3. Search for **`redalert`**
4. Click **Install** on `@toharush/homebridge-redalert`
5. After installation, click **Settings** to configure your cities

---

## Via Command Line

```bash
npm install -g @toharush/homebridge-redalert
```

Then restart Homebridge:

```bash
sudo systemctl restart homebridge
```

---

## Verify Installation

After restarting Homebridge, check the logs for:

```
[RedAlert] Monitoring X cities, Y category IDs enabled
[RedAlert] Pikud HaOref polling started (every 1000ms)
```

> [!TIP]
> A new **Red Alert** motion sensor should appear in your Home app automatically. If it doesn't, see [Troubleshooting](Troubleshooting.md).

---

## Updating

<details>
<summary><strong>Via Homebridge UI</strong></summary>

Go to **Plugins**, find Red Alert, and click **Update** if available.

</details>

<details>
<summary><strong>Via Command Line</strong></summary>

```bash
npm update -g @toharush/homebridge-redalert
```

Then restart Homebridge.

</details>

---

**Next:** [Configuration](Configuration.md)
