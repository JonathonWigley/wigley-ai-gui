import type { ChatImage } from '../../../contracts/agent';
import type { CommandId } from '../../../contracts/commands';
import type { Disposable } from '../../../contracts/disposable';
import type { Log } from '../../../contracts/log';
import {
  type ContributedPartsPlace,
  type PartStore,
  placeContributedParts,
} from '../../../shared/page/contributed-parts';
import { appended, element } from '../../../shared/page/dom';
import { appSlot } from '../../../shared/page/layout-host/app-slot';
import {
  type DrawnPart,
  requireElementIn,
} from '../../../shared/page/layout-host/draw-part';
import type { BaseKit } from '../../../shared/page/layout-host/kit';
import { textButton } from '../../../shared/page/ui/button';
import { chip } from '../../../shared/page/ui/chip';
import { floatingPanel } from '../../../shared/page/ui/floating-panel';
import { iconButton } from '../../../shared/page/ui/icon-button';
import { disposeAnchors } from '../../../shared/page/ui/key-anchors';
import { statusDot } from '../../../shared/page/ui/status-dot';
import type { ChatComposerPart } from '../contract';
import { type ChatCommandName, chatCommand, chatScope } from '../ids';
import type {
  AttachmentsInput,
  AttachmentsKit,
  ComposerBarKit,
  ComposerInput,
  ComposerKit,
  PartView,
} from '../layouts/layout';
import { imageUrl } from './attachments';
import {
  type ChatLayouts,
  chatPartDraws,
  type SurfaceKitDeps,
  surfaceBaseKit,
} from './chat-layouts';
import { chipKeyCommands } from './composer-input';
import { controlCommand } from './control-commands';

// `run` runs a command, as the chips and Send do; `composerParts` holds the
// parts other plugins added above every composer.
export interface ComposerSurfaceDeps extends SurfaceKitDeps {
  layouts: ChatLayouts;
  run(command: CommandId): void;
  composerParts: Pick<PartStore<ChatComposerPart>, 'parts'>;
  log: Log;
}

// One Chat tab's app-owned pieces: the session whose parts the composer
// draws, the message box frame its editor is mounted in, and the removal of
// an attached image.
export interface ComposerPieces {
  sessionId: string;
  box: HTMLElement;
  removeImage(index: number): void;
}

// One Chat tab's composer, drawn through the chat layout. The box, the
// attachments and bar slots, and the bar's key-holding parts are built once
// and placed again by each draw; other plugins' composer parts are built
// again by each composer draw.
export interface ComposerSurface {
  // Draws the composer into `parent` in place of its last draw, then the bar
  // with `input` and the last attached images; returns the composer's root.
  drawComposer(parent: HTMLElement, input: ComposerInput): HTMLElement;
  // Runs the composer's update with `input`, then draws the bar with it in
  // place of its last draw. Returns false, drawing no bar, when the update
  // threw: the composer then draws with `default` until the layouts change,
  // and the caller draws it again.
  drawBar(input: ComposerInput): boolean;
  // Draws the attachments in place of their last draw; the slot hides while
  // `images` is empty.
  drawAttachments(images: readonly ChatImage[]): void;
  // Disposes every draw and the bar's anchors.
  dispose(): void;
}

interface BuiltPart<I> {
  element: HTMLElement;
  view: PartView<I>;
}

// The bar's parts holding keys, each anchored once in `chat.chat`: the type
// hint (`i` and `a`), the running indicator (dot and interrupt keys), Send,
// and a key span per pick command, which the first chip running it holds.
interface BarParts {
  typeHint: HTMLElement;
  running: HTMLElement;
  send: HTMLButtonElement;
  chipKeys: ReadonlyMap<ChatCommandName, HTMLElement>;
  anchors: Disposable[];
}

const CHIP_COMMANDS = [
  'pickMode',
  'pickEffort',
  'pickModel',
  'pickControl',
] as const;

