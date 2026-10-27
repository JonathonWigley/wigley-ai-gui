import type { Log } from '../../../../contracts/log';
import type { MarkdownRenderer } from '../../../../contracts/markdown';
import type { Platform } from '../../../../contracts/platform';
import type { ShownLayouts } from '../../../../contracts/plugin';
import { element } from '../../../../shared/page/dom';
import {
  type BaseKitDeps,
  createBaseKit,
  type KitCommands,
} from '../../../../shared/page/layout-host/base-kit';
import {
  type DrawnPart,
  drawPart,
  requireElementIn,
  type RollbackDeps,
} from '../../../../shared/page/layout-host/draw-part';
import type { BaseKit } from '../../../../shared/page/layout-host/kit';
import { pickLayout } from '../../../../shared/page/layout-host/pick';
import {
  type ButtonVariant,
  textButton,
} from '../../../../shared/page/ui/button';
import { chip } from '../../../../shared/page/ui/chip';
import { iconButton } from '../../../../shared/page/ui/icon-button';
import { keyStack } from '../../../../shared/page/ui/key-anchors';
import { qualify } from '../../../../shared/plugin-manifests';
import type { KeysPageExports } from '../../../keys/contract';
import defaultLayout from '../../layouts/default/layout.js';
import type {
  CompleteLayout,
  ConfirmAction,
  ImagesInput,
  Layout,
  MarkupColour,
  MarkupCommand,
  MarkupKit,
  MarkupTool,
  NoteAction,
  NoteField,
  NoteImageInput,
  NoteRowInput,
  NotesKit,
  NotesPart,
  PickerRowInput,
  SessionInput,
  TagsInput,
  TargetInput,
} from '../../layouts/layout';
import { notesManifest } from '../../manifest';

const PLUGIN_ID = 'notes';
const DEFAULT_LAYOUT = 'default';

type NotesScope = keyof typeof notesManifest.scopes & string;
type NotesCommand = keyof typeof notesManifest.commands & string;

interface ActionButton<A extends NotesCommand> {
  action: A;
  label: string;
  variant: ButtonVariant;
  // The scopes its key fires in, when more than the part's own: one anchor
  // each, stacked in one place.
  hintScopes?: readonly NotesScope[];
}

const POPUP_ACTIONS: readonly ActionButton<NoteAction>[] = [
  { action: 'discard', label: 'Discard', variant: 'ghost' },
  {
    action: 'appendFollowup',
    label: 'Append to follow-up',
    variant: 'secondary',
  },
  { action: 'sendSession', label: 'Start session', variant: 'secondary' },
  {
    action: 'sendFollowup',
    label: 'Add follow-up',
    variant: 'primary',
    hintScopes: ['popup', 'title'],
  },
];

const CONFIRM_ACTIONS: readonly ActionButton<ConfirmAction>[] = [
  { action: 'confirmNo', label: 'Keep', variant: 'secondary' },
  { action: 'confirmYes', label: 'Discard', variant: 'danger' },
];

// The command each field row names at its end, acting on that field from
// any row.
const ROW_COMMANDS: Partial<Record<NoteField, NotesCommand>> = {
  target: 'pickTarget',
  tags: 'pickTags',
  session: 'pickSession',
};

// The markup colours in the order `c` steps through them, each the theme
// token `--wg-notes-markup-<name>`.
export const MARKUP_COLOURS: readonly MarkupColour[] = [
  'red',
  'yellow',
  'green',
  'blue',
];

const COLOUR_LABELS: Record<MarkupColour, string> = {
  red: 'Red',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
};

const MARKUP_TOOLS: readonly {
  tool: MarkupTool;
  label: string;
  command: NotesCommand;
}[] = [
  { tool: 'select', label: 'Select', command: 'toolSelect' },
  { tool: 'pen', label: 'Pen', command: 'toolPen' },
  { tool: 'text', label: 'Text', command: 'toolText' },
  { tool: 'arrow', label: 'Arrow', command: 'toolArrow' },
  { tool: 'box', label: 'Box', command: 'toolBox' },
];

