import type { FuzzyMatcher } from '../../../contracts/fuzzy';
import { normalVimKeys, vimTokens } from '../../../shared/key-hints';
import { matchesSubstring } from '../../../shared/matches-substring';
import { type CommandRow, firesAnywhere } from './keymap-rows';
import type { SettingRow } from './setting-rows';

// Whether `query` fuzzily matches a setting row's label or path, or the
// trimmed query sits in its description, ignoring case: a fuzzy match over a
// sentence matches almost any query.
export function matchesSetting(
  row: SettingRow,
  query: string,
  matcher: FuzzyMatcher,
): boolean {
  const { label, path, description } = row.leaf;
  return (
    matcher.matches(query, label) ||
    matcher.matches(query, path) ||
    matchesSubstring(query, description)
  );
}

// Whether `query` fuzzily matches a command row's label (its arg's label
// included), id, any line's keys or any accelerator.
export function matchesCommand(
  row: CommandRow,
  query: string,
  matcher: FuzzyMatcher,
): boolean {
  const accelerators = row.accelerators.map((line) =>
    line.kind === 'intercept' ? line.bind.key : line.bind.accelerator,
  );
  return [
    row.label,
    row.command.id,
    ...row.binds.map((line) => line.bind.keys),
    ...accelerators,
  ].some((text) => matcher.matches(query, text));
}

// How `row`'s binds in force meet the keys `?` captured, read under `leader`
// with each token in one spelling: `runs` when a bind is those keys, `starts`
// when a bind only starts with them, else null. Accelerators are not matched.
export function keyMatch(
  row: CommandRow,
  keys: string,
  leader: string,
): 'runs' | 'starts' | null {
  const tokensOf = (text: string) => vimTokens(text, leader).map(normalVimKeys);
  const wanted = tokensOf(keys);
  let best: 'starts' | null = null;
  for (const line of row.binds.filter(firesAnywhere)) {
    const tokens = tokensOf(line.bind.keys);
    const startsWithWanted = wanted.every((token, i) => tokens[i] === token);
    if (startsWithWanted && tokens.length === wanted.length) {
      return 'runs';
    }
    if (startsWithWanted && tokens.length > wanted.length) {
      best = 'starts';
    }
  }
  return best;
}

// Whether `query` fuzzily matches the Leader row's word or any leader key.
export function matchesLeader(
  keys: readonly string[],
  query: string,
  matcher: FuzzyMatcher,
): boolean {
  return ['leader', ...keys].some((text) => matcher.matches(query, text));
}
