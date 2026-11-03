// The file chip pattern: where a box's text holds a file's path, and how a
// dropped path is written into the text so it reads back as one chip.
import type { Paths } from '../../../contracts/paths';

// A path's span in the text, `to` exclusive; quotes, when written, included.
export interface FileChipRange {
  from: number;
  to: number;
  path: string;
  name: string;
}

// Characters that end a sentence around an unquoted path rather than the path.
const TRAILING_PUNCTUATION = /[.,;:!?)]+$/;
const WHITESPACE = /\s/;
const LINE_BREAK = /[\r\n]/;

// Every absolute path of two or more segments in `text`, left to right: a
// double-quoted span on one line, or a run of text up to whitespace or a quote
// that holds no quote. A quote opens a span wherever it stands, except inside a
// run that began as an absolute path: there it belongs to the path, and the
// path draws no chip.
export function fileChipsIn(text: string, paths: Paths): FileChipRange[] {
  const chips: FileChipRange[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (WHITESPACE.test(char)) {
      index += 1;
    } else if (char === '"') {
      const close = closingQuoteAfter(text, index);
      const path = close === -1 ? '' : text.slice(index + 1, close);
      if (isChipPath(path, paths)) {
        chips.push({
          from: index,
          to: close + 1,
          path,
          name: paths.base(path),
        });
        index = close + 1;
      } else {
        index += 1;
      }
    } else {
      const end = tokenEnd(text, index, paths);
      const token = text.slice(index, end);
      const path = token.replace(TRAILING_PUNCTUATION, '');
      if (!token.includes('"') && isChipPath(path, paths)) {
        chips.push({
          from: index,
          to: index + path.length,
          path,
          name: paths.base(path),
        });
      }
      index = end;
    }
  }
  return chips;
}

// `filePaths` as text to insert after `charBefore`: joined by spaces, each
// quoted when an unquoted chip would not read it whole, and spaced off a
// character before it that is not whitespace. A path holding a quote goes in
// unquoted and reads back as no chip. The caller spaces the text off the
// character after it.
export function insertionText(
  filePaths: readonly string[],
  charBefore: string,
): string {
  const written = filePaths.map((path) => {
    const needsQuotes =
      !path.includes('"') &&
      (WHITESPACE.test(path) || TRAILING_PUNCTUATION.test(path));
    return needsQuotes ? `"${path}"` : path;
  });
  const needsLeadingSpace = charBefore !== '' && !WHITESPACE.test(charBefore);
  return (needsLeadingSpace ? ' ' : '') + written.join(' ');
}

// The index of the `"` closing the one opened at `open`, or -1 when a line
// break or the end of the text comes first.
function closingQuoteAfter(text: string, open: number): number {
  for (let index = open + 1; index < text.length; index += 1) {
    if (text[index] === '"') {
      return index;
    }
    if (LINE_BREAK.test(text[index])) {
      return -1;
    }
  }
  return -1;
}

// The end of the unquoted run at `start`: the next whitespace, or the first
// quote before it when the run before that quote is no absolute path.
function tokenEnd(text: string, start: number, paths: Paths): number {
  let end = start;
  while (end < text.length && !WHITESPACE.test(text[end])) {
    end += 1;
  }
  const quote = text.indexOf('"', start);
  const quoteInRun = quote !== -1 && quote < end;
  if (quoteInRun && !paths.isAbsolute(text.slice(start, quote))) {
    return quote;
  }
  return end;
}

// `/` and a one-segment path such as the slash command `/compact` stay text.
function isChipPath(path: string, paths: Paths): boolean {
  return paths.isAbsolute(path) && paths.base(paths.parent(path)) !== '';
}
