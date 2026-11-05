import type { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { SoftenerAccessory } from './accessory.js';
import { HydroLinkAuthError, HydroLinkClient, type HydroLinkDevice } from './hydrolinkClient.js';
import { PLATFORM_NAME, PLUGIN_NAME, type HydroLinkConfig } from './settings.js';

export class HydroLinkPlatform implements DynamicPlatformPlugin {
  private readonly cached = new Map<string, PlatformAccessory>();
  private readonly handlers = new Map<string, SoftenerAccessory>();
  private readonly client?: HydroLinkClient;
  private readonly settings: Required<Omit<HydroLinkConfig, 'name' | 'email' | 'password' | 'webhookUrl'>> & {
    webhookUrl?: string;
  };
  private polling = false;

  constructor(
    public readonly log: Logger,
    config: PlatformConfig,
    public readonly api: API,
  ) {
    const cfg = config as HydroLinkConfig;
    this.settings = {
      pollIntervalSeconds: Math.max(60, cfg.pollIntervalSeconds ?? 300),
      saltTankMaxTenths: Math.max(1, cfg.saltTankMaxTenths ?? 85),
      lowSaltThresholdPercent: cfg.lowSaltThresholdPercent ?? 20,
      alarmConfirmPolls: Math.max(1, cfg.alarmConfirmPolls ?? 1),
      exposeWaterUsage: cfg.exposeWaterUsage ?? true,
      debug: cfg.debug ?? false,
      webhookUrl: cfg.webhookUrl || undefined,
    };

    if (!cfg.email || !cfg.password) {
      this.log.error('HydroLink Home: email and password must be set in the plugin config.');
      return;
    }
    this.client = new HydroLinkClient(cfg.email, cfg.password, this.log);

    this.api.on('didFinishLaunching', () => {
      void this.poll();
      const timer = setInterval(() => void this.poll(), this.settings.pollIntervalSeconds * 1000);
      this.api.on('shutdown', () => clearInterval(timer));
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.cached.set(accessory.UUID, accessory);
  }

  private async poll(): Promise<void> {
    if (!this.client || this.polling) {
      return;
    }
    this.polling = true;
    try {
      const devices = await this.client.getDevices();
      this.sync(devices);
    } catch (err) {
      if (err instanceof HydroLinkAuthError) {
        this.log.error(`${err.message} Check the email/password in the plugin config.`);
      } else {
        this.log.warn(`HydroLink Home poll failed (will retry): ${(err as Error).message}`);
      }
    } finally {
      this.polling = false;
    }
  }

  private sync(devices: HydroLinkDevice[]): void {
    const seen = new Set<string>();
    for (const device of devices) {
      const uuid = this.api.hap.uuid.generate(`hydrolink:${device.id}`);
      seen.add(uuid);

      let handler = this.handlers.get(uuid);
      if (!handler) {
        let accessory = this.cached.get(uuid);
        if (!accessory) {
          this.log.info(`Adding softener "${device.nickname}" (${device.serial_number})`);
          accessory = new this.api.platformAccessory(device.nickname || 'Softener', uuid);
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          this.cached.set(uuid, accessory);
        }
        handler = new SoftenerAccessory(this, accessory, this.settings);
        this.handlers.set(uuid, handler);
      }
      handler.update(device);
    }

    // Only prune after a successful poll that returned a device list.
    for (const [uuid, accessory] of this.cached) {
      if (!seen.has(uuid)) {
        this.log.info(`Removing accessory no longer on the account: ${accessory.displayName}`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.cached.delete(uuid);
        this.handlers.delete(uuid);
      }
    }
  }
}
