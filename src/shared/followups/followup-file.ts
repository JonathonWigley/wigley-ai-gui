// The follow-up file shape (triage.md § The project's follow-ups in
// wigley-ai-marketplace): reads a features home's follow-ups file into items,
// as `docs_index.py` reads it, and turns one item edit into the file's new
// text, in the file's own shape. Pure: text in, text out.

// One follow-up. `line` and `endLine` are 1-based: the `##` heading or list
// item, and the last non-blank line of its section or continuation.
export interface FollowupItem {
  title: string;
  oneLine: string;
  tags: string[];
  body: string;
  line: number;
  endLine: number;
  done: boolean;
}

// `sections`: one item per `##` heading, its line in a Contents list.
// `list`: one item per top-level list item.
export type FollowupShape = 'sections' | 'list';

export interface FollowupFile {
  shape: FollowupShape;
  items: FollowupItem[];
}

export interface FollowupDraft {
  title: string;
  oneLine: string;
  tags: string[];
  body: string;
}

// An edit names its item by title, compared exactly. A create with
// `openOneLine` writes an empty one line and no tags as `**<title>** — `, so
// the one line is typed after it.
export type FollowupEdit =
  | { type: 'create'; draft: FollowupDraft; openOneLine?: boolean }
  | { type: 'edit'; title: string; draft: FollowupDraft }
  | { type: 'setTags'; title: string; tags: string[] }
  | { type: 'delete'; title: string };

// `line` is the 1-based line of the created or edited item (for a create with
// `openOneLine`, the line its one line is typed on: the list item or the
// Contents line); for a delete, the line where the removed item started,
// clamped to the file's last line.
export type FollowupEditResult =
  | { type: 'applied'; text: string; line: number }
  | { type: 'missing'; title: string }
  | { type: 'titleTaken'; title: string };

