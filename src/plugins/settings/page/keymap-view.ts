import type { CommandArg, CommandId } from '../../../contracts/commands';
import type { ViewScope } from '../../../contracts/keymap';
import type { CommandInfo } from '../../../contracts/plugin';
import { commandTarget } from '../../../shared/command-args';
import { capitalised } from '../../../shared/capitalised';
import { element } from '../../../shared/page/dom';
import { commandLabel } from '../../../shared/plugin-manifests';
import { kbd } from '../../../shared/page/ui/kbd';
import {
  chordName,
  formatAccelerator,
  formatVimKeys,
} from '../../../shared/key-hints';
import {
  advancedText,
  withAddedBind,
  withAdvanced,
  withCommandReset,
  withLeader,
  withRemovedBind,
} from './keymap-edits';
import {
  type AcceleratorLine,
  andList,
  type BindLine,
  type CommandRow,
  coverTexts,
  firesAnywhere,
  keymapLeader,
  keymapRows,
  replacedBy,
} from './keymap-rows';
import { matchesCommand, matchesLeader } from './row-filter';
import type { KeyLineInput, KeyRowInput } from '../layouts/layout';
import type {
  RowActions,
  RowContext,
  SectionDrawing,
  SectionEntry,
  SettingsRow,
} from './settings-view';

const ACCELERATOR_TAGS: Record<AcceleratorLine['kind'], string> = {
  app: 'App menu',
  global: 'Global',
  intercept: 'Intercept',
};

const ACCELERATORS_TEXT = 'Accelerators are edited in the advanced box';

// A scope as its Tag names it: `any` as Everywhere, else by its title.
function scopeTitle(ctx: RowContext, scope: ViewScope): string {
  if (scope === 'any') {
    return 'Everywhere';
  }
  return ctx.schema.scopes.find((info) => info.id === scope)?.title ?? scope;
}

function leader(ctx: RowContext): string {
  return keymapLeader(ctx.schema, ctx.keymapLayer());
}

// `keys` in vim notation as Kbd, each token printed for the platform.
function keysKbd(ctx: RowContext, keys: string): HTMLElement {
  return kbd(formatVimKeys(keys, leader(ctx), ctx.platform), ctx.platform);
}

// A bind's line: its keys printed for the platform, then its scope, `where`,
// `mode`, `Set` for a user bind, then what covers it; struck while it fires
// nowhere.
function bindLine(ctx: RowContext, line: BindLine): KeyLineInput {
  const { bind } = line;
  const tags = [scopeTitle(ctx, bind.scope)];
  if (bind.where !== undefined) {
    tags.push(bind.where);
  }
  if (bind.mode !== undefined) {
    tags.push(bind.mode);
  }
  if (line.origin === 'user') {
    tags.push('Set');
  }
  const label = (command: CommandId) =>
    commandLabel(ctx.schema.commands, command);
  tags.push(...coverTexts(line, label));
  return {
    kind: 'bind',
    keys: formatVimKeys(bind.keys, leader(ctx), ctx.platform),
    tags,
    isStruck: !firesAnywhere(line),
  };
}

// An accelerator's line: its chord printed for the platform, then its kind
// and, unless active, `Removed` or `Replaced by <label>`; struck unless
// active.
function acceleratorLine(ctx: RowContext, line: AcceleratorLine): KeyLineInput {
  const keys =
    line.kind === 'intercept'
      ? chordName(line.bind, ctx.platform)
      : formatAccelerator(line.bind.accelerator, ctx.platform);
  const tags = [ACCELERATOR_TAGS[line.kind]];
  if (line.state === 'removed') {
    tags.push('Removed');
  }
  if (line.state === 'replaced' && line.replacedBy !== null) {
    tags.push(
      `Replaced by ${commandLabel(ctx.schema.commands, line.replacedBy)}`,
    );
  }
  return { kind: 'accelerator', keys, tags, isStruck: line.state !== 'active' };
}

