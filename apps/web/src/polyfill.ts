// isomorphic-git expects Node's Buffer as a global. Must be imported before it.
import { Buffer } from 'buffer';

(globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer;
