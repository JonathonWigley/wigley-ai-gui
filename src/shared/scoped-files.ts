import type { Files } from '../contracts/files';
import type { Paths } from '../contracts/paths';

// Windows reads `\` as a separator and `C:` as a drive.
const WINDOWS_PATH_SYNTAX = /\\|^[A-Za-z]:/;

// The segments of the `/`-separated relative `path`, its `.` and `..`
// segments folded, `[]` for an empty path; null when `path` is absolute (a
// leading `/`), holds a `\` or starts with a drive prefix such as `C:`, or its
// `..` segments climb above its start.
export function relativeSegments(path: string): string[] | null {
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
  return segments;
}

// `files` with every path a `/`-separated path relative to `root`, joined
// onto `root` by `paths` (`root` itself for an empty path). A path
// `relativeSegments` refuses fails with `<path> is outside <root>` before any
// I/O: `read`, `modified`, `readStart`, `readBytes`, `write`, `writeBytes`,
// `append`, `list`, `stat`, `realPath`, `makeFolder`, `rename` (either path),
// `trash` and `deleteFile` reject, and `watch` throws. `realPath` returns the resolved path
// relative to `root`'s own real path (`` for `root` itself), as `paths`
// compares them, its segments joined with `/`, and rejects `<path> is outside
// <root>` when a link leads out of `root`.
export function scopedFiles(files: Files, root: string, paths: Paths): Files {
  const outside = (path: string) => new Error(`${path} is outside ${root}`);
  const inside = (path: string): string => {
    const segments = relativeSegments(path);
    if (segments === null) {
      throw outside(path);
    }
    return segments.length === 0 ? root : paths.join(root, ...segments);
  };
  return {
    read: async (path) => files.read(inside(path)),
    modified: async (path) => files.modified(inside(path)),
    readStart: async (path, maxBytes) =>
      files.readStart(inside(path), maxBytes),
    readBytes: async (path) => files.readBytes(inside(path)),
    write: async (path, text) => files.write(inside(path), text),
    writeBytes: async (path, bytes) => files.writeBytes(inside(path), bytes),
    append: async (path, text) => files.append(inside(path), text),
    list: async (folder, options) => files.list(inside(folder), options),
    watch: (folder, onChange, options) =>
      files.watch(inside(folder), onChange, options),
    stat: async (path) => files.stat(inside(path)),
    realPath: async (path) => {
      const [real, realRoot] = await Promise.all([
        files.realPath(inside(path)),
        files.realPath(root),
      ]);
      const relative = paths.segmentsBelow(real, realRoot);
      if (relative === null) {
        throw outside(path);
      }
      return relative.join('/');
    },
    makeFolder: async (path) => files.makeFolder(inside(path)),
    rename: async (from, to) => files.rename(inside(from), inside(to)),
    trash: async (path) => files.trash(inside(path)),
    deleteFile: async (path) => files.deleteFile(inside(path)),
  };
}
