import type { Paths } from '../../contracts/paths';
import { rootedPaths } from './rooted-paths';

// Paths on macOS and Linux: '/' is the one separator and the one root, and
// segments compare case-sensitively.
export const posixPaths: Paths = rootedPaths({
  separator: '/',
  separators: /\//,
  splitRoot(path) {
    return path.startsWith('/')
      ? { root: '/', absolute: true, fixedTop: true, rest: path.slice(1) }
      : { root: '', absolute: false, fixedTop: false, rest: path };
  },
  compareKey: (text) => text,
});