export function createComposerSurface(
  deps: ComposerSurfaceDeps,
  pieces: ComposerPieces,
): ComposerSurface {
  const attachmentsSlot = element('div', 'chat-attachments-slot');
  attachmentsSlot.hidden = true;
  const barSlot = element('div', 'chat-composer-bar-slot');
  const parts = createBarParts(deps);
  const composerDraws = chatPartDraws(deps.layouts, 'composer', deps.log);
  const barDraws = chatPartDraws(deps.layouts, 'composerBar', deps.log);
  const attachmentsDraws = chatPartDraws(deps.layouts, 'attachments', deps.log);
  let composer: DrawnPart<BuiltPart<ComposerInput>> | null = null;
  let bar: DrawnPart<BuiltPart<ComposerInput>> | null = null;
  let attachments: DrawnPart<BuiltPart<AttachmentsInput>> | null = null;
  let images: readonly ChatImage[] = [];

  const surface: ComposerSurface = {
    drawComposer(parent, input) {
      composer?.dispose();
      composer?.built.element.remove();
      composer = composerDraws.draw(parent, (builder, at, rollback) => {
        const box = appSlot(pieces.box, 'box', rollback);
        const attachmentsAt = appSlot(attachmentsSlot, 'attachments', rollback);
        const barAt = appSlot(barSlot, 'bar', rollback);
        let arePartsPlaced = false;
        const kit: ComposerKit = {
          ...surfaceBaseKit(deps, 'chat', rollback),
          floatingPanel: (panelParent) =>
            appended(panelParent, floatingPanel()),
          box: (boxParent) => box.place(boxParent),
          attachments: (slotParent) => attachmentsAt.place(slotParent),
          bar: (slotParent) => barAt.place(slotParent),
          contributedParts(partsParent) {
            if (arePartsPlaced) {
              throw new Error('composer placed contributed parts twice');
            }
            arePartsPlaced = true;
            return placeContributedParts(
              partsParent,
              pieces.sessionId,
              deps.composerParts.parts(),
              COMPOSER_PARTS,
              deps.log,
              rollback,
            );
          },
        };
        const view = builder(at, input, kit);
        const root = requireElementIn(at, view.element, 'composer');
        if (!arePartsPlaced && deps.composerParts.parts().length > 0) {
          root.prepend(kit.contributedParts(root));
        }
        box.placeIfLeftOut(root);
        return { element: root, view };
      });
      drawBarPart(input);
      surface.drawAttachments(images);
      return composer.built.element;
    },
    drawBar(input) {
      const isComposerStale =
        composer !== null && composerDraws.update(composer, input) === 'threw';
      if (isComposerStale) {
        return false;
      }
      drawBarPart(input);
      return true;
    },
    drawAttachments(next) {
      images = next;
      attachmentsSlot.hidden = next.length === 0;
      attachments?.dispose();
      attachmentsSlot.replaceChildren();
      const input: AttachmentsInput = {
        images: next.map((image, index) => ({
          src: imageUrl(image),
          index,
          count: next.length,
        })),
      };
      attachments = attachmentsDraws.draw(
        attachmentsSlot,
        (builder, at, rollback) => {
          const kit: AttachmentsKit = {
            ...surfaceBaseKit(deps, 'chat', rollback),
            removeButton(buttonParent, index) {
              const remove = iconButton(
                'close',
                'Remove the image',
                () => pieces.removeImage(index),
                'sm',
              );
              remove.classList.add('chat-attachment-remove');
              return appended(buttonParent, remove);
            },
          };
          const view = builder(at, input, kit);
          return { element: view.element, view };
        },
      );
    },
    dispose() {
      composer?.dispose();
      bar?.dispose();
      attachments?.dispose();
      disposeAnchors(parts.anchors);
    },
  };

  const drawBarPart = (input: ComposerInput) => {
    bar?.dispose();
    barSlot.replaceChildren();
    bar = barDraws.draw(barSlot, (builder, at, rollback) => {
      const kit = composerBarKit(
        surfaceBaseKit(deps, 'chat', rollback),
        parts,
        input,
        deps.run,
      );
      const view = builder(at, input, kit);
      return { element: view.element, view };
    });
  };

  return surface;
}

const COMPOSER_PARTS: ContributedPartsPlace = {
  owner: 'chat',
  noun: 'composer part',
  holderClass: 'chat-composer-parts',
  wrapperClass: 'chat-composer-part',
};

function createBarParts(
  deps: Pick<ComposerSurfaceDeps, 'keys' | 'run'>,
): BarParts {
  const typeKey = element('span', 'chat-type-key');
  const appendKey = element('span', 'chat-type-key');
  const typeHint = element('span', 'chat-type-hint');
  typeHint.append(typeKey, appendKey);
  const interruptKey = element('span', 'chat-running-key');
  const running = element('span', 'chat-running');
  running.append(statusDot('running'), interruptKey);
  const sendKey = element('span', 'chat-send-key');
  const send = textButton('Send', () => deps.run(chatCommand('send')), {
    variant: 'ghost',
    hint: sendKey,
  });

  const scope = { scope: chatScope('chat') };
  const anchors = [
    deps.keys.anchor(interruptKey, chatCommand('interrupt'), {
      ...scope,
      label: 'stop',
    }),
    deps.keys.anchor(typeKey, chatCommand('focusBox'), {
      ...scope,
      label: 'to type',
    }),
    deps.keys.anchor(appendKey, chatCommand('appendBox'), {
      ...scope,
      label: 'to append',
    }),
    deps.keys.anchor(sendKey, chatCommand('send'), scope),
  ];
  const chipKeys = new Map<ChatCommandName, HTMLElement>();
  for (const command of CHIP_COMMANDS) {
    const key = element('span', 'chat-chip-key');
    chipKeys.set(command, key);
    anchors.push(deps.keys.anchor(key, chatCommand(command), scope));
  }
  return { typeHint, running, send, chipKeys, anchors };
}

// The bar's kit for one draw: each key-holding part places the tab's own
// element, shown for `input`; a chip holds its command's keys when
// `chipKeyCommands` gives them to its control.
function composerBarKit(
  base: BaseKit,
  parts: BarParts,
  input: ComposerInput,
  run: (command: CommandId) => void,
): ComposerBarKit {
  const keyCommands = chipKeyCommands(input.controls);
  return {
    ...base,
    typeHint(parent) {
      parts.typeHint.classList.toggle('is-box-focused', input.isBoxFocused);
      return appended(parent, parts.typeHint);
    },
    controlChip(parent, control) {
      const command = controlCommand(control.id);
      const controlChip = chip(control.label, control.value, () =>
        run(chatCommand(command)),
      ) as HTMLButtonElement;
      controlChip.disabled = !control.enabled;
      const index = input.controls.findIndex((held) => held.id === control.id);
      const keyed = index === -1 ? null : keyCommands[index];
      const key = keyed === null ? undefined : parts.chipKeys.get(keyed);
      if (key !== undefined) {
        controlChip.append(key);
      }
      return appended(parent, controlChip);
    },
    running(parent) {
      parts.running.classList.toggle('is-idle', !input.working);
      return appended(parent, parts.running);
    },
    sendButton: (parent) => appended(parent, parts.send),
  };
}
