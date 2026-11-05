export const PLUGIN_NAME = 'homebridge-hydrolink-home';
export const PLATFORM_NAME = 'HydroLinkHome';

/** Raw values from the Homebridge config. */
export interface HydroLinkConfig {
  name?: string;
  email?: string;
  password?: string;
  pollIntervalSeconds?: number;
  saltTankMaxTenths?: number;
  lowSaltThresholdPercent?: number;
  alarmConfirmPolls?: number;
  exposeWaterUsage?: boolean;
  exposeTestSwitch?: boolean;
  testAlarmSeconds?: number;
  staleAfterMinutes?: number;
  webhookUrl?: string;
  debug?: boolean;
}

/** Config with defaults applied. */
export interface ResolvedSettings {
  pollIntervalSeconds: number;
  saltTankMaxTenths: number;
  lowSaltThresholdPercent: number;
  alarmConfirmPolls: number;
  exposeWaterUsage: boolean;
  exposeTestSwitch: boolean;
  testAlarmSeconds: number;
  staleAfterMinutes: number;
  webhookUrl?: string;
  debug: boolean;
}

export function resolveSettings(cfg: HydroLinkConfig): ResolvedSettings {
  return {
    pollIntervalSeconds: Math.max(60, cfg.pollIntervalSeconds ?? 300),
    saltTankMaxTenths: Math.max(1, cfg.saltTankMaxTenths ?? 85),
    lowSaltThresholdPercent: cfg.lowSaltThresholdPercent ?? 20,
    alarmConfirmPolls: Math.max(1, cfg.alarmConfirmPolls ?? 1),
    exposeWaterUsage: cfg.exposeWaterUsage ?? true,
    exposeTestSwitch: cfg.exposeTestSwitch ?? true,
    testAlarmSeconds: Math.max(10, cfg.testAlarmSeconds ?? 60),
    staleAfterMinutes: Math.max(10, cfg.staleAfterMinutes ?? 30),
    webhookUrl: cfg.webhookUrl || undefined,
    debug: cfg.debug ?? false,
  };
}
