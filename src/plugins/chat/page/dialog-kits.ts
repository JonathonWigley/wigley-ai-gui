import type { CommandId } from '../../../contracts/commands';
import type { PluginLog } from '../../../contracts/log';
import { appended, element } from '../../../shared/page/dom';
import { appSlot } from '../../../shared/page/layout-host/app-slot';
import {
  type DrawnPart,
  type RollbackDeps,
  requireElementIn,
} from '../../../shared/page/layout-host/draw-part';
import type { BaseKit } from '../../../shared/page/layout-host/kit';
import { type ButtonVariant, textButton } from '../../../shared/page/ui/button';
import type { KeyHints } from '../../../contracts/plugin';
import {
  type ChatCommandName,
  type ChatScopeName,
  chatCommand,
  chatScope,
} from '../ids';
import type {
  CloseConfirmInput,
  CloseConfirmKit,
  CompleteChatLayout,
  ImageViewerInput,
  PartView,
  ReasonBoxInput,
  ReasonBoxKit,
  SignInInput,
  SignInKit,
} from '../layouts/layout';
import {
  type ChatLayouts,
  type ChatPartName,
  chatPartDraws,
  type SurfaceKitDeps,
  surfaceBaseKit,
} from './chat-layouts';

// One action button of a dialog: its label, look, and the command it runs,
// whose keys in `scope` it shows.
export interface DialogAction {
  label: string;
  variant: ButtonVariant;
  command: ChatCommandName;
  scope: ChatScopeName;
}

// `div.ui-dialog-actions` holding one button per action, each running its
// command with its keys anchored in the action's scope for as long as the
// page lives. A dialog builds it once; its part places it.
export function dialogActions(
  actions: readonly DialogAction[],
  deps: {
    keys: Pick<KeyHints, 'anchor'>;
    run(command: CommandId): void;
  },
): HTMLElement {
  const row = element('div', 'ui-dialog-actions');
  row.append(
    ...actions.map((action) => {
      const hint = element('span', 'chat-dialog-key');
      deps.keys.anchor(hint, chatCommand(action.command), {
        scope: chatScope(action.scope),
      });
      return textButton(
        action.label,
        () => deps.run(chatCommand(action.command)),
        { variant: action.variant, hint },
      );
    }),
  );
  return row;
}

export interface DialogPartDeps extends SurfaceKitDeps {
  layouts: ChatLayouts;
  log: PluginLog;
}

// One dialog's part, drawn into `parent()` (the dialog's body, or the image
// viewer's scrim), read on each `clear` and `draw`: a frame redraw replaces the
// dialog's body. `draw` replaces the last draw, disposing it; `update` runs
// the drawn view's update, else draws again, with `default` once the update
// threw until the layouts change; `redraw` draws the last input again while a
// draw is held; `clear` disposes the draw and empties `parent()`.
export interface DialogPart<I> {
  draw(input: I): void;
  update(input: I): void;
  redraw(): void;
  clear(): void;
}

// Builds the part's kit for one attempt; `finish` runs on the part's root
// once the builder returned it.
interface PartKit<K> {
  kit: K;
  finish(root: HTMLElement): void;
}

// The dialog part `partName` of the chat layout, its builder taking input `I`
// and kit `K`.
type DialogPartName<I, K> = {
  [P in ChatPartName]: CompleteChatLayout[P] extends (
    parent: HTMLElement,
    input: I,
    kit: K,
  ) => PartView<I>
    ? P
    : never;
}[ChatPartName];