const TOP_LEVEL_ITEM = /^(- |\d+\. )(.*)$/;
const NUMBERED_MARKER = /^(\d+)\. $/;
const FENCE = /^(`{3,}|~{3,})(.*)$/;
const TAG_SPAN = /^(?:\*([^*]+)\*|_([^_]+)_):\s*(.*)$/;
const CONTENTS_LINE = '**Contents**';

// 0-based line indexes, both inclusive.
interface LineSpan {
  start: number;
  end: number;
}

// What a Contents line or list item's first line says.
interface LineFields {
  title: string;
  oneLine: string;
  tags: string[];
  struck: boolean;
}

interface ContentsEntry {
  span: LineSpan;
  marker: string;
  fields: LineFields;
}

interface ContentsList {
  heading: number;
  entries: ContentsEntry[];
}

// An item and where its text sits. `marker` is a list item's `- ` or `N. `;
// `leadEnd` is the last line of a list item's first line, a bold title
// wrapped onto its continuation included; `contents` is a section's Contents
// line.
interface Entry {
  item: FollowupItem;
  span: LineSpan;
  leadEnd: number;
  struck: boolean;
  marker: string;
  contents: ContentsEntry | null;
}

interface Layout {
  shape: FollowupShape;
  entries: Entry[];
  contents: ContentsList | null;
}

// A replacement of `remove` lines from index `at` by `insert`.
interface Splice {
  at: number;
  remove: number;
  insert: string[];
}

// `lineEnding` is `\r\n` when the file uses CRLF, so an edit writes it back.
interface SplitText {
  lines: string[];
  endsWithNewline: boolean;
  lineEnding: string;
}

// Why `title` would not read back as written as a follow-up's title, or null.
export function followupTitleProblem(title: string): string | null {
  if (title.trim() === '') {
    return 'A follow-up title is required';
  }
  if (/[\r\n]/.test(title)) {
    return 'A follow-up title is one line';
  }
  if (title !== title.trim()) {
    return 'A follow-up title does not start or end with a space';
  }
  if (title.startsWith('~~')) {
    return 'A follow-up title does not start with ~~';
  }
  if (title.includes('**') || title.endsWith('*')) {
    return 'A follow-up title holds no ** and does not end with *';
  }
  if (title.endsWith(':')) {
    return 'A follow-up title does not end with :';
  }
  return null;
}

export function parseFollowups(text: string): FollowupFile {
  const layout = readLayout(splitText(text).lines);
  return {
    shape: layout.shape,
    items: layout.entries.map((entry) => entry.item),
  };
}

// A sections file with no Contents list gains one, built from its headings,
// before the edit applies.
export function applyFollowupEdit(
  text: string,
  edit: FollowupEdit,
): FollowupEditResult {
  const source = splitText(text);
  let lines =
    edit.type === 'create' ? withoutTrailingBlanks(source.lines) : source.lines;
  let layout = readLayout(lines);
  if (layout.shape === 'sections' && layout.contents === null) {
    lines = applySplices(lines, [contentsListSplice(lines, layout.entries)]);
    layout = readLayout(lines);
  }
  if (edit.type === 'create') {
    if (findEntry(layout, edit.draft.title) !== undefined) {
      return { type: 'titleTaken', title: edit.draft.title };
    }
    const openOneLine = edit.openOneLine === true;
    const created = applySplices(
      lines,
      createSplices(lines, layout, edit.draft, openOneLine),
    );
    const line = openOneLine
      ? oneLineLineOf(created, edit.draft.title)
      : lineOf(created, edit.draft.title);
    return applied(created, source, line);
  }
  const entry = findEntry(layout, edit.title);
  if (entry === undefined) {
    return { type: 'missing', title: edit.title };
  }
  if (edit.type === 'edit') {
    const isRename = edit.draft.title !== edit.title;
    if (isRename && findEntry(layout, edit.draft.title) !== undefined) {
      return { type: 'titleTaken', title: edit.draft.title };
    }
    const edited = applySplices(
      lines,
      editSplices(lines, layout, entry, edit.draft),
    );
    return applied(edited, source, lineOf(edited, edit.draft.title));
  }
  if (edit.type === 'setTags') {
    const tagged = applySplices(
      lines,
      setTagsSplices(lines, layout, entry, edit.tags),
    );
    return applied(tagged, source, lineOf(tagged, edit.title));
  }
  return deleteEntry(lines, source, layout.shape, entry);
}

// The text of a new follow-ups file for `repo`, in the sections shape with an
// empty Contents list.
export function newFollowupsFile(repo: string): string {
  return [
    `# Follow-ups — ${repo}`,
    '',
    CONTENTS_LINE,
    '',
    `Deferred work for the ${repo} repo. Each entry is one \`##\` section and stands on its own as a task brief.`,
    '',
  ].join('\n');
}

function splitText(text: string): SplitText {
  const lineEnding = text.includes('\r\n') ? '\r\n' : '\n';
  if (text === '') {
    return { lines: [], endsWithNewline: true, lineEnding };
  }
  const endsWithNewline = text.endsWith('\n');
  const lines = (endsWithNewline ? text.slice(0, -1) : text)
    .split('\n')
    .map((line) => line.replace(/\r$/, ''));
  return { lines, endsWithNewline, lineEnding };
}

function joinText(lines: string[], source: SplitText): string {
  if (lines.length === 0) {
    return '';
  }
  const ending = source.endsWithNewline ? source.lineEnding : '';
  return lines.join(source.lineEnding) + ending;
}

function applied(
  lines: string[],
  source: SplitText,
  line: number,
): FollowupEditResult {
  return {
    type: 'applied',
    text: joinText(lines, source),
    line,
  };
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

function withoutTrailingBlanks(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && isBlank(lines[end - 1])) {
    end--;
  }
  return lines.slice(0, end);
}

function withoutLeadingBlanks(lines: string[]): string[] {
  const first = lines.findIndex((line) => !isBlank(line));
  return first < 0 ? [] : lines.slice(first);
}

// The last non-blank line index after `start` and before `bound`, else `start`.
function lastNonBlank(lines: string[], start: number, bound: number): number {
  let end = start;
  for (let index = start + 1; index < bound; index++) {
    if (!isBlank(lines[index])) {
      end = index;
    }
  }
  return end;
}

