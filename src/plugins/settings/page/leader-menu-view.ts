import type { CommandArg } from '../../../contracts/commands';
import type { KeyBind, UserKeymap, ViewScope } from '../../../contracts/keymap';
import type { FocusTarget } from '../../../contracts/panes';
import type { CommandInfo } from '../../../contracts/plugin';
import type { UserConfigSchema } from '../../../contracts/user-config';
import { capitalised } from '../../../shared/capitalised';
import { parseChord } from '../../../shared/chord-notation';
import { commandTarget } from '../../../shared/command-args';
import { formatVimKeys, normalVimKeys } from '../../../shared/key-hints';
import { scopesOverlap } from '../../../shared/keymap-checks';
import type { PromptActionInput } from '../../../shared/page/layout-host/kit';
import { commandLabel } from '../../../shared/plugin-manifests';
import type { LeaderCursors } from '../contract';
import type {
  LeaderAddRowInput,
  LeaderGroupRowInput,
  LeaderItemRowInput,
  LeaderPanesInput,
} from '../layouts/layout';
import type { Judgement } from './key-recorder';
import {
  withAddedBind,
  withCommandReset,
  withGroupName,
  withMovedBind,
  withRemovedBind,
} from './keymap-edits';
import {
  type BindLine,
  type CommandRow,
  keymapLeader,
  keymapRows,
} from './keymap-rows';
import { openScopePicker, recordingOn, scopeTitle } from './keymap-view';
import type { BuiltLeaderPanes, BuiltRow } from './layout/settings-kit';
import { createPromptHolder, type PromptHolder } from './row-prompt';
import {
  freeKeys,
  groupNameIn,
  groupTitle,
  keyTaken,
  LEADER,
  type LeaderGroup,
  type LeaderItem,
  leaderTree,
} from './leader-tree';
import type { CommitVia, RowContext } from './settings-view';

export type LeaderMenuCommand =
  | 'down'
  | 'up'
  | 'top'
  | 'bottom'
  | 'open'
  | 'addBind'
  | 'removeBind'
  | 'reset'
  | 'renameGroup'
  | 'changeKey'
  | 'moveToGroup';

export type LeaderPane = 'groups' | 'items';

export type LeaderScope = 'leaderGroups' | 'leaderItems';

export type LeaderRowPart =
  | { part: 'leaderGroupRow'; input: LeaderGroupRowInput }
  | { part: 'leaderItemRow'; input: LeaderItemRowInput }
  | { part: 'leaderAddRow'; input: LeaderAddRowInput };

// What the Leader menu draws through and hands the keys to. `drawPanes` and
// `drawRow` draw a layout part, which the caller disposes on its next draw of
// the rows; `drawRow` is handed the row's key, for a click on the row to move
// the cursor to; `redraw` draws the rows again, the Leader menu through
// `draw`. `drawPrompt` draws the layout's `cursorPrompt` for `actions` into a
// row's actions slot `parent`, in the kit of the pane's `scope`, and returns
// the dispose that takes it out again. `cursorMoved` hears each cursor move.
export interface LeaderMenuDeps {
  context: RowContext;
  drawPanes(parent: HTMLElement, input: LeaderPanesInput): BuiltLeaderPanes;
  drawRow(
    row: LeaderRowPart,
    parent: HTMLElement,
    scope: LeaderScope,
    key: string,
  ): BuiltRow;
  drawPrompt(
    parent: HTMLElement,
    actions: readonly PromptActionInput[],
    scope: LeaderScope,
  ): () => void;
  setScope(scope: LeaderScope): void;
  setFocusTarget(target: FocusTarget): void;
  redraw(): void;
  cursorMoved(): void;
  log(line: string): void;
}

