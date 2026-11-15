/**
 * A git tree held in memory: file names map to file contents (UTF-8 text) or to subtrees.
 * Subsurface's storage is plain text throughout, so blobs are strings here.
 */
export type GitNode = string | GitTree;
export type GitTree = Map<string, GitNode>;

export function isTree(node: GitNode | undefined): node is GitTree {
  return node instanceof Map;
}

/** Get or create a subtree. Throws if a file is in the way. */
export function subtree(tree: GitTree, name: string): GitTree {
  const existing = tree.get(name);
  if (existing === undefined) {
    const created: GitTree = new Map();
    tree.set(name, created);
    return created;
  }
  if (!isTree(existing)) throw new Error(`"${name}" is a file, expected a directory`);
  return existing;
}

/** Add a file. Throws on a name collision, which Subsurface would resolve with a "~hash" suffix. */
export function addFile(tree: GitTree, name: string, content: string): void {
  if (tree.has(name)) throw new Error(`Duplicate entry "${name}" (unique suffixes are not supported yet)`);
  tree.set(name, content);
}

/** All file paths with their contents, sorted, for comparisons and tests. */
export function flattenTree(tree: GitTree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of [...tree.keys()].sort()) {
    const node = tree.get(name)!;
    const path = prefix + name;
    if (isTree(node)) {
      if (node.size === 0) out.set(`${path}/`, '');
      for (const [p, c] of flattenTree(node, `${path}/`)) out.set(p, c);
    } else {
      out.set(path, node);
    }
  }
  return out;
}

/** Inverse of flattenTree(): paths ending in "/" are empty directories. */
export function unflattenTree(files: Iterable<[string, string]>): GitTree {
  const root: GitTree = new Map();
  for (const [path, content] of files) {
    const isDir = path.endsWith('/');
    const parts = (isDir ? path.slice(0, -1) : path).split('/');
    const name = parts.pop()!;
    let dir = root;
    for (const part of parts) dir = subtree(dir, part);
    if (isDir) subtree(dir, name);
    else dir.set(name, content);
  }
  return root;
}