// The indexes of the lines outside fenced code, the fence lines left out. A
// fence closes only on a run of its own character at least as long, with
// nothing after it, as CommonMark has it.
function linesOutsideFences(lines: string[]): number[] {
  const outside: number[] = [];
  let fence: string | null = null;
  lines.forEach((line, index) => {
    const match = FENCE.exec(line.trimStart());
    if (fence === null) {
      const isInlineCode =
        match !== null && match[1][0] === '`' && match[2].includes('`');
      if (match !== null && !isInlineCode) {
        fence = match[1];
        return;
      }
      outside.push(index);
      return;
    }
    const closesFence =
      match !== null &&
      match[1][0] === fence[0] &&
      match[1].length >= fence.length &&
      match[2].trim() === '';
    if (closesFence) {
      fence = null;
    }
  });
  return outside;
}

// Sectioned by a `**Contents**` line or a `### ` heading, or by `## ` headings
// with no top-level list item; else a list file.
function readLayout(lines: string[]): Layout {
  const outside = linesOutsideFences(lines);
  const hasSectionMark = outside.some(
    (index) =>
      lines[index].trim() === CONTENTS_LINE || lines[index].startsWith('### '),
  );
  const hasHeading = outside.some((index) => lines[index].startsWith('## '));
  const hasListItem = outside.some((index) =>
    TOP_LEVEL_ITEM.test(lines[index]),
  );
  const isSectioned = hasSectionMark || (hasHeading && !hasListItem);
  if (!isSectioned) {
    return {
      shape: 'list',
      entries: readListEntries(lines, outside),
      contents: null,
    };
  }
  const contents = readContents(lines, outside);
  return {
    shape: 'sections',
    entries: readSectionEntries(lines, outside, contents),
    contents,
  };
}

// The Contents list: every top-level list item outside fences after the
// `**Contents**` line and before the first `## ` heading, each with its
// indented continuation, which its fields read as part of its line.
function readContents(lines: string[], outside: number[]): ContentsList | null {
  const heading = outside.find(
    (index) => lines[index].trim() === CONTENTS_LINE,
  );
  if (heading === undefined) {
    return null;
  }
  const firstSection =
    outside.find((index) => lines[index].startsWith('## ')) ?? lines.length;
  const entries: ContentsEntry[] = [];
  for (const index of outside) {
    const match = TOP_LEVEL_ITEM.exec(lines[index]);
    if (index <= heading || index >= firstSection || match === null) {
      continue;
    }
    let end = index;
    while (end + 1 < lines.length && isIndentedText(lines[end + 1])) {
      end++;
    }
    const wrapped = lines.slice(index + 1, end + 1).map((line) => line.trim());
    entries.push({
      span: { start: index, end },
      marker: match[1],
      fields: readLineFields([match[2].trim(), ...wrapped].join(' ')),
    });
  }
  return { heading, entries };
}

function isIndentedText(line: string): boolean {
  return !isBlank(line) && /^\s/.test(line);
}

function readSectionEntries(
  lines: string[],
  outside: number[],
  contents: ContentsList | null,
): Entry[] {
  const headings = outside.filter((index) => lines[index].startsWith('## '));
  return headings.map((start, position) => {
    const bound = headings[position + 1] ?? lines.length;
    const end = lastNonBlank(lines, start, bound);
    const heading = unstrike(lines[start].slice(3).trim());
    const bodyLines = withoutLeadingBlanks(lines.slice(start + 1, end + 1));
    const contentsEntry =
      contents?.entries.find((entry) =>
        isSameTitle(entry.fields.title, heading.text),
      ) ?? null;
    const firstBodyLine =
      bodyLines
        .map((line) => line.trim())
        .find((line) => line !== '' && !line.startsWith('#')) ?? '';
    return {
      item: {
        title: heading.text,
        oneLine: contentsEntry?.fields.oneLine ?? '',
        tags: contentsEntry?.fields.tags ?? [],
        body: bodyLines.join('\n'),
        line: start + 1,
        endLine: end + 1,
        done: heading.struck || startsWithShipped(firstBodyLine),
      },
      span: { start, end },
      leadEnd: start,
      struck: heading.struck,
      marker: '',
      contents: contentsEntry,
    };
  });
}

