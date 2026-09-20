import { defineConfig, type Plugin } from 'vite';
import { isPublicHttpUrl } from './src/core/links.js';

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
          const href = new URL(req.url, 'http://127.0.0.1').searchParams.get('url') ?? '';
          if (!isPublicHttpUrl(href)) throw new Error('bad');
          const response = await fetch(href, {
            headers: { Accept: 'text/html' },
            redirect: 'follow',
            signal: AbortSignal.timeout(4000),
          });
          const type = response.headers.get('content-type') ?? '';
          if (
            !response.ok ||
            (type && !/html|xml/i.test(type)) ||
            !isPublicHttpUrl(response.url || href)
          ) {
            res.statusCode = 204;
            res.end();
            return;
          }
          res.statusCode = 200;
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.setHeader('x-unfurl-url', response.url);
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
