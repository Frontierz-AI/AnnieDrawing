import { defineConfig, type Plugin } from 'vite';

function unfurlPlugin(): Plugin {
  return {
    name: 'ad-unfurl',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__ad-unfurl')) return next();
        try {
          const href = new URL(req.url, 'http://127.0.0.1').searchParams.get('url') ?? '';
          const url = new URL(href);
          if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad');
          url.username = url.password = '';
          const response = await fetch(url, {
            headers: { Accept: 'text/html' },
            redirect: 'follow',
          });
          const type = response.headers.get('content-type') ?? '';
          if (!response.ok || (type && !/html|xml/i.test(type))) {
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