// Backticks are ignored for the match only.
function isSameTitle(a: string, b: string): boolean {
  return a.replaceAll('`', '') === b.replaceAll('`', '');
}

function startsWithShipped(text: string): boolean {
  return text.toLowerCase().startsWith('shipped');
}

// One item per top-level list item at column 0 outside fences; the blank and
// indented lines after it are its continuation, and any other line, a fence
// line at column 0 included, ends it.
function readListEntries(lines: string[], outside: number[]): Entry[] {
  const isOutside = new Set(outside);
  const entries: Entry[] = [];
  let current: { start: number; marker: string; text: string } | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const match = isOutside.has(index) ? TOP_LEVEL_ITEM.exec(line) : null;
    const isContinuation =
      current !== null && (isBlank(line) || /^\s/.test(line));
    if (current !== null && (match !== null || !isContinuation)) {
      entries.push(listEntry(lines, current, index));
      current = null;
    }
    if (match !== null) {
      current = { start: index, marker: match[1], text: match[2] };
    }
  }
  if (current !== null) {
    entries.push(listEntry(lines, current, lines.length));
  }
  return entries;
}

function listEntry(
  lines: string[],
  item: { start: number; marker: string; text: string },
  bound: number,
): Entry {
  const end = lastNonBlank(lines, item.start, bound);
  const leadEnd = boldTitleEnd(lines, item.start, item.text);
  const wrapped = lines
    .slice(item.start + 1, leadEnd + 1)
    .map((line) => line.trim());
  const fields = readLineFields([item.text.trim(), ...wrapped].join(' '));
  const body = withoutLeadingBlanks(lines.slice(leadEnd + 1, end + 1))
    .map((line) => line.replace(/^ {1,2}/, ''))
    .join('\n');
  return {
    item: {
      title: fields.title,
      oneLine: fields.oneLine,
      tags: fields.tags,
      body,
      line: item.start + 1,
      endLine: end + 1,
      done: fields.struck || startsWithShipped(fields.oneLine),
    },
    span: { start: item.start, end },
    leadEnd,
    struck: fields.struck,
    marker: item.marker,
    contents: null,
  };
}

// The line a bold title that opens `text`, the list item's first line on
// `start`, closes on: the first of its indented continuation lines holding
// `**` when the first line does not close it, else `start`.
function boldTitleEnd(lines: string[], start: number, text: string): number {
  const lead = text.trim().replace(/^~~/, '');
  const opensUnclosedBold = lead.startsWith('**') && lead.indexOf('**', 2) < 0;
  if (!opensUnclosedBold) {
    return start;
  }
  for (
    let index = start + 1;
    index < lines.length && isIndentedText(lines[index]);
    index++
  ) {
    if (lines[index].includes('**')) {
      return index;
    }
  }
  return start;
}

// A Contents line or list item's text after its marker:
// `**<title>** — *<tags>*: <oneLine>`, or a first sentence as the title.
function readLineFields(raw: string): LineFields {
  const { text, struck } = unstrike(raw.trim());
  const { title, rest } = splitTitle(text);
  const span = TAG_SPAN.exec(rest);
  if (span === null) {
    return { title, oneLine: rest, tags: [], struck };
  }
  const tags = (span[1] ?? span[2])
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
  return { title, oneLine: span[3].trim(), tags, struck };
}