function createDialogPart<I, K>(
  deps: DialogPartDeps,
  parent: () => HTMLElement,
  partName: DialogPartName<I, K>,
  kitFor: (rollback: RollbackDeps) => PartKit<K>,
): DialogPart<I> {
  const draws = chatPartDraws(deps.layouts, partName, deps.log);
  let drawn: DrawnPart<{ element: HTMLElement; view: PartView<I> }> | null =
    null;
  let current: I | null = null;
  const clear = () => {
    drawn?.dispose();
    drawn = null;
    parent().replaceChildren();
  };
  const draw = (input: I) => {
    clear();
    current = input;
    drawn = draws.draw(parent(), (builder, at, rollback) => {
      const { kit, finish } = kitFor(rollback);
      // TypeScript cannot resolve the builder of a generic part name.
      const build = builder as (
        parent: HTMLElement,
        input: I,
        kit: K,
      ) => PartView<I>;
      const view = build(at, input, kit);
      const root = requireElementIn(at, view.element, partName);
      finish(root);
      return { element: root, view };
    });
  };
  return {
    draw,
    update(input) {
      current = input;
      if (drawn === null || draws.update(drawn, input) !== 'ran') {
        draw(input);
      }
    },
    redraw() {
      if (drawn !== null && current !== null) {
        draw(current);
      }
    },
    clear,
  };
}

// The sign-in dialog's own pieces: the code box frame its editor is mounted
// in, Copy and the actions, each built once.
export interface SignInPieces {
  codeBox: HTMLElement;
  copy: HTMLButtonElement;
  actions: HTMLElement;
}

export function createSignInPart(
  deps: DialogPartDeps,
  body: () => HTMLElement,
  pieces: SignInPieces,
): DialogPart<SignInInput> {
  return createDialogPart<SignInInput, SignInKit>(
    deps,
    body,
    'signIn',
    (rollback) => {
      const codeBox = appSlot(pieces.codeBox, 'codeBox', rollback);
      const actions = appSlot(pieces.actions, 'actions', rollback);
      return {
        kit: {
          ...surfaceBaseKit(deps, 'signIn', rollback),
          copyButton: (parent) => appended(parent, pieces.copy),
          codeBox: (parent) => codeBox.place(parent),
          actions: (parent) => actions.place(parent),
        },
        finish(root) {
          codeBox.placeIfLeftOut(root);
          actions.placeIfLeftOut(root);
        },
      };
    },
  );
}

// The deny reason dialog's own pieces: the reason box frame its editor is
// mounted in, and the actions, each built once.
export interface ReasonBoxPieces {
  reasonBox: HTMLElement;
  actions: HTMLElement;
}

export function createReasonBoxPart(
  deps: DialogPartDeps,
  body: () => HTMLElement,
  pieces: ReasonBoxPieces,
): DialogPart<ReasonBoxInput> {
  return createDialogPart<ReasonBoxInput, ReasonBoxKit>(
    deps,
    body,
    'reasonBox',
    (rollback) => {
      const reasonBox = appSlot(pieces.reasonBox, 'reasonBox', rollback);
      const actions = appSlot(pieces.actions, 'actions', rollback);
      return {
        kit: {
          ...surfaceBaseKit(deps, 'reason', rollback),
          reasonBox: (parent) => reasonBox.place(parent),
          actions: (parent) => actions.place(parent),
        },
        finish(root) {
          reasonBox.placeIfLeftOut(root);
          actions.placeIfLeftOut(root);
        },
      };
    },
  );
}

export function createCloseConfirmPart(
  deps: DialogPartDeps,
  body: () => HTMLElement,
  pieces: { actions: HTMLElement },
): DialogPart<CloseConfirmInput> {
  return createDialogPart<CloseConfirmInput, CloseConfirmKit>(
    deps,
    body,
    'closeConfirm',
    (rollback) => {
      const actions = appSlot(pieces.actions, 'actions', rollback);
      return {
        kit: {
          ...surfaceBaseKit(deps, 'confirm', rollback),
          actions: (parent) => actions.place(parent),
        },
        finish: (root) => actions.placeIfLeftOut(root),
      };
    },
  );
}

export function createImageViewerPart(
  deps: DialogPartDeps,
  scrim: () => HTMLElement,
): DialogPart<ImageViewerInput> {
  return createDialogPart<ImageViewerInput, BaseKit>(
    deps,
    scrim,
    'imageViewer',
    (rollback) => ({
      kit: surfaceBaseKit(deps, 'image', rollback),
      finish: () => undefined,
    }),
  );
}
