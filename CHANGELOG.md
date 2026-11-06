# Changelog

This is a prototype maintained on a best-effort basis. Versions below 1.0 may change without notice.

## Unreleased

- Add MIT license, automated tests, CI, and changelog.
- Rewrite the README with disclaimers, privacy notes, a summary of EcoWater's terms, and known gaps.
- Declare supported versions accurately: Node 22.12+ and Homebridge 2.x.

## 0.3.0

- Add a read-only status web page (default port 8590) and `/status.json`.
- Use a fixed two-column layout on the page.

## 0.2.0

- Add the "Test Flow Alarm" switch, which forces the flow alarm on briefly so automations can be tested.
- Add the "Softener Offline" sensor, which opens when no good data has arrived for `staleAfterMinutes`.

## 0.1.0

- Initial version: salt level, recharging, water used today, and two alarm sensors
  (continuous flow, heavy daily use), with an optional webhook.
