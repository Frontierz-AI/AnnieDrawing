import { createServer } from 'vite';
const server = await createServer({
  configFile: 'vite.demo.config.ts',
  server: {
    host: '127.0.0.1',
    port: Number(process.argv[2]),
    strictPort: true,
    hmr: false,
    watch: null,
  },
});
await server.listen();
server.printUrls();
