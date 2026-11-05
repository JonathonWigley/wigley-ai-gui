import type { PluginLog } from '../../../../contracts/log';
import type { ShownLayouts } from '../../../../contracts/plugin';
import { appended, element } from '../../../../shared/page/dom';
import type { DrawnPickerRow } from '../../../../contracts/list-picker';
import { appSlot } from '../../../../shared/page/layout-host/app-slot';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import {
  requireElementIn,
  type RollbackDeps,
} from '../../../../shared/page/layout-host/draw-part';
import type { BaseKit } from '../../../../shared/page/layout-host/kit';
import { createLayoutParts } from '../../../../shared/page/layout-host/layout-parts';
import {
  type ButtonVariant,
  textButton,
} from '../../../../shared/page/ui/button';
import { chip } from '../../../../shared/page/ui/chip';
import { iconButton } from '../../../../shared/page/ui/icon-button';
import { keyStack } from '../../../../shared/page/ui/key-anchors';
import { qualify } from '../../../../shared/plugin-manifests';
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
export interface NotesPartsDeps extends OwnerKitServices {
  log: PluginLog;
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

// The notes parts drawn over the layout host, with `default` alone until the
// first `setLayouts`; the popup and its markup view draw through one. Every
// draw but `pickerRow` keeps the dispose of the part's last draw, and disposes
// it and removes that draw's root before it draws the same part again, so a
// part holds one set of key anchors however often it draws. A `pickerRow`
// draw hands its dispose to the picker.
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
  // Draws each image the layout's `images` left out at the end of its root.
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
  // `trailing` is the picker's element for the cursor row, else null.
  pickerRow(
    list: HTMLElement,
    input: PickerRowInput,
    trailing: HTMLElement | null,
  ): DrawnPickerRow;
}

export function createNotesParts(deps: NotesPartsDeps): NotesParts {
  const parts = createLayoutParts<Layout, CompleteLayout>({
    owner: PLUGIN_ID,
    defaultLayout,
    log: deps.log,
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
    parts.redraw(part, slot, (builder, into, rollback) =>
      build(builder, into, kitFor(deps, 'popup', rollback), rollback),
    ).built.element;

  return {
    setLayouts: (shown) => parts.setLayouts(shown),
    row: (parent, input, box) =>
      parts.redraw(
        'row',
        parent,
        (row, into, rollback) => {
          const base = kitFor(deps, 'popup', rollback);
          const slot = element('div', 'notes-row-value');
          const valueSlot = appSlot(slot, 'valueSlot', rollback);
          const command = ROW_COMMANDS[input.field];
          const root = partRoot(
            into,
            row(into, input, {
              ...base,
              valueSlot: (slotParent) => valueSlot.place(slotParent),
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
          valueSlot.placeIfLeftOut(root);
          if (box !== null) {
            slot.append(box);
          }
          return { element: root, slot };
        },
        `row:${input.field}`,
      ).built,
    target: (slot, input) =>
      valuePart('target', slot, (target, into, kit) =>
        target(into, input, kit),
      ),
    tags: (slot, input) =>
      valuePart('tags', slot, (tags, into, kit) => tags(into, input, kit)),
    images: (slot, input, entries) =>
      valuePart('images', slot, (images, into, kit, rollback) => {
        const drawnPositions = new Set<number>();
        const image = (parent: HTMLElement, position: number) => {
          const held = entries.imageAt(position);
          if (held === undefined) {
            throw new Error(`no image ${position}`);
          }
          const drawn = parts.draw(
            'image',
            parent,
            (imageBuilder, imageInto, imageRollback) =>
              imageBuilder(imageInto, held, {
                ...kitFor(deps, 'popup', imageRollback),
                removeButton: (buttonParent) =>
                  appended(
                    buttonParent,
                    removeButton('Remove the image', 'notes-image-remove', () =>
                      entries.removeImageAt(position - 1),
                    ),
                  ),
              }),
          );
          rollback.recordBox(drawn.dispose);
          drawnPositions.add(position);
          return drawn.built.element;
        };
        const root = partRoot(
          into,
          images(into, input, { ...kit, image }),
          'images',
        );
        for (let position = 1; position <= input.count; position += 1) {
          if (!drawnPositions.has(position)) {
            image(root, position);
          }
        }
        return { element: root };
      }),
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
      parts.redraw('actions', parent, (actions, into, rollback) =>
        withActionButtons(
          deps,
          'popup',
          POPUP_ACTIONS,
          rollback,
          into,
          'actions',
          (kit, button) => actions(into, { ...kit, actionButton: button }),
        ),
      ).built.element,
    confirm: (parent) =>
      parts.redraw('confirm', parent, (confirm, into, rollback) =>
        withActionButtons(
          deps,
          'confirm',
          CONFIRM_ACTIONS,
          rollback,
          into,
          'confirm',
          (kit, button) => confirm(into, { ...kit, actionButton: button }),
        ),
      ).built.element,
    markupToolbar: (parent, pickColour) =>
      parts.redraw('markupToolbar', parent, (toolbar, into, rollback) =>
        drawToolbar(deps, rollback, into, pickColour, (kit) =>
          toolbar(into, kit),
        ),
      ).built,
    pickerRow(list, input, trailing) {
      const drawn = parts.draw('pickerRow', list, (pickerRow, into, rollback) =>
        pickerRow(into, input, {
          ...kitFor(deps, 'picker', rollback),
          trailing: () => trailing,
        }),
      );
      return { element: drawn.built.element, dispose: drawn.dispose };
    },
  };
}

// The base kit of one part draw, its keys in `notes.<scope>` and each anchor
// recorded through `rollback`.
function kitFor(
  deps: NotesPartsDeps,
  scope: NotesScope,
  rollback: RollbackDeps,
): BaseKit {
  return createBaseKit(ownerBaseKitDeps(notesManifest, deps, scope, rollback));
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
  rollback.recordAnchor(
    deps.keys.anchor(node, qualify(PLUGIN_ID, command), {
      scope: qualify(PLUGIN_ID, scope),
    }),
  );
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