// The Leader menu section: the groups pane beside the selected group's
// items, each with its own cursor by row key, kept across redraws. `focus`
// hands the keys to the pane last focused (`groups` after `reset`), logging
// `leader groups focused` or `leader items focused` when the pane holding the
// keys changes; `blur` takes them away. Its focus target moves between the
// panes and leaves every other move to the core. Each cursor move logs
// `cursor <row key>`; an edit that moves or adds a bind or group moves the
// cursors to it once its write lands; an add whose key the scope chosen
// refuses logs `add refused <keys> in <scope>: <reason>` and toasts why. Row
// keys: `group top`, `group <prefix>`, `item <scope> <keys>` (` set` appended
// for a user bind), `opens <prefix>` and `add <prefix>`. `reset` puts both
// cursors back to their first draw's, or onto `restored`'s rows where the
// next draw still holds them. `cursors` reads both cursors' row keys.
// `moveTo` moves the cursor of the pane holding the row `key` to it, that pane
// taking the keys on the next `focus`; false when no row holds `key`.
// `drawnRow` finds a drawn row by key, for the box and the recording drawn on
// it. `dispose` disposes the cursor prompts drawn in the panes' rows, for the
// owner to run before it replaces or leaves the rows. `isEdit` is whether
// `command` on the cursor row edits the keymap rather than moving the
// cursors.
export interface LeaderMenuView {
  draw(parent: HTMLElement): void;
  focus(): void;
  blur(): void;
  reset(restored?: LeaderCursors | null): void;
  cursors(): LeaderCursors;
  moveTo(key: string): boolean;
  drawnRow(key: string): BuiltRow | undefined;
  dispose(): void;
  isEdit(command: LeaderMenuCommand): boolean;
  commands: Record<LeaderMenuCommand, () => void>;
}

const MOVES = ['down', 'up', 'top', 'bottom'] as const;

type RowAction = Exclude<LeaderMenuCommand, (typeof MOVES)[number]>;

// The cursor prompt's actions: each a settings command, qualified, and the
// word its hint draws.
const GROUP_HINTS = {
  rename: { command: 'settings.renameGroup', label: 'rename' },
  addGroup: { command: 'settings.addBind', label: 'add group' },
  remove: { command: 'settings.removeBind', label: 'remove' },
} satisfies Record<string, PromptActionInput>;

const ITEM_HINTS = {
  changeAction: { command: 'settings.open', label: 'change action' },
  open: { command: 'settings.open', label: 'open' },
  add: { command: 'settings.addBind', label: 'add' },
  changeKey: { command: 'settings.changeKey', label: 'change key' },
  clear: { command: 'settings.removeBind', label: 'clear' },
  move: { command: 'settings.moveToGroup', label: 'move to group' },
  reset: { command: 'settings.reset', label: 'reset' },
} satisfies Record<string, PromptActionInput>;

type GroupHint = keyof typeof GROUP_HINTS;
type ItemHint = keyof typeof ITEM_HINTS;

// One row of a pane: its key, the part that draws it, what each command does
// on it, the cursor prompt's hints it shows, and whether its `open` only
// moves the cursors.
interface PaneRow<H extends string> {
  key: string;
  draw: LeaderRowPart;
  actions: Partial<Record<RowAction, () => void>>;
  hints: readonly H[];
  isOpenAMove?: boolean;
}

// Where the cursors go on the next draw, once an edit's write lands or after
// a `reset` to restored cursors; a row the draw no longer holds is passed
// over.
interface Follow {
  group: string;
  item: string | null;
}

const PANE_SCOPES: Record<LeaderPane, LeaderScope> = {
  groups: 'leaderGroups',
  items: 'leaderItems',
};

const CHORD_NOTE =
  'A leader item is one key with no Ctrl, Alt or Cmd, and not Tab or F1 to F12';
const ITEMS_FIRST_NOTE = 'Move or clear its items first';

function groupRowKey(group: LeaderGroup): string {
  return group.path.length === 0 ? 'group top' : `group ${group.prefix}`;
}

function itemRowKey(bind: KeyBind, isSet: boolean): string {
  return `item ${bind.scope} ${bind.keys}${isSet ? ' set' : ''}`;
}

// What a row or item runs: its command and argument.
interface Runs {
  command: CommandInfo;
  arg?: CommandArg;
}

function sameTarget(a: Runs, b: Runs): boolean {
  return (
    commandTarget(a.command.id, a.arg) === commandTarget(b.command.id, b.arg)
  );
}

// Every leader line of what `runs` runs, in the tree's order.
function leaderLinesOf(tree: readonly LeaderGroup[], runs: Runs): BindLine[] {
  return tree.flatMap((group) =>
    group.entries.flatMap((entry) =>
      entry.type === 'item' && sameTarget(entry.item, runs)
        ? [entry.item.line]
        : [],
    ),
  );
}