const MARKUP_COMMANDS: readonly { command: MarkupCommand; label: string }[] = [
  { command: 'undo', label: 'Undo' },
  { command: 'redo', label: 'Redo' },
  { command: 'closeMarkup', label: 'Done' },
];

// What every notes part draw reads: the page services and the keys export.
export interface NotesPartsDeps {
  markdown: MarkdownRenderer;
  keys: Pick<KeysPageExports, 'anchor' | 'keysFor'>;
  commands: KitCommands;
  platform: Platform;
  log: Log;
}

// The image entries the `images` part draws, by position from 1, and the
// removal of one by its index from 0.
export interface ImageEntries {
  imageAt(position: number): NoteImageInput | undefined;
  removeImageAt(index: number): void;
}

// A drawn row and the value slot the app fills.
export interface DrawnRow {
  element: HTMLElement;
  slot: HTMLElement;
}

// A drawn markup toolbar and the tool and colour buttons it holds, which the
// markup view marks `is-active`.
export interface DrawnToolbar {
  element: HTMLElement;
  tools: { tool: MarkupTool; node: HTMLElement }[];
  colours: { colour: MarkupColour; node: HTMLElement }[];
}

// The list picker's row of one item: the app's trailing element and where
// the row's key anchors go.
export interface PickerRowSlot {
  trailing: HTMLElement | null;
  recordAnchor: RollbackDeps['recordAnchor'];
}

// The notes parts drawn over the layout host, with `default` alone until the
// first `setLayouts`. Every draw but `pickerRow` keeps the dispose of the
// part's last draw, and disposes it and removes that draw's root before it
// draws the same part again, so a part holds one set of key anchors however
// often it draws. A `pickerRow` draw hands its anchors to the picker, which
// disposes them.
export interface NotesParts {
  setLayouts(shown: ShownLayouts<Layout>): void;
  // The field's row, appended to `parent`, with `box` (the title or body
  // frame, else null) moved into its value slot.
  row(
    parent: HTMLElement,
    input: NoteRowInput,
    box: HTMLElement | null,
  ): DrawnRow;
  target(slot: HTMLElement, input: TargetInput): HTMLElement;
  tags(slot: HTMLElement, input: TagsInput): HTMLElement;
  images(
    slot: HTMLElement,
    input: ImagesInput,
    entries: ImageEntries,
  ): HTMLElement;
  session(
    slot: HTMLElement,
    input: SessionInput,
    removeSession: () => void,
  ): HTMLElement;
  actions(parent: HTMLElement): HTMLElement;
  confirm(parent: HTMLElement): HTMLElement;
  markupToolbar(
    parent: HTMLElement,
    pickColour: (colour: MarkupColour) => void,
  ): DrawnToolbar;
  pickerRow(
    list: HTMLElement,
    input: PickerRowInput,
    row: PickerRowSlot,
  ): HTMLElement;
}

