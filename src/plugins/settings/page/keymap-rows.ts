import type { CommandArg, CommandId } from '../../../contracts/commands';
import type {
  AcceleratorBind,
  InterceptBind,
  KeyBind,
  UserKeymap,
} from '../../../contracts/keymap';
import type { CommandInfo } from '../../../contracts/plugin';
import type { UserConfigSchema } from '../../../contracts/user-config';
import { capitalised } from '../../../shared/capitalised';
import { commandArgLabel, commandTarget } from '../../../shared/command-args';
import { isSameJson } from '../../../shared/json';
import {
  bindIdentities,
  defaultBindLines,
  expandBind,
  type HalfStanding,
  isSameAccelerator,
  sharedHalves,
} from '../../../shared/plugin-manifests';

// A bind's page and editor halves, each null when the bind does not fire
// there; a user bind's halves are active.
export interface BindLine {
  bind: KeyBind;
  origin: 'default' | 'user';
  page: HalfStanding | null;
  editor: HalfStanding | null;
}
// `accelerators`: a main command's `app`, `global` and `intercept` binds, read-only in the rows (the advanced box
// edits them); the view prints them with `formatAccelerator` and `chordName`.
// `arg`: the argument this row's lines bind, for a command that declares one.
// `label`: the command's label, then `: ` and `commandArgLabel(arg)` on an arg row.
export interface CommandRow {
  command: CommandInfo;
  label: string;
  arg?: CommandArg;
  binds: BindLine[];
  accelerators: AcceleratorLine[];
}
export interface CommandGroup {
  plugin: string;
  title: string;
  rows: CommandRow[];
}
// `replacedBy`: the command of the user accelerator of the same kind on this
// default's keys; null unless `state` is `replaced`.
export type AcceleratorState = 'active' | 'removed' | 'replaced';
export type AcceleratorLine =
  | {
      kind: 'app' | 'global';
      bind: AcceleratorBind;
      state: AcceleratorState;
      replacedBy: CommandId | null;
    }
  | {
      kind: 'intercept';
      bind: InterceptBind;
      state: AcceleratorState;
      replacedBy: CommandId | null;
    };

// The leader `<Leader>` stands for under `layer`.
export function keymapLeader(
  schema: UserConfigSchema,
  layer: UserKeymap | null,
): string {
  return layer?.leader ?? schema.defaultLeader;
}

// Whether any half of `line`'s bind still fires.
export function firesAnywhere(line: BindLine): boolean {
  return line.page?.state === 'active' || line.editor?.state === 'active';
}

// The Keybindings section's filter chips, in the order `f` cycles them.
export type KeyFilter = 'all' | 'bound' | 'unbound' | 'changed';

export const KEY_FILTERS: readonly KeyFilter[] = [
  'all',
  'bound',
  'unbound',
  'changed',
];

function isBound(row: CommandRow): boolean {
  return (
    row.binds.some(firesAnywhere) ||
    row.accelerators.some((line) => line.state === 'active')
  );
}

// Whether the user layer names one of `row`'s lines: a user bind, a removed
// default half or a removed accelerator. A default only another command's
// user bind replaced is not.
function isChanged(row: CommandRow): boolean {
  const isRemoved = (line: BindLine) =>
    line.page?.state === 'removed' || line.editor?.state === 'removed';
  return (
    row.binds.some((line) => line.origin === 'user' || isRemoved(line)) ||
    row.accelerators.some((line) => line.state === 'removed')
  );
}

// Whether the chip `filter` shows `row`: `bound` a row with a bind or
// accelerator in force, `unbound` the rest, `changed` a row the user layer
// changed.
export function matchesKeyFilter(row: CommandRow, filter: KeyFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'bound':
      return isBound(row);
    case 'unbound':
      return !isBound(row);
    case 'changed':
      return isChanged(row);
  }
}

const HALF_PLACES = { page: 'on the page', editor: 'in the editor' } as const;

// What covers one half, in lower case; null for a half still firing.
function coverText(
  standing: HalfStanding,
  label: (command: CommandId) => string,
): string | null {
  if (standing.state === 'removed') {
    return 'removed';
  }
  if (standing.state === 'replaced') {
    return `replaced by ${label(standing.by.command)}`;
  }
  return null;
}