// The typed keys as Kbd, and the other commands a bind of `command` on them in
// `scope` replaces.
function keysPreview(
  ctx: RowContext,
  text: string,
  scope: ViewScope,
  command: CommandId,
  arg: CommandArg | undefined,
): HTMLElement | null {
  const keys = text.trim();
  if (keys === '') {
    return null;
  }
  const node = element('span', 'settings-bind');
  node.append(keysKbd(ctx, keys));
  const replaced = replacedBy(
    ctx.schema,
    ctx.keymapLayer(),
    keys,
    scope,
    command,
    arg,
  );
  if (replaced.length > 0) {
    node.append(
      element(
        'span',
        'settings-replaces',
        `Replaces ${replacedLabels(replaced)}`,
      ),
    );
  }
  return node;
}

function replacedLabels(commands: readonly CommandInfo[]): string {
  return andList(commands.map((command) => command.label));
}

// Adds a bind to `row`'s command and argument: a box takes the keys, then the scope
// picker, preselecting the scope of the row's first default bind; Enter on an
// empty box closes it.
function addBind(ctx: RowContext, row: CommandRow) {
  const command = row.command.id;
  const { arg } = row;
  const firstDefault = row.binds.find((line) => line.origin === 'default');
  const preselected: ViewScope = firstDefault?.bind.scope ?? 'any';
  ctx.openBox({
    key: commandTarget(command, arg),
    file: 'keymap',
    text: '',
    editor: {
      type: 'line',
      preview: (text) => keysPreview(ctx, text, preselected, command, arg),
    },
    accept(box) {
      const keys = box.text().trim();
      if (keys === '') {
        ctx.closeBox(box);
        return;
      }
      const scopes: ViewScope[] = [
        'any',
        ...ctx.schema.scopes.map((info) => info.id),
      ];
      ctx.openPicker({
        file: 'keymap',
        title: 'Scope',
        items: scopes,
        label(scope) {
          const replaced = replacedBy(
            ctx.schema,
            ctx.keymapLayer(),
            keys,
            scope,
            command,
            arg,
          );
          const title = scopeTitle(ctx, scope);
          return replaced.length === 0
            ? title
            : `${title} — replaces ${replacedLabels(replaced)}`;
        },
        selected: scopes.indexOf(preselected),
        chosen: (scope) =>
          ctx.commitKeymap(
            withAddedBind(
              ctx.keymapLayer(),
              { keys, scope, command, ...(arg !== undefined && { arg }) },
              ctx.schema,
            ),
            { box },
          ),
        cancelled: () => box.focus(),
      });
    },
  });
}

function removeBind(ctx: RowContext, row: CommandRow) {
  const active = row.binds.filter(firesAnywhere);
  if (active.length === 0) {
    return;
  }
  if (active.length === 1) {
    ctx.commitKeymap(
      withRemovedBind(ctx.keymapLayer(), active[0], ctx.schema),
      null,
    );
    return;
  }
  ctx.openPicker({
    file: 'keymap',
    title: 'Key to remove',
    items: active,
    label: (line) => {
      const keys = formatVimKeys(line.bind.keys, leader(ctx), ctx.platform);
      return `${keys} — ${scopeTitle(ctx, line.bind.scope)}`;
    },
    chosen: (line, expectedText) =>
      ctx.commitKeymap(withRemovedBind(ctx.keymapLayer(), line, ctx.schema), {
        expectedText,
      }),
  });
}

// A main command's binds are its accelerators, edited only in the advanced
// box; a page command's row adds, removes and resets binds, and Enter or `i`
// adds one.
function commandActions(ctx: RowContext, row: CommandRow): RowActions {
  const { command } = row;
  if (command.runsIn === 'main') {
    const tellAdvanced = () => ctx.toast(ACCELERATORS_TEXT, 'info');
    return {
      open: tellAdvanced,
      edit: tellAdvanced,
      addBind: tellAdvanced,
      removeBind: tellAdvanced,
      reset: tellAdvanced,
    };
  }
  const add = () => addBind(ctx, row);
  return {
    open: add,
    edit: add,
    addBind: add,
    removeBind: () => removeBind(ctx, row),
    reset: () =>
      ctx.commitKeymap(
        withCommandReset(ctx.keymapLayer(), command.id, ctx.schema, row.arg),
        null,
      ),
  };
}

