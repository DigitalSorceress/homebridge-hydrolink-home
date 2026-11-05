import type { PlatformAccessory, Service } from 'homebridge';
import type { HydroLinkDevice } from './hydrolinkClient.js';
import type { HydroLinkPlatform } from './platform.js';
import type { ResolvedSettings } from './settings.js';

interface AlarmDef {
  id: string;
  label: string;
  property: string;
}

const ALARMS: AlarmDef[] = [
  { id: 'flow-alarm', label: 'Continuous Flow Alarm', property: 'flow_monitor_alert' },
  { id: 'heavy-use-alarm', label: 'Heavy Daily Use Alarm', property: 'excessive_water_use_alert' },
];

/** The alarm the test switch forces on. */
const TEST_ALARM_ID = 'flow-alarm';

// regen_status_enum: 0 = idle, 1 = scheduled, 2 = recharging (per community docs; unverified on 3700 series)
const REGEN_RECHARGING = 2;
// HomeKit's ambient light characteristic cannot be exactly 0.
const MIN_LUX = 0.0001;

type SensorType =
  | typeof Service.HumiditySensor
  | typeof Service.LeakSensor
  | typeof Service.OccupancySensor
  | typeof Service.LightSensor
  | typeof Service.ContactSensor
  | typeof Service.Switch;

export class SoftenerAccessory {
  private readonly salt: Service;
  private readonly recharge: Service;
  private readonly usage?: Service;
  private readonly offline: Service;
  private readonly testSwitch?: Service;
  private readonly alarmServices = new Map<string, Service>();
  private readonly alarmState = new Map<string, { streak: number; active: boolean }>();
  private lastRegen: unknown;
  private lastDevice?: HydroLinkDevice;
  /** Starts "now" so a restart gets a full grace period before reporting offline. */
  private lastGoodAt = Date.now();
  private stale = false;
  private testForced = false;
  private testTimer?: NodeJS.Timeout;

  constructor(
    private readonly platform: HydroLinkPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly settings: ResolvedSettings,
  ) {
    const { Service: S, Characteristic: C } = platform.api.hap;

    accessory
      .getService(S.AccessoryInformation)!
      .setCharacteristic(C.Manufacturer, 'EcoWater')
      .setCharacteristic(C.Model, 'HydroLink Softener')
      .setCharacteristic(C.SerialNumber, 'unknown');

    this.salt = this.service(S.HumiditySensor, 'salt', 'Salt Level');
    this.recharge = this.service(S.OccupancySensor, 'recharge', 'Recharging');
    if (settings.exposeWaterUsage) {
      this.usage = this.service(S.LightSensor, 'usage', 'Water Used Today');
    } else {
      this.removeIfPresent(S.LightSensor, 'usage');
    }
    for (const alarm of ALARMS) {
      this.alarmServices.set(alarm.id, this.service(S.LeakSensor, alarm.id, alarm.label));
      this.alarmState.set(alarm.id, { streak: 0, active: false });
    }

    // "Open" (contact not detected) means there is a problem: no good data for a while.
    this.offline = this.service(S.ContactSensor, 'offline', 'Softener Offline');
    this.offline.updateCharacteristic(C.ContactSensorState, C.ContactSensorState.CONTACT_DETECTED);

    if (settings.exposeTestSwitch) {
      const sw = this.service(S.Switch, 'test-flow', 'Test Flow Alarm');
      sw.updateCharacteristic(C.On, false);
      sw.getCharacteristic(C.On).onSet((value) => this.setTest(Boolean(value)));
      this.testSwitch = sw;
    } else {
      this.removeIfPresent(S.Switch, 'test-flow');
    }
  }

  private service(type: SensorType, subtype: string, name: string): Service {
    const { Characteristic: C } = this.platform.api.hap;
    const svc = this.accessory.getServiceById(type, subtype) ?? this.accessory.addService(type, name, subtype);
    svc.setCharacteristic(C.Name, name);
    svc.addOptionalCharacteristic(C.ConfiguredName);
    svc.setCharacteristic(C.ConfiguredName, name);
    return svc;
  }

  private removeIfPresent(type: SensorType, subtype: string): void {
    const existing = this.accessory.getServiceById(type, subtype);
    if (existing) {
      this.accessory.removeService(existing);
    }
  }

