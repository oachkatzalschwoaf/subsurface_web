/**
 * Diagnose the cloud login without the browser.
 *
 *   node scripts/check-login.ts you@example.org [https://ssrf-cloud-u2.subsurface-divelog.org]
 *
 * Asks for the password without echoing it, then reads the logbook twice: directly, and through
 * the development proxy of `npm run dev` (if it is running on port 5173). Nothing is written to
 * the cloud. The password is not printed or stored.
 */
import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import httpNode from 'isomorphic-git/http/node';
import httpWeb from 'isomorphic-git/http/web';
import { createMemoryFs, fetchLogbook, type Remote } from '../packages/core/src/index.ts';

const [email = '', server = 'https://ssrf-cloud-u2.subsurface-divelog.org'] = process.argv.slice(2);
if (!email.includes('@')) {
  console.error('Usage: node scripts/check-login.ts <cloud e-mail> [server]');
  process.exit(2);
}

function askPassword(): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput.bind(rl);
    let muted = false;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => {
      if (!muted) write(s);
    };
    rl.question('Password (not shown): ', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

const password = await askPassword();
const remote: Remote = { url: `${server.replace(/\/+$/, '')}/git/${email}`, branch: email, username: email, password };

async function attempt(label: string, http: typeof httpNode, corsProxy?: string, inMemory = false) {
  const dir = inMemory ? '/repo' : mkdtempSync(join(tmpdir(), 'topside-check-'));
  const started = Date.now();
  try {
    const snapshot = await fetchLogbook({ fs: inMemory ? createMemoryFs() : fs, http, dir }, corsProxy ? { ...remote, corsProxy } : remote);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`${label}: OK in ${seconds} s, ${snapshot.logbook.dives.length} dives, commit ${snapshot.commit.slice(0, 7)}`);
    console.log(`  writable: ${snapshot.problems.length === 0 ? 'yes' : `no – ${snapshot.problems.slice(0, 3).join(' | ')}`}`);
  } catch (error) {
    const e = error as { kind?: string; message?: string };
    console.log(`${label}: FAILED (${e.kind ?? 'error'}) ${e.message ?? String(error)}`);
  } finally {
    if (!inMemory) rmSync(dir, { recursive: true, force: true });
  }
}

await attempt('direct', httpNode);
const devUp = await fetch('http://localhost:5173/').then(() => true, () => false);
if (devUp) await attempt('like the browser (dev proxy, in memory)', httpWeb as typeof httpNode, 'http://localhost:5173/git-proxy.php', true);
else console.log('via dev proxy: skipped, `npm run dev` is not running');
