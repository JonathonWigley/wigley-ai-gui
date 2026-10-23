import type { Paths } from '../../contracts/paths';
import { rootedPaths, type SplitRoot } from './rooted-paths';

const UNC_ROOT = /^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)(?:[\\/]|$)/;
const DRIVE_ROOT = /^([A-Za-z]:)[\\/]/;
// 'C:foo': relative to the drive's current folder.
const DRIVE_RELATIVE = /^[A-Za-z]:/;

// Paths on Windows: '/' and '\' both read as separators and '\' is written;
// a drive ('C:\') or a UNC share ('\\server\share\') is a root, and segments
// compare case-insensitively.
export const windowsPaths: Paths = rootedPaths({
  separator: '\\',
  separators: /[\\/]/,
  splitRoot,
  compareKey: (text) => text.toLowerCase(),
});

function splitRoot(path: string): SplitRoot {
  const unc = UNC_ROOT.exec(path);
  if (unc !== null) {
    return {
      root: `\\\\${unc[1]}\\${unc[2]}\\`,
      absolute: true,
      fixedTop: true,
      rest: path.slice(unc[0].length),
    };
  }
  const drive = DRIVE_ROOT.exec(path);
  if (drive !== null) {
    return {
      root: `${drive[1]}\\`,
      absolute: true,
      fixedTop: true,
      rest: path.slice(drive[0].length),
    };
  }
  if (DRIVE_RELATIVE.test(path)) {
    return {
      root: path.slice(0, 2),
      absolute: false,
      fixedTop: false,
      rest: path.slice(2),
    };
  }
  // '\foo': relative to the current drive's root.
  if (path.startsWith('\\') || path.startsWith('/')) {
    return { root: '\\', absolute: false, fixedTop: true, rest: path.slice(1) };
  }
  return { root: '', absolute: false, fixedTop: false, rest: path };
}
