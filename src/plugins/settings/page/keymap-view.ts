import type { CommandId } from '../../../contracts/commands';
import type { KeyBind, ViewScope } from '../../../contracts/keymap';
import { commandTarget } from '../../../shared/command-args';
import { capitalised } from '../../../shared/capitalised';
import { element } from '../../../shared/page/dom';
import { commandLabel } from '../../../shared/plugin-manifests';
import { kbd } from '../../../shared/page/ui/kbd';
import {
  chordName,
  formatAccelerator,
  formatVimKeys,
  normalVimKeys,
} from '../../../shared/key-hints';
import type { Judgement, RecordRequest } from './key-recorder';
import {
  advancedText,
  withAddedBind,
  withAdvanced,
  withCommandReset,
  withLeader,
  withMovedBind,
  withRemovedBind,
} from './keymap-edits';
import {
  type AcceleratorLine,
  andList,
  type BindLine,
  type CommandRow,
  coverTexts,
  firesAnywhere,
  isExpandable,
  KEY_FILTERS,
  type KeyFilter,
  keymapLeader,
  keymapRows,
  matchesKeyFilter,
  replacedBy,
} from './keymap-rows';
import { keyMatch, matchesCommand, matchesLeader } from './row-filter';
import type {
  KeyFiltersInput,
  KeyLineInput,
  KeyRowInput,
  RecordingInput,
} from '../layouts/layout';
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

const RECORD_PROMPT = 'Press a key or chord — Tab types it, Esc cancels';

// The key of `?`'s recording, which names no row: every command id holds a
// dot.
export const FIND_KEY = 'find';

const CHIP_LABELS: Record<KeyFilter, string> = {
  all: 'All',
  bound: 'Bound',
  unbound: 'Unbound',
  changed: 'Changed',
};

// The Keybindings section's view state: the chip in force, and the keys `?`
// captured (vim notation), null with no find query.
export interface KeysViewState {
  filter: KeyFilter;
  findKeys: string | null;
}

// A scope as the rows name it: `any` as Everywhere, else by its title.
export function scopeTitle(ctx: RowContext, scope: ViewScope): string {
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
  return kbd(printedKeys(ctx, keys), ctx.platform);
}

function printedKeys(ctx: RowContext, keys: string): string {
  return formatVimKeys(keys, leader(ctx), ctx.platform);
}

// A bind's line: its keys printed for the platform, then its scope unless
// `any`, `where`, `mode`, `Set` for a user bind, then what covers it; struck
// while it fires nowhere.
function bindLine(ctx: RowContext, line: BindLine): KeyLineInput {
  const { bind } = line;
  const tags = bind.scope === 'any' ? [] : [scopeTitle(ctx, bind.scope)];
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
    keys: printedKeys(ctx, bind.keys),
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

// The typed keys as Kbd, and the other rows the bind `bindOn` writes on them
// replaces, each by its row label.
function keysPreview(
  ctx: RowContext,
  text: string,
  bindOn: (keys: string) => KeyBind,
): HTMLElement | null {
  const keys = text.trim();
  if (keys === '') {
    return null;
  }
  const node = element('span', 'settings-bind');
  node.append(keysKbd(ctx, keys));
  const replaced = replacedBy(ctx.schema, ctx.keymapLayer(), bindOn(keys));
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

function replacedLabels(rows: readonly CommandRow[]): string {
  return andList(rows.map((row) => row.label));
}

// What a scope picker opens on: `bindIn` the bind it writes in a scope, the
// scope it preselects, and what it does with the scope chosen; `expectedText`
// is the keymap's text when the picker opened.
export interface ScopePickRequest {
  bindIn(scope: ViewScope): KeyBind;
  preselected: ViewScope;
  chosen(scope: ViewScope, expectedText: string | null): void;
  cancelled?(): void;
}

// The list picker `Scope` over `any` and every scope, each line naming the
// rows `request.bindIn` there would replace.
export function openScopePicker(
  ctx: RowContext,
  request: ScopePickRequest,
): void {
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
        request.bindIn(scope),
      );
      const title = scopeTitle(ctx, scope);
      return replaced.length === 0
        ? title
        : `${title} — replaces ${replacedLabels(replaced)}`;
    },
    selected: scopes.indexOf(request.preselected),
    chosen: request.chosen,
    cancelled: request.cancelled,
  });
}