// The bold lead, or else the first sentence (a trailing `.` dropped), and the
// text after it, its leading colon, dash and spaces removed.
function splitTitle(text: string): { title: string; rest: string } {
  const boldEnd = text.startsWith('**') ? text.indexOf('**', 2) : -1;
  if (boldEnd >= 0) {
    return {
      title: text.slice(2, boldEnd).trim().replace(/:+$/, '').trim(),
      rest: withoutLead(text.slice(boldEnd + 2)),
    };
  }
  const sentenceEnd = text.indexOf('. ');
  const sentence = sentenceEnd < 0 ? text : text.slice(0, sentenceEnd);
  const rest = sentenceEnd < 0 ? '' : text.slice(sentenceEnd + 2);
  return { title: sentence.replace(/\.$/, ''), rest: withoutLead(rest) };
}

function withoutLead(text: string): string {
  return text.replace(/^[:—– ]+/, '').trim();
}

// `text` with a leading `~~…~~` strike-through removed, and whether it had one.
function unstrike(text: string): { text: string; struck: boolean } {
  const close = text.startsWith('~~') ? text.indexOf('~~', 2) : -1;
  if (close < 0) {
    return { text, struck: false };
  }
  return { text: text.slice(2, close) + text.slice(close + 2), struck: true };
}

function findEntry(layout: Layout, title: string): Entry | undefined {
  return layout.entries.find((entry) => entry.item.title === title);
}

function lineOf(lines: string[], title: string): number {
  return writtenEntry(lines, title).item.line;
}

// The 1-based line `title`'s one line is typed on: its list item, or its
// Contents line in a sections file.
function oneLineLineOf(lines: string[], title: string): number {
  const entry = writtenEntry(lines, title);
  return (entry.contents?.span.start ?? entry.span.start) + 1;
}

function writtenEntry(lines: string[], title: string): Entry {
  const entry = findEntry(readLayout(lines), title);
  if (entry === undefined) {
    throw new Error(`The written follow-up "${title}" does not read back.`);
  }
  return entry;
}

// Applied from the highest index down, so each splice's index still holds;
// of two at one index, the earlier-listed one ends up first.
function applySplices(lines: string[], splices: Splice[]): string[] {
  const result = [...lines];
  const ordered = splices
    .map((splice, order) => ({ splice, order }))
    .sort((a, b) => b.splice.at - a.splice.at || b.order - a.order);
  for (const { splice } of ordered) {
    result.splice(splice.at, splice.remove, ...splice.insert);
  }
  return result;
}

// `openOneLine` keeps the dash after a title with no tags or one line.
function formatItemLine(
  marker: string,
  title: string,
  tags: string[],
  oneLine: string,
  struck: boolean,
  openOneLine = false,
): string {
  const tagSpan = tags.length > 0 ? `*${tags.join(', ')}*:` : '';
  const tail = [tagSpan, oneLine].filter((part) => part !== '').join(' ');
  const lead = struck ? `~~**${title}**~~` : `**${title}**`;
  const hasNoDash = tail === '' && !openOneLine;
  return hasNoDash ? `${marker}${lead}` : `${marker}${lead} — ${tail}`;
}

function bodyLines(body: string): string[] {
  return withoutTrailingBlanks(withoutLeadingBlanks(body.split('\n')));
}

// An empty body writes `oneLine`, so the section stands on its own.
function sectionLines(draft: FollowupDraft, struck: boolean): string[] {
  const heading = `## ${struck ? `~~${draft.title}~~` : draft.title}`;
  const body = bodyLines(draft.body);
  const written = body.length > 0 ? body : bodyLines(draft.oneLine);
  return written.length > 0 ? [heading, '', ...written] : [heading];
}

function listItemLines(
  marker: string,
  draft: FollowupDraft,
  struck: boolean,
  openOneLine = false,
): string[] {
  const continuation = bodyLines(draft.body).map((line) =>
    isBlank(line) ? '' : `  ${line}`,
  );
  return [
    formatItemLine(
      marker,
      draft.title,
      draft.tags,
      draft.oneLine,
      struck,
      openOneLine,
    ),
    ...continuation,
  ];
}

