import type { ChatEntry, ChatImage } from '../../../contracts/agent';
import type { Clock, Timers } from '../../../contracts/ambient';
import type { CommandId } from '../../../contracts/commands';
import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import { callEach } from '../../../shared/call-each';
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
import type {
  ChatComposerPart,
  ChatStatusPart,
  SessionCompaction,
} from '../contract';
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
import { createActivityDock, isLive } from './activity-dock';
import { imageUrl } from './attachments';
import {
  type ChatLayouts,
  chatPartDraws,
  type SurfaceKitDeps,
  surfaceBaseKit,
} from './chat-layouts';
import { chipKeyCommands, modelEffortText } from './composer-input';
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

// One Chat tab's composer, drawn through the chat layout, and its activity
// dock. The box, the working, attachments and status line slots, the status
// parts' slot and the status line's key-holding parts are built once and placed
// again by each draw; other plugins' composer parts and status parts are built
// again by each composer draw, not by a status line draw. The tab's activity
// dock draws three parts with one input: `working` in `dockSlot`, which the
// surface makes and the session hub's Main agent section places, `workingLine`
// in the composer's working slot, and `workingLine` again in `turnLineSlot`,
// which the entry list places, there only while the turn is live. Each slot hides
// while it has nothing to show or while its part's default draw has failed since
// the last composer draw.
export interface ComposerSurface {
  // `div.chat-dock-slot`, the same element for the surface's life.
  dockSlot: HTMLElement;
  // `li.chat-turn-line-slot`, the same element for the surface's life.
  turnLineSlot: HTMLElement;
  // What the activity dock shows now; null while it shows nothing.
  dockInput(): WorkingInput | null;
  // Hears what the activity dock shows, after each of its parts has drawn it. A
  // listener that throws stops no other, and the first throw reaches the caller.
  onDockChanged(listener: (input: WorkingInput | null) => void): Disposable;
  // Draws the composer into `parent` in place of its last draw, then the
  // status line with `input`, the last attached images and each of the activity
  // dock's parts afresh, retrying a failed default draw of any; returns the
  // composer's root.
  drawComposer(parent: HTMLElement, input: ComposerInput): HTMLElement;
  // Runs the composer's update with `input`, then draws the status line with
  // it in place of its last draw. A change to `isBoxFocused` alone moves only the
  // type hint, and an unchanged input draws nothing, so the elements under a
  // release that focused the pane stay in the document for its click. Returns
  // false, drawing no status line, when the update threw: the composer then
  // draws with `default` until the layouts change, and the caller draws it again.
  drawStatusLine(input: ComposerInput): boolean;
  // Draws the attachments in place of their last draw; the slot hides while
  // `images` is empty.
  drawAttachments(images: readonly ChatImage[]): void;
  // Hands the activity dock the session's entries after a change, whether the
  // session's turn is under way (working, or waiting on a permission answer),
  // and the compaction running in the session.
  setTurn(
    entries: readonly ChatEntry[],
    working: boolean,
    compaction: SessionCompaction | null,
  ): void;
  // Disposes every draw, the activity dock's tick and listeners and the status
  // line's anchors.
  dispose(): void;
}

interface BuiltPart<I> {
  element: HTMLElement;
  view: PartView<I>;
}

// One part the activity dock draws, in a slot of its own.
interface DockPart {
  slot: HTMLElement;
  // Runs the drawn part's update with `input`; a part with no update, or whose
  // update threw, is drawn again.
  show(input: WorkingInput | null): void;
  // Draws the part afresh with `input`, retrying a failed default draw.
  redraw(input: WorkingInput | null): void;
  dispose(): void;
}