// Each of `lines` other than `kept` whose scope overlaps `scope`: the leader
// paths an edit binding in `scope` removes.
function otherLeaderPaths(
  lines: readonly BindLine[],
  kept: BindLine | undefined,
  scope: ViewScope,
): BindLine[] {
  return lines.filter(
    (line) => line !== kept && scopesOverlap(line.bind.scope, scope),
  );
}

// `layer` without each of `otherLeaderPaths`, each removed as
// `withRemovedBind` removes it.
function withOtherLeaderPathsRemoved(
  layer: UserKeymap,
  lines: readonly BindLine[],
  kept: BindLine | undefined,
  scope: ViewScope,
  schema: UserConfigSchema,
): UserKeymap {
  let edited = layer;
  for (const line of otherLeaderPaths(lines, kept, scope)) {
    edited = withRemovedBind(edited, line, schema);
  }
  return edited;
}

export function createLeaderMenuView(deps: LeaderMenuDeps): LeaderMenuView {
  const { context: ctx, log } = deps;
  // Each pane's `cursorPrompt`, drawn into its cursor row.
  const promptHolder = (at: LeaderPane): PromptHolder =>
    createPromptHolder((slot, actions) =>
      deps.drawPrompt(slot, actions, PANE_SCOPES[at]),
    );
  const prompts: Record<LeaderPane, PromptHolder> = {
    groups: promptHolder('groups'),
    items: promptHolder('items'),
  };

  let pane: LeaderPane = 'groups';
  let holding: LeaderPane | null = null;
  const cursors: Record<LeaderPane, string | null> = {
    groups: null,
    items: null,
  };
  // The group whose items the items cursor walks.
  let itemsGroup: string | null = null;
  let follow: Follow | null = null;
  let tree: LeaderGroup[] = [];
  let groupRows: PaneRow<GroupHint>[] = [];
  let itemRows: PaneRow<ItemHint>[] = [];
  let panes: BuiltLeaderPanes | null = null;
  let drawn: Record<LeaderPane, Map<string, BuiltRow>> = {
    groups: new Map(),
    items: new Map(),
  };

  const leader = () => keymapLeader(ctx.schema, ctx.keymapLayer());
  const printed = (keys: string) => formatVimKeys(keys, leader(), ctx.platform);

  const setCursor = (at: LeaderPane, key: string | null) => {
    if (cursors[at] === key) {
      return;
    }
    cursors[at] = key;
    if (key !== null) {
      log(`cursor ${key}`);
    }
    deps.cursorMoved();
  };

  // `key` while a row holds it; else the row now in the place of the one
  // that left, from `previous`; null stays null.
  const cursorAfter = (
    rows: readonly { key: string }[],
    key: string | null,
    previous: readonly { key: string }[],
  ): string | null => {
    if (key === null || rows.some((row) => row.key === key)) {
      return key;
    }
    const place = Math.max(
      previous.findIndex((row) => row.key === key),
      0,
    );
    return rows[Math.min(place, rows.length - 1)]?.key ?? null;
  };

  const selectedGroup = (): LeaderGroup | undefined =>
    tree.find((group) => groupRowKey(group) === cursors.groups);

  const currentGroup = (group: LeaderGroup): LeaderGroup =>
    tree.find((each) => each.prefix === group.prefix) ?? group;

  // A recorded press as the key it binds under a prefix: the leader in force
  // is the key `<Leader>`.
  const asItemKey = (keys: string): string =>
    normalVimKeys(keys) === normalVimKeys(leader()) ? LEADER : keys;

  // A recorded key in `group` for a bind in `scope`, the `excluded` lines the
  // edit moves or removes aside: a chord, a nested group's key or an item's
  // key in an overlapping scope is refused.
  const judge = (
    group: LeaderGroup,
    keys: string,
    scope: ViewScope | null,
    excluded: readonly BindLine[],
  ): Judgement => {
    const key = asItemKey(keys);
    if (parseChord(key) !== null) {
      return { type: 'refused', note: CHORD_NOTE, reason: 'chord' };
    }
    const held = currentGroup(group);
    const taken = keyTaken(tree, held, key, scope, excluded);
    const full = printed(held.prefix + key);
    if (taken?.type === 'group') {
      return {
        type: 'refused',
        note: `${full} opens the ${taken.group.name} group`,
        reason: 'group',
      };
    }
    if (taken?.type === 'item') {
      const { scope: takenScope } = taken.item.line.bind;
      const label = commandLabel(ctx.schema.commands, taken.item.command.id);
      const where =
        takenScope === 'any' ? '' : ` in ${scopeTitle(ctx, takenScope)}`;
      return {
        type: 'refused',
        note: `${full} already runs "${label}"${where}`,
        reason: 'taken',
      };
    }
    return { type: 'free' };
  };

  // Records one key in `group` on the row `key`, then hands `keep` the keys
  // it binds there, the group's prefix and the key, and the key alone.
  const recordIn = (
    group: LeaderGroup,
    key: string,
    prompt: string,
    scope: ViewScope | null,
    excluded: readonly BindLine[],
    keep: (keys: string, itemKey: string) => void,
  ) =>
    ctx.recordKey({
      key,
      replacing: null,
      prompt,
      confirm: 'press',
      judge: (keys) => judge(group, keys, scope, excluded),
      keep: (keys) => {
        const itemKey = asItemKey(keys);
        keep(currentGroup(group).prefix + itemKey, itemKey);
      },
    });

  const commit = (
    layer: Parameters<RowContext['commitKeymap']>[0],
    via: CommitVia,
    to: Follow | null,
  ) =>
    ctx.commitKeymap(layer, via, () => {
      follow = to;
    });

  const actionRows = (): CommandRow[] =>
    keymapRows(ctx.schema, ctx.keymapLayer())
      .flatMap((group) => group.rows)
      .filter((row) => row.command.runsIn === 'page');

  // The `Action` picker over every page command's rows, each with its first
  // leader keys in the tree's order printed beside it: the ones Add moves
  // unless a line sits in the scope chosen.
  const openActionPicker = (
    rows: readonly CommandRow[],
    selected: number | undefined,
    chosen: (row: CommandRow, expectedText: string | null) => void,
  ) =>
    ctx.openPicker({
      file: 'keymap',
      title: 'Action',
      items: rows,
      label: (row) => capitalised(row.label),
      keysOf: (row) => {
        const [line] = leaderLinesOf(tree, row);
        return line === undefined ? null : printed(line.bind.keys);
      },
      selected,
      chosen,
    });

  // ── Group edits ─────────────────────────────────────────────────────────

  const addGroup = (group: LeaderGroup) => {
    const key = groupRowKey(group);
    recordIn(
      group,
      key,
      "Press the new group's key — Esc cancels",
      'any',
      [],
      (prefix) =>
        ctx.openBox({
          key,
          file: 'keymap',
          text: '',
          editor: { type: 'line' },
          accept(box) {
            const name = box.text().trim();
            if (name === '') {
              ctx.closeBox(box);
              return;
            }
            commit(
              withGroupName(ctx.keymapLayer(), prefix, name, ctx.schema),
              { box },
              { group: `group ${prefix}`, item: null },
            );
          },
        }),
    );
  };

  const renameGroup = (group: LeaderGroup) =>
    ctx.openBox({
      key: groupRowKey(group),
      file: 'keymap',
      text: group.isNamed ? group.name : '',
      editor: { type: 'line' },
      accept(box) {
        const text = box.text().trim();
        const isDefault =
          text === '' ||
          text ===
            groupNameIn(ctx.schema.defaultGroups, group.prefix, leader());
        ctx.commitKeymap(
          withGroupName(
            ctx.keymapLayer(),
            group.prefix,
            isDefault ? null : text,
            ctx.schema,
          ),
          { box },
        );
      },
    });

  const removeGroup = (group: LeaderGroup) => {
    if (group.entries.length > 0) {
      log(`group has items ${group.prefix}`);
      ctx.toast(ITEMS_FIRST_NOTE, 'info');
      return;
    }
    ctx.commitKeymap(
      withGroupName(ctx.keymapLayer(), group.prefix, null, ctx.schema),
      null,
    );
  };

  // ── Item edits ──────────────────────────────────────────────────────────

  // Records the new item's key, which meets only `any` items until the Scope
  // picker names its scope; the key is judged again in the scope chosen, the
  // lines the edit moves or removes aside, and refused there it writes
  // nothing. A command with leader binds moves the one in the scope chosen,
  // else its first in the tree's order, and loses the rest in a scope
  // overlapping it, so it keeps one leader path per scope.
  const addItem = (group: LeaderGroup) =>
    recordIn(
      group,
      `add ${group.prefix}`,
      "Press the new item's key — Esc cancels",
      null,
      [],
      (keys, itemKey) =>
        openActionPicker(actionRows(), undefined, (row) => {
          const lines = leaderLinesOf(
            leaderTree(ctx.schema, ctx.keymapLayer()),
            row,
          );
          const movingIn = (scope: ViewScope): BindLine | undefined =>
            lines.find((line) => line.bind.scope === scope) ?? lines[0];
          const firstDefault = row.binds.find(
            (line) => line.origin === 'default',
          );
          const bindIn = (scope: ViewScope): KeyBind => {
            const moving = movingIn(scope);
            return moving === undefined
              ? {
                  keys,
                  scope,
                  command: row.command.id,
                  ...(row.arg !== undefined && { arg: row.arg }),
                }
              : { ...moving.bind, keys, scope };
          };
          openScopePicker(ctx, {
            bindIn,
            preselected:
              lines[0]?.bind.scope ?? firstDefault?.bind.scope ?? 'any',
            chosen(scope, expectedText) {
              const moving = movingIn(scope);
              const judged = judge(group, itemKey, scope, [
                ...(moving === undefined ? [] : [moving]),
                ...otherLeaderPaths(lines, moving, scope),
              ]);
              if (judged.type === 'refused') {
                log(`add refused ${keys} in ${scope}: ${judged.reason}`);
                ctx.toast(judged.note, 'info');
                return;
              }
              const layer = ctx.keymapLayer();
              const to = bindIn(scope);
              const added =
                moving === undefined
                  ? withAddedBind(layer, to, ctx.schema)
                  : withMovedBind(layer, moving, to, ctx.schema);
              const edited = withOtherLeaderPathsRemoved(
                added,
                lines,
                moving,
                scope,
                ctx.schema,
              );
              commit(
                edited,
                { expectedText },
                { group: groupRowKey(group), item: itemRowKey(to, true) },
              );
            },
          });
        }),
    );

  // Rebinds the item's key and scope to the picked command, which loses its
  // other leader binds in a scope overlapping the item's, so it keeps one
  // leader path per scope.
  const changeAction = (group: LeaderGroup, item: LeaderItem) => {
    const rows = actionRows();
    const own = rows.findIndex((row) => sameTarget(row, item));
    openActionPicker(
      rows,
      own === -1 ? undefined : own,
      (row, expectedText) => {
        if (sameTarget(row, item)) {
          return;
        }
        const to: KeyBind = { ...item.line.bind, command: row.command.id };
        delete to.arg;
        if (row.arg !== undefined) {
          to.arg = row.arg;
        }
        const moved = withMovedBind(
          ctx.keymapLayer(),
          item.line,
          to,
          ctx.schema,
        );
        const edited = withOtherLeaderPathsRemoved(
          moved,
          leaderLinesOf(leaderTree(ctx.schema, ctx.keymapLayer()), row),
          undefined,
          to.scope,
          ctx.schema,
        );
        commit(
          edited,
          { expectedText },
          { group: groupRowKey(group), item: itemRowKey(to, true) },
        );
      },
    );
  };

  // Records the item's key in `target`, keeping its scope; the item's own
  // keys write nothing.
  const rekey = (target: LeaderGroup, item: LeaderItem, prompt: string) =>
    recordIn(
      target,
      itemRowKey(item.line.bind, item.line.origin === 'user'),
      prompt,
      item.line.bind.scope,
      [item.line],
      (keys) => {
        if (normalVimKeys(keys) === normalVimKeys(item.line.bind.keys)) {
          return;
        }
        const to = { ...item.line.bind, keys };
        commit(
          withMovedBind(ctx.keymapLayer(), item.line, to, ctx.schema),
          null,
          { group: groupRowKey(target), item: itemRowKey(to, true) },
        );
      },
    );

  const moveToGroup = (group: LeaderGroup, item: LeaderItem) => {
    const targets = tree.filter((each) => each.prefix !== group.prefix);
    const held = leader();
    ctx.openPicker({
      file: 'keymap',
      title: 'Group',
      items: targets,
      label: (target) => groupTitle(target, held, ctx.platform),
      chosen: (target) =>
        rekey(
          target,
          item,
          `Press its key in ${groupTitle(target, held, ctx.platform)} — Esc cancels`,
        ),
    });
  };

  // ── Rows ────────────────────────────────────────────────────────────────

  const groupRow = (group: LeaderGroup): PaneRow<GroupHint> => {
    const key = groupRowKey(group);
    const isTop = group.path.length === 0;
    const lastToken = group.path[group.path.length - 1];
    return {
      key,
      draw: {
        part: 'leaderGroupRow',
        input: {
          prefix: group.prefix,
          key: isTop ? '' : printed(lastToken),
          name: group.name,
          isNamed: group.isNamed,
          isSet: group.isSet,
          depth: Math.max(group.path.length - 1, 0),
          count: group.entries.length,
          recording: recordingOn(ctx, key),
        },
      },
      actions: isTop
        ? { addBind: () => addGroup(group) }
        : {
            addBind: () => addGroup(group),
            renameGroup: () => renameGroup(group),
            removeBind: () => removeGroup(group),
          },
      hints: isTop ? ['addGroup'] : ['rename', 'addGroup', 'remove'],
    };
  };

  const itemTags = (item: LeaderItem): string[] => {
    const { line } = item;
    const tags =
      line.bind.scope === 'any' ? [] : [scopeTitle(ctx, line.bind.scope)];
    const isBoxOnly =
      line.editor?.state === 'active' && line.page?.state !== 'active';
    if (isBoxOnly) {
      tags.push('in a box');
    }
    if (line.origin === 'user') {
      tags.push('Set');
    }
    return tags;
  };

  const itemRow = (group: LeaderGroup, item: LeaderItem): PaneRow<ItemHint> => {
    const key = itemRowKey(item.line.bind, item.line.origin === 'user');
    return {
      key,
      draw: {
        part: 'leaderItemRow',
        input: {
          kind: 'command',
          key: printed(item.key),
          label: capitalised(item.command.label),
          command: commandTarget(item.command.id, item.arg),
          tags: itemTags(item),
          recording: recordingOn(ctx, key),
        },
      },
      actions: {
        open: () => changeAction(group, item),
        changeKey: () => rekey(group, item, 'Press its new key — Esc cancels'),
        removeBind: () =>
          ctx.commitKeymap(
            withRemovedBind(ctx.keymapLayer(), item.line, ctx.schema),
            null,
          ),
        moveToGroup: () => moveToGroup(group, item),
        reset: () =>
          ctx.commitKeymap(
            withCommandReset(
              ctx.keymapLayer(),
              item.command.id,
              ctx.schema,
              item.arg,
            ),
            null,
          ),
      },
      hints: ['changeAction', 'changeKey', 'clear', 'move', 'reset'],
    };
  };

  const nestedRow = (key: string, prefix: string): PaneRow<ItemHint> => {
    const nested = tree.find((each) => each.prefix === prefix);
    const rowKey = `opens ${prefix}`;
    return {
      key: rowKey,
      draw: {
        part: 'leaderItemRow',
        input: {
          kind: 'group',
          key: printed(key),
          label: nested?.name ?? '',
          command: null,
          tags: [],
          recording: null,
        },
      },
      actions: { open: () => openNested(prefix) },
      hints: ['open'],
      isOpenAMove: true,
    };
  };

  const addRow = (group: LeaderGroup): PaneRow<ItemHint> => {
    const key = `add ${group.prefix}`;
    return {
      key,
      draw: {
        part: 'leaderAddRow',
        input: {
          freeKeys: freeKeys(group).map((free) => printed(free)),
          recording: recordingOn(ctx, key),
        },
      },
      actions: { open: () => addItem(group) },
      hints: ['add'],
    };
  };

  const itemRowsOf = (group: LeaderGroup): PaneRow<ItemHint>[] => [
    ...group.entries.map((entry) =>
      entry.type === 'item'
        ? itemRow(group, entry.item)
        : nestedRow(entry.key, entry.prefix),
    ),
    addRow(group),
  ];

  // ── Cursor, focus and drawing ───────────────────────────────────────────

  const rowsOf = (at: LeaderPane): readonly PaneRow<string>[] =>
    at === 'groups' ? groupRows : itemRows;

  const listOf = (at: LeaderPane): HTMLElement | undefined =>
    at === 'groups' ? panes?.groupRows : panes?.itemRows;

  // Disposes both panes' cursor prompts, so no prompt anchor outlives its row.
  const disposePrompts = () => {
    prompts.groups.dispose();
    prompts.items.dispose();
  };

  // Marks each pane's cursor row selected, ringed while its pane holds the
  // keys, the pane without them inactive, and draws each pane's cursor prompt
  // in its cursor row; a hint out of scope hides in place.
  const mark = () => {
    for (const at of ['groups', 'items'] as const) {
      for (const [key, row] of drawn[at]) {
        const isCursor = key === cursors[at];
        row.element.classList.toggle('is-selected', isCursor);
        row.element.classList.toggle('is-cursor', isCursor && holding === at);
      }
      listOf(at)?.classList.toggle('is-pane-inactive', holding !== at);
    }
    placePrompt('groups', groupRows, GROUP_HINTS);
    placePrompt('items', itemRows, ITEM_HINTS);
    if (holding !== null) {
      const cursor = cursors[holding];
      if (cursor !== null) {
        drawn[holding]
          .get(cursor)
          ?.element.scrollIntoView({ block: 'nearest' });
      }
    }
  };

  // Draws `at`'s cursor prompt into its cursor row's actions slot with the
  // row's `hints`, in order, taken from `table`. With no cursor row it
  // disposes the drawn prompt.
  const placePrompt = <H extends string>(
    at: LeaderPane,
    rows: readonly PaneRow<H>[],
    table: Record<H, PromptActionInput>,
  ) => {
    const row = rows.find((each) => each.key === cursors[at]);
    const into = row === undefined ? undefined : drawn[at].get(row.key);
    if (row === undefined || into === undefined) {
      prompts[at].dispose();
      return;
    }
    prompts[at].place(
      into.actions,
      row.hints.map((hint) => table[hint]),
    );
  };

  const focusTarget: FocusTarget = {
    move(direction) {
      if (pane === 'groups' && direction === 'right') {
        focusPane('items');
        return true;
      }
      if (pane === 'items' && direction === 'left') {
        focusPane('groups');
        return true;
      }
      return false;
    },
  };

  const focus = () => {
    if (pane === 'items' && cursors.items === null) {
      setCursor('items', itemRows[0]?.key ?? null);
    }
    deps.setScope(PANE_SCOPES[pane]);
    deps.setFocusTarget(focusTarget);
    if (holding !== pane) {
      log(`leader ${pane} focused`);
    }
    holding = pane;
    mark();
    listOf(pane)?.focus();
  };

  const focusPane = (next: LeaderPane) => {
    pane = next;
    focus();
  };

  // Moves the groups cursor to the nested group `prefix`, the items cursor
  // to its first row.
  const openNested = (prefix: string) => {
    const group = tree.find((each) => each.prefix === prefix);
    if (group === undefined) {
      return;
    }
    setCursor('groups', groupRowKey(group));
    itemsGroup = group.prefix;
    cursors.items = null;
    deps.redraw();
  };

  const drawRows = (
    rows: readonly PaneRow<string>[],
    parent: HTMLElement,
    scope: LeaderScope,
  ) =>
    new Map(
      rows.map((row) => [
        row.key,
        deps.drawRow(row.draw, parent, scope, row.key),
      ]),
    );

  const draw = (parent: HTMLElement) => {
    disposePrompts();
    tree = leaderTree(ctx.schema, ctx.keymapLayer());
    const followed = follow;
    follow = null;
    const nextGroupRows = tree.map(groupRow);
    const isFollowedGroup =
      followed !== null &&
      nextGroupRows.some((row) => row.key === followed.group);
    setCursor(
      'groups',
      isFollowedGroup
        ? followed.group
        : (cursorAfter(nextGroupRows, cursors.groups, groupRows) ??
            nextGroupRows[0]?.key ??
            null),
    );
    groupRows = nextGroupRows;
    const selected = selectedGroup();
    if (selected?.prefix !== itemsGroup) {
      itemsGroup = selected?.prefix ?? null;
      cursors.items = null;
      itemRows = [];
    }
    const nextItemRows = selected === undefined ? [] : itemRowsOf(selected);
    const followedItem = followed?.item ?? null;
    const isFollowedItem =
      followedItem !== null &&
      nextItemRows.some((row) => row.key === followedItem);
    let itemsCursor = isFollowedItem
      ? followedItem
      : cursorAfter(nextItemRows, cursors.items, itemRows);
    if (itemsCursor === null && pane === 'items') {
      itemsCursor = nextItemRows[0]?.key ?? null;
    }
    setCursor('items', itemsCursor);
    itemRows = nextItemRows;
    const held = leader();
    panes = deps.drawPanes(parent, {
      focused: pane,
      itemsTitle:
        selected === undefined ? '' : groupTitle(selected, held, ctx.platform),
    });
    drawn = {
      groups: drawRows(groupRows, panes.groupRows, 'leaderGroups'),
      items: drawRows(itemRows, panes.itemRows, 'leaderItems'),
    };
    mark();
    const isFocusLost =
      document.activeElement === null ||
      document.activeElement === document.body;
    if (holding !== null && isFocusLost) {
      listOf(holding)?.focus();
    }
  };

  const move = (to: (index: number, count: number) => number) => {
    const rows = rowsOf(pane);
    if (rows.length === 0) {
      return;
    }
    const index = rows.findIndex((row) => row.key === cursors[pane]);
    const next = Math.max(0, Math.min(rows.length - 1, to(index, rows.length)));
    setCursor(pane, rows[next].key);
    if (pane === 'groups') {
      deps.redraw();
    } else {
      mark();
    }
  };

  const cursorRow = () =>
    rowsOf(pane).find((each) => each.key === cursors[pane]);

  const runRow = (action: RowAction) => {
    cursorRow()?.actions[action]?.();
  };

  // `open` on the groups pane focuses the items pane.
  const isEdit = (command: LeaderMenuCommand): boolean => {
    if ((MOVES as readonly LeaderMenuCommand[]).includes(command)) {
      return false;
    }
    if (command !== 'open') {
      return true;
    }
    return pane === 'items' && cursorRow()?.isOpenAMove !== true;
  };

  const commands: Record<LeaderMenuCommand, () => void> = {
    down: () => move((index) => index + 1),
    up: () => move((index) => index - 1),
    top: () => move(() => 0),
    bottom: () => move((_index, count) => count - 1),
    open() {
      if (pane === 'items') {
        runRow('open');
        return;
      }
      setCursor('items', itemRows[0]?.key ?? null);
      focusPane('items');
    },
    addBind() {
      const selected = selectedGroup();
      if (pane === 'groups') {
        runRow('addBind');
      } else if (selected !== undefined) {
        addItem(selected);
      }
    },
    removeBind: () => runRow('removeBind'),
    reset: () => runRow('reset'),
    renameGroup: () => runRow('renameGroup'),
    changeKey: () => runRow('changeKey'),
    moveToGroup: () => runRow('moveToGroup'),
  };

  return {
    draw,
    focus,
    blur() {
      holding = null;
      mark();
    },
    reset(restored = null) {
      disposePrompts();
      pane = 'groups';
      holding = null;
      cursors.groups = null;
      cursors.items = null;
      itemsGroup = null;
      follow =
        restored?.groups == null
          ? null
          : { group: restored.groups, item: restored.items };
      groupRows = [];
      itemRows = [];
    },
    cursors: () => ({ ...cursors }),
    moveTo(key) {
      const at = (['groups', 'items'] as const).find((each) =>
        rowsOf(each).some((row) => row.key === key),
      );
      if (at === undefined) {
        return false;
      }
      pane = at;
      setCursor(at, key);
      if (at === 'groups') {
        deps.redraw();
      }
      return true;
    },
    drawnRow: (key) => drawn.groups.get(key) ?? drawn.items.get(key),
    dispose: disposePrompts,
    isEdit,
    commands,
  };
}
