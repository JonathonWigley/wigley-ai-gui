import type { CommandId } from '../../../contracts/commands';
import type { ViewScope } from '../../../contracts/keymap';
import { element } from '../../../shared/page/dom';
import { kbd } from '../../../shared/page/ui/kbd';
import { sectionHeader } from '../../../shared/page/ui/section-header';
import { tag } from '../../../shared/page/ui/tag';
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
  type BindLine,
  type CommandRow,
  keymapLeader,
  keymapRows,
  replacedBy,
} from './keymap-rows';
import { matchesCommand } from './row-filter';
import { settingsRowElement, valueElement } from './setting-rows-view';
import type {
  RowActions,
  RowContext,
  SectionDrawing,
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

function commandLabel(ctx: RowContext, command: CommandId): string {
  return ctx.schema.commands[command]?.label ?? command;
}

function leader(ctx: RowContext): string {
  return keymapLeader(ctx.schema, ctx.keymapLayer());
}

// `keys` in vim notation as Kbd, each token printed for the platform.
function keysKbd(ctx: RowContext, keys: string): HTMLElement {
  return kbd(formatVimKeys(keys, leader(ctx), ctx.platform), ctx.platform);
}

function lineElement(
  keys: HTMLElement,
  tags: HTMLElement[],
  isStruck: boolean,
): HTMLElement {
  const node = element('span', 'settings-bind');
  node.classList.toggle('is-struck', isStruck);
  node.append(keys, ...tags);
  return node;
}

function bindLineElement(ctx: RowContext, line: BindLine): HTMLElement {
  const { bind } = line;
  const tags = [tag(scopeTitle(ctx, bind.scope))];
  if (bind.where !== undefined) {
    tags.push(tag(bind.where));
  }
  if (bind.mode !== undefined) {
    tags.push(tag(bind.mode));
  }
  if (line.origin === 'user') {
    tags.push(tag('Set'));
  }
  if (line.state === 'unbound') {
    tags.push(tag('Removed'));
  }
  if (line.state === 'replaced' && line.replacedBy !== null) {
    tags.push(tag(`Replaced by ${commandLabel(ctx, line.replacedBy)}`));
  }
  return lineElement(keysKbd(ctx, bind.keys), tags, line.state !== 'active');
}

function acceleratorLineElement(
  ctx: RowContext,
  line: AcceleratorLine,
): HTMLElement {
  const text =
    line.kind === 'intercept'
      ? chordName(line.bind, ctx.platform)
      : formatAccelerator(line.bind.accelerator, ctx.platform);
  const tags = [tag(ACCELERATOR_TAGS[line.kind])];
  if (line.state === 'unbound') {
    tags.push(tag('Removed'));
  }
  return lineElement(kbd(text, ctx.platform), tags, line.state === 'unbound');
}

// The typed keys as Kbd, and the command a bind on them in `scope` replaces.
function keysPreview(
  ctx: RowContext,
  text: string,
  scope: ViewScope,
): HTMLElement | null {
  const keys = text.trim();
  if (keys === '') {
    return null;
  }
  const node = element('span', 'settings-bind');
  node.append(keysKbd(ctx, keys));
  const replaced = replacedBy(ctx.schema, ctx.keymapLayer(), keys, scope);
  if (replaced !== null) {
    node.append(
      element('span', 'settings-replaces', `Replaces ${replaced.label}`),
    );
  }
  return node;
}

// Adds a bind: a box takes the keys, then the scope picker; Enter on an empty
// box closes it.
function addBind(ctx: RowContext, command: CommandId) {
  const firstDefault = ctx.schema.defaultBinds.find(
    (bind) => bind.command === command,
  );
  const preselected: ViewScope = firstDefault?.scope ?? 'any';
  ctx.openBox({
    key: command,
    file: 'keymap',
    text: '',
    editor: {
      type: 'line',
      preview: (text) => keysPreview(ctx, text, preselected),
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
          );
          const title = scopeTitle(ctx, scope);
          return replaced === null
            ? title
            : `${title} — replaces ${replaced.label}`;
        },
        selected: scopes.indexOf(preselected),
        chosen: (scope) =>
          ctx.commitKeymap(
            withAddedBind(ctx.keymapLayer(), { keys, scope, command }),
            { box },
          ),
        cancelled: () => box.focus(),
      });
    },
  });
}

function removeBind(ctx: RowContext, row: CommandRow) {
  const active = row.binds.filter((line) => line.state === 'active');
  if (active.length === 0) {
    return;
  }
  if (active.length === 1) {
    ctx.commitKeymap(withRemovedBind(ctx.keymapLayer(), active[0]), null);
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
      ctx.commitKeymap(withRemovedBind(ctx.keymapLayer(), line), {
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
  const add = () => addBind(ctx, command.id);
  return {
    open: add,
    edit: add,
    addBind: add,
    removeBind: () => removeBind(ctx, row),
    reset: () =>
      ctx.commitKeymap(
        withCommandReset(ctx.keymapLayer(), command.id, ctx.schema),
        null,
      ),
  };
}

function commandRow(ctx: RowContext, row: CommandRow): SettingsRow {
  const lines = [
    ...row.binds.map((line) => bindLineElement(ctx, line)),
    ...row.accelerators.map((line) => acceleratorLineElement(ctx, line)),
  ];
  const end =
    lines.length === 0
      ? valueElement('Not bound', true)
      : element('span', 'settings-binds');
  end.append(...lines);
  return {
    key: row.command.id,
    file: 'keymap',
    element: settingsRowElement({
      label: row.command.label,
      description: '',
      end,
      isSet: false,
      defaultText: null,
    }),
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
    element: settingsRowElement({
      label: 'Leader',
      description: 'The key every <Leader> bind starts with',
      end: kbd(printed(userLeader ?? defaultLeader), ctx.platform),
      isSet: userLeader !== undefined,
      defaultText: printed(defaultLeader),
    }),
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
    element: settingsRowElement({
      label: 'Advanced',
      description: 'Groups, remaps and accelerators',
      end: element('span'),
      isSet: text !== '{}',
      defaultText: null,
    }),
    actions: { open: edit, edit },
  };
}

// The Keymap section's rows that match `query`: the leader, each plugin's
// commands under its header, and, with no filter, the advanced row.
export function keymapSection(ctx: RowContext, query: string): SectionDrawing {
  const items: HTMLElement[] = [];
  const rows: SettingsRow[] = [];
  const needle = query.toLowerCase();
  const isLeaderShown = ['leader', leader(ctx).toLowerCase()].some((text) =>
    text.includes(needle),
  );
  if (isLeaderShown) {
    const row = leaderRow(ctx);
    items.push(row.element);
    rows.push(row);
  }
  for (const group of keymapRows(ctx.schema, ctx.keymapLayer())) {
    const shown = group.rows
      .filter((row) => matchesCommand(row, query))
      .map((row) => commandRow(ctx, row));
    if (shown.length > 0) {
      const header = sectionHeader(group.title);
      header.classList.add('settings-group-header');
      items.push(header, ...shown.map((row) => row.element));
      rows.push(...shown);
    }
  }
  if (query === '') {
    const row = advancedRow(ctx);
    items.push(row.element);
    rows.push(row);
  }
  return { items, rows };
}
