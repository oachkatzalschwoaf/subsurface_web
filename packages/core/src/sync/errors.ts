/**
 * Errors of the sync, kept apart from sync.ts so that code showing them does not have to load
 * isomorphic-git.
 */

/** 'internal': not a problem of the server or the connection, e.g. a logbook Topside cannot write. */
export type SyncErrorKind = 'auth' | 'not-found' | 'conflict' | 'unsupported' | 'network' | 'internal';

export class SyncError extends Error {
  readonly kind: SyncErrorKind;
  constructor(kind: SyncErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}