export function createNotesParts(deps: NotesPartsDeps): NotesParts {
  let shown: ShownLayouts<Layout> = {
    layouts: new Map<string, Layout>([[DEFAULT_LAYOUT, defaultLayout]]),
    user: DEFAULT_LAYOUT,
  };
  // The last draw of each part, by part key.
  const draws = new Map<string, DrawnPart<{ element: HTMLElement }>>();

  const redraw = <R extends { element: HTMLElement }>(
    key: string,
    draw: () => DrawnPart<R>,
  ): R => {
    const last = draws.get(key);
    last?.dispose();
    last?.built.element.remove();
    const next = draw();
    draws.set(key, next);
    return next.built;
  };

  // Draws `part` into `parent` with the first of the user's layout and
  // `default` that defines it.
  const drawLayoutPart = <
    P extends keyof CompleteLayout,
    R extends { element: HTMLElement },
  >(
    part: P,
    parent: HTMLElement,
    build: (
      builder: CompleteLayout[P],
      into: HTMLElement,
      rollback: RollbackDeps,
    ) => R,
  ): DrawnPart<R> =>
    drawPart<Layout, CompleteLayout[P], R>({
      owner: PLUGIN_ID,
      parent,
      pick: pickLayout(
        [shown.user, DEFAULT_LAYOUT],
        shown.layouts,
        (layout) => layout[part] !== undefined,
      ),
      defaultLayout,
      // TypeScript cannot relate an optional part to the complete one.
      part: (layout) => layout[part] as CompleteLayout[P] | undefined,
      build,
      log: deps.log,
      logSource: PLUGIN_ID,
      partName: part,
    });

  const valuePart = <P extends 'target' | 'tags' | 'images' | 'session'>(
    part: P,
    slot: HTMLElement,
    build: (
      builder: CompleteLayout[P],
      into: HTMLElement,
      kit: NotesKit,
      rollback: RollbackDeps,
    ) => NotesPart,
  ): HTMLElement =>
    redraw(part, () =>
      drawLayoutPart(part, slot, (builder, into, rollback) =>
        build(builder, into, kitFor(deps, 'popup', rollback), rollback),
      ),
    ).element;

  return {
    setLayouts(next) {
      shown = next;
    },
    row(parent, input, box) {
      return redraw(`row:${input.field}`, () =>
        drawLayoutPart('row', parent, (row, into, rollback) => {
          const base = kitFor(deps, 'popup', rollback);
          const slots: HTMLElement[] = [];
          const command = ROW_COMMANDS[input.field];
          const root = partRoot(
            into,
            row(into, input, {
              ...base,
              valueSlot(slotParent) {
                const slot = base.el(slotParent, 'div', 'notes-row-value');
                slots.push(slot);
                return slot;
              },
              pickHint: (hintParent) =>
                command === undefined
                  ? base.el(hintParent, 'span')
                  : base.keyHint(hintParent, command, {
                      className: 'notes-hint',
                      label: 'pick',
                    }),
            }),
            'row',
          );
          const slot = slots[0] ?? base.el(root, 'div', 'notes-row-value');
          if (box !== null) {
            slot.append(box);
          }
          return { element: root, slot };
        }),
      );
    },
    target: (slot, input) =>
      valuePart('target', slot, (target, into, kit) =>
        target(into, input, kit),
      ),
    tags: (slot, input) =>
      valuePart('tags', slot, (tags, into, kit) => tags(into, input, kit)),
    images: (slot, input, entries) =>
      valuePart('images', slot, (images, into, kit, rollback) =>
        images(into, input, {
          ...kit,
          image(parent, position) {
            const held = entries.imageAt(position);
            if (held === undefined) {
              throw new Error(`no image ${position}`);
            }
            const drawn = drawLayoutPart(
              'image',
              parent,
              (image, imageInto, imageRollback) => {
                const imageKit = kitFor(deps, 'popup', imageRollback);
                return image(imageInto, held, {
                  ...imageKit,
                  removeButton: (buttonParent) =>
                    appended(
                      buttonParent,
                      removeButton(
                        'Remove the image',
                        'notes-image-remove',
                        () => entries.removeImageAt(position - 1),
                      ),
                    ),
                });
              },
            );
            rollback.recordBox(drawn.dispose);
            return drawn.built.element;
          },
        }),
      ),
    session: (slot, input, removeSession) =>
      valuePart('session', slot, (session, into, kit) =>
        session(into, input, {
          ...kit,
          sessionChip(parent, text) {
            const shownChip = chip(text, '', () =>
              deps.commands.run(qualify(PLUGIN_ID, 'pickSession')),
            );
            shownChip.title = text;
            shownChip.classList.add('notes-session');
            return appended(parent, shownChip);
          },
          removeButton: (parent) =>
            appended(
              parent,
              removeButton('Remove the session', '', removeSession),
            ),
        }),
      ),
    actions: (parent) =>
      redraw('actions', () =>
        drawLayoutPart('actions', parent, (actions, into, rollback) =>
          withActionButtons(
            deps,
            'popup',
            POPUP_ACTIONS,
            rollback,
            into,
            'actions',
            (kit, button) => actions(into, { ...kit, actionButton: button }),
          ),
        ),
      ).element,
    confirm: (parent) =>
      redraw('confirm', () =>
        drawLayoutPart('confirm', parent, (confirm, into, rollback) =>
          withActionButtons(
            deps,
            'confirm',
            CONFIRM_ACTIONS,
            rollback,
            into,
            'confirm',
            (kit, button) => confirm(into, { ...kit, actionButton: button }),
          ),
        ),
      ).element,
    markupToolbar: (parent, pickColour) =>
      redraw('markupToolbar', () =>
        drawLayoutPart('markupToolbar', parent, (toolbar, into, rollback) =>
          drawToolbar(deps, rollback, into, pickColour, (kit) =>
            toolbar(into, kit),
          ),
        ),
      ),
    pickerRow: (list, input, row) =>
      drawLayoutPart('pickerRow', list, (pickerRow, into, rollback) => {
        const kit = kitFor(deps, 'picker', {
          recordBox: rollback.recordBox,
          recordAnchor(anchor) {
            rollback.recordAnchor(anchor);
            row.recordAnchor(anchor);
          },
        });
        const root = partRoot(
          into,
          pickerRow(into, input, { ...kit, trailing: () => row.trailing }),
          'pickerRow',
        );
        if (row.trailing !== null && !root.contains(row.trailing)) {
          root.append(row.trailing);
        }
        return { element: root };
      }).built.element,
  };
}

