# Automation Examples

The Red Alert motion sensor integrates with HomeKit automations. Here are some ideas to get started.

---

## How Automations Work

All automations use the **Red Alert** motion sensor as the trigger:

| Trigger | Meaning |
|:--------|:--------|
| **Motion Detected** | Alert is active |
| **No Motion** | All clear |

---

## Examples

### Flash All Lights

> **Trigger:** Red Alert detects motion
> **Action:** Turn all lights ON at 100% brightness

Creates a visual alert throughout your home — useful even when sleeping.

---

### Play Audio Alert

> **Trigger:** Red Alert detects motion
> **Action:** Play a sound via HomePod or AirPlay speaker

You can create a scene that sets speaker volume to maximum as part of the automation.

---

### Push Notifications

> **Trigger:** Red Alert detects motion
> **Action:** HomeKit sends push notifications to all household members

To enable:

1. Open the **Home** app
2. Long-press the **Red Alert** sensor
3. Tap the gear icon
4. Enable **Status & Notifications**

> [!TIP]
> This works with all household members who have accepted the Home invitation.

---

### Night Mode Alert

> **Trigger:** Red Alert detects motion **AND** time is 22:00–06:00
> **Actions:**
> - Turn on hallway + shelter room lights
> - Set to warm white at 50% brightness

---

### All Clear Confirmation

> **Trigger:** Red Alert **stops** detecting motion
> **Actions:**
> - Flash lights green briefly (color bulbs)
> - Reset all lights to previous state

---

## Tips

> [!IMPORTANT]
> **Test your automations** before relying on them. You can test by temporarily setting your cities config to a city that currently has an active drill or test alert.

- **Keep it simple** — In an emergency, reliability matters more than complexity.
- **Use scenes** — Create "Alert" and "All Clear" scenes, then trigger them from automations. Easier to manage and update.
- **Local execution** — HomeKit automations run locally on your home hub (Apple TV, HomePod, or iPad). They work even without internet once triggered.

---

**Next:** [Troubleshooting](Troubleshooting.md)
