/**
 * A local git smart-HTTP server for tests: Node's http server in front of `git http-backend`.
 * It asks for Basic auth like the Subsurface cloud does.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface TestServer {
  url: string;
  /** Path of the bare repository on disk */
  repo: string;
  /** Run git in the bare repository */
  git: (...args: string[]) => string;
  close: () => Promise<void>;
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 26 });

export async function startGitServer(options: {
  branch: string;
  files: Record<string, string>;
  username: string;
  password: string;
}): Promise<TestServer> {
  const root = mkdtempSync(join(tmpdir(), 'topside-git-'));
  const work = join(root, 'work');
  const repo = join(root, 'repo.git');
  mkdirSync(work);

  if (Object.keys(options.files).length === 0) {
    // An empty repository, like a freshly created one on GitHub
    git(root, 'init', '-q', '--bare', '-b', options.branch, repo);
  } else {
    git(work, 'init', '-q', '-b', options.branch);
    git(work, 'config', 'core.autocrlf', 'false');
    for (const [path, content] of Object.entries(options.files)) {
      mkdirSync(dirname(join(work, path)), { recursive: true });
      writeFileSync(join(work, path), content);
    }
    git(work, 'add', '-A');
    git(work, '-c', 'user.name=Test', '-c', 'user.email=test@example.org', 'commit', '-q', '-m', 'Initial');
    git(root, 'clone', '-q', '--bare', work, repo);
  }
  git(repo, 'config', 'http.receivepack', 'true');
  // Like the Subsurface cloud: HEAD points nowhere, so the server advertises no HEAD.
  git(repo, 'symbolic-ref', 'HEAD', 'refs/heads/no-such-branch');

  const expected = `Basic ${Buffer.from(`${options.username}:${options.password}`).toString('base64')}`;
  const server: Server = createServer((req, res) => {
    if (req.headers.authorization !== expected) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="test"' }).end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const backend = spawn('git', ['http-backend'], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        REQUEST_METHOD: req.method ?? 'GET',
        PATH_INFO: decodeURIComponent(url.pathname),
        QUERY_STRING: url.search.slice(1),
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        CONTENT_LENGTH: req.headers['content-length'] ?? '',
        HTTP_CONTENT_ENCODING: req.headers['content-encoding'] ?? '',
        REMOTE_USER: options.username,
        REMOTE_ADDR: '127.0.0.1',
      },
    });
    req.pipe(backend.stdin);
    const chunks: Buffer[] = [];
    backend.stdout.on('data', (c: Buffer) => chunks.push(c));
    backend.on('close', () => {
      // CGI response: headers, blank line, body
      const out = Buffer.concat(chunks);
      let split = out.indexOf('\r\n\r\n');
      let gap = 4;
      if (split < 0) {
        split = out.indexOf('\n\n');
        gap = 2;
      }
      let status = 200;
      const headers: Record<string, string> = {};
      for (const line of out.subarray(0, Math.max(split, 0)).toString('utf8').split(/\r?\n/)) {
        const i = line.indexOf(':');
        if (i < 0) continue;
        const key = line.slice(0, i).trim();
        const value = line.slice(i + 1).trim();
        if (key.toLowerCase() === 'status') status = Number.parseInt(value, 10);
        else headers[key] = value;
      }
      res.writeHead(status, headers).end(split < 0 ? undefined : out.subarray(split + gap));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/repo.git`,
    repo,
    git: (...args) => git(repo, ...args),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          rmSync(root, { recursive: true, force: true });
          resolve();
        });
      }),
  };
}
