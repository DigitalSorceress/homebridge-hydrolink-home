export const PLUGIN_NAME = 'homebridge-hydrolink-home';
export const PLATFORM_NAME = 'HydroLinkHome';

export interface HydroLinkConfig {
  name?: string;
  email?: string;
  password?: string;
  pollIntervalSeconds?: number;
  saltTankMaxTenths?: number;
  lowSaltThresholdPercent?: number;
  alarmConfirmPolls?: number;
  exposeWaterUsage?: boolean;
  webhookUrl?: string;
  debug?: boolean;
}