// The leader in force refused as a recorded key, else null.
function leaderRefusal(ctx: RowContext, keys: string): Judgement | null {
  const held = leader(ctx);
  if (normalVimKeys(keys) !== normalVimKeys(held)) {
    return null;
  }
  const printed = formatVimKeys(held, held, ctx.platform);
  return {
    type: 'refused',
    note: `${printed} is the leader — Tab types a leader sequence`,
    reason: 'leader',
  };
}

// A reassign's judgement of `keys` for `line`, judging the bind it writes:
// the leader refused, a chord the line's `where` cannot take refused, keys
// other rows hold on the halves it fires on moving here, else free.
function reassignJudgement(
  ctx: RowContext,
  line: BindLine,
  keys: string,
): Judgement {
  const refusal = leaderRefusal(ctx, keys);
  if (refusal !== null) {
    return refusal;
  }
  const written: KeyBind = { ...line.bind, keys };
  if (!isExpandable(written, leader(ctx))) {
    return {
      type: 'refused',
      note: `${printedKeys(ctx, keys)} is a chord, which fires in a box too: a "${line.bind.where}" bind takes none`,
      reason: 'chord',
    };
  }
  const { scope } = line.bind;
  const replaced = replacedBy(ctx.schema, ctx.keymapLayer(), written);
  if (replaced.length === 0) {
    return { type: 'free' };
  }
  const where = scope === 'any' ? 'everywhere' : `in ${scopeTitle(ctx, scope)}`;
  const labels = andList(replaced.map((each) => `"${each.label}"`));
  return {
    type: 'moves',
    note: `${printedKeys(ctx, keys)} runs ${labels} ${where}: it moves here`,
    from: replaced.map((each) => commandTarget(each.command.id, each.arg)),
  };
}

// Writes `line`'s bind on `keys`, keeping its scope, `where`, `mode` and
// `arg`; keys the line already holds write nothing.
function moveLine(
  ctx: RowContext,
  line: BindLine,
  keys: string,
  via: Parameters<RowContext['commitKeymap']>[1],
): boolean {
  if (normalVimKeys(keys) === normalVimKeys(line.bind.keys)) {
    return false;
  }
  ctx.commitKeymap(
    withMovedBind(ctx.keymapLayer(), line, { ...line.bind, keys }, ctx.schema),
    via,
  );
  return true;
}

// Records new keys in place of `line` on `row`; Tab turns the row into a
// line box over the keys held.
function recordReassign(ctx: RowContext, row: CommandRow, line: BindLine) {
  const command = row.command.id;
  const { arg } = row;
  ctx.recordKey({
    key: commandTarget(command, arg),
    replacing: row.binds.indexOf(line),
    prompt: RECORD_PROMPT,
    confirm: 'enter',
    judge: (keys) => reassignJudgement(ctx, line, keys),
    keep: (keys) => {
      moveLine(ctx, line, keys, null);
    },
    type: (typed) =>
      ctx.openBox({
        key: commandTarget(command, arg),
        file: 'keymap',
        text: typed,
        editor: {
          type: 'line',
          preview: (text) =>
            keysPreview(ctx, text, (keys) => ({ ...line.bind, keys })),
        },
        accept(box) {
          const keys = box.text().trim();
          if (keys === '' || !moveLine(ctx, line, keys, { box })) {
            ctx.closeBox(box);
          }
        },
      }),
  });
}

// `line`'s keys and scope, as a picker over a row's binds lists them.
function bindChoiceLabel(ctx: RowContext, line: BindLine): string {
  return `${printedKeys(ctx, line.bind.keys)} — ${scopeTitle(ctx, line.bind.scope)}`;
}

