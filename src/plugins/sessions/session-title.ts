import type { SessionTitles } from './contract';

// The title rules main and page share. Lengths count code points, so an emoji
// is one character.

const ELLIPSIS = '…';

function codePoints(text: string): string[] {
  return [...text];
}

// Whitespace runs collapsed to one space, trimmed.
export function normalizedTitle(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// The `titleMaxLength` setting as a limit: floored, and at least 2 so a cut
// keeps one character before its ellipsis.
export function titleLimit(setting: number): number {
  return Math.max(2, Math.floor(setting));
}

// Why the text cannot be a chosen title at `max`, or null when it can.
export function titleProblem(text: string, max: number): string | null {
  const length = codePoints(normalizedTitle(text)).length;
  if (length === 0) {
    return 'The title is empty.';
  }
  if (length > max) {
    return `The title is ${length} characters; the limit is ${max}.`;
  }
  return null;
}

// The text cut to `max` with an ellipsis when longer.
export function cutTitle(text: string, max: number): string {
  const characters = codePoints(normalizedTitle(text));
  if (characters.length <= max) {
    return characters.join('');
  }
  return (
    characters
      .slice(0, max - 1)
      .join('')
      .trimEnd() + ELLIPSIS
  );
}

// The title the row shows: the user's, else the agent's, else the first
// message cut to `max`; null when no source set one.
export function shownTitle(titles: SessionTitles, max: number): string | null {
  if (titles.user !== null) {
    return titles.user;
  }
  if (titles.agent !== null) {
    return titles.agent;
  }
  return titles.firstMessage === null
    ? null
    : cutTitle(titles.firstMessage, max);
}
