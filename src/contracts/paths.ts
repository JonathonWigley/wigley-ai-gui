// Full paths by the rules of one OS. A path the caller passes may use either
// separator on Windows; every path returned is normalized: '.' and repeated
// or trailing separators folded, '..' folded and never climbing above a root
// with a fixed top ('/', 'C:\', a UNC share, Windows' '\'; kept at the front
// of an unrooted or 'C:'-relative path), the OS's separator written.
export interface Paths {
  // '/' or '\'.
  readonly separator: string;
  // POSIX: starts with '/'. Windows: a drive root ('C:\', 'c:/') or a UNC
  // root ('\\server\share'); 'C:foo' and '\foo' are not absolute.
  isAbsolute(path: string): boolean;
  normalize(path: string): string;
  // `folder` with each segment appended; a segment may itself hold
  // separators, so a link's relative path joins as one segment.
  join(folder: string, ...segments: string[]): string;
  // The folder holding `path`; a root is its own parent.
  parent(path: string): string;
  // The last segment; '' for a root.
  base(path: string): string;
  // The same path once normalized; case-insensitive on Windows.
  samePath(a: string, b: string): boolean;
  // True when `path` is `folder` or lies below it, compared as samePath does.
  isInside(path: string, folder: string): boolean;
  // The segments of `path` below `folder` ([] for `folder` itself), or null
  // when `path` is not inside it.
  segmentsBelow(path: string, folder: string): string[] | null;
  // The deepest folder holding every path's parent, compared by whole
  // segments; null when they share no root (two Windows drives). Throws on an
  // empty list.
  commonFolder(paths: readonly string[]): string | null;
  // `homeDir` → '~'; below it → '~' + separator + the rest; any other path
  // normalized.
  tilde(path: string, homeDir: string): string;
  // '~' → `homeDir`; '~/x' (and '~\x' on Windows) → `homeDir` joined with
  // 'x'; any other text unchanged, '~user/x' included.
  expandTilde(text: string, homeDir: string): string;
}
