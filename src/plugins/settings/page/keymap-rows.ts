import type { CommandId } from '../../../contracts/commands';
import type {
  AcceleratorBind,
  BindWhere,
  InterceptBind,
  KeyBind,
  KeymapUnbind,
  UserKeymap,
} from '../../../contracts/keymap';
import type { CommandInfo } from '../../../contracts/plugin';
import type { UserConfigSchema } from '../../../contracts/user-config';
import { withLeader } from '../../../shared/key-hints';
import {
  bindIdentities,
  isSameAccelerator,
} from '../../../shared/plugin-manifests';

export type BindState = 'active' | 'unbound' | 'replaced';
export interface BindLine {
  bind: KeyBind;
  origin: 'default' | 'user';
  state: BindState;
  // The command whose user bind replaced this default; null unless `state` is `replaced`.
  replacedBy: CommandId | null;
}
// `accelerators`: a main command's `app`, `global` and `intercept` binds, read-only in the rows (the advanced box
// edits them); the view prints them with `formatAccelerator` and `chordName`.
export interface CommandRow {
  command: CommandInfo;
  binds: BindLine[];
  accelerators: AcceleratorLine[];
}
export interface CommandGroup {
  plugin: string;
  title: string;
  rows: CommandRow[];
}
export type AcceleratorLine =
  | {
      kind: 'app' | 'global';
      bind: AcceleratorBind;
      state: 'active' | 'unbound';
    }
  | {
      kind: 'intercept';
      bind: InterceptBind;
      state: 'active' | 'unbound';
    };

// The leader `<Leader>` stands for under `layer`.
export function keymapLeader(
  schema: UserConfigSchema,
  layer: UserKeymap | null,
): string {
  return layer?.leader ?? schema.defaultLeader;
}

// Whether two key strings are one sequence once `<Leader>` is spelled as
// `leader` in both.
export function isSameKeys(a: string, b: string, leader: string): boolean {
  return withLeader(a, leader) === withLeader(b, leader);
}

// Where a bind or `keys` unbind entry fires: its `where`, else `both` when its
// keys, `<Leader>` spelled as `leader`, start with the leader, else `page`.
function whereOf(
  bind: { keys: string; where?: BindWhere },
  leader: string,
): BindWhere {
  const startsWithLeader = withLeader(bind.keys, leader).startsWith(leader);
  return bind.where ?? (startsWithLeader ? 'both' : 'page');
}

// Whether the bind or `keys` unbind entry `a` stands for the same bind as
// `b`, as the keymap merge tells them apart: keys with `<Leader>` spelled as
// `leader`, scope, mode (normal when absent) and where after its default.
// An accelerator unbind entry matches no bind.
export function sameBind(
  a: KeyBind | KeymapUnbind,
  b: KeyBind,
  leader: string,
): boolean {
  if (!('keys' in a)) {
    return false;
  }
  return (
    isSameKeys(a.keys, b.keys, leader) &&
    a.scope === b.scope &&
    (a.mode ?? 'normal') === (b.mode ?? 'normal') &&
    whereOf(a, leader) === whereOf(b, leader)
  );
}

// A default bind's line: unbound by a `keys` unbind entry, replaced by a user
// bind on its keys in its scope, else active.
function defaultLine(
  bind: KeyBind,
  layer: UserKeymap | null,
  leader: string,
): BindLine {
  const isUnbound = (layer?.unbind ?? []).some((entry) =>
    sameBind(entry, bind, leader),
  );
  const replacing = (layer?.binds ?? []).find(
    (user) =>
      user.scope === bind.scope && isSameKeys(user.keys, bind.keys, leader),
  );
  if (isUnbound) {
    return { bind, origin: 'default', state: 'unbound', replacedBy: null };
  }
  if (replacing) {
    return {
      bind,
      origin: 'default',
      state: 'replaced',
      replacedBy: replacing.command,
    };
  }
  return { bind, origin: 'default', state: 'active', replacedBy: null };
}

