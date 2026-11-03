import type { ChatEntry, ChatImage } from '../../../contracts/agent';
import type { Clock, Timers } from '../../../contracts/ambient';
import type { CommandId } from '../../../contracts/commands';
import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';
import {
  type ContributedPartsPlace,
  type PartStore,
  placeContributedParts,
} from '../../../shared/page/contributed-parts';
import { appended, element } from '../../../shared/page/dom';
import { appSlot } from '../../../shared/page/layout-host/app-slot';
import {
  type DrawnPart,
  type RollbackDeps,
  requireElementIn,
} from '../../../shared/page/layout-host/draw-part';
import type { BaseKit } from '../../../shared/page/layout-host/kit';
import { textButton } from '../../../shared/page/ui/button';
import { chip } from '../../../shared/page/ui/chip';
import { floatingPanel } from '../../../shared/page/ui/floating-panel';
import { iconButton } from '../../../shared/page/ui/icon-button';
import { disposeAnchors } from '../../../shared/page/ui/key-anchors';
import { statusDot } from '../../../shared/page/ui/status-dot';
import type { ChatComposerPart, ChatStatusPart } from '../contract';
import { type ChatCommandName, chatCommand, chatScope } from '../ids';
import type {
  AttachmentsInput,
  AttachmentsKit,
  ComposerInput,
  ComposerKit,
  PartView,
  StatusLineKit,
  WorkingInput,
} from '../layouts/layout';
import { createActivityDock } from './activity-dock';
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
// parts other plugins added above every composer, `statusParts` those added
// to every status line; `clock` and `timers` tick the activity dock's live
// time.
export interface ComposerSurfaceDeps extends SurfaceKitDeps {
  layouts: ChatLayouts;
  run(command: CommandId): void;
  composerParts: Pick<PartStore<ChatComposerPart>, 'parts'>;
  statusParts: Pick<PartStore<ChatStatusPart>, 'parts'>;
  log: PluginLog;
  clock: Clock;
  timers: Timers;
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
// working, attachments and status line slots, the status parts' slot and the
// status line's key-holding parts are built once and placed again by each draw;
// other plugins' composer parts and status parts are built again by each
// composer draw, not by a status line draw. The working slot holds the
// activity dock: the `working` part, drawn with what the tab's activity dock
// shows and hidden while it shows nothing or while the default `working` draw
// has failed since the last composer draw.
export interface ComposerSurface {
  // Draws the composer into `parent` in place of its last draw, then the
  // status line with `input`, the last attached images and the activity dock
  // afresh, retrying a failed default `working` draw; returns the composer's
  // root.
  drawComposer(parent: HTMLElement, input: ComposerInput): HTMLElement;
  // Runs the composer's update with `input`, then draws the status line with
  // it in place of its last draw. Returns false, drawing no status line, when
  // the update threw: the composer then draws with `default` until the
  // layouts change, and the caller draws it again.
  drawStatusLine(input: ComposerInput): boolean;
  // Draws the attachments in place of their last draw; the slot hides while
  // `images` is empty.
  drawAttachments(images: readonly ChatImage[]): void;
  // Hands the activity dock the session's entries after a change and whether
  // the session's turn is under way: working, or waiting on a permission
  // answer.
  setTurn(entries: readonly ChatEntry[], working: boolean): void;
  // Disposes every draw, the activity dock's tick and the status line's
  // anchors.
  dispose(): void;
}

interface BuiltPart<I> {
  element: HTMLElement;
  view: PartView<I>;
}

// The status line's parts holding keys, each anchored once in `chat.chat`:
// the type hint (`i` and `a`), the running indicator (dot and interrupt
// keys), Send, and a key span per pick command, which the first chip running
// it holds.
interface StatusLineParts {
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
  const workingSlot = element('div', 'chat-working-slot');
  workingSlot.hidden = true;
  const attachmentsSlot = element('div', 'chat-attachments-slot');
  attachmentsSlot.hidden = true;
  const statusLineSlot = element('div', 'chat-status-line-slot');
  const statusPartsSlot = element('span', 'chat-status-parts-slot');
  const parts = createStatusLineParts(deps);
  const composerDraws = chatPartDraws(deps.layouts, 'composer', deps.log);
  const statusLineDraws = chatPartDraws(deps.layouts, 'statusLine', deps.log);
  const attachmentsDraws = chatPartDraws(deps.layouts, 'attachments', deps.log);
  const workingDraws = chatPartDraws(deps.layouts, 'working', deps.log);
  let composer: DrawnPart<BuiltPart<ComposerInput>> | null = null;
  let statusLine: DrawnPart<BuiltPart<ComposerInput>> | null = null;
  let attachments: DrawnPart<BuiltPart<AttachmentsInput>> | null = null;
  let workingPart: DrawnPart<BuiltPart<WorkingInput>> | null = null;
  let images: readonly ChatImage[] = [];
  let isWorkingFailed = false;

