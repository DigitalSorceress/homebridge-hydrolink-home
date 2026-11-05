import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { HydroLinkAuthError, HydroLinkClient } from '../src/hydrolinkClient.js';
import { makeDevice, makeLogger } from './helpers.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Call {
  url: string;
  method: string;
  cookie?: string;
  body?: string;
}

/** Install a scripted fetch; each entry answers one request in order. */
function script(responses: (() => Response)[]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      cookie: headers.get('cookie') ?? undefined,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const next = responses.shift();
    if (!next) {
      throw new Error('unexpected extra request');
    }
    return next();
  }) as typeof fetch;
  return calls;
}

const loginOk = (cookie = 'abc'): Response =>
  new Response('{}', { status: 200, headers: { 'set-cookie': `hhfoffoezyzzoeibwv=${cookie}; Path=/; HttpOnly` } });
const devicesOk = (): Response => Response.json({ data: [makeDevice()] });

describe('HydroLinkClient', () => {
  it('signs in, then sends the session cookie when listing devices', async () => {
    const calls = script([() => loginOk('s3cret'), devicesOk]);
    const client = new HydroLinkClient('me@example.com', 'pw', makeLogger().log);
    const devices = await client.getDevices();

    assert.equal(devices.length, 1);
    assert.equal(calls[0]?.method, 'POST');
    assert.ok(calls[0]?.url.endsWith('/auth/login'));
    assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), { email: 'me@example.com', password: 'pw' });
    assert.ok(calls[1]?.url.includes('/devices?all=false&per_page=200'));
    assert.equal(calls[1]?.cookie, 'hhfoffoezyzzoeibwv=s3cret');
  });

  it('reuses the session on later calls', async () => {
    const calls = script([loginOk, devicesOk, devicesOk]);
    const client = new HydroLinkClient('a@b.c', 'pw', makeLogger().log);
    await client.getDevices();
    await client.getDevices();
    assert.equal(calls.filter((c) => c.url.endsWith('/auth/login')).length, 1);
  });

  it('signs in again once when the session expires (401)', async () => {
    const calls = script([() => loginOk('old'), () => new Response('', { status: 401 }), () => loginOk('new'), devicesOk]);
    const client = new HydroLinkClient('a@b.c', 'pw', makeLogger().log);
    const devices = await client.getDevices();
    assert.equal(devices.length, 1);
    assert.equal(calls[3]?.cookie, 'hhfoffoezyzzoeibwv=new');
  });

  it('throws HydroLinkAuthError on a rejected login', async () => {
    script([() => new Response('', { status: 401 })]);
    const client = new HydroLinkClient('a@b.c', 'wrong', makeLogger().log);
    await assert.rejects(client.getDevices(), HydroLinkAuthError);
  });

  it('fails clearly when login returns no session cookie', async () => {
    script([() => new Response('{}', { status: 200 })]);
    const client = new HydroLinkClient('a@b.c', 'pw', makeLogger().log);
    await assert.rejects(client.getDevices(), /no session cookie/);
  });

  it('reports server errors without treating them as auth failures', async () => {
    script([loginOk, () => new Response('', { status: 503 })]);
    const client = new HydroLinkClient('a@b.c', 'pw', makeLogger().log);
    await assert.rejects(client.getDevices(), (err: Error) => !(err instanceof HydroLinkAuthError) && /503/.test(err.message));
  });

  it('returns an empty list when the account has no devices', async () => {
    script([loginOk, () => Response.json({})]);
    const client = new HydroLinkClient('a@b.c', 'pw', makeLogger().log);
    assert.deepEqual(await client.getDevices(), []);
  });
});