  update(device: HydroLinkDevice): void {
    const { Characteristic: C } = this.platform.api.hap;
    this.lastDevice = device;
    if (device.is_online) {
      this.lastGoodAt = Date.now();
    }
    this.logDataAge(device);
    this.checkStale();

    const prop = (name: string): unknown => device.properties?.[name]?.value;
    const num = (name: string): number | undefined => {
      const v = Number(prop(name));
      return prop(name) === undefined || prop(name) === null || Number.isNaN(v) ? undefined : v;
    };
    const fault = device.is_online ? C.StatusFault.NO_FAULT : C.StatusFault.GENERAL_FAULT;

    this.accessory
      .getService(this.platform.api.hap.Service.AccessoryInformation)!
      .updateCharacteristic(C.SerialNumber, device.serial_number || 'unknown')
      .updateCharacteristic(C.Model, String(prop('model_description') ?? 'HydroLink Softener'))
      .updateCharacteristic(C.FirmwareRevision, String(prop('base_software_version') ?? '0'));

    // Salt level (as % humidity) + low-salt flag
    const tenths = num('salt_level_tenths');
    if (tenths !== undefined) {
      const pct = Math.min(100, Math.max(0, (tenths * 100) / this.settings.saltTankMaxTenths));
      const lowSaltAlert = Boolean(num('low_salt_alert'));
      this.salt
        .updateCharacteristic(C.CurrentRelativeHumidity, Math.round(pct))
        .updateCharacteristic(
          C.StatusLowBattery,
          lowSaltAlert || pct <= this.settings.lowSaltThresholdPercent
            ? C.StatusLowBattery.BATTERY_LEVEL_LOW
            : C.StatusLowBattery.BATTERY_LEVEL_NORMAL,
        )
        .updateCharacteristic(C.StatusFault, fault);
      this.debug(`salt_level_tenths=${tenths} -> ${pct.toFixed(1)}%`);
    }

    // Recharging
    const regen = prop('regen_status_enum');
    if (regen !== this.lastRegen) {
      this.platform.log.info(`Recharge status changed: ${String(this.lastRegen)} -> ${String(regen)}`);
      this.lastRegen = regen;
    }
    this.recharge.updateCharacteristic(
      C.OccupancyDetected,
      Number(regen) === REGEN_RECHARGING ? C.OccupancyDetected.OCCUPANCY_DETECTED : C.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
    );

    // Water used today (gallons, exposed as "lux")
    const gallons = num('gallons_used_today');
    if (this.usage && gallons !== undefined) {
      this.usage
        .updateCharacteristic(C.CurrentAmbientLightLevel, Math.max(MIN_LUX, gallons))
        .updateCharacteristic(C.StatusFault, fault);
      this.debug(`gallons_used_today=${gallons}`);
    }

    // Alarms
    this.evaluateAlarms(device, fault);
  }

  private evaluateAlarms(device: HydroLinkDevice, fault: number): void {
    for (const alarm of ALARMS) {
      const value = Number(device.properties?.[alarm.property]?.value);
      this.applyAlarm(alarm, Boolean(value) && !Number.isNaN(value), device, fault);
    }
  }

  private applyAlarm(alarm: AlarmDef, raw: boolean, device: HydroLinkDevice, fault: number): void {
    const { Characteristic: C } = this.platform.api.hap;
    const state = this.alarmState.get(alarm.id)!;
    state.streak = raw ? state.streak + 1 : 0;
    const forced = this.testForced && alarm.id === TEST_ALARM_ID;
    const active = forced || (raw && state.streak >= this.settings.alarmConfirmPolls);

    this.alarmServices
      .get(alarm.id)!
      .updateCharacteristic(C.LeakDetected, active ? C.LeakDetected.LEAK_DETECTED : C.LeakDetected.LEAK_NOT_DETECTED)
      .updateCharacteristic(C.StatusFault, fault);

    if (active !== state.active) {
      state.active = active;
      const verb = active ? 'TRIPPED' : 'cleared';
      const suffix = forced || (!active && this.testWasActive) ? ' [TEST]' : '';
      this.platform.log[active ? 'warn' : 'info'](`${alarm.label} ${verb} (${alarm.property}) on ${device.nickname}${suffix}`);
      void this.postWebhook({
        event: active ? 'alarm_tripped' : 'alarm_cleared',
        alarm: alarm.id,
        label: alarm.label,
        property: alarm.property,
        device: device.nickname,
        serial: device.serial_number,
        test: forced || (!active && this.testWasActive),
        gallons_used_today: this.numOrNull(device.properties?.gallons_used_today?.value),
        current_flow_gpm: this.numOrNull(device.properties?.current_water_flow_gpm?.value),
      });
    }
  }

