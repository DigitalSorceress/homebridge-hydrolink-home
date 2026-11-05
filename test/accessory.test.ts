import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  C,
  Service,
  advanceClock,
  captureServer,
  leak,
  makeDevice,
  makeHarness,
  offlineContact,
  sleep,
  testSwitch,
} from './helpers.js';

describe('SoftenerAccessory sensors', () => {
  it('creates the expected services', () => {
    const h = makeHarness();
    assert.ok(h.accessory.getServiceById(Service.HumiditySensor, 'salt'));
    assert.ok(h.accessory.getServiceById(Service.OccupancySensor, 'recharge'));
    assert.ok(h.accessory.getServiceById(Service.LightSensor, 'usage'));
    assert.ok(h.accessory.getServiceById(Service.LeakSensor, 'flow-alarm'));
    assert.ok(h.accessory.getServiceById(Service.LeakSensor, 'heavy-use-alarm'));
    assert.ok(h.accessory.getServiceById(Service.ContactSensor, 'offline'));
    assert.ok(h.accessory.getServiceById(Service.Switch, 'test-flow'));
  });

  it('honours exposeWaterUsage=false and exposeTestSwitch=false', () => {
    const h = makeHarness({ exposeWaterUsage: false, exposeTestSwitch: false });
    assert.equal(h.accessory.getServiceById(Service.LightSensor, 'usage'), undefined);
    assert.equal(h.accessory.getServiceById(Service.Switch, 'test-flow'), undefined);
  });

  it('maps salt level, usage and recharge state', () => {
    const h = makeHarness();
    h.handler.update(makeDevice());
    const salt = h.accessory.getServiceById(Service.HumiditySensor, 'salt')!;
    assert.equal(salt.getCharacteristic(C.CurrentRelativeHumidity).value, 35); // 30 / 85
    assert.equal(salt.getCharacteristic(C.StatusLowBattery).value, C.StatusLowBattery.BATTERY_LEVEL_NORMAL);
    const usage = h.accessory.getServiceById(Service.LightSensor, 'usage')!;
    assert.equal(usage.getCharacteristic(C.CurrentAmbientLightLevel).value, 24);
    const recharge = h.accessory.getServiceById(Service.OccupancySensor, 'recharge')!;
    assert.equal(recharge.getCharacteristic(C.OccupancyDetected).value, 0);

    h.handler.update(makeDevice({ regen_status_enum: 2 }));
    assert.equal(recharge.getCharacteristic(C.OccupancyDetected).value, 1);
  });

  it('keeps zero gallons above the HomeKit light-level minimum', () => {
    const h = makeHarness();
    h.handler.update(makeDevice({ gallons_used_today: 0 }));
    const v = h.accessory.getServiceById(Service.LightSensor, 'usage')!.getCharacteristic(C.CurrentAmbientLightLevel).value;
    assert.ok((v as number) > 0);
  });

  it('flags low salt by threshold and by the softener alert', () => {
    const h = makeHarness();
    const low = () =>
      h.accessory.getServiceById(Service.HumiditySensor, 'salt')!.getCharacteristic(C.StatusLowBattery).value;
    h.handler.update(makeDevice({ salt_level_tenths: 10 })); // 11.8%
    assert.equal(low(), C.StatusLowBattery.BATTERY_LEVEL_LOW);
    h.handler.update(makeDevice({ salt_level_tenths: 60, low_salt_alert: 1 }));
    assert.equal(low(), C.StatusLowBattery.BATTERY_LEVEL_LOW);
    h.handler.update(makeDevice({ salt_level_tenths: 60 }));
    assert.equal(low(), C.StatusLowBattery.BATTERY_LEVEL_NORMAL);
  });
});

describe('alarms', () => {
  it('trips and clears each alarm independently', () => {
    const h = makeHarness();
    h.handler.update(makeDevice());
    assert.equal(leak(h, 'flow-alarm'), 0);
    assert.equal(leak(h, 'heavy-use-alarm'), 0);

    h.handler.update(makeDevice({ flow_monitor_alert: 1 }));
    assert.equal(leak(h, 'flow-alarm'), 1);
    assert.equal(leak(h, 'heavy-use-alarm'), 0);

    h.handler.update(makeDevice({ excessive_water_use_alert: 1 }));
    assert.equal(leak(h, 'flow-alarm'), 0);
    assert.equal(leak(h, 'heavy-use-alarm'), 1);

    h.handler.update(makeDevice());
    assert.equal(leak(h, 'heavy-use-alarm'), 0);
  });

  it('waits for alarmConfirmPolls consecutive polls', () => {
    const h = makeHarness({ alarmConfirmPolls: 2 });
    h.handler.update(makeDevice({ flow_monitor_alert: 1 }));
    assert.equal(leak(h, 'flow-alarm'), 0);
    h.handler.update(makeDevice({ flow_monitor_alert: 1 }));
    assert.equal(leak(h, 'flow-alarm'), 1);
    h.handler.update(makeDevice());
    h.handler.update(makeDevice({ flow_monitor_alert: 1 }));
    assert.equal(leak(h, 'flow-alarm'), 0, 'streak resets after a clear poll');
  });
});

