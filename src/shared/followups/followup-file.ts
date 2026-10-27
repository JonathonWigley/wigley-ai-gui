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

// An edit names its item by title, compared exactly.
export type FollowupEdit =
  | { type: 'create'; draft: FollowupDraft }
  | { type: 'edit'; title: string; draft: FollowupDraft }
  | { type: 'setTags'; title: string; tags: string[] }
  | { type: 'delete'; title: string };

// `line` is the 1-based line of the created or edited item; for a delete, the
// line where the removed item started, clamped to the file's last line.
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
// `contents` is a section's Contents line.
interface Entry {
  item: FollowupItem;
  span: LineSpan;
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

interface SplitText {
  lines: string[];
  endsWithNewline: boolean;
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
    const created = applySplices(
      lines,
      createSplices(lines, layout, edit.draft),
    );
    return applied(created, source, lineOf(created, edit.draft.title));
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
  if (text === '') {
    return { lines: [], endsWithNewline: true };
  }
  const endsWithNewline = text.endsWith('\n');
  const lines = (endsWithNewline ? text.slice(0, -1) : text).split('\n');
  return { lines, endsWithNewline };
}

function joinText(lines: string[], endsWithNewline: boolean): string {
  if (lines.length === 0) {
    return '';
  }
  return lines.join('\n') + (endsWithNewline ? '\n' : '');
}

function applied(
  lines: string[],
  source: SplitText,
  line: number,
): FollowupEditResult {
  return {
    type: 'applied',
    text: joinText(lines, source.endsWithNewline),
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

function readLayout(lines: string[]): Layout {
  const outside = linesOutsideFences(lines);
  const isSectioned = outside.some(
    (index) =>
      lines[index].trim() === CONTENTS_LINE || lines[index].startsWith('### '),
  );
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

// The Contents list: the top-level list items right after the `**Contents**`
// line and its blank lines, each with its indented continuation.
function readContents(lines: string[], outside: number[]): ContentsList | null {
  const heading = outside.find(
    (index) => lines[index].trim() === CONTENTS_LINE,
  );
  if (heading === undefined) {
    return null;
  }
  const entries: ContentsEntry[] = [];
  let index = heading + 1;
  while (index < lines.length && isBlank(lines[index])) {
    index++;
  }
  for (
    let match = TOP_LEVEL_ITEM.exec(lines[index] ?? '');
    match !== null;
    match = TOP_LEVEL_ITEM.exec(lines[index] ?? '')
  ) {
    let end = index;
    while (end + 1 < lines.length && isIndentedText(lines[end + 1])) {
      end++;
    }
    entries.push({
      span: { start: index, end },
      marker: match[1],
      fields: readLineFields(match[2]),
    });
    index = end + 1;
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

// One item per top-level list item at column 0; the blank and indented lines
// after it are its continuation.
function readListEntries(lines: string[], outside: number[]): Entry[] {
  const entries: Entry[] = [];
  let current: { start: number; marker: string; text: string } | null = null;
  for (const index of outside) {
    const line = lines[index];
    const match = TOP_LEVEL_ITEM.exec(line);
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
  const fields = readLineFields(item.text);
  const body = withoutLeadingBlanks(lines.slice(item.start + 1, end + 1))
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
    struck: fields.struck,
    marker: item.marker,
    contents: null,
  };
}

// A Contents line or list item's text after its marker:
// `**<title>** — *<tags>*: <oneLine>`, or a first sentence as the title.
function readLineFields(raw: string): LineFields {
  const { text, struck } = unstrike(raw.trim());
  const boldEnd = text.startsWith('**') ? text.indexOf('**', 2) : -1;
  if (boldEnd < 0) {
    const sentenceEnd = text.indexOf('. ');
    const sentence = sentenceEnd < 0 ? text : text.slice(0, sentenceEnd);
    const rest = sentenceEnd < 0 ? '' : text.slice(sentenceEnd + 2);
    return {
      title: sentence.replace(/\.$/, ''),
      oneLine: withoutLead(rest),
      tags: [],
      struck,
    };
  }
  const title = text.slice(2, boldEnd).trim().replace(/:+$/, '').trim();
  const rest = withoutLead(text.slice(boldEnd + 2));
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
  const entry = findEntry(readLayout(lines), title);
  if (entry === undefined) {
    throw new Error(`The written follow-up "${title}" does not read back.`);
  }
  return entry.item.line;
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

function formatItemLine(
  marker: string,
  title: string,
  tags: string[],
  oneLine: string,
  struck: boolean,
): string {
  const tagSpan = tags.length > 0 ? `*${tags.join(', ')}*:` : '';
  const tail = [tagSpan, oneLine].filter((part) => part !== '').join(' ');
  const lead = struck ? `~~**${title}**~~` : `**${title}**`;
  return tail === '' ? `${marker}${lead}` : `${marker}${lead} — ${tail}`;
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
): string[] {
  const continuation = bodyLines(draft.body).map((line) =>
    isBlank(line) ? '' : `  ${line}`,
  );
  return [
    formatItemLine(marker, draft.title, draft.tags, draft.oneLine, struck),
    ...continuation,
  ];
}

// Inserts `line` after the last Contents line, or right after `**Contents**`
// and its blank line, with a blank line between it and what follows.
function contentsInsertSplice(
  lines: string[],
  contents: ContentsList,
  line: string,
): Splice {
  const last = contents.entries.at(-1);
  if (last !== undefined) {
    return { at: last.span.end + 1, remove: 0, insert: [line] };
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

// Writes the section's Contents line: its own when it has one, else a new
// line in the list.
function contentsLineSplice(
  lines: string[],
  layout: Layout,
  entry: Entry,
  line: string,
  wholeEntry: boolean,
): Splice {
  if (entry.contents === null) {
    return contentsInsertSplice(lines, requireContents(layout), line);
  }
  const { start, end } = entry.contents.span;
  return {
    at: start,
    remove: wholeEntry ? end - start + 1 : 1,
    insert: [line],
  };
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
): Splice[] {
  const separator = lines.length > 0 ? [''] : [];
  if (layout.shape === 'sections') {
    const contentsLine = formatItemLine(
      '- ',
      draft.title,
      draft.tags,
      draft.oneLine,
      false,
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
        insert: [...separator, ...listItemLines('- ', draft, false)],
      },
    ];
  }
  return [
    {
      at: last.span.end + 1,
      remove: 0,
      insert: listItemLines(nextMarker(last.marker), draft, false),
    },
  ];
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
    contentsLineSplice(lines, layout, entry, contentsLine, true),
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
        remove: 1,
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
  return [contentsLineSplice(lines, layout, entry, line, false)];
}

// Removes the section (and one blank line after it) with its Contents line, or
// the list item with its continuation.
function deleteEntry(
  lines: string[],
  source: SplitText,
  shape: FollowupShape,
  entry: Entry,
): FollowupEditResult {
  const { start, end } = entry.span;
  const hasBlankAfter = end + 1 < lines.length && isBlank(lines[end + 1]);
  const removesBlankAfter = shape === 'sections' && hasBlankAfter;
  const removed = end - start + 1 + (removesBlankAfter ? 1 : 0);
  const splices: Splice[] = [{ at: start, remove: removed, insert: [] }];
  let removedAbove = 0;
  if (entry.contents !== null) {
    const contentsSpan = entry.contents.span;
    const contentsLength = contentsSpan.end - contentsSpan.start + 1;
    splices.push({
      at: contentsSpan.start,
      remove: contentsLength,
      insert: [],
    });
    if (contentsSpan.end < start) {
      removedAbove = contentsLength;
    }
  }
  const wasLastText = end === lastNonBlank(lines, -1, lines.length);
  const remaining = applySplices(lines, splices);
  const result = wasLastText ? withoutTrailingBlanks(remaining) : remaining;
  const line = Math.min(start - removedAbove + 1, Math.max(result.length, 1));
  return applied(result, source, line);
}