  // --- Test switch -------------------------------------------------------

  private testWasActive = false;

  private setTest(on: boolean): void {
    const { Characteristic: C } = this.platform.api.hap;
    clearTimeout(this.testTimer);

    if (on && !this.lastDevice) {
      this.platform.log.warn('Test alarm requested before any softener data has arrived; ignoring.');
      setTimeout(() => this.testSwitch?.updateCharacteristic(C.On, false), 500);
      return;
    }

    this.testForced = on;
    if (on) {
      this.testWasActive = true;
      this.platform.log.warn(`TEST: forcing "${ALARMS.find((a) => a.id === TEST_ALARM_ID)!.label}" on for ${this.settings.testAlarmSeconds}s`);
      this.testTimer = setTimeout(() => {
        this.testSwitch?.updateCharacteristic(C.On, false);
        this.setTest(false);
      }, this.settings.testAlarmSeconds * 1000);
    }
    this.reevaluate();
    if (!on) {
      this.testWasActive = false;
    }
  }

  private reevaluate(): void {
    if (!this.lastDevice) {
      return;
    }
    const { Characteristic: C } = this.platform.api.hap;
    this.evaluateAlarms(this.lastDevice, this.lastDevice.is_online ? C.StatusFault.NO_FAULT : C.StatusFault.GENERAL_FAULT);
  }

  // --- Offline / stale-data sensor --------------------------------------

  /** Call regularly (the platform does so every minute) and after each poll. */
  checkStale(): void {
    const { Characteristic: C } = this.platform.api.hap;
    const ageMin = (Date.now() - this.lastGoodAt) / 60_000;
    const stale = ageMin > this.settings.staleAfterMinutes;

    this.offline.updateCharacteristic(
      C.ContactSensorState,
      stale ? C.ContactSensorState.CONTACT_NOT_DETECTED : C.ContactSensorState.CONTACT_DETECTED,
    );

    if (stale !== this.stale) {
      this.stale = stale;
      if (stale) {
        this.platform.log.warn(
          `Softener OFFLINE: no good data for ${Math.round(ageMin)} min. Flow alarms will NOT be reported until this recovers.`,
        );
      } else {
        this.platform.log.info('Softener data is flowing again.');
      }
      void this.postWebhook({
        event: stale ? 'offline' : 'back_online',
        label: 'Softener Offline',
        device: this.accessory.displayName,
        minutes_without_data: Math.round(ageMin),
      });
    }
  }

  /** Learn how often the softener really updates, to tune staleness later. */
  private logDataAge(device: HydroLinkDevice): void {
    if (!this.settings.debug) {
      return;
    }
    let newest = 0;
    for (const p of Object.values(device.properties ?? {})) {
      const t = Date.parse(p.updated_at ?? '');
      if (!Number.isNaN(t) && t > newest) {
        newest = t;
      }
    }
    if (newest) {
      this.debug(`newest property update was ${Math.round((Date.now() - newest) / 60_000)} min ago; is_online=${device.is_online}`);
    }
  }

  // --- Helpers -----------------------------------------------------------

  private numOrNull(v: unknown): number | null {
    const n = Number(v);
    return v === undefined || v === null || Number.isNaN(n) ? null : n;
  }

  private async postWebhook(payload: Record<string, unknown>): Promise<void> {
    const url = this.settings.webhookUrl;
    if (!url) {
      return;
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'homebridge-hydrolink-home',
          ...payload,
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.platform.log.warn(`Webhook returned HTTP ${res.status}`);
      }
    } catch (err) {
      this.platform.log.warn(`Webhook failed: ${(err as Error).message}`);
    }
  }

  private debug(msg: string): void {
    if (this.settings.debug) {
      this.platform.log.info(`[debug] ${msg}`);
    }
  }
}
