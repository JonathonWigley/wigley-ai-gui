// POSIX path helpers for absolute `/`-separated paths, usable in both
// processes (no `node:path`).

// '/a/b/c.md' → '/a/b'; '/a' → '/'.
export function parentFolder(path: string): string {
  const normal = normalizePath(path);
  const slash = normal.lastIndexOf('/');
  return slash <= 0 ? '/' : normal.slice(0, slash);
}

// '/a/b/c.md' → 'c.md'; '/a/b/' → 'b'.
export function baseName(path: string): string {
  const normal = normalizePath(path);
  return normal.slice(normal.lastIndexOf('/') + 1);
}

export function joinPath(folder: string, ...segments: string[]): string {
  return normalizePath([folder, ...segments].join('/'));
}

// Folds '//', '.' and '..' (never above '/') and drops a trailing '/'.
export function normalizePath(path: string): string {
  const absolute = path.startsWith('/');
  const kept: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    const climbsKeptSegment =
      segment === '..' && kept.length > 0 && kept[kept.length - 1] !== '..';
    if (climbsKeptSegment) {
      kept.pop();
    } else if (segment !== '..' || !absolute) {
      kept.push(segment);
    }
  }
  const joined = kept.join('/');
  return absolute ? `/${joined}` : joined;
}

// True when `path` is `folder` or lies below it.
export function isInside(path: string, folder: string): boolean {
  if (folder === '/') {
    return path.startsWith('/');
  }
  return path === folder || path.startsWith(`${folder}/`);
}

// `homeDir` → '~', `homeDir/x` → '~/x'; any other path unchanged.
export function tildePath(path: string, homeDir: string): string {
  if (path === homeDir) {
    return '~';
  }
  return path.startsWith(`${homeDir}/`)
    ? `~${path.slice(homeDir.length)}`
    : path;
}

// '~' → `homeDir`, '~/x' → `homeDir/x`; '~user/x' and every other text
// unchanged.
export function expandTilde(text: string, homeDir: string): string {
  if (text === '~') {
    return homeDir;
  }
  return text.startsWith('~/') ? `${homeDir}${text.slice(1)}` : text;
}

// The deepest folder holding every path's parent folder, compared by whole
// segments; '/' when they share none.
export function commonFolder(paths: readonly string[]): string {
  if (paths.length === 0) {
    throw new Error('commonFolder needs at least one path');
  }
  let common = folderSegments(paths[0]);
  for (const path of paths.slice(1)) {
    const segments = folderSegments(path);
    let shared = 0;
    while (
      shared < common.length &&
      shared < segments.length &&
      common[shared] === segments[shared]
    ) {
      shared++;
    }
    common = common.slice(0, shared);
  }
  return `/${common.join('/')}`;
}

function folderSegments(path: string): string[] {
  return parentFolder(path)
    .split('/')
    .filter((segment) => segment !== '');
}
