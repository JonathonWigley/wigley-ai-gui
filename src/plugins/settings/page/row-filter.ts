import type { FuzzyMatcher } from '../../../contracts/fuzzy';
import type { CommandRow } from './keymap-rows';
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
    description.toLowerCase().includes(query.trim().toLowerCase())
  );
}

// Whether `query` fuzzily matches a command row's label, id, any line's keys
// or any accelerator.
export function matchesCommand(
  row: CommandRow,
  query: string,
  matcher: FuzzyMatcher,
): boolean {
  const accelerators = row.accelerators.map((line) =>
    line.kind === 'intercept' ? line.bind.key : line.bind.accelerator,
  );
  return [
    row.command.label,
    row.command.id,
    ...row.binds.map((line) => line.bind.keys),
    ...accelerators,
  ].some((text) => matcher.matches(query, text));
}

// Whether `query` fuzzily matches the Leader row's word or any leader key.
export function matchesLeader(
  keys: readonly string[],
  query: string,
  matcher: FuzzyMatcher,
): boolean {
  return ['leader', ...keys].some((text) => matcher.matches(query, text));
}