// The status line's parts holding keys, each anchored once in `chat.chat`:
// the type hint (`i` and `a`, then `.chat-cursor-keys`, the page keys that read
// the entries: `J`, `K`, `V` and `y`, with no labels), the
// running indicator (dot and interrupt keys), Send, and a key span per pick
// command, which the first chip running it holds.
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
  const attachmentsSlot = element('div', 'chat-attachments-slot');
  attachmentsSlot.hidden = true;
  const statusLineSlot = element('div', 'chat-status-line-slot');
  const statusPartsSlot = element('span', 'chat-status-parts-slot');
  const parts = createStatusLineParts(deps);
  const composerDraws = chatPartDraws(deps.layouts, 'composer', deps.log);
  const statusLineDraws = chatPartDraws(deps.layouts, 'statusLine', deps.log);
  const attachmentsDraws = chatPartDraws(deps.layouts, 'attachments', deps.log);
  let composer: DrawnPart<BuiltPart<ComposerInput>> | null = null;
  let statusLine: DrawnPart<BuiltPart<ComposerInput>> | null = null;
  let statusLineDrawnFor: string | null = null;
  let attachments: DrawnPart<BuiltPart<AttachmentsInput>> | null = null;
  let images: readonly ChatImage[] = [];

  const dockPart = createDockPart(deps, 'working', 'chat-dock-slot');
  const linePart = createDockPart(deps, 'workingLine', 'chat-working-slot');
  const turnLinePart = createDockPart(
    deps,
    'workingLine',
    'chat-entry-slot chat-turn-line-slot',
    'li',
  );
  const workingSlot = linePart.slot;
  const dockListeners = new Set<(input: WorkingInput | null) => void>();
  const dock = createActivityDock({
    clock: deps.clock,
    timers: deps.timers,
    changed: (input) =>
      callEach(
        [
          dockPart.show,
          linePart.show,
          (shown) => turnLinePart.show(liveOnly(shown)),
          ...dockListeners,
        ],
        (show) => show(input),
      ),
  });

  const surface: ComposerSurface = {
    dockSlot: dockPart.slot,
    turnLineSlot: turnLinePart.slot,
    dockInput: () => dock.input(),
    onDockChanged(listener) {
      // A wrapper per subscription, so each handle removes only its own.
      const wrapped = (input: WorkingInput | null) => listener(input);
      dockListeners.add(wrapped);
      return { dispose: () => dockListeners.delete(wrapped) };
    },
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
      dockPart.redraw(dock.input());
      linePart.redraw(dock.input());
      turnLinePart.redraw(liveOnly(dock.input()));
      return composer.built.element;
    },
    drawStatusLine(input) {
      const isComposerStale =
        composer !== null && composerDraws.update(composer, input) === 'threw';
      if (isComposerStale) {
        return false;
      }
      if (statusLineDrawnFor === statusLineFacts(input)) {
        showBoxFocus(parts, input);
        return true;
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
    setTurn(entries, working, compaction) {
      dock.set(entries, working, compaction);
    },
    dispose() {
      dock.dispose();
      composer?.dispose();
      statusLine?.dispose();
      attachments?.dispose();
      dockPart.dispose();
      linePart.dispose();
      turnLinePart.dispose();
      dockListeners.clear();
      disposeAnchors(parts.anchors);
    },
  };

  const drawStatusLinePart = (input: ComposerInput) => {
    statusLineDrawnFor = null;
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
    statusLineDrawnFor = statusLineFacts(input);
  };

  return surface;
}

// What a status line draw depends on: all of `input` but `isBoxFocused`, which
// `showBoxFocus` applies in place.
function statusLineFacts(input: ComposerInput): string {
  return JSON.stringify({ ...input, isBoxFocused: false });
}

function showBoxFocus(
  parts: Pick<StatusLineParts, 'typeHint'>,
  input: ComposerInput,
) {
  parts.typeHint.classList.toggle('is-box-focused', input.isBoxFocused);
}

function liveOnly(input: WorkingInput | null): WorkingInput | null {
  return isLive(input) ? input : null;
}

// `key`'s part in a new hidden `slotTag` of class `slotClass`, which shows while the part has
// an input to draw; a default that fails is logged once and leaves the slot hidden
// until the next `redraw`.
function createDockPart(
  deps: ComposerSurfaceDeps,
  key: 'working' | 'workingLine',
  slotClass: string,
  slotTag: 'div' | 'li' = 'div',
): DockPart {
  const slot = element(slotTag, slotClass);
  slot.hidden = true;
  const draws = chatPartDraws(deps.layouts, key, deps.log);
  let part: DrawnPart<BuiltPart<WorkingInput>> | null = null;
  let isFailed = false;

  const clear = () => {
    part?.dispose();
    part = null;
    slot.replaceChildren();
    slot.hidden = true;
  };
  const draw = (input: WorkingInput | null) => {
    clear();
    if (input === null || isFailed) {
      return;
    }
    slot.hidden = false;
    try {
      part = draws.draw(slot, (builder, at, rollback) => {
        const view = builder(at, input, surfaceBaseKit(deps, 'chat', rollback));
        return { element: view.element, view };
      });
    } catch (error) {
      deps.log(`default layout ${key} failed: ${errorText(error)}`);
      isFailed = true;
      clear();
    }
  };
  return {
    slot,
    show(input) {
      const isUpdated =
        input !== null && part !== null && draws.update(part, input) === 'ran';
      if (!isUpdated) {
        draw(input);
      }
    },
    redraw(input) {
      isFailed = false;
      draw(input);
    },
    dispose: () => part?.dispose(),
  };
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
  const nextMessageKey = element('span', 'chat-type-key');
  const prevMessageKey = element('span', 'chat-type-key');
  const rangeKey = element('span', 'chat-type-key');
  const copyKey = element('span', 'chat-type-key');
  const cursorKeys = element('span', 'chat-cursor-keys');
  cursorKeys.append(nextMessageKey, prevMessageKey, rangeKey, copyKey);
  typeHint.append(typeKey, appendKey, cursorKeys);
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
    deps.keys.anchor(nextMessageKey, chatCommand('nextMessage'), scope),
    deps.keys.anchor(prevMessageKey, chatCommand('prevMessage'), scope),
    deps.keys.anchor(rangeKey, chatCommand('toggleRange'), scope),
    deps.keys.anchor(copyKey, chatCommand('allowOrCopy'), scope),
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
      showBoxFocus(parts, input);
      return appended(parent, parts.typeHint);
    },
    modelEffortChip(parent, modelEffort) {
      const { model, effort } = modelEffort;
      const modelEffortChip = chip(
        model.label,
        modelEffortText(modelEffort),
        () => run(chatCommand('pickModel')),
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