// The keys a part draw names its anchors through: each anchor is recorded
// through `rollback`, so the draw's dispose disposes it.
function recordingKeys(
  keys: NotesPartsDeps['keys'],
  rollback: RollbackDeps,
): BaseKitDeps['keys'] {
  return {
    anchor(target, command, options) {
      const anchor = keys.anchor(target, command, options);
      rollback.recordAnchor(anchor);
      return anchor;
    },
    keysFor: (command, scope) => keys.keysFor(command, scope),
  };
}

// The base kit of one part draw, its keys in `notes.<scope>`.
function kitFor(
  deps: NotesPartsDeps,
  scope: NotesScope,
  rollback: RollbackDeps,
): BaseKit {
  return createBaseKit({
    markdown: deps.markdown,
    keys: recordingKeys(deps.keys, rollback),
    commands: deps.commands,
    scope: qualify(PLUGIN_ID, scope),
    commandNamed: (short) =>
      Object.hasOwn(notesManifest.commands, short)
        ? qualify(PLUGIN_ID, short)
        : null,
    platform: deps.platform,
  });
}

// `span.notes-hint`: the anchor of `command`'s keys in `notes.<scope>`,
// recorded through `rollback`.
function hint(
  deps: NotesPartsDeps,
  rollback: RollbackDeps,
  command: NotesCommand,
  scope: NotesScope,
): HTMLElement {
  const node = element('span', 'notes-hint');
  recordingKeys(deps.keys, rollback).anchor(node, qualify(PLUGIN_ID, command), {
    scope: qualify(PLUGIN_ID, scope),
  });
  return node;
}

// The element a part returned, checked as the host checks it, so the app can
// append what the part left out.
function partRoot(
  parent: HTMLElement,
  part: NotesPart,
  partName: string,
): HTMLElement {
  return requireElementIn(
    parent,
    (part as Partial<NotesPart> | null | undefined)?.element,
    partName,
  );
}

function appended<E extends HTMLElement>(parent: HTMLElement, node: E): E {
  parent.append(node);
  return node;
}

function removeButton(
  label: string,
  className: string,
  onClick: () => void,
): HTMLButtonElement {
  const node = iconButton('close', label, onClick, 'sm');
  if (className !== '') {
    node.classList.add(className);
  }
  return node;
}

// Draws a part of action buttons through `draw`, then appends each button of
// `actions` it left out, in order, at the end of its root.
function withActionButtons<A extends NotesCommand>(
  deps: NotesPartsDeps,
  scope: NotesScope,
  actions: readonly ActionButton<A>[],
  rollback: RollbackDeps,
  parent: HTMLElement,
  partName: string,
  draw: (
    kit: BaseKit,
    button: (buttonParent: HTMLElement, action: A) => HTMLButtonElement,
  ) => NotesPart,
): NotesPart {
  const drawn = new Set<A>();
  const button = (buttonParent: HTMLElement, action: A) => {
    const entry = actions.find((each) => each.action === action);
    if (entry === undefined) {
      throw new Error(`no ${partName} button ${action}`);
    }
    drawn.add(action);
    return appended(buttonParent, actionButton(deps, rollback, entry, scope));
  };
  const root = partRoot(
    parent,
    draw(kitFor(deps, scope, rollback), button),
    partName,
  );
  for (const entry of actions) {
    if (!drawn.has(entry.action)) {
      button(root, entry.action);
    }
  }
  return { element: root };
}

