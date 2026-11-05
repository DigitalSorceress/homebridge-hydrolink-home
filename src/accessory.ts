import type { PlatformAccessory, Service } from 'homebridge';
import type { HydroLinkDevice } from './hydrolinkClient.js';
import type { HydroLinkPlatform } from './platform.js';

interface AccessorySettings {
  saltTankMaxTenths: number;
  lowSaltThresholdPercent: number;
  alarmConfirmPolls: number;
  exposeWaterUsage: boolean;
  webhookUrl?: string;
  debug: boolean;
}

interface AlarmDef {
  id: string;
  label: string;
  property: string;
}

const ALARMS: AlarmDef[] = [
  { id: 'flow-alarm', label: 'Continuous Flow Alarm', property: 'flow_monitor_alert' },
  { id: 'heavy-use-alarm', label: 'Heavy Daily Use Alarm', property: 'excessive_water_use_alert' },
];

// regen_status_enum: 0 = idle, 1 = scheduled, 2 = recharging (per community docs; unverified on 3700 series)
const REGEN_RECHARGING = 2;
// HomeKit's ambient light characteristic cannot be exactly 0.
const MIN_LUX = 0.0001;

export class SoftenerAccessory {
  private readonly salt: Service;
  private readonly recharge: Service;
  private readonly usage?: Service;
  private readonly alarmServices = new Map<string, Service>();
  private readonly alarmState = new Map<string, { streak: number; active: boolean }>();
  private lastRegen: unknown;

  constructor(
    private readonly platform: HydroLinkPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly settings: AccessorySettings,
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
  }

  private service(type: typeof Service.HumiditySensor | typeof Service.LeakSensor | typeof Service.OccupancySensor | typeof Service.LightSensor, subtype: string, name: string): Service {
    const { Characteristic: C } = this.platform.api.hap;
    const svc = this.accessory.getServiceById(type, subtype) ?? this.accessory.addService(type, name, subtype);
    svc.setCharacteristic(C.Name, name);
    svc.addOptionalCharacteristic(C.ConfiguredName);
    svc.setCharacteristic(C.ConfiguredName, name);
    return svc;
  }

  private removeIfPresent(type: typeof Service.LightSensor, subtype: string): void {
    const existing = this.accessory.getServiceById(type, subtype);
    if (existing) {
      this.accessory.removeService(existing);
    }
  }

  update(device: HydroLinkDevice): void {
    const { Characteristic: C } = this.platform.api.hap;
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
    for (const alarm of ALARMS) {
      const raw = Boolean(num(alarm.property));
      this.applyAlarm(alarm, raw, device, fault);
    }
  }

  private applyAlarm(alarm: AlarmDef, raw: boolean, device: HydroLinkDevice, fault: number): void {
    const { Characteristic: C } = this.platform.api.hap;
    const state = this.alarmState.get(alarm.id)!;
    state.streak = raw ? state.streak + 1 : 0;
    const active = raw && state.streak >= this.settings.alarmConfirmPolls;

    this.alarmServices
      .get(alarm.id)!
      .updateCharacteristic(C.LeakDetected, active ? C.LeakDetected.LEAK_DETECTED : C.LeakDetected.LEAK_NOT_DETECTED)
      .updateCharacteristic(C.StatusFault, fault);

    if (active !== state.active) {
      state.active = active;
      const verb = active ? 'TRIPPED' : 'cleared';
      this.platform.log[active ? 'warn' : 'info'](`${alarm.label} ${verb} (${alarm.property}) on ${device.nickname}`);
      void this.sendWebhook(alarm, active, device);
    }
  }

  private async sendWebhook(alarm: AlarmDef, active: boolean, device: HydroLinkDevice): Promise<void> {
    const url = this.settings.webhookUrl;
    if (!url) {
      return;
    }
    const gallons = Number(device.properties?.gallons_used_today?.value);
    const flow = Number(device.properties?.current_water_flow_gpm?.value);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'homebridge-hydrolink-home',
          event: active ? 'alarm_tripped' : 'alarm_cleared',
          alarm: alarm.id,
          label: alarm.label,
          property: alarm.property,
          device: device.nickname,
          serial: device.serial_number,
          gallons_used_today: Number.isNaN(gallons) ? null : gallons,
          current_flow_gpm: Number.isNaN(flow) ? null : flow,
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
