/** Snapshot of everything the status page shows. Contains no credentials. */
export interface SoftenerStatus {
  name: string;
  serial: string;
  model: string;
  firmware: string;
  hasData: boolean;
  /** Softener reports itself online to the HydroLink cloud. */
  online: boolean;
  /** No good data for longer than staleAfterMinutes: flow alarms cannot be reported. */
  offline: boolean;
  lastGoodAt: string;
  minutesSinceGood: number;
  saltPercent: number | null;
  lowSalt: boolean;
  gallonsToday: number | null;
  avgDailyGallons: number | null;
  /** Raw current_water_flow_gpm. Scale not yet verified against live flow. */
  flowGpm: number | null;
  treatedWaterAvailGallons: number | null;
  daysSinceRegen: number | null;
  outOfSaltDays: number | null;
  recharging: boolean;
  regenStatusRaw: number | null;
  signalDbm: number | null;
  testActive: boolean;
  alarms: { id: string; label: string; active: boolean }[];
}