// Reassigns one of `row`'s binds in force: with none it adds a key, with
// several the list picker chooses which first.
function reassign(ctx: RowContext, row: CommandRow) {
  const active = row.binds.filter(firesAnywhere);
  if (active.length === 0) {
    addBind(ctx, row);
    return;
  }
  if (active.length === 1) {
    recordReassign(ctx, row, active[0]);
    return;
  }
  ctx.openPicker({
    file: 'keymap',
    title: 'Key to reassign',
    items: active,
    label: (line) => bindChoiceLabel(ctx, line),
    chosen: (line) => recordReassign(ctx, row, line),
  });
}

// Adds a bind to `row`'s command and argument: a recorded key, or the keys
// typed in a box after Tab, then the scope picker, preselecting the scope of
// the row's first default bind; Enter on an empty box closes it.
function addBind(ctx: RowContext, row: CommandRow) {
  const command = row.command.id;
  const { arg } = row;
  const key = commandTarget(command, arg);
  const firstDefault = row.binds.find((line) => line.origin === 'default');
  const preselected: ViewScope = firstDefault?.bind.scope ?? 'any';
  const bindOn = (keys: string, scope: ViewScope): KeyBind => ({
    keys,
    scope,
    command,
    ...(arg !== undefined && { arg }),
  });
  const added = (keys: string, scope: ViewScope) =>
    withAddedBind(ctx.keymapLayer(), bindOn(keys, scope), ctx.schema);
  const request: RecordRequest = {
    key,
    replacing: null,
    prompt: RECORD_PROMPT,
    confirm: 'enter',
    judge: (keys) => leaderRefusal(ctx, keys) ?? { type: 'free' },
    keep: (keys) =>
      openScopePicker(ctx, {
        bindIn: (scope) => bindOn(keys, scope),
        preselected,
        chosen: (scope, expectedText) =>
          ctx.commitKeymap(added(keys, scope), { expectedText }),
      }),
    type: (typed) =>
      ctx.openBox({
        key,
        file: 'keymap',
        text: typed,
        editor: {
          type: 'line',
          preview: (text) =>
            keysPreview(ctx, text, (keys) => bindOn(keys, preselected)),
        },
        accept(box) {
          const keys = box.text().trim();
          if (keys === '') {
            ctx.closeBox(box);
            return;
          }
          openScopePicker(ctx, {
            bindIn: (scope) => bindOn(keys, scope),
            preselected,
            chosen: (scope) => ctx.commitKeymap(added(keys, scope), { box }),
            cancelled: () => box.focus(),
          });
        },
      }),
  };
  ctx.recordKey(request);
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
    label: (line) => bindChoiceLabel(ctx, line),
    chosen: (line, expectedText) =>
      ctx.commitKeymap(withRemovedBind(ctx.keymapLayer(), line, ctx.schema), {
        expectedText,
      }),
  });
}

// A main command's binds are its accelerators, edited only in the advanced
// box; a page command's row reassigns on Enter or `i`, adds, removes and
// resets binds.
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
  const reassignRow = () => reassign(ctx, row);
  return {
    open: reassignRow,
    edit: reassignRow,
    addBind: () => addBind(ctx, row),
    removeBind: () => removeBind(ctx, row),
    reset: () =>
      ctx.commitKeymap(
        withCommandReset(ctx.keymapLayer(), command.id, ctx.schema, row.arg),
        null,
      ),
  };
}

// The recording on the row `key` as the row draws it, its keys printed for
// the platform; null with none there.
export function recordingOn(
  ctx: RowContext,
  key: string,
): RecordingInput | null {
  const recording = ctx.recording();
  if (recording === null || recording.key !== key) {
    return null;
  }
  return {
    keys: recording.keys === null ? null : printedKeys(ctx, recording.keys),
    prompt: recording.prompt,
    note: recording.note,
    isRefused: recording.isRefused,
  };
}

