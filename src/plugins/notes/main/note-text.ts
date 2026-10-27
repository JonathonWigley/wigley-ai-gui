import type { NoteFields } from '../contract';

// The follow-up's one line: the first sentence of the body's first paragraph,
// its whitespace runs folded to one space. A sentence ends at the first `.`,
// `!` or `?` followed by a space or the text's end; with none, the whole
// paragraph. '' for an empty body.
export function firstSentence(body: string): string {
  const paragraph = body.trim().split(/\n[^\S\n]*(?:\n|$)/)[0];
  const folded = paragraph.replace(/\s+/g, ' ');
  const end = /[.!?](?= |$)/.exec(folded);
  return end === null ? folded : folded.slice(0, end.index + 1);
}

// `parts` trimmed and joined by blank lines, empty ones left out.
function joinParts(parts: readonly (string | null)[]): string {
  return parts
    .map((part) => (part ?? '').trim())
    .filter((part) => part !== '')
    .join('\n\n');
}

// The text a note adds to a follow-up: the title (on `append` only, since a
// created item's heading holds it), the body, and the session line `line`.
export function followupText(
  draft: NoteFields,
  line: string | null,
  kind: 'create' | 'append',
): string {
  return joinParts([kind === 'append' ? draft.title : null, draft.body, line]);
}

// A launched session's first message: `brief`, the title, the body and the
// session line `line`.
export function launchText(
  brief: string,
  draft: NoteFields,
  line: string | null,
): string {
  return joinParts([brief, draft.title, draft.body, line]);
}