// A command row's input: its row label capitalised, its binds then its
// accelerators.
export function keyRowInput(ctx: RowContext, row: CommandRow): KeyRowInput {
  const { command } = row;
  return {
    command: command.id,
    label: capitalised(row.label),
    runsIn: command.runsIn,
    lines: [
      ...row.binds.map((line) => bindLine(ctx, line)),
      ...row.accelerators.map((line) => acceleratorLine(ctx, line)),
    ],
  };
}

function commandRow(ctx: RowContext, row: CommandRow): SettingsRow {
  return {
    key: commandTarget(row.command.id, row.arg),
    file: 'keymap',
    draw: { part: 'keyRow', input: keyRowInput(ctx, row) },
    actions: commandActions(ctx, row),
  };
}

// The leader row: a one-line box, where empty text or the default leader
// leaves the leader unset.
function leaderRow(ctx: RowContext): SettingsRow {
  const { defaultLeader } = ctx.schema;
  const userLeader = ctx.keymapLayer()?.leader;
  const printed = (keys: string) => formatVimKeys(keys, keys, ctx.platform);
  const edit = () =>
    ctx.openBox({
      key: 'leader',
      file: 'keymap',
      text: userLeader ?? defaultLeader,
      editor: { type: 'line' },
      accept(box) {
        const text = box.text().trim();
        const isDefault = text === '' || text === defaultLeader;
        ctx.commitKeymap(
          withLeader(ctx.keymapLayer(), isDefault ? null : text),
          { box },
        );
      },
    });
  return {
    key: 'leader',
    file: 'keymap',
    draw: {
      part: 'leaderRow',
      input: {
        keys: printed(userLeader ?? defaultLeader),
        defaultKeys: printed(defaultLeader),
        isSet: userLeader !== undefined,
      },
    },
    actions: {
      open: edit,
      edit,
      reset: () => ctx.commitKeymap(withLeader(ctx.keymapLayer(), null), null),
    },
  };
}

// The advanced row: a document box over the keymap's groups, remaps,
// accelerators and accelerator unbind entries.
function advancedRow(ctx: RowContext): SettingsRow {
  const text = advancedText(ctx.keymapLayer());
  const edit = () =>
    ctx.openBox({
      key: 'advanced',
      file: 'keymap',
      text: advancedText(ctx.keymapLayer()),
      editor: { type: 'document', fileName: 'advanced.json' },
      accept(box) {
        const edited = withAdvanced(ctx.keymapLayer(), box.text());
        if (edited.type === 'problem') {
          ctx.boxProblem(box, edited.problem);
          return;
        }
        ctx.commitKeymap(edited.layer, { box });
      },
    });
  return {
    key: 'advanced',
    file: 'keymap',
    draw: { part: 'advancedRow', input: { isSet: text !== '{}' } },
    actions: { open: edit, edit },
  };
}

// The Keymap section's rows that match `query`: the leader, each plugin's
// commands under its header, and, with no filter, the advanced row.
export function keymapSection(ctx: RowContext, query: string): SectionDrawing {
  const entries: SectionEntry[] = [];
  const rows: SettingsRow[] = [];
  const addRow = (row: SettingsRow) => {
    entries.push({ type: 'row', row });
    rows.push(row);
  };
  if (matchesLeader([leader(ctx)], query, ctx.matcher)) {
    addRow(leaderRow(ctx));
  }
  for (const group of keymapRows(ctx.schema, ctx.keymapLayer())) {
    const shown = group.rows
      .filter((row) => matchesCommand(row, query, ctx.matcher))
      .map((row) => commandRow(ctx, row));
    if (shown.length > 0) {
      entries.push({ type: 'header', input: { title: group.title } });
      shown.forEach(addRow);
    }
  }
  if (query.trim() === '') {
    addRow(advancedRow(ctx));
  }
  return { entries, rows };
}