// A command row's input: its row label capitalised, its manifest group, its
// binds then its accelerators, and the recording on it, if any.
export function keyRowInput(ctx: RowContext, row: CommandRow): KeyRowInput {
  const { command } = row;
  const recording = recordingOn(ctx, commandTarget(command.id, row.arg));
  const replacing = ctx.recording()?.replacing ?? null;
  return {
    command: command.id,
    label: capitalised(row.label),
    group: command.group,
    runsIn: command.runsIn,
    lines: [
      ...row.binds.map((line) => bindLine(ctx, line)),
      ...row.accelerators.map((line) => acceleratorLine(ctx, line)),
    ],
    recording: recording === null ? null : { ...recording, line: replacing },
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

// The advanced row: a document box over the keymap's remaps, accelerators
// and accelerator unbind entries.
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

// The filter bar's input: each chip with the count of the `matched` command
// rows it would show, and the find query.
function keyFiltersInput(
  ctx: RowContext,
  matched: readonly CommandRow[],
  state: KeysViewState,
): KeyFiltersInput {
  const recording = ctx.recording();
  return {
    chips: KEY_FILTERS.map((filter) => ({
      id: filter,
      label: CHIP_LABELS[filter],
      count: matched.filter((row) => matchesKeyFilter(row, filter)).length,
      isOn: filter === state.filter,
    })),
    find: {
      keys: state.findKeys === null ? null : printedKeys(ctx, state.findKeys),
      prompt: recording?.key === FIND_KEY ? recording.prompt : null,
    },
  };
}

// The Keybindings section's rows that match `query`, the chip and the find
// query: the filter bar first, the leader, each plugin's commands under its
// header (with a find query, the commands under "<keys> runs" and "Starts
// with <keys>" instead), and, with no filter, the advanced row. The leader
// and advanced rows show only under the `all` chip with no find query.
export function keymapSection(
  ctx: RowContext,
  query: string,
  state: KeysViewState,
): SectionDrawing {
  const entries: SectionEntry[] = [];
  const rows: SettingsRow[] = [];
  const addRow = (row: SettingsRow) => {
    entries.push({ type: 'row', row });
    rows.push(row);
  };
  const addGroup = (title: string, shown: readonly CommandRow[]) => {
    if (shown.length > 0) {
      entries.push({ type: 'header', input: { title } });
      shown.forEach((row) => addRow(commandRow(ctx, row)));
    }
  };
  const { findKeys } = state;
  const held = leader(ctx);
  const matchOf = (row: CommandRow) =>
    findKeys === null ? null : keyMatch(row, findKeys, held);
  const groups = keymapRows(ctx.schema, ctx.keymapLayer()).map((group) => ({
    title: group.title,
    rows: group.rows.filter(
      (row) =>
        matchesCommand(row, query, ctx.matcher) &&
        (findKeys === null || matchOf(row) !== null),
    ),
  }));
  const matched = groups.flatMap((group) => group.rows);
  entries.push({
    type: 'keyFilters',
    input: keyFiltersInput(ctx, matched, state),
  });
  const isPlain = state.filter === 'all' && findKeys === null;
  if (isPlain && matchesLeader([held], query, ctx.matcher)) {
    addRow(leaderRow(ctx));
  }
  const inChip = (row: CommandRow) => matchesKeyFilter(row, state.filter);
  if (findKeys === null) {
    for (const group of groups) {
      addGroup(group.title, group.rows.filter(inChip));
    }
  } else {
    const printed = printedKeys(ctx, findKeys);
    const shown = matched.filter(inChip);
    addGroup(
      `${printed} runs`,
      shown.filter((row) => matchOf(row) === 'runs'),
    );
    addGroup(
      `Starts with ${printed}`,
      shown.filter((row) => matchOf(row) === 'starts'),
    );
  }
  if (isPlain && query.trim() === '') {
    addRow(advancedRow(ctx));
  }
  return {
    entries,
    rows,
    ...(findKeys !== null && { emptyQuery: printedKeys(ctx, findKeys) }),
  };
}
