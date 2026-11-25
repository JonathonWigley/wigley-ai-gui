// A shell's output as plain text, fed chunk by chunk: escape sequences are
// dropped, except erase in line, which changes the current line; `\r` and `\b`
// move a cursor over the current line, and later characters overwrite from it.
// An escape sequence split across chunks waits for the next chunk.
export interface PlainText {
  write(chunk: string): void;
  // The finished lines and the current one, each without trailing spaces, the
  // current one left out when empty: the last `lineLimit` of them joined with `\n`.
  text(): string;
  reset(): void;
}

const ESC = 0x1b;
const BEL = 0x07;
const BACKSPACE = 0x08;
const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const DEL = 0x7f;
const FIRST_PRINTABLE = 0x20;
const CSI_OPENER = '[';
const OSC_OPENER = ']';
const STRING_TERMINATOR_END = '\\';
const ERASE_IN_LINE = 'K';
// A sequence that ends past the text: it waits for the next chunk.
const UNFINISHED = -1;

function isBetween(code: number, first: number, last: number): boolean {
  return code >= first && code <= last;
}

function withoutTrailingSpaces(line: string): string {
  return line.replace(/ +$/, '');
}

// The index after the escape sequence that starts at `start`, or `UNFINISHED`.
// A CSI's parameter and intermediate bytes are `0x20`–`0x3F` and its final byte
// `0x40`–`0x7E`; an OSC runs to BEL or ST (`ESC \`); any other escape takes
// intermediate bytes `0x20`–`0x2F` and one final byte `0x30`–`0x7E`. A byte
// outside a sequence's ranges ends it there, and is read as text.
function escapeEnd(text: string, start: number): number {
  const opener = text[start + 1];
  if (opener === undefined) {
    return UNFINISHED;
  }
  if (opener === CSI_OPENER) {
    const final = skipWhile(text, start + 2, 0x20, 0x3f);
    if (final === text.length) {
      return UNFINISHED;
    }
    return isBetween(text.charCodeAt(final), 0x40, 0x7e) ? final + 1 : final;
  }
  if (opener === OSC_OPENER) {
    return oscEnd(text, start + 2);
  }
  const final = skipWhile(text, start + 1, 0x20, 0x2f);
  if (final === text.length) {
    return UNFINISHED;
  }
  return isBetween(text.charCodeAt(final), 0x30, 0x7e) ? final + 1 : final;
}

function skipWhile(
  text: string,
  from: number,
  first: number,
  last: number,
): number {
  let index = from;
  while (
    index < text.length &&
    isBetween(text.charCodeAt(index), first, last)
  ) {
    index += 1;
  }
  return index;
}

// An OSC's body runs to BEL or ST; an ESC that starts anything else ends it,
// and starts the next sequence.
function oscEnd(text: string, from: number): number {
  for (let index = from; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === BEL) {
      return index + 1;
    }
    if (code === ESC) {
      const next = text[index + 1];
      if (next === undefined) {
        return UNFINISHED;
      }
      return next === STRING_TERMINATOR_END ? index + 2 : index;
    }
  }
  return UNFINISHED;
}

export function createPlainText(lineLimit: number): PlainText {
  let finished: string[] = [];
  let line: string[] = [];
  let cursor = 0;
  let pending = '';

  const finishLine = (): void => {
    finished.push(withoutTrailingSpaces(line.join('')));
    if (finished.length > lineLimit) {
      finished.shift();
    }
    line = [];
    cursor = 0;
  };

  const put = (char: string): void => {
    while (line.length < cursor) {
      line.push(' ');
    }
    line[cursor] = char;
    cursor += 1;
  };

  // Erase in line: empty or `0` clears from the cursor to the line's end, `1`
  // writes spaces from column 0 through the cursor, `2` clears the whole line.
  // The cursor stays.
  const eraseInLine = (parameter: string): void => {
    if (parameter === '' || parameter === '0') {
      line.length = Math.min(line.length, cursor);
    } else if (parameter === '1') {
      for (let column = 0; column <= cursor; column += 1) {
        line[column] = ' ';
      }
    } else if (parameter === '2') {
      line = [];
    }
  };

  const applyEscape = (sequence: string): void => {
    const isEraseInLine =
      sequence[1] === CSI_OPENER && sequence.endsWith(ERASE_IN_LINE);
    if (isEraseInLine) {
      eraseInLine(sequence.slice(2, -1));
    }
  };

  const writeText = (char: string, code: number): void => {
    if (code === CARRIAGE_RETURN) {
      cursor = 0;
    } else if (code === LINE_FEED) {
      finishLine();
    } else if (code === BACKSPACE) {
      cursor = Math.max(0, cursor - 1);
    } else if (code === TAB || (code >= FIRST_PRINTABLE && code !== DEL)) {
      put(char);
    }
  };

  return {
    write(chunk) {
      const text = pending + chunk;
      pending = '';
      let index = 0;
      while (index < text.length) {
        const code = text.charCodeAt(index);
        if (code !== ESC) {
          writeText(text[index] as string, code);
          index += 1;
          continue;
        }
        const end = escapeEnd(text, index);
        if (end === UNFINISHED) {
          pending = text.slice(index);
          return;
        }
        applyEscape(text.slice(index, end));
        index = end;
      }
    },
    text() {
      const current = withoutTrailingSpaces(line.join(''));
      const lines = current === '' ? finished : [...finished, current];
      return lines.slice(-lineLimit).join('\n');
    },
    reset() {
      finished = [];
      line = [];
      cursor = 0;
      pending = '';
    },
  };
}