// The action's button, its key drawn inside it while a scope it fires in is
// in force; it runs `notes.<action>` on click.
function actionButton<A extends NotesCommand>(
  deps: NotesPartsDeps,
  rollback: RollbackDeps,
  entry: ActionButton<A>,
  scope: NotesScope,
): HTMLButtonElement {
  const keys =
    entry.hintScopes === undefined
      ? hint(deps, rollback, entry.action, scope)
      : keyStack(
          'notes-hint-stack',
          entry.hintScopes.map((hintScope) =>
            hint(deps, rollback, entry.action, hintScope),
          ),
        );
  return textButton(
    entry.label,
    () => deps.commands.run(qualify(PLUGIN_ID, entry.action)),
    { variant: entry.variant, hint: keys },
  );
}

// Draws the markup toolbar through `draw`, then appends each tool button,
// colour button, the colour keys and each command button it left out, in
// that order, at the end of its root.
function drawToolbar(
  deps: NotesPartsDeps,
  rollback: RollbackDeps,
  parent: HTMLElement,
  pickColour: (colour: MarkupColour) => void,
  draw: (kit: MarkupKit) => NotesPart,
): DrawnToolbar {
  const base = kitFor(deps, 'markup', rollback);
  const tools: DrawnToolbar['tools'] = [];
  const colours: DrawnToolbar['colours'] = [];
  const commands = new Set<MarkupCommand>();
  let hasColourKeys = false;
  const commandButton = (label: string, command: NotesCommand) =>
    textButton(label, () => deps.commands.run(qualify(PLUGIN_ID, command)), {
      variant: 'ghost',
      hint: hint(deps, rollback, command, 'markup'),
    });
  const kit: MarkupKit = {
    ...base,
    toolButton(buttonParent, tool) {
      const entry = MARKUP_TOOLS.find((each) => each.tool === tool);
      if (entry === undefined) {
        throw new Error(`no markup tool ${tool}`);
      }
      const node = commandButton(entry.label, entry.command);
      tools.push({ tool, node });
      return appended(buttonParent, node);
    },
    colourButton(buttonParent, colour) {
      if (!Object.hasOwn(COLOUR_LABELS, colour)) {
        throw new Error(`no markup colour ${colour}`);
      }
      const node = textButton(COLOUR_LABELS[colour], () => pickColour(colour), {
        variant: 'ghost',
      });
      node.classList.add('notes-colour');
      node.prepend(element('span', `notes-swatch notes-swatch--${colour}`));
      colours.push({ colour, node });
      return appended(buttonParent, node);
    },
    colourKeys(keysParent) {
      const node = base.el(keysParent, 'span', 'notes-markup-keys');
      node.append(
        hint(deps, rollback, 'nextColour', 'markup'),
        hint(deps, rollback, 'prevColour', 'markup'),
      );
      hasColourKeys = true;
      return node;
    },
    commandButton(buttonParent, command) {
      const entry = MARKUP_COMMANDS.find((each) => each.command === command);
      if (entry === undefined) {
        throw new Error(`no markup command ${command}`);
      }
      commands.add(command);
      return appended(buttonParent, commandButton(entry.label, command));
    },
  };
  const root = partRoot(parent, draw(kit), 'markupToolbar');
  for (const { tool } of MARKUP_TOOLS) {
    if (!tools.some((each) => each.tool === tool)) {
      kit.toolButton(root, tool);
    }
  }
  for (const colour of MARKUP_COLOURS) {
    if (!colours.some((each) => each.colour === colour)) {
      kit.colourButton(root, colour);
    }
  }
  if (!hasColourKeys) {
    kit.colourKeys(root);
  }
  for (const { command } of MARKUP_COMMANDS) {
    if (!commands.has(command)) {
      kit.commandButton(root, command);
    }
  }
  return { element: root, tools, colours };
}