describe('test switch', () => {
  it('forces only the flow alarm and clears itself', async () => {
    const h = makeHarness({}, { testAlarmSeconds: 1 });
    h.handler.update(makeDevice());
    testSwitch(h).setValue(true);
    await sleep(50);
    assert.equal(leak(h, 'flow-alarm'), 1);
    assert.equal(leak(h, 'heavy-use-alarm'), 0);
    await sleep(1300);
    assert.equal(leak(h, 'flow-alarm'), 0);
    assert.equal(testSwitch(h).value, false);
  });

  it('clears the alarm when switched off early', async () => {
    const h = makeHarness({}, { testAlarmSeconds: 30 });
    h.handler.update(makeDevice());
    testSwitch(h).setValue(true);
    await sleep(50);
    assert.equal(leak(h, 'flow-alarm'), 1);
    testSwitch(h).setValue(false);
    await sleep(50);
    assert.equal(leak(h, 'flow-alarm'), 0);
  });

  it('does not clear a genuinely active alarm when the test ends', async () => {
    const h = makeHarness({}, { testAlarmSeconds: 30 });
    h.handler.update(makeDevice({ flow_monitor_alert: 1 }));
    testSwitch(h).setValue(true);
    await sleep(50);
    testSwitch(h).setValue(false);
    await sleep(50);
    assert.equal(leak(h, 'flow-alarm'), 1);
  });

  it('refuses to run before any data has arrived', async () => {
    const h = makeHarness();
    testSwitch(h).setValue(true);
    await sleep(700);
    assert.equal(leak(h, 'flow-alarm'), 0);
    assert.equal(testSwitch(h).value, false);
    assert.ok(h.lines.some((l) => l.includes('before any softener data')));
  });
});

describe('offline sensor', () => {
  it('opens after staleAfterMinutes and closes on fresh data', () => {
    const h = makeHarness({}, { staleAfterMinutes: 10 });
    h.handler.update(makeDevice());
    assert.equal(offlineContact(h), C.ContactSensorState.CONTACT_DETECTED);

    let restore = advanceClock(11);
    try {
      h.handler.checkStale();
      assert.equal(offlineContact(h), C.ContactSensorState.CONTACT_NOT_DETECTED);
      assert.ok(h.lines.some((l) => l.includes('Softener OFFLINE')));
    } finally {
      restore();
    }

    restore = advanceClock(12);
    try {
      h.handler.update(makeDevice());
      assert.equal(offlineContact(h), C.ContactSensorState.CONTACT_DETECTED);
    } finally {
      restore();
    }
  });

  it('does not treat an is_online=false reading as fresh data', () => {
    const h = makeHarness({}, { staleAfterMinutes: 10 });
    h.handler.update(makeDevice());
    const restore = advanceClock(40);
    try {
      h.handler.update(makeDevice({}, false));
      assert.equal(offlineContact(h), C.ContactSensorState.CONTACT_NOT_DETECTED);
    } finally {
      restore();
    }
  });
});

describe('webhook', () => {
  it('posts alarm and test events with the right fields', async () => {
    const hook = await captureServer();
    try {
      const h = makeHarness({ webhookUrl: hook.url }, { testAlarmSeconds: 30 });
      h.handler.update(makeDevice({ flow_monitor_alert: 1 }));
      await sleep(150);
      h.handler.update(makeDevice());
      await sleep(150);
      testSwitch(h).setValue(true);
      await sleep(150);

      const [tripped, cleared, test] = hook.bodies;
      assert.equal(tripped?.event, 'alarm_tripped');
      assert.equal(tripped?.alarm, 'flow-alarm');
      assert.equal(tripped?.test, false);
      assert.equal(tripped?.source, 'homebridge-hydrolink-home');
      assert.equal(cleared?.event, 'alarm_cleared');
      assert.equal(test?.event, 'alarm_tripped');
      assert.equal(test?.test, true);
      testSwitch(h).setValue(false);
    } finally {
      hook.close();
    }
  });

  it('survives an unreachable webhook', async () => {
    const h = makeHarness({ webhookUrl: 'http://127.0.0.1:1/never' });
    h.handler.update(makeDevice({ flow_monitor_alert: 1 }));
    await sleep(300);
    assert.equal(leak(h, 'flow-alarm'), 1);
    assert.ok(h.lines.some((l) => l.startsWith('warn: Webhook failed')));
  });
});

describe('getStatus', () => {
  it('reports no data before the first update', () => {
    const s = makeHarness().handler.getStatus();
    assert.equal(s.hasData, false);
    assert.equal(s.saltPercent, null);
  });

  it('summarises the device and never includes credentials', () => {
    const h = makeHarness();
    h.handler.update(makeDevice({ flow_monitor_alert: 1 }));
    const s = h.handler.getStatus();
    assert.equal(s.name, 'Test Softener');
    assert.equal(s.saltPercent, 35.3);
    assert.equal(s.gallonsToday, 24);
    assert.equal(s.recharging, false);
    assert.equal(s.alarms.find((a) => a.id === 'flow-alarm')?.active, true);
    assert.equal(s.offline, false);
    assert.ok(!/password|cookie|email/i.test(JSON.stringify(s)));
  });
});
