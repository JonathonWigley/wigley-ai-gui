import type { CommandRow } from './keymap-rows';
import type { SettingRow } from './setting-rows';

// Whether any of `texts` holds `query`, ignoring case; an empty query matches.
function anyHolds(texts: readonly string[], query: string): boolean {
  const lowered = query.toLowerCase();
  return texts.some((text) => text.toLowerCase().includes(lowered));
}

// Whether a setting row's label, path or description holds `query`.
export function matchesSetting(row: SettingRow, query: string): boolean {
  const { label, path, description } = row.leaf;
  return anyHolds([label, path, description], query);
}

// Whether a command row's label, id, any line's keys or any accelerator holds
// `query`.
export function matchesCommand(row: CommandRow, query: string): boolean {
  const accelerators = row.accelerators.map((line) =>
    line.kind === 'intercept' ? line.bind.key : line.bind.accelerator,
  );
  return anyHolds(
    [
      row.command.label,
      row.command.id,
      ...row.binds.map((line) => line.bind.keys),
      ...accelerators,
    ],
    query,
  );
}
