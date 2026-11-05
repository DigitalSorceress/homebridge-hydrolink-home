import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { StatusServer } from '../src/statusServer.js';
import { freePort, makeDevice, makeHarness, makeLogger, sleep } from './helpers.js';

describe('StatusServer', () => {
  let server: StatusServer;
  let base: string;
  const harness = makeHarness();

  before(async () => {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    server = new StatusServer(port, '127.0.0.1', () => [harness.handler.getStatus()], makeLogger().log);
    server.start();
    await sleep(200);
  });
  after(() => server.stop());

  it('serves status.json, empty before data and populated after', async () => {
    let json = (await (await fetch(`${base}/status.json`)).json()) as { softeners: { hasData: boolean }[] };
    assert.equal(json.softeners[0]?.hasData, false);

    harness.handler.update(makeDevice());
    json = (await (await fetch(`${base}/status.json`)).json()) as { softeners: { hasData: boolean }[] };
    assert.equal(json.softeners[0]?.hasData, true);
  });

  it('serves the page with safe headers and no innerHTML', async () => {
    const res = await fetch(`${base}/`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.startsWith('text/html'));
    assert.ok(res.headers.get('content-security-policy')?.includes("default-src 'none'"));
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(html.includes('Softener Status'));
    assert.ok(!html.includes('innerHTML'));
  });

  it('is read-only: 404 for unknown paths, 405 for non-GET, HEAD allowed', async () => {
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    assert.equal((await fetch(`${base}/status.json`, { method: 'POST', body: '{}' })).status, 405);
    assert.equal((await fetch(`${base}/status.json`, { method: 'PUT', body: '{}' })).status, 405);
    assert.equal((await fetch(`${base}/status.json`, { method: 'HEAD' })).status, 200);
  });

  it('only warns when the port is already taken', async () => {
    const port = Number(new URL(base).port);
    const { log, lines } = makeLogger();
    const clash = new StatusServer(port, '127.0.0.1', () => [], log);
    clash.start();
    await sleep(200);
    clash.stop();
    assert.ok(lines.some((l) => l.startsWith('warn: Status page could not start')));
  });
});
