# homebridge-hydrolink-home

A read-only Homebridge plugin that exposes an **EcoWater water softener** to Apple Home through the
**HydroLink Home** app's cloud service, plus a small status web page.

> **Unofficial prototype, provided as-is.**
> This project is **not affiliated with, endorsed by, or supported by EcoWater**. "EcoWater" and
> "HydroLink" are trademarks of their owners and are used here only to describe compatibility.
> It was built on a best-effort basis from publicly shared community knowledge of HydroLink Home's
> undocumented cloud API, and it was tested against exactly one device: the author's **EcoWater
> ERR3702**, because that is what they had. Other models may or may not work.
> EcoWater can change or block that API at any time. See [Disclaimers](#disclaimers) before using it.

## What it does

Signs in to HydroLink Home with your own account, reads your softener every few minutes, and shows
the data as HomeKit sensors and on a web page. It never changes anything on the softener.

## Exposed Sensors

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

The plugin is not published to npm yet. Install it from source on the Homebridge host:

```sh
git clone https://github.com/DigitalSorceress/homebridge-hydrolink-home.git
cd homebridge-hydrolink-home
npm install
npm run build
npm pack                           # creates homebridge-hydrolink-home-<version>.tgz
```

Then copy the tarball to the Homebridge host and install it. On the Homebridge Raspberry Pi image:

```sh
scp homebridge-hydrolink-home-*.tgz <user>@<homebridge-host>:/tmp/
ssh <user>@<homebridge-host>
sudo hb-service add /tmp/homebridge-hydrolink-home-<version>.tgz
sudo hb-service restart
```

Then open the plugin's settings in the Homebridge UI and enter your HydroLink Home email and password.
The log should say `Adding softener "<name>"` and `Status page: ...`.

**Requirements:** Node 22.12+ and Homebridge 2.x (the plugin is ESM). Developed and tested on
Homebridge 2.5. Older Homebridge 1.x versions are untested and not supported.

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

- `regen_status_enum == 2` meaning "recharging" comes from community docs.
- "Flow now" is the raw `current_water_flow_gpm`. The scale is unverified against live flow.
- Alarm values have only been seen as 0. Any non-zero value counts as an alarm. The alarm path has
  been exercised with the test switch and automated tests, but not by a real flow event.
- Only an ERR3702 has been tested.
- Read-only. The API has no known way to shut off water or change settings.

## Privacy and security

- The plugin talks to `api.hydrolinkhome.com` (your softener's data) and, if you set one, your own
  webhook URL. Nothing else, and there is no analytics or telemetry.
- Your HydroLink Home email and password are stored **in plain text** in Homebridge's `config.json`,
  like most Homebridge plugins. Don't reuse that password elsewhere.
- The status page has **no authentication**. Anyone who can reach its port can see your water and
  salt data. Keep it on your local network, never forward it to the internet, or set the port to 0.
- The plugin only reads data. It never sends commands to the softener.

## Disclaimers

- **Not a safety device.** This is a convenience monitor. It can be late, wrong, or silent, for example
  if EcoWater's service is down, the API changes, or your Homebridge host loses internet. Do not rely
  on it as your only protection against leaks, flooding, or water damage. Use dedicated leak detectors
  and shutoff valves.
- **Provided "AS IS", without warranty of any kind** (see [LICENSE](LICENSE)). Use at your own risk.
- **Unofficial API.** HydroLink Home has no public API. This plugin relies on endpoints worked out by
  the community. The author has **not reviewed EcoWater's or HydroLink Home's terms of use**, and
  cannot say whether this kind of access is permitted under them. You are responsible for checking and
  for how you use it with your account.
- **Best-effort maintenance.** This began as a personal prototype. Issues and pull requests are
  welcome, but there is no guarantee of fixes, support, or compatibility with future EcoWater changes.

## Development

```sh
npm install
npm run build      # compile to dist/
npm test           # compile and run the automated tests (no network, no real account needed)
npm run dev        # run a throwaway Homebridge in ./.homebridge-dev (create its config.json first)
```

The tests use a synthetic sample device in `test/fixtures/` and never contact EcoWater.
`config.md` and `.homebridge-dev/` hold credentials and are gitignored. Never commit them.

## Credit

The API was worked out by the community, notably
[GrumpyTanker/Ecowater-Hydrolink-HACS](https://github.com/GrumpyTanker/Ecowater-Hydrolink-HACS).
This plugin is an independent implementation and does not copy their code.

## License

[MIT](LICENSE) © 2026 DigitalSorceress
