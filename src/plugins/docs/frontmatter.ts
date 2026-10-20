export interface SplitDoc {
  // In file order.
  fields: [string, string][];
  body: string;
  // 1-based line of the body's first line in the whole text.
  bodyStartLine: number;
}

const FIELD_LINE = /^([^\s#:][^:]*):(\s.*)?$/;
const BLOCK_INDICATORS = ['>', '>-', '|', '|-', ''];
const LITERAL_INDICATORS = ['|', '|-'];

// Splits a leading `---` block from the text and reads its `key: value`
// fields; a text with no closed block is all body.
export function splitFrontmatter(text: string): SplitDoc {
  const lines = text.split('\n');
  const closing = lines.findIndex((line, index) => index > 0 && isFence(line));
  if (!isFence(lines[0]) || closing === -1) {
    return { fields: [], body: text, bodyStartLine: 1 };
  }
  const block = lines.slice(1, closing).map((line) => line.replace(/\r$/, ''));
  return {
    fields: readFields(block),
    body: lines.slice(closing + 1).join('\n'),
    bodyStartLine: closing + 2,
  };
}

function isFence(line: string): boolean {
  return line.replace(/[ \r]+$/, '') === '---';
}

function readFields(block: readonly string[]): [string, string][] {
  const fields: [string, string][] = [];
  let index = 0;
  while (index < block.length) {
    const match = FIELD_LINE.exec(block[index]);
    index++;
    if (match === null) {
      continue;
    }
    const value = (match[2] ?? '').trim();
    const taken: string[] = [];
    if (BLOCK_INDICATORS.includes(value)) {
      const listAllowed = value === '';
      while (index < block.length && isBlockLine(block[index], listAllowed)) {
        taken.push(block[index].trim());
        index++;
      }
      fields.push([match[1], blockValue(value, taken)]);
    } else {
      while (index < block.length && isContinuation(block[index])) {
        taken.push(block[index].trim());
        index++;
      }
      fields.push([match[1], unquoted([value, ...taken].join(' '))]);
    }
  }
  return fields;
}

// An indented or blank line, or (under an empty value) a `- item` at
// column 0.
function isBlockLine(line: string, listAllowed: boolean): boolean {
  return (
    isContinuation(line) ||
    line.trim() === '' ||
    (listAllowed && line.startsWith('- '))
  );
}

function isContinuation(line: string): boolean {
  return /^[ \t]/.test(line) && line.trim() !== '';
}

function blockValue(indicator: string, lines: readonly string[]): string {
  if (LITERAL_INDICATORS.includes(indicator)) {
    return trimmedBlankEnds(lines).join('\n');
  }
  return lines.filter((line) => line !== '').join(' ');
}

function trimmedBlankEnds(lines: readonly string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === '') {
    end--;
  }
  return lines.slice(0, end);
}

// Strips one matching pair of surrounding `'` or `"`.
function unquoted(value: string): string {
  const quoted =
    value.length >= 2 &&
    (value[0] === '"' || value[0] === "'") &&
    value[value.length - 1] === value[0];
  return quoted ? value.slice(1, -1) : value;
}