// Inserts `line` after the last Contents line, a blank line before it when
// the list's items are separated by blank lines; or right after `**Contents**`
// and its blank line, with a blank line between it and what follows.
function contentsInsertSplice(
  lines: string[],
  contents: ContentsList,
  line: string,
): Splice {
  const last = contents.entries.at(-1);
  if (last !== undefined) {
    const isLoose = contents.entries.some(
      (entry, position) =>
        position > 0 &&
        isBlank(lines[contents.entries[position - 1].span.end + 1]),
    );
    const leading = isLoose ? [''] : [];
    return { at: last.span.end + 1, remove: 0, insert: [...leading, line] };
  }
  const afterHeading = contents.heading + 1;
  const hasBlankAfterHeading =
    afterHeading < lines.length && isBlank(lines[afterHeading]);
  const at = hasBlankAfterHeading ? afterHeading + 1 : afterHeading;
  const leading = hasBlankAfterHeading ? [] : [''];
  const hasTextAfter = at < lines.length && !isBlank(lines[at]);
  const trailing = hasTextAfter ? [''] : [];
  return { at, remove: 0, insert: [...leading, line, ...trailing] };
}

// Writes the section's Contents line: over its own, wrapped lines included,
// when it has one, else as a new line in the list.
function contentsLineSplice(
  lines: string[],
  layout: Layout,
  entry: Entry,
  line: string,
): Splice {
  if (entry.contents === null) {
    return contentsInsertSplice(lines, requireContents(layout), line);
  }
  const { start, end } = entry.contents.span;
  return { at: start, remove: end - start + 1, insert: [line] };
}

function requireContents(layout: Layout): ContentsList {
  if (layout.contents === null) {
    throw new Error(
      'A sections file reached an edit without its Contents list.',
    );
  }
  return layout.contents;
}

// A `**Contents**` list built from the headings, after the `# ` heading or at
// the top, each line's one line the first sentence of its section.
function contentsListSplice(lines: string[], entries: Entry[]): Splice {
  const listLines = entries.map((entry) =>
    formatItemLine(
      '- ',
      entry.item.title,
      [],
      firstSentence(lines, entry),
      false,
    ),
  );
  const block = [CONTENTS_LINE, '', ...listLines];
  const titleLine = linesOutsideFences(lines).find((index) =>
    lines[index].startsWith('# '),
  );
  const at = titleLine === undefined ? 0 : titleLine + 1;
  const leading = titleLine === undefined ? [] : [''];
  const hasTextAfter = at < lines.length && !isBlank(lines[at]);
  const trailing = hasTextAfter ? [''] : [];
  return { at, remove: 0, insert: [...leading, ...block, ...trailing] };
}

// The first sentence of the section's first paragraph, `#` lines skipped.
function firstSentence(lines: string[], entry: Entry): string {
  const section = lines.slice(entry.span.start + 1, entry.span.end + 1);
  const first = section.findIndex(
    (line) => !isBlank(line) && !line.trim().startsWith('#'),
  );
  if (first < 0) {
    return '';
  }
  const paragraph: string[] = [];
  for (const line of section.slice(first)) {
    if (isBlank(line) || line.trim().startsWith('#')) {
      break;
    }
    paragraph.push(line.trim());
  }
  const text = paragraph.join(' ');
  const sentenceEnd = text.indexOf('. ');
  return sentenceEnd < 0 ? text : text.slice(0, sentenceEnd + 1);
}

function createSplices(
  lines: string[],
  layout: Layout,
  draft: FollowupDraft,
  openOneLine: boolean,
): Splice[] {
  const separator = lines.length > 0 ? [''] : [];
  if (layout.shape === 'sections') {
    const contentsLine = formatItemLine(
      '- ',
      draft.title,
      draft.tags,
      draft.oneLine,
      false,
      openOneLine,
    );
    return [
      contentsInsertSplice(lines, requireContents(layout), contentsLine),
      {
        at: lines.length,
        remove: 0,
        insert: [...separator, ...sectionLines(draft, false)],
      },
    ];
  }
  const last = layout.entries.at(-1);
  if (last === undefined) {
    return [
      {
        at: lines.length,
        remove: 0,
        insert: [
          ...separator,
          ...listItemLines('- ', draft, false, openOneLine),
        ],
      },
    ];
  }
  return [
    {
      at: last.span.end + 1,
      remove: 0,
      insert: listItemLines(nextMarker(last.marker), draft, false, openOneLine),
    },
  ];
}

