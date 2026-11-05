import type { Logger } from 'homebridge';

export interface HydroLinkProperty {
  name: string;
  value: unknown;
  updated_at?: string;
}

export interface HydroLinkDevice {
  id: string;
  nickname: string;
  serial_number: string;
  system_type: string;
  is_online: boolean;
  properties: Record<string, HydroLinkProperty>;
}

const COOKIE_NAME = 'hhfoffoezyzzoeibwv';
const TIMEOUT_MS = 15_000;

export class HydroLinkAuthError extends Error {}

/** Minimal read-only client for the (unofficial) HydroLink Home REST API. */
export class HydroLinkClient {
  private cookie: string | undefined;
  private loginInFlight: Promise<void> | undefined;

  constructor(
    private readonly email: string,
    private readonly password: string,
    private readonly log: Logger,
    private readonly baseUrl = 'https://api.hydrolinkhome.com/v1',
  ) {}

  private login(): Promise<void> {
    // Share one login between concurrent callers.
    this.loginInFlight ??= this.doLogin().finally(() => {
      this.loginInFlight = undefined;
    });
    return this.loginInFlight;
  }

  private async doLogin(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: this.email, password: this.password }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) {
      throw new HydroLinkAuthError('HydroLink Home rejected the email or password (HTTP 401).');
    }
    if (!res.ok) {
      throw new Error(`HydroLink Home login failed: HTTP ${res.status}`);
    }
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .find((c) => c.startsWith(`${COOKIE_NAME}=`));
    if (!cookie) {
      throw new Error('HydroLink Home login succeeded but returned no session cookie.');
    }
    this.cookie = cookie;
    this.log.debug('Signed in to HydroLink Home');
  }

  async getDevices(): Promise<HydroLinkDevice[]> {
    if (!this.cookie) {
      await this.login();
    }
    let res = await this.fetchDevices();
    if (res.status === 401) {
      // Session expired: sign in again and retry once.
      this.cookie = undefined;
      await this.login();
      res = await this.fetchDevices();
    }
    if (!res.ok) {
      throw new Error(`HydroLink Home device request failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as { data?: HydroLinkDevice[] };
    return body.data ?? [];
  }

  private fetchDevices(): Promise<Response> {
    return fetch(`${this.baseUrl}/devices?all=false&per_page=200`, {
      headers: { cookie: this.cookie! },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }
}