  const clearWorking = () => {
    workingPart?.dispose();
    workingPart = null;
    workingSlot.replaceChildren();
    workingSlot.hidden = true;
  };
  // Draws the `working` part afresh with `input`, or leaves the slot hidden
  // for null; a default that fails is logged once and leaves it hidden until
  // the next composer draw.
  const drawWorking = (input: WorkingInput | null) => {
    clearWorking();
    if (input === null || isWorkingFailed) {
      return;
    }
    workingSlot.hidden = false;
    try {
      workingPart = workingDraws.draw(workingSlot, (builder, at, rollback) => {
        const view = builder(at, input, surfaceBaseKit(deps, 'chat', rollback));
        return { element: view.element, view };
      });
    } catch (error) {
      deps.log(`default layout working failed: ${errorText(error)}`);
      isWorkingFailed = true;
      clearWorking();
    }
  };
  // Runs the drawn part's update with `input`; a part with no update, or
  // whose update threw, is drawn again.
  const showWorking = (input: WorkingInput | null) => {
    const isUpdated =
      input !== null &&
      workingPart !== null &&
      workingDraws.update(workingPart, input) === 'ran';
    if (!isUpdated) {
      drawWorking(input);
    }
  };
  const dock = createActivityDock({
    clock: deps.clock,
    timers: deps.timers,
    changed: showWorking,
  });

