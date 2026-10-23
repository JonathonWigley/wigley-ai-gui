import type { Paths } from '../../contracts/paths';

export type LinkTarget =
  | { type: 'external'; url: string }
  | { type: 'heading'; fragment: string }
  | { type: 'file'; path: string; line: number | null; fragment: string | null }
  | { type: 'unsupported'; href: string };

// The links the app opens outside itself, in the OS default handler.
export const EXTERNAL_SCHEME = /^https?:/i;
const FILE_URL = /^file:\/\//i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// `b.md:12` reads as a scheme to ANY_SCHEME; a name holding a `.` or `/`
// with a colon followed only by digits is a file and line (not
// `localhost:3000` or `tel:555`).
const NAME_WITH_LINE = /^[^:]*[./][^:]*:\d+([#?]|$)/;
const LINE_FRAGMENT = /^L(\d+)$/;
const LINE_SUFFIX = /:(\d+)$/;

// Where a link in the doc at `fromFile` leads. An empty href, or a
// `file://` with no path, is unsupported; `#` alone is the doc's first line.
// An absolute path is a file link, so a Windows drive path never reads as a
// scheme.
export function resolveLink(
  href: string,
  fromFile: string,
  homeDir: string,
  paths: Paths,
): LinkTarget {
  if (href === '') {
    return { type: 'unsupported', href };
  }
  if (EXTERNAL_SCHEME.test(href)) {
    return { type: 'external', url: href };
  }
  if (FILE_URL.test(href)) {
    const urlPath = href.replace(FILE_URL, '');
    // `file:///C:/x` carries a '/' before the drive.
    const filePath = paths.isAbsolute(urlPath.slice(1))
      ? urlPath.slice(1)
      : urlPath;
    return filePath === ''
      ? { type: 'unsupported', href }
      : fileTarget(filePath, fromFile, homeDir, paths);
  }
  if (paths.isAbsolute(href)) {
    return fileTarget(href, fromFile, homeDir, paths);
  }
  if (ANY_SCHEME.test(href) && !NAME_WITH_LINE.test(href)) {
    return { type: 'unsupported', href };
  }
  if (href === '#') {
    return { type: 'file', path: fromFile, line: 1, fragment: null };
  }
  if (href.startsWith('#')) {
    const fragment = href.slice(1);
    const lineMatch = LINE_FRAGMENT.exec(fragment);
    return lineMatch === null
      ? { type: 'heading', fragment: decoded(fragment) }
      : {
          type: 'file',
          path: fromFile,
          line: Number(lineMatch[1]),
          fragment: null,
        };
  }
  return fileTarget(href, fromFile, homeDir, paths);
}

// A path link: `#L<n>` or a trailing `:<n>` gives the line, any other `#…`
// the fragment; a `?query` is dropped, and a link that is only a `?query`
// leads to `fromFile` itself.
function fileTarget(
  href: string,
  fromFile: string,
  homeDir: string,
  paths: Paths,
): LinkTarget {
  const hash = href.indexOf('#');
  let pathText = (hash === -1 ? href : href.slice(0, hash)).split('?')[0];
  const fragmentText = hash === -1 ? '' : href.slice(hash + 1);
  const lineMatch = LINE_FRAGMENT.exec(fragmentText);
  let line = lineMatch === null ? null : Number(lineMatch[1]);
  const fragment =
    lineMatch === null && fragmentText !== '' ? decoded(fragmentText) : null;
  if (line === null) {
    const suffix = LINE_SUFFIX.exec(pathText);
    if (suffix !== null) {
      line = Number(suffix[1]);
      pathText = pathText.slice(0, suffix.index);
    }
  }
  if (pathText === '') {
    return { type: 'file', path: fromFile, line, fragment };
  }
  const expanded = paths.expandTilde(decoded(pathText), homeDir);
  const path = paths.isAbsolute(expanded)
    ? paths.normalize(expanded)
    : paths.join(paths.parent(fromFile), expanded);
  return { type: 'file', path, line, fragment };
}

// `text` URI-decoded; a malformed escape keeps the raw text.
function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