// The tag texts naming what covers `line`'s halves, each once, page half
// first: with no half firing, "Removed" and "Replaced by <label>"; with a half
// still firing, "Partly removed" or "Partly replaced by <label>", each with
// where it still fires. `label` names a command.
export function coverTexts(
  line: BindLine,
  label: (command: CommandId) => string,
): string[] {
  const halves = (['page', 'editor'] as const).flatMap((half) => {
    const standing = line[half];
    return standing === null ? [] : [{ half, standing }];
  });
  const firing = halves.find(({ standing }) => standing.state === 'active');
  const texts: string[] = [];
  for (const { standing } of halves) {
    const text = coverText(standing, label);
    if (text === null) {
      continue;
    }
    texts.push(
      firing === undefined
        ? capitalised(text)
        : `Partly ${text} — still fires ${HALF_PLACES[firing.half]}`,
    );
  }
  return [...new Set(texts)];
}

// `labels` joined as prose: "A", "A and B", "A, B and C".
export function andList(labels: readonly string[]): string {
  if (labels.length < 2) {
    return labels.join('');
  }
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

// Whether the merge can expand `bind` under `leader`; keys the user is still
// typing may not be.
export function isExpandable(bind: KeyBind, leader: string): boolean {
  try {
    expandBind(bind, leader);
    return true;
  } catch {
    return false;
  }
}

function userLine(bind: KeyBind, leader: string): BindLine {
  const halves = expandBind(bind, leader);
  const active = { state: 'active' } as const;
  return {
    bind,
    origin: 'user',
    page: halves.page === null ? null : active,
    editor: halves.editor === null ? null : active,
  };
}

// A default accelerator's state: removed when an unbind entry names it, else
// replaced by the first user accelerator of its kind on its keys, else active.
function acceleratorStanding<B extends { command: CommandId }>(
  bind: B,
  isRemoved: boolean,
  userBinds: readonly B[],
  same: (a: B, b: B) => boolean,
): { state: AcceleratorState; replacedBy: CommandId | null } {
  if (isRemoved) {
    return { state: 'removed', replacedBy: null };
  }
  const replacer = userBinds.find((user) => same(user, bind));
  if (replacer !== undefined) {
    return { state: 'replaced', replacedBy: replacer.command };
  }
  return { state: 'active', replacedBy: null };
}

// `command`'s app, global and intercept binds: the defaults, each removed or
// replaced as the merge decides, then the user layer's own.
function acceleratorLines(
  schema: UserConfigSchema,
  layer: UserKeymap | null,
  command: CommandId,
  leader: string,
): AcceleratorLine[] {
  const unbind = layer?.unbind ?? [];
  const same = bindIdentities(leader);
  const defaults = schema.defaultAccelerators;
  const names = (bind: { command: CommandId }) => bind.command === command;
  const active = { state: 'active', replacedBy: null } as const;
  return [
    ...defaults.app.filter(names).map((bind): AcceleratorLine => ({
      kind: 'app',
      bind,
      ...acceleratorStanding(
        bind,
        unbind.some(
          (entry) =>
            'app' in entry && isSameAccelerator(entry.app, bind.accelerator),
        ),
        layer?.app ?? [],
        same.accelerators,
      ),
    })),
    ...defaults.global.filter(names).map((bind): AcceleratorLine => ({
      kind: 'global',
      bind,
      ...acceleratorStanding(
        bind,
        unbind.some(
          (entry) =>
            'global' in entry &&
            isSameAccelerator(entry.global, bind.accelerator),
        ),
        layer?.global ?? [],
        same.accelerators,
      ),
    })),
    ...defaults.intercept.filter(names).map((bind): AcceleratorLine => ({
      kind: 'intercept',
      bind,
      ...acceleratorStanding(
        bind,
        unbind.some(
          (entry) =>
            'intercept' in entry && same.intercept(bind, entry.intercept),
        ),
        layer?.intercept ?? [],
        same.intercept,
      ),
    })),
    ...(layer?.app ?? [])
      .filter(names)
      .map((bind): AcceleratorLine => ({ kind: 'app', bind, ...active })),
    ...(layer?.global ?? [])
      .filter(names)
      .map((bind): AcceleratorLine => ({ kind: 'global', bind, ...active })),
    ...(layer?.intercept ?? [])
      .filter(names)
      .map((bind): AcceleratorLine => ({ kind: 'intercept', bind, ...active })),
  ];
}

function groupTitle(plugin: string): string {
  return capitalised(plugin);
}

// The rows of `whole`, every line of one command: `whole` itself for a command
// that declares no argument, else one row per distinct bound argument, in the
// order its lines first name each, and no row when no key binds it. A default
// line binds its argument whatever its state, so a default the user unbound
// keeps its row.
function rowsPerArg(whole: CommandRow): CommandRow[] {
  if (whole.command.arg === undefined) {
    return [whole];
  }
  const args: CommandArg[] = [];
  for (const { bind } of [...whole.binds, ...whole.accelerators]) {
    if (
      bind.arg !== undefined &&
      !args.some((seen) => isSameJson(seen, bind.arg))
    ) {
      args.push(bind.arg);
    }
  }
  return args.map((arg) => ({
    ...whole,
    label: `${whole.command.label}: ${commandArgLabel(arg)}`,
    arg,
    binds: whole.binds.filter(({ bind }) => isSameJson(bind.arg, arg)),
    accelerators: whole.accelerators.filter(({ bind }) =>
      isSameJson(bind.arg, arg),
    ),
  }));
}

// Every command's rows, grouped by plugin: `core` first, then each plugin in
// the order `schema.commands` first names it, rows in `schema.commands` order.
// A row's default binds are those the merge of the default layers keeps.
export function keymapRows(
  schema: UserConfigSchema,
  layer: UserKeymap | null,
): CommandGroup[] {
  const leader = keymapLeader(schema, layer);
  const defaults = defaultBindLines(
    schema.defaultBindLayers,
    layer ?? {},
    leader,
  );
  const groups = new Map<string, CommandGroup>([
    ['core', { plugin: 'core', title: groupTitle('core'), rows: [] }],
  ]);
  for (const command of Object.values(schema.commands)) {
    const defaultLines = defaults
      .filter((line) => line.bind.command === command.id)
      .map((line): BindLine => ({ ...line, origin: 'default' }));
    const userLines = (layer?.binds ?? [])
      .filter((bind) => bind.command === command.id)
      .map((bind) => userLine(bind, leader));
    const rows = rowsPerArg({
      command,
      label: command.label,
      binds: [...defaultLines, ...userLines],
      accelerators: acceleratorLines(schema, layer, command.id, leader),
    });
    let group = groups.get(command.plugin);
    if (!group) {
      group = {
        plugin: command.plugin,
        title: groupTitle(command.plugin),
        rows: [],
      };
      groups.set(command.plugin, group);
    }
    group.rows.push(...rows);
  }
  return [...groups.values()].filter((group) => group.rows.length > 0);
}

// Every other row writing `bind` would displace, in row order: each whose
// default bind fires on a half `bind` shares, and each whose user bind
// `withAddedBind` drops; judged half by half as the merge does. A command's
// arg rows count apart, each naming its own argument in its label. The row of
// `bind`'s command and argument itself is left out, since a bind on keys it
// already holds displaces nothing. Empty when none, or when the merge cannot
// expand `bind`.
export function replacedBy(
  schema: UserConfigSchema,
  layer: UserKeymap | null,
  bind: KeyBind,
): CommandRow[] {
  const leader = keymapLeader(schema, layer);
  if (!isExpandable(bind, leader)) {
    return [];
  }
  const target = commandTarget(bind.command, bind.arg);
  const rows = keymapRows(schema, layer).flatMap((group) => group.rows);
  return rows
    .filter((row) => commandTarget(row.command.id, row.arg) !== target)
    .filter((row) =>
      row.binds.some((line) => {
        const shared = sharedHalves(bind, line.bind, leader);
        const takesPage = shared.page && line.page?.state === 'active';
        const takesEditor = shared.editor && line.editor?.state === 'active';
        return takesPage || takesEditor;
      }),
    );
}
