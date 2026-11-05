import http from 'node:http';
import type { Logger } from 'homebridge';
import type { SoftenerStatus } from './status.js';
import { STATUS_PAGE_HTML } from './statusPage.js';

/** Read-only HTTP server for the status page. GET only; never exposes credentials. */
export class StatusServer {
  private server?: http.Server;

  constructor(
    private readonly port: number,
    private readonly bind: string,
    private readonly getStatuses: () => SoftenerStatus[],
    private readonly log: Logger,
  ) {}

  start(): void {
    const server = http.createServer((req, res) => this.handle(req, res));
    server.on('error', (err: NodeJS.ErrnoException) => {
      // Never let the status page take Homebridge down.
      this.log.warn(`Status page could not start on ${this.bind}:${this.port}: ${err.code ?? err.message}`);
    });
    server.listen(this.port, this.bind, () => {
      this.log.info(`Status page: http://${this.bind === '0.0.0.0' ? '<this-host>' : this.bind}:${this.port}/`);
    });
    this.server = server;
  }

  stop(): void {
    this.server?.close();
    this.server?.closeAllConnections?.();
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const common = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...common, Allow: 'GET, HEAD' }).end();
      return;
    }
    const path = (req.url ?? '/').split('?')[0];

    if (path === '/' || path === '/index.html') {
      res
        .writeHead(200, {
          ...common,
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy':
            "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
        })
        .end(req.method === 'HEAD' ? undefined : STATUS_PAGE_HTML);
    } else if (path === '/status.json') {
      res
        .writeHead(200, { ...common, 'Content-Type': 'application/json; charset=utf-8' })
        .end(req.method === 'HEAD' ? undefined : JSON.stringify({ generatedAt: new Date().toISOString(), softeners: this.getStatuses() }));
    } else {
      res.writeHead(404, common).end('Not found');
    }
  }
}
