import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';

/** Hosts the proxy may reach. Keep in sync with public/git-proxy.php. */
const ALLOWED_HOST = /^(?:cloud|ssrf-cloud-[a-z0-9]+)\.subsurface-divelog\.org$/;
const ALLOWED_PATH = /^\/git\/[^/]+\/(?:info\/refs|git-upload-pack|git-receive-pack)$/;

/**
 * Development stand-in for public/git-proxy.php: forwards git smart-HTTP requests from
 * /git-proxy.php/<host>/<path> to https://<host>/<path>, with the same allowlist.
 */
function gitProxy(): Plugin {
  return {
    name: 'topside-git-proxy',
    configureServer(server) {
      server.middlewares.use('/git-proxy.php', async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost');
          const [, host = '', ...rest] = url.pathname.split('/');
          const path = `/${rest.join('/')}`;
          if (!ALLOWED_HOST.test(host) || !ALLOWED_PATH.test(decodeURIComponent(path))) {
            res.writeHead(403).end('Forbidden');
            return;
          }
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const headers: Record<string, string> = { 'User-Agent': 'git/topside-dev' };
          for (const name of ['authorization', 'content-type', 'accept', 'git-protocol']) {
            const value = req.headers[name];
            if (typeof value === 'string') headers[name] = value;
          }
          const upstream = await fetch(`https://${host}${path}${url.search}`, {
            method: req.method ?? 'GET',
            headers,
            ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
          });
          res.writeHead(upstream.status, {
            'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
            'Cache-Control': 'no-store',
          });
          res.end(Buffer.from(await upstream.arrayBuffer()));
        } catch (error) {
          res.writeHead(502).end(String(error));
        }
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [svelte(), gitProxy()],
  build: { target: 'es2022' },
});
