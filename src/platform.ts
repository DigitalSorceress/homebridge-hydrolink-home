import type { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { SoftenerAccessory } from './accessory.js';
import { HydroLinkAuthError, HydroLinkClient, type HydroLinkDevice } from './hydrolinkClient.js';
import { StatusServer } from './statusServer.js';
import { PLATFORM_NAME, PLUGIN_NAME, resolveSettings, type HydroLinkConfig, type ResolvedSettings } from './settings.js';

export class HydroLinkPlatform implements DynamicPlatformPlugin {
  private readonly cached = new Map<string, PlatformAccessory>();
  private readonly handlers = new Map<string, SoftenerAccessory>();
  private readonly client?: HydroLinkClient;
  private readonly settings: ResolvedSettings;
  private polling = false;

  constructor(
    public readonly log: Logger,
    config: PlatformConfig,
    public readonly api: API,
  ) {
    const cfg = config as HydroLinkConfig;
    this.settings = resolveSettings(cfg);

    if (!cfg.email || !cfg.password) {
      this.log.error('HydroLink Home: email and password must be set in the plugin config.');
      return;
    }
    this.client = new HydroLinkClient(cfg.email, cfg.password, this.log);

    this.api.on('didFinishLaunching', () => {
      // Build handlers for accessories restored from cache right away, so the
      // "Softener Offline" sensor works even if the first poll never succeeds.
      for (const [uuid, accessory] of this.cached) {
        this.handlers.set(uuid, new SoftenerAccessory(this, accessory, this.settings));
      }

      if (this.settings.statusPagePort > 0) {
        const server = new StatusServer(
          this.settings.statusPagePort,
          this.settings.statusPageBind,
          () => [...this.handlers.values()].map((h) => h.getStatus()),
          this.log,
        );
        server.start();
        this.api.on('shutdown', () => server.stop());
      }

      void this.poll();
      const pollTimer = setInterval(() => void this.poll(), this.settings.pollIntervalSeconds * 1000);
      const staleTimer = setInterval(() => this.handlers.forEach((h) => h.checkStale()), 60_000);
      this.api.on('shutdown', () => {
        clearInterval(pollTimer);
        clearInterval(staleTimer);
      });
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
      this.handlers.forEach((h) => h.checkStale());
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
