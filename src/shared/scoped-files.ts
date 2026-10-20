import type { Files } from '../contracts/files';

// Windows reads `\` as a separator and `C:` as a drive.
const WINDOWS_PATH_SYNTAX = /\\|^[A-Za-z]:/;

// `path` resolved under `root`, its `.` and `..` segments normalized and its
// segments joined with `/`; null when `path` is absolute (a leading `/`),
// holds a `\` or starts with a drive prefix such as `C:`, or its `..`
// segments climb above `root`. An empty `path` resolves to `root`.
export function resolveInside(root: string, path: string): string | null {
  if (path.startsWith('/') || WINDOWS_PATH_SYNTAX.test(path)) {
    return null;
  }
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '..') {
      if (segments.length === 0) {
        return null;
      }
      segments.pop();
    } else if (segment !== '' && segment !== '.') {
      segments.push(segment);
    }
  }
  const base = root.replace(/\/+$/, '');
  return segments.length === 0 ? root : `${base}/${segments.join('/')}`;
}

// `files` with every path relative to `root`. A path `resolveInside` refuses
// fails with `<path> is outside <root>` before any I/O: `read`, `write` and
// `list` reject, and `watch` throws.
export function scopedFiles(files: Files, root: string): Files {
  const inside = (path: string): string => {
    const resolved = resolveInside(root, path);
    if (resolved === null) {
      throw new Error(`${path} is outside ${root}`);
    }
    return resolved;
  };
  return {
    read: async (path) => files.read(inside(path)),
    write: async (path, text) => files.write(inside(path), text),
    list: async (folder, options) => files.list(inside(folder), options),
    watch: (folder, onChange, onError) =>
      files.watch(inside(folder), onChange, onError),
  };
}
