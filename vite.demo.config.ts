import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { defineConfig, type Plugin } from 'vite';
import { isPublicHttpUrl } from './src/core/links.js';

async function isPublicHttpTarget(href: string): Promise<boolean> {
  if (!isPublicHttpUrl(href)) return false;
  let hostname: string;
  try {
    hostname = new URL(href).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (isIP(hostname)) return true;
  try {
    const records = await lookup(hostname, { all: true });
    return (
      records.length > 0 &&
      records.every((record) =>
        isPublicHttpUrl(
          record.family === 6 ? `http://[${record.address}]/` : `http://${record.address}/`,
        ),
      )
    );
  } catch {
    return false;
  }
}

function unfurlPlugin(): Plugin {
  return {
    name: 'ad-unfurl',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__ad-unfurl')) return next();
        const origin = req.headers.origin;
        const host = req.headers.host;
        let allowed = false;
        try {
          const url = origin ? new URL(origin) : undefined;
          allowed = !!(
            url &&
            host &&
            url.host === host &&
            (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1')
          );
        } catch {
          allowed = false;
        }
        if (!allowed) {
          res.statusCode = 403;
          res.end();
          return;
        }
        try {
          let href = new URL(req.url, 'http://127.0.0.1').searchParams.get('url') ?? '';
          const signal = AbortSignal.timeout(4000);
          let response: Response | undefined;
          // Follow redirects by hand so each hop is resolved and checked before it is requested.
          for (let hop = 0; hop <= 5; hop++) {
            if (!(await isPublicHttpTarget(href))) throw new Error('bad');
            response = await fetch(href, {
              headers: { Accept: 'text/html' },
              redirect: 'manual',
              signal,
            });
            const location =
              response.status >= 300 && response.status < 400
                ? response.headers.get('location')
                : null;
            if (!location) break;
            href = new URL(location, href).href;
            response = undefined;
          }
          const type = response?.headers.get('content-type') ?? '';
          if (!response || !response.ok || (type && !/html|xml/i.test(type))) {
            res.statusCode = 204;
            res.end();
            return;
          }
          res.statusCode = 200;
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.setHeader('x-unfurl-url', href);
          res.end((await response.text()).slice(0, 200000));
        } catch {
          res.statusCode = 204;
          res.end();
        }
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [unfurlPlugin()],
  build: { outDir: 'site' },
  server: { host: '127.0.0.1', port: 5173 },
});
