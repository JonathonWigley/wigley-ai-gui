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
// fails with `<path> is outside <root>` before any I/O: `read`, `write`,
// `list`, `stat`, `realPath`, `makeFolder`, `rename` (either path) and `trash`
// reject, and `watch` throws. `realPath` returns the resolved path relative to
// `root`'s own real path (`` for `root` itself), and rejects
// `<path> is outside <root>` when a link leads out of `root`.
export function scopedFiles(files: Files, root: string): Files {
  const outside = (path: string) => new Error(`${path} is outside ${root}`);
  const inside = (path: string): string => {
    const resolved = resolveInside(root, path);
    if (resolved === null) {
      throw outside(path);
    }
    return resolved;
  };
  return {
    read: async (path) => files.read(inside(path)),
    write: async (path, text) => files.write(inside(path), text),
    list: async (folder, options) => files.list(inside(folder), options),
    watch: (folder, onChange, onError) =>
      files.watch(inside(folder), onChange, onError),
    stat: async (path) => files.stat(inside(path)),
    realPath: async (path) => {
      const [real, realRoot] = await Promise.all([
        files.realPath(inside(path)),
        files.realPath(root),
      ]);
      const relative = relativeToFolder(realRoot, real);
      if (relative === null) {
        throw outside(path);
      }
      return relative;
    },
    makeFolder: async (path) => files.makeFolder(inside(path)),
    rename: async (from, to) => files.rename(inside(from), inside(to)),
    trash: async (path) => files.trash(inside(path)),
  };
}

// `path` relative to `folder`, `` for `folder` itself; null when `path` is
// not inside `folder`.
function relativeToFolder(folder: string, path: string): string | null {
  if (path === folder) {
    return '';
  }
  const prefix = folder.endsWith('/') ? folder : `${folder}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}