  const surface: ComposerSurface = {
    drawComposer(parent, input) {
      composer?.dispose();
      composer?.built.element.remove();
      composer = composerDraws.draw(parent, (builder, at, rollback) => {
        const box = appSlot(pieces.box, 'box', rollback);
        const workingAt = appSlot(workingSlot, 'working', rollback);
        const attachmentsAt = appSlot(attachmentsSlot, 'attachments', rollback);
        const statusLineAt = appSlot(statusLineSlot, 'statusLine', rollback);
        statusPartsSlot.replaceChildren();
        placeContributedParts(
          statusPartsSlot,
          pieces.sessionId,
          deps.statusParts.parts(),
          STATUS_PARTS,
          deps.log,
          rollback,
        );
        let arePartsPlaced = false;
        let isWorkingPlaced = false;
        const kit: ComposerKit = {
          ...surfaceBaseKit(deps, 'chat', rollback),
          floatingPanel: (panelParent) =>
            appended(panelParent, floatingPanel()),
          box: (boxParent) => box.place(boxParent),
          working(slotParent) {
            const placed = workingAt.place(slotParent);
            isWorkingPlaced = true;
            return placed;
          },
          attachments: (slotParent) => attachmentsAt.place(slotParent),
          statusLine: (slotParent) => statusLineAt.place(slotParent),
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
        if (!isWorkingPlaced) {
          pieces.box.parentNode?.insertBefore(workingSlot, pieces.box);
          rollback.recordBox(() => workingSlot.remove());
        }
        return { element: root, view };
      });
      drawStatusLinePart(input);
      surface.drawAttachments(images);
      isWorkingFailed = false;
      drawWorking(dock.input());
      return composer.built.element;
    },
    drawStatusLine(input) {
      const isComposerStale =
        composer !== null && composerDraws.update(composer, input) === 'threw';
      if (isComposerStale) {
        return false;
      }
      drawStatusLinePart(input);
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
    setTurn(entries, working) {
      dock.set(entries, working);
    },
    dispose() {
      dock.dispose();
      composer?.dispose();
      statusLine?.dispose();
      attachments?.dispose();
      workingPart?.dispose();
      disposeAnchors(parts.anchors);
    },
  };

  const drawStatusLinePart = (input: ComposerInput) => {
    statusLine?.dispose();
    statusLineSlot.replaceChildren();
    statusLine = statusLineDraws.draw(
      statusLineSlot,
      (builder, at, rollback) => {
        const statusPartsAt = statusPartsPlacement(statusPartsSlot, rollback);
        const kit = statusLineKit(
          surfaceBaseKit(deps, 'chat', rollback),
          parts,
          input,
          deps.run,
          statusPartsAt.place,
        );
        const view = builder(at, input, kit);
        statusPartsAt.placeIfLeftOut(view.element);
        return { element: view.element, view };
      },
    );
  };

  return surface;
}

const COMPOSER_PARTS: ContributedPartsPlace = {
  noun: 'composer part',
  holderClass: 'chat-composer-parts',
  wrapperClass: 'chat-composer-part',
};

const STATUS_PARTS: ContributedPartsPlace = {
  noun: 'status part',
  holderClass: 'chat-status-parts',
  wrapperClass: 'chat-status-part',
};

// The status parts' slot for one status line drawing attempt: `place`
// appends it and throws on a second call; `placeIfLeftOut` appends it to the
// line's end when no call placed it. The attempt's rollback detaches it.
function statusPartsPlacement(
  slot: HTMLElement,
  rollback: Pick<RollbackDeps, 'recordBox'>,
): {
  place(parent: HTMLElement): HTMLElement;
  placeIfLeftOut(line: HTMLElement): void;
} {
  let isPlaced = false;
  const place = (parent: HTMLElement) => {
    if (isPlaced) {
      throw new Error('status line placed status parts twice');
    }
    isPlaced = true;
    rollback.recordBox(() => slot.remove());
    return appended(parent, slot);
  };
  return {
    place,
    placeIfLeftOut(line) {
      if (!isPlaced) {
        place(line);
      }
    },
  };
}

function createStatusLineParts(
  deps: Pick<ComposerSurfaceDeps, 'keys' | 'run'>,
): StatusLineParts {
  const typeKey = element('span', 'chat-type-key');
  const appendKey = element('span', 'chat-type-key');
  const typeHint = element('span', 'chat-type-hint');
  typeHint.append(typeKey, appendKey);
  const interruptKey = element('span', 'chat-running-key');
  const sendNowKey = element('span', 'chat-running-key');
  const running = element('span', 'chat-running');
  running.append(statusDot('running'), interruptKey, sendNowKey);
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
    deps.keys.anchor(sendNowKey, chatCommand('sendNow'), {
      ...scope,
      label: 'send now',
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

// The status line's kit for one draw: each key-holding part places the tab's
// own element, shown for `input`; the model · effort chip holds the model and
// effort pick keys, and any other chip its command's keys when
// `chipKeyCommands` gives them to its control.
function statusLineKit(
  base: BaseKit,
  parts: StatusLineParts,
  input: ComposerInput,
  run: (command: CommandId) => void,
  placeStatusParts: (parent: HTMLElement) => HTMLElement,
): StatusLineKit {
  const keyCommands = chipKeyCommands(input.controls);
  const holdKeys = (holder: HTMLElement, command: ChatCommandName) => {
    const key = parts.chipKeys.get(command);
    if (key !== undefined) {
      holder.append(key);
    }
  };
  return {
    ...base,
    typeHint(parent) {
      parts.typeHint.classList.toggle('is-box-focused', input.isBoxFocused);
      return appended(parent, parts.typeHint);
    },
    modelEffortChip(parent, { model, effort }) {
      const value =
        effort === null ? model.value : `${model.value} · ${effort.value}`;
      const modelEffortChip = chip(model.label, value, () =>
        run(chatCommand('pickModel')),
      ) as HTMLButtonElement;
      modelEffortChip.disabled = !model.enabled;
      holdKeys(modelEffortChip, 'pickModel');
      if (effort !== null) {
        holdKeys(modelEffortChip, 'pickEffort');
      }
      return appended(parent, modelEffortChip);
    },
    controlChip(parent, control) {
      const command = controlCommand(control.id);
      const controlChip = chip(control.label, control.value, () =>
        run(chatCommand(command)),
      ) as HTMLButtonElement;
      controlChip.disabled = !control.enabled;
      const index = input.controls.findIndex((held) => held.id === control.id);
      const keyed = index === -1 ? null : keyCommands[index];
      if (keyed !== null) {
        holdKeys(controlChip, keyed);
      }
      return appended(parent, controlChip);
    },
    statusParts: placeStatusParts,
    running(parent) {
      parts.running.classList.toggle('is-idle', !input.working);
      return appended(parent, parts.running);
    },
    sendButton: (parent) => appended(parent, parts.send),
  };
}
