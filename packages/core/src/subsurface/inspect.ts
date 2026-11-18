import type { Logbook } from './model.ts';
import { parseLogbook } from './parse.ts';
import { serializeLogbook } from './serialize.ts';
import { flattenTree, type GitTree } from './tree.ts';

/** Parse a tree and check that writing it back reproduces it exactly. */
export function inspect(tree: GitTree): { logbook: Logbook; problems: string[] } {
  const { logbook, warnings } = parseLogbook(tree);
  const problems = [...warnings];
  if (logbook.settings.version !== 3) problems.push(`Unsupported data format version ${logbook.settings.version}`);
  if (problems.length === 0) {
    const before = flattenTree(tree);
    // serializeLogbook() leaves its argument unchanged (tested), so the parsed logbook is reused
    const after = flattenTree(serializeLogbook(logbook));
    for (const path of new Set([...before.keys(), ...after.keys()])) {
      if (before.get(path) !== after.get(path)) problems.push(`${path}: cannot be reproduced exactly`);
    }
  }
  return { logbook, problems };
}
