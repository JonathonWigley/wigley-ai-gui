import {
  expandTilde,
  joinPath,
  normalizePath,
  parentFolder,
} from './doc-paths';

export type LinkTarget =
  | { type: 'external'; url: string }
  | { type: 'heading'; fragment: string }
  | { type: 'file'; path: string; line: number | null; fragment: string | null }
  | { type: 'unsupported'; href: string };

const EXTERNAL_SCHEME = /^(https?|mailto):/i;
const FILE_URL = /^file:\/\//i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// `b.md:12` reads as a scheme to ANY_SCHEME; a colon followed only by digits
// is a line number.
const NAME_WITH_LINE = /^[^:]*:\d+([#?]|$)/;
const LINE_FRAGMENT = /^L(\d+)$/;
const LINE_SUFFIX = /:(\d+)$/;

// Where a link in the doc at `fromFile` leads.
export function resolveLink(
  href: string,
  fromFile: string,
  homeDir: string,
): LinkTarget {
  if (EXTERNAL_SCHEME.test(href)) {
    return { type: 'external', url: href };
  }
  if (FILE_URL.test(href)) {
    return fileTarget(href.replace(FILE_URL, ''), fromFile, homeDir);
  }
  if (ANY_SCHEME.test(href) && !NAME_WITH_LINE.test(href)) {
    return { type: 'unsupported', href };
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
  return fileTarget(href, fromFile, homeDir);
}

// A path link: `#L<n>` or a trailing `:<n>` gives the line, any other `#…`
// the fragment; a `?query` is dropped.
function fileTarget(
  href: string,
  fromFile: string,
  homeDir: string,
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
  const expanded = expandTilde(decoded(pathText), homeDir);
  const path = expanded.startsWith('/')
    ? normalizePath(expanded)
    : joinPath(parentFolder(fromFile), expanded);
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
