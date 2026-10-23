import type { Paths } from '../../contracts/paths';

// The root at the start of a path and the text after it.
export interface SplitRoot {
  // As `normalize` writes it: '' for none, '/', 'C:\', '\\server\share\'.
  root: string;
  absolute: boolean;
  rest: string;
}

// What one OS's paths differ in; every other rule `rootedPaths` shares.
export interface PathSyntax {
  separator: string;
  // Matches one separator the OS reads; never global, so `test` holds no state.
  separators: RegExp;
  splitRoot(path: string): SplitRoot;
  // The form two roots or segments are compared in.
  compareKey(text: string): string;
}

interface ParsedPath {
  root: string;
  segments: string[];
}

// A `Paths` over `syntax`: a path is a root and its segments, '..' climbing a
// kept segment, kept at the front of an unrooted path and dropped at a root.
export function rootedPaths(syntax: PathSyntax): Paths {
  const parse = (path: string): ParsedPath => {
    const { root, rest } = syntax.splitRoot(path);
    return {
      root,
      segments: foldSegments(rest.split(syntax.separators), root),
    };
  };
  const write = (root: string, segments: readonly string[]): string =>
    root + segments.join(syntax.separator);
  const normalize = (path: string): string => {
    const parsed = parse(path);
    return write(parsed.root, parsed.segments);
  };
  const isAbsolute = (path: string): boolean => syntax.splitRoot(path).absolute;
  const join = (folder: string, ...segments: string[]): string => {
    const parsed = parse(folder);
    const appended = segments.flatMap((segment) =>
      segment.split(syntax.separators),
    );
    return write(
      parsed.root,
      foldSegments([...parsed.segments, ...appended], parsed.root),
    );
  };
  const segmentsBelow = (path: string, folder: string): string[] | null => {
    const inner = parse(path);
    const outer = parse(folder);
    const sharesFolder =
      sameKey(syntax, inner.root, outer.root) &&
      sharedLength(syntax, inner.segments, outer.segments) ===
        outer.segments.length;
    return sharesFolder ? inner.segments.slice(outer.segments.length) : null;
  };

  return {
    separator: syntax.separator,
    isAbsolute,
    normalize,
    join,
    parent(path) {
      const parsed = parse(path);
      return write(parsed.root, parsed.segments.slice(0, -1));
    },
    base(path) {
      const { segments } = parse(path);
      return segments.length === 0 ? '' : segments[segments.length - 1];
    },
    samePath(a, b) {
      return sameKey(syntax, normalize(a), normalize(b));
    },
    isInside(path, folder) {
      return segmentsBelow(path, folder) !== null;
    },
    segmentsBelow,
    commonFolder(paths) {
      if (paths.length === 0) {
        throw new Error('commonFolder needs at least one path');
      }
      const [first, ...others] = paths.map(parse);
      let common = first.segments.slice(0, -1);
      for (const other of others) {
        if (!sameKey(syntax, first.root, other.root)) {
          return null;
        }
        const folder = other.segments.slice(0, -1);
        common = common.slice(0, sharedLength(syntax, common, folder));
      }
      return write(first.root, common);
    },
    tilde(path, homeDir) {
      // An unknown home ('') would otherwise hold every unrooted path.
      const below = isAbsolute(homeDir) ? segmentsBelow(path, homeDir) : null;
      if (below === null) {
        return normalize(path);
      }
      return below.length === 0
        ? '~'
        : `~${syntax.separator}${below.join(syntax.separator)}`;
    },
    expandTilde(text, homeDir) {
      if (text === '~') {
        return normalize(homeDir);
      }
      const startsInHome =
        text.startsWith('~') && syntax.separators.test(text.charAt(1));
      return startsInHome ? join(homeDir, text.slice(2)) : text;
    },
  };
}

// Drops '' and '.', and folds '..' into the segment before it; a '..' with
// none before it stays when `root` is '' and is dropped at a root.
function foldSegments(segments: readonly string[], root: string): string[] {
  const kept: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') {
      continue;
    }
    const climbsKeptSegment =
      segment === '..' && kept.length > 0 && kept[kept.length - 1] !== '..';
    if (climbsKeptSegment) {
      kept.pop();
    } else if (segment !== '..' || root === '') {
      kept.push(segment);
    }
  }
  return kept;
}

// How many leading segments `a` and `b` share, compared by `compareKey`.
function sharedLength(
  syntax: PathSyntax,
  a: readonly string[],
  b: readonly string[],
): number {
  let shared = 0;
  while (
    shared < a.length &&
    shared < b.length &&
    sameKey(syntax, a[shared], b[shared])
  ) {
    shared++;
  }
  return shared;
}

function sameKey(syntax: PathSyntax, a: string, b: string): boolean {
  return syntax.compareKey(a) === syntax.compareKey(b);
}
