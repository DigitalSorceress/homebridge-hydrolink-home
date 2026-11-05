# homebridge-hydrolink-home

A read-only Homebridge plugin that exposes an **EcoWater softener** (ERR3702, via the
**HydroLink Home** app) to Apple Home, plus a small status web page.

It uses HydroLink Home's **unofficial** cloud API (`api.hydrolinkhome.com`). EcoWater can change
it at any time. If that happens, the *Softener Offline* sensor will open.

## What you get

| In Apple Home | Source property | Notes |
|---|---|---|
| Salt Level (humidity %) | `salt_level_tenths` | Low-battery flag at the low-salt threshold or when `low_salt_alert` is on |
| Recharging (occupancy) | `regen_status_enum` | Occupied when value is 2 (unverified, see below) |
| Water Used Today (light) | `gallons_used_today` | Gallons shown as "lux": HomeKit has no volume sensor |
| Continuous Flow Alarm (leak) | `flow_monitor_alert` | Softener trips after 30 min of continuous flow |
| Heavy Daily Use Alarm (leak) | `excessive_water_use_alert` | |
| Softener Offline (contact) | none | Opens when there has been no good data for 30 min |
| Test Flow Alarm (switch) | none | Forces the flow alarm on for 60 s to test automations |

Apple Home shows sensors as small readouts at the top of a room, labelled by type
("Light", "Humidity"), not by name. That is an Apple limitation. The names show when you tap through,
and in notifications and the automation picker. Use the alarms (leak sensors) as automation triggers.

**Status page:** `http://<homebridge-host>:8590/` (and `/status.json`). Read-only, no login, so keep
it on your LAN. Set the port to 0 to turn it off.

## Install

On the Homebridge host:

```sh
npm run build && npm pack          # on your dev machine
scp homebridge-hydrolink-home-*.tgz <user>@<homebridge-host>:/tmp/
ssh <user>@<homebridge-host>
sudo hb-service add /tmp/homebridge-hydrolink-home-<version>.tgz
sudo hb-service restart
```

Then open the plugin's settings in the Homebridge UI and enter your HydroLink Home email and password.
The log should say `Adding softener "<name>"` and `Status page: ...`.

Requires Node 18.14+ and Homebridge 1.8+ / 2.x (the plugin is ESM).

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `email`, `password` | | Your HydroLink Home login (stored in plain text in Homebridge's `config.json`) |
| `pollIntervalSeconds` | 300 | Minimum 60 |
| `saltTankMaxTenths` | 85 | Tune until the salt % matches the app |
| `lowSaltThresholdPercent` | 20 | |
| `alarmConfirmPolls` | 1 | Polls an alarm must stay on before it trips |
| `exposeWaterUsage` | true | The Water Used Today sensor |
| `exposeTestSwitch`, `testAlarmSeconds` | true, 60 | The test switch |
| `staleAfterMinutes` | 30 | Minimum 10. When Softener Offline opens |
| `statusPagePort`, `statusPageBind` | 8590, 0.0.0.0 | Port 0 disables the page. Use 127.0.0.1 to keep it local |
| `webhookUrl` | none | JSON POST when an alarm trips or clears, or on offline / back online |
| `debug` | false | Logs raw values and how old the newest reading is |

## Using the alarms

- Put your automations (lights, HomePod alarm, notifications) on **Continuous Flow Alarm**.
  Use **Test Flow Alarm** to try them safely.
- Put one on **Softener Offline** too. While it is open, flow alarms cannot be reported.
- A real alarm can take up to about 35 minutes to arrive: 30 minutes of continuous flow on the
  softener, plus up to one poll interval.

## Known gaps

- `regen_status_enum == 2` meaning "recharging" comes from community docs. Check it on the next recharge
  (the log prints every change).
- "Flow now" is the raw `current_water_flow_gpm`. The scale is unverified against live flow.
- Alarm values have only been seen as 0. Any non-zero value counts as an alarm.
- Read-only. The API has no known way to shut off water or change settings.

## Development

```sh
npm install
npm run build      # compile to dist/
npm run dev        # run a throwaway Homebridge in ./.homebridge-dev (create its config.json first)
```

`config.md` and `.homebridge-dev/` hold credentials and are gitignored. Never commit them.

Credit: the API was worked out by the community, notably
[GrumpyTanker/Ecowater-Hydrolink-HACS](https://github.com/GrumpyTanker/Ecowater-Hydrolink-HACS).
