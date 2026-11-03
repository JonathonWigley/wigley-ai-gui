import type { Paths } from '../../contracts/paths';
import type { FileChipDrawing } from '../../contracts/editor';

function unused(): never {
  throw new Error('Finding file chips reads no other path rule');
}

// POSIX path rules as far as finding a file chip reads them: a path is
// absolute from '/', and its parent and base split at its last '/'.
export const CHIP_PATHS: Paths = {
  separator: '/',
  isAbsolute: (path) => path.startsWith('/'),
  parent: (path) => path.slice(0, Math.max(path.lastIndexOf('/'), 1)),
  base: (path) => path.slice(path.lastIndexOf('/') + 1),
  normalize: unused,
  join: unused,
  samePath: unused,
  isInside: unused,
  segmentsBelow: unused,
  commonFolder: unused,
  tilde: unused,
  expandTilde: unused,
};

// A drawing for an editor state with no view, which draws no chip.
export const CHIP_DRAWING: FileChipDrawing = {
  paths: CHIP_PATHS,
  fileIcon: () => {
    throw new Error('A state with no view draws no chip');
  },
};