// Removes `span`, and the blank line after it when it sits between two.
function blankSeparatedRemoval(lines: string[], span: LineSpan): Splice {
  const hasBlankAfter =
    span.end + 1 < lines.length && isBlank(lines[span.end + 1]);
  const hasBlankBefore = span.start > 0 && isBlank(lines[span.start - 1]);
  const isBetweenBlanks = hasBlankAfter && hasBlankBefore;
  const length = span.end - span.start + 1;
  return {
    at: span.start,
    remove: length + (isBetweenBlanks ? 1 : 0),
    insert: [],
  };
}

function nextMarker(marker: string): string {
  const number = NUMBERED_MARKER.exec(marker);
  return number === null ? marker : `${Number(number[1]) + 1}. `;
}

function editSplices(
  lines: string[],
  layout: Layout,
  entry: Entry,
  draft: FollowupDraft,
): Splice[] {
  const { start, end } = entry.span;
  if (layout.shape === 'list') {
    return [
      {
        at: start,
        remove: end - start + 1,
        insert: listItemLines(entry.marker, draft, entry.struck),
      },
    ];
  }
  const contentsLine = formatItemLine(
    entry.contents?.marker ?? '- ',
    draft.title,
    draft.tags,
    draft.oneLine,
    entry.contents?.fields.struck ?? false,
  );
  return [
    contentsLineSplice(lines, layout, entry, contentsLine),
    {
      at: start,
      remove: end - start + 1,
      insert: sectionLines(draft, entry.struck),
    },
  ];
}

function setTagsSplices(
  lines: string[],
  layout: Layout,
  entry: Entry,
  tags: string[],
): Splice[] {
  if (layout.shape === 'list') {
    const { title, oneLine } = entry.item;
    return [
      {
        at: entry.span.start,
        remove: entry.leadEnd - entry.span.start + 1,
        insert: [
          formatItemLine(entry.marker, title, tags, oneLine, entry.struck),
        ],
      },
    ];
  }
  const contents = entry.contents;
  const line =
    contents === null
      ? formatItemLine(
          '- ',
          entry.item.title,
          tags,
          firstSentence(lines, entry),
          false,
        )
      : formatItemLine(
          contents.marker,
          contents.fields.title,
          tags,
          contents.fields.oneLine,
          contents.fields.struck,
        );
  return [contentsLineSplice(lines, layout, entry, line)];
}

// Removes the section (and one blank line after it) with its Contents line, or
// the list item with its continuation. A removed Contents line or list item
// that sat between two blank lines takes one of them along.
function deleteEntry(
  lines: string[],
  source: SplitText,
  shape: FollowupShape,
  entry: Entry,
): FollowupEditResult {
  const { start, end } = entry.span;
  const hasBlankAfter = end + 1 < lines.length && isBlank(lines[end + 1]);
  const sectionRemoval: Splice = {
    at: start,
    remove: end - start + 1 + (hasBlankAfter ? 1 : 0),
    insert: [],
  };
  const splices: Splice[] = [
    shape === 'sections'
      ? sectionRemoval
      : blankSeparatedRemoval(lines, entry.span),
  ];
  let removedAbove = 0;
  if (entry.contents !== null) {
    const contentsSplice = blankSeparatedRemoval(lines, entry.contents.span);
    splices.push(contentsSplice);
    if (entry.contents.span.end < start) {
      removedAbove = contentsSplice.remove;
    }
  }
  const wasLastText = end === lastNonBlank(lines, -1, lines.length);
  const remaining = applySplices(lines, splices);
  const result = wasLastText ? withoutTrailingBlanks(remaining) : remaining;
  const line = Math.min(start - removedAbove + 1, Math.max(result.length, 1));
  return applied(result, source, line);
}