// `command`'s app, global and intercept binds: the defaults, each unbound
// when an unbind entry names it, then the user layer's own.
function acceleratorLines(
  schema: UserConfigSchema,
  layer: UserKeymap | null,
  command: CommandId,
  leader: string,
): AcceleratorLine[] {
  const unbind = layer?.unbind ?? [];
  const sameIntercept = bindIdentities(leader).intercept;
  const stateOf = (isUnbound: boolean) =>
    isUnbound ? ('unbound' as const) : ('active' as const);
  const defaults = schema.defaultAccelerators;
  const names = (bind: { command: CommandId }) => bind.command === command;
  return [
    ...defaults.app.filter(names).map((bind): AcceleratorLine => ({
      kind: 'app',
      bind,
      state: stateOf(
        unbind.some(
          (entry) =>
            'app' in entry && isSameAccelerator(entry.app, bind.accelerator),
        ),
      ),
    })),
    ...defaults.global.filter(names).map((bind): AcceleratorLine => ({
      kind: 'global',
      bind,
      state: stateOf(
        unbind.some(
          (entry) =>
            'global' in entry &&
            isSameAccelerator(entry.global, bind.accelerator),
        ),
      ),
    })),
    ...defaults.intercept.filter(names).map((bind): AcceleratorLine => ({
      kind: 'intercept',
      bind,
      state: stateOf(
        unbind.some(
          (entry) =>
            'intercept' in entry && sameIntercept(bind, entry.intercept),
        ),
      ),
    })),
    ...(layer?.app ?? [])
      .filter(names)
      .map((bind): AcceleratorLine => ({ kind: 'app', bind, state: 'active' })),
    ...(layer?.global ?? []).filter(names).map((bind): AcceleratorLine => ({
      kind: 'global',
      bind,
      state: 'active',
    })),
    ...(layer?.intercept ?? []).filter(names).map((bind): AcceleratorLine => ({
      kind: 'intercept',
      bind,
      state: 'active',
    })),
  ];
}

function groupTitle(plugin: string): string {
  return plugin === 'core'
    ? 'Core'
    : plugin.charAt(0).toUpperCase() + plugin.slice(1);
}

// Every command's row, grouped by plugin: `core` first, then each plugin in
// the order `schema.commands` first names it, rows in `schema.commands` order.
export function keymapRows(
  schema: UserConfigSchema,
  layer: UserKeymap | null,
): CommandGroup[] {
  const leader = keymapLeader(schema, layer);
  const groups = new Map<string, CommandGroup>([
    ['core', { plugin: 'core', title: groupTitle('core'), rows: [] }],
  ]);
  for (const command of Object.values(schema.commands)) {
    const defaultLines = schema.defaultBinds
      .filter((bind) => bind.command === command.id)
      .map((bind) => defaultLine(bind, layer, leader));
    const userLines = (layer?.binds ?? [])
      .filter((bind) => bind.command === command.id)
      .map((bind): BindLine => ({
        bind,
        origin: 'user',
        state: 'active',
        replacedBy: null,
      }));
    const row: CommandRow = {
      command,
      binds: [...defaultLines, ...userLines],
      accelerators: acceleratorLines(schema, layer, command.id, leader),
    };
    let group = groups.get(command.plugin);
    if (!group) {
      group = {
        plugin: command.plugin,
        title: groupTitle(command.plugin),
        rows: [],
      };
      groups.set(command.plugin, group);
    }
    group.rows.push(row);
  }
  return [...groups.values()].filter((group) => group.rows.length > 0);
}

// The command of the active line, default or user, on `keys` in `scope`;
// null when none.
export function replacedBy(
  schema: UserConfigSchema,
  layer: UserKeymap | null,
  keys: string,
  scope: string,
): CommandInfo | null {
  const leader = keymapLeader(schema, layer);
  for (const group of keymapRows(schema, layer)) {
    for (const row of group.rows) {
      const holdsKeys = row.binds.some(
        (line) =>
          line.state === 'active' &&
          line.bind.scope === scope &&
          isSameKeys(line.bind.keys, keys, leader),
      );
      if (holdsKeys) {
        return row.command;
      }
    }
  }
  return null;
}
