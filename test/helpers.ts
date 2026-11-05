import { readFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import * as hap from '@homebridge/hap-nodejs';
import type { Logger, PlatformAccessory } from 'homebridge';
import { SoftenerAccessory } from '../src/accessory.js';
import type { HydroLinkDevice } from '../src/hydrolinkClient.js';
import type { HydroLinkPlatform } from '../src/platform.js';
import { resolveSettings, type HydroLinkConfig, type ResolvedSettings } from '../src/settings.js';

export const { Service, Characteristic: C } = hap;

const fixture = JSON.parse(
  readFileSync(new URL('../../test/fixtures/device.json', import.meta.url), 'utf8'),
) as HydroLinkDevice;

/** A fresh copy of the sample device, with property overrides. */
export function makeDevice(overrides: Record<string, unknown> = {}, online = true): HydroLinkDevice {
  const d = structuredClone(fixture);
  d.is_online = online;
  for (const [name, value] of Object.entries(overrides)) {
    d.properties[name] = { ...(d.properties[name] ?? { name }), value };
  }
  return d;
}

export function makeLogger(): { log: Logger; lines: string[] } {
  const lines: string[] = [];
  const log = Object.fromEntries(
    ['info', 'warn', 'error', 'debug', 'success'].map((l) => [l, (m: string) => lines.push(`${l}: ${m}`)]),
  ) as unknown as Logger;
  return { log, lines };
}

export interface Harness {
  handler: SoftenerAccessory;
  accessory: hap.Accessory;
  lines: string[];
  settings: ResolvedSettings;
}

export function makeHarness(config: HydroLinkConfig = {}, overrides: Partial<ResolvedSettings> = {}): Harness {
  const { log, lines } = makeLogger();
  const platform = { log, api: { hap } } as unknown as HydroLinkPlatform;
  const accessory = new hap.Accessory('Test Softener', hap.uuid.generate('test'));
  const settings: ResolvedSettings = { ...resolveSettings(config), ...overrides };
  const handler = new SoftenerAccessory(platform, accessory as unknown as PlatformAccessory, settings);
  return { handler, accessory, lines, settings };
}

export const leak = (h: Harness, id: string): number =>
  h.accessory.getServiceById(Service.LeakSensor, id)!.getCharacteristic(C.LeakDetected).value as number;

export const offlineContact = (h: Harness): number =>
  h.accessory.getServiceById(Service.ContactSensor, 'offline')!.getCharacteristic(C.ContactSensorState).value as number;

export const testSwitch = (h: Harness): hap.Characteristic =>
  h.accessory.getServiceById(Service.Switch, 'test-flow')!.getCharacteristic(C.On);

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Replace Date.now with an offset clock; returns a restore function. */
export function advanceClock(minutes: number): () => void {
  const real = Date.now;
  Date.now = () => real() + minutes * 60_000;
  return () => {
    Date.now = real;
  };
}

/** Find a free local TCP port. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

/** Tiny local HTTP server that records POST bodies. */
export async function captureServer(): Promise<{ url: string; bodies: Record<string, unknown>[]; close: () => void }> {
  const bodies: Record<string, unknown>[] = [];
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      bodies.push(JSON.parse(data) as Record<string, unknown>);
      res.writeHead(200).end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as net.AddressInfo;
  return { url: `http://127.0.0.1:${port}/hook`, bodies, close: () => server.close() };
}
