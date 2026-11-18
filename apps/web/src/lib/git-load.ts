/** Loaded by lib/git.ts when the first sync starts. The polyfill must come before isomorphic-git. */
import '../polyfill.ts';
import { createMemoryFs, type GitEnv } from '@topside/core';
import http from 'isomorphic-git/http/web';

export { fetchLogbook, initRemote, pushLogbook, remoteHasBranch } from '@topside/core';

export const freshEnv = (): GitEnv => ({ fs: createMemoryFs(), http, dir: '/repo' });
