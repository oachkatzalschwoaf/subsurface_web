import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';
import { pwa } from './pwa.ts';

/** Hosts the proxy may reach. Keep in sync with public/git-proxy.php. */
const ALLOWED_HOST = /^(?:cloud|ssrf-cloud-[a-z0-9]+)\.subsurface-divelog\.org$/;
const ALLOWED_PATH = /^\/git\/[^/]+\/(?:info\/refs|git-upload-pack|git-receive-pack)$/;
const GENERIC_PATH = /^\/(?:[A-Za-z0-9._~@%+-]+\/)+(?:info\/refs|git-upload-pack|git-receive-pack)$/;
/** Extra git hosts for development, like git-proxy.config.php in production. */
const EXTRA_HOSTS = (process.env.TOPSIDE_PROXY_HOSTS ?? 'github.com,gitlab.com,codeberg.org')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);
/** Tests only: local git servers reached over plain http, e.g. "127.0.0.1:51234". */
const HTTP_HOSTS = (process.env.TOPSIDE_PROXY_HTTP_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

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
          if ((url.pathname === '/' || url.pathname === '') && url.search === '?ping') {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('topside-proxy 1');
            return;
          }
          const [, host = '', ...rest] = url.pathname.split('/');
          const path = `/${rest.join('/')}`;
          const isCloud = ALLOWED_HOST.test(host);
          const plainHttp = HTTP_HOSTS.includes(host.toLowerCase());
          if (!isCloud && !plainHttp && !EXTRA_HOSTS.includes(host.toLowerCase())) {
            res.writeHead(421).end('Host not allowed by git-proxy.php');
            return;
          }
          const decoded = decodeURIComponent(path);
          if (decoded.includes('/../') || !(isCloud ? ALLOWED_PATH : GENERIC_PATH).test(decoded)) {
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
          const upstream = await fetch(`${plainHttp ? 'http' : 'https'}://${host}${path}${url.search}`, {
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
  plugins: [svelte(), gitProxy(), pwa()],
  build: { target: 'es2022' },
});
