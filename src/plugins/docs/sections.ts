import { splitFrontmatter } from './frontmatter';

// Lines are 1-based and inclusive, and count from the file's first line,
// frontmatter included. Sections nest, so their ranges overlap.
export interface DocSection {
  title: string;
  level: number;
  startLine: number;
  endLine: number;
}

export interface ScannedLine {
  number: number;
  // Without its line ending.
  text: string;
  heading: { level: number; title: string } | null;
  // False on a frontmatter line, a fence line and a line inside a fence.
  isProse: boolean;
}

interface LineSpan {
  start: number;
  // Offset of the line's ending, or of the end of the text.
  end: number;
}

const FRONTMATTER_MARKER = '---';

// `s`: JavaScript's `.` stops at a lone `\r`, which is line text here.
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/s;
const FENCE_RUN = /^(`{3,}|~{3,})(.*)$/s;

// One entry per line of the file. Lines break on `\n`, a `\r` before it
// belongs to the line ending, and the last line ending adds no line.
export function scanLines(text: string): ScannedLine[] {
  const lines = lineSpans(text).map((span) => text.slice(span.start, span.end));
  const firstBodyLine =
    lines[0] === FRONTMATTER_MARKER ? splitFrontmatter(text).bodyStartLine : 1;
  let fence: string | null = null;
  return lines.map((line, index) => {
    const number = index + 1;
    if (number < firstBodyLine) {
      return { number, text: line, heading: null, isProse: false };
    }
    const fenceBefore: string | null = fence;
    fence = fenceAfterLine(line, fence);
    const isProse = fenceBefore === null && fence === null;
    return {
      number,
      text: line,
      heading: isProse ? headingOf(line) : null,
      isProse,
    };
  });
}

// One section per heading, in file order. A section ends before the next
// heading of the same or higher level. A level 1 first heading is the lead
// section, which ends before the next heading of any level.
export function sectionsOf(text: string): DocSection[] {
  const lines = scanLines(text);
  const headings = lines.flatMap((line) =>
    line.heading === null ? [] : [{ ...line.heading, startLine: line.number }],
  );
  return headings.map((heading, index) => {
    const isLead = index === 0 && heading.level === 1;
    const next = headings
      .slice(index + 1)
      .find((later) => isLead || later.level <= heading.level);
    return {
      title: heading.title,
      level: heading.level,
      startLine: heading.startLine,
      endLine: next === undefined ? lines.length : next.startLine - 1,
    };
  });
}

// The last section starting at or above the line, which is the deepest one
// holding it. `sections` is in file order, as `sectionsOf` gives it.
export function sectionAt(
  sections: readonly DocSection[],
  line: number,
): DocSection | null {
  for (let index = sections.length - 1; index >= 0; index--) {
    if (sections[index].startLine <= line) {
      return sections[index];
    }
  }
  return null;
}

// The section's lines joined with `\n`, with no ending after the last.
export function sectionText(text: string, section: DocSection): string {
  return lineSpans(text)
    .slice(section.startLine - 1, section.endLine)
    .map((span) => text.slice(span.start, span.end))
    .join('\n');
}

// Replaces the section's lines, without the ending of its last line, with
// `next` in the file's line ending. Every other byte of `text` stays.
// `section` must come from this same `text`.
export function spliceSection(
  text: string,
  section: DocSection,
  next: string,
): string {
  const spans = lineSpans(text);
  const start = spans[section.startLine - 1].start;
  const end = spans[section.endLine - 1].end;
  const replacement = next
    .replaceAll('\r\n', '\n')
    .replaceAll('\n', fileLineEnding(text));
  return text.slice(0, start) + replacement + text.slice(end);
}

function lineSpans(text: string): LineSpan[] {
  const spans: LineSpan[] = [];
  let start = 0;
  while (start < text.length) {
    const lineFeed = text.indexOf('\n', start);
    if (lineFeed === -1) {
      spans.push({ start, end: text.length });
      break;
    }
    const hasCarriageReturn = lineFeed > start && text[lineFeed - 1] === '\r';
    spans.push({ start, end: hasCarriageReturn ? lineFeed - 1 : lineFeed });
    start = lineFeed + 1;
  }
  return spans;
}

function fileLineEnding(text: string): string {
  const firstLineFeed = text.indexOf('\n');
  return firstLineFeed > 0 && text[firstLineFeed - 1] === '\r' ? '\r\n' : '\n';
}

// The open fence's run after this line, null when none is open. Any indent
// counts, so a fence inside a list item counts.
function fenceAfterLine(line: string, fence: string | null): string | null {
  const run = FENCE_RUN.exec(line.trimStart());
  if (run === null) {
    return fence;
  }
  if (fence === null) {
    return isInlineCode(run) ? null : run[1];
  }
  return closesFence(run, fence) ? null : fence;
}

// A backtick fence's info string holds no backtick.
function isInlineCode(run: RegExpExecArray): boolean {
  return run[1][0] === '`' && run[2].includes('`');
}

function closesFence(run: RegExpExecArray, fence: string): boolean {
  const isSameCharacter = run[1][0] === fence[0];
  const isLongEnough = run[1].length >= fence.length;
  return isSameCharacter && isLongEnough && run[2].trim() === '';
}

function headingOf(line: string): ScannedLine['heading'] {
  const match = HEADING.exec(line);
  return match === null ? null : { level: match[1].length, title: match[2] };
}
