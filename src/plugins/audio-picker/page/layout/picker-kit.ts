import { appended, element } from '../../../../shared/page/dom';
import type {
  BoxIdentity,
  EditorBoxes,
} from '../../../../shared/page/editor-boxes';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import { iconButton } from '../../../../shared/page/ui/icon-button';
import { boxHint } from '../../../../shared/page/ui/key-anchors';
import {
  type AudioPickerCommandName,
  audioPickerCommand,
  audioPickerScope,
} from '../../ids';
import type {
  CandidateKit,
  CandidateRowInput,
  NotesKit,
  PickerKit,
} from '../../layouts/layout';
import { audioPickerManifest } from '../../manifest';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
// The least bar height in the waveform's 2-high box, so silence draws a line.
const MIN_BAR_HEIGHT = 0.04;
const BAR_WIDTH = 0.7;

// One notes box: the picker it belongs to and its 0-based moment.
export type PickerBox = { formId: string; moment: number };

// The audio picker's boxes, one picker's boxes to a form.
export const PICKER_BOX_IDENTITY: BoxIdentity<PickerBox> = {
  formIdOf: (box) => box.formId,
  keyOf: (box) => `${box.formId}:${box.moment}`,
  describe: (box) => `notes on moment ${box.moment + 1}`,
};

// What every picker kit reads: the core keys API's `anchor` and `keysFor`, the
// commands a kit's `command` reaches, and the platform its key hints draw for.
export type PickerKitDeps = OwnerKitServices;

// What the notes kit acts through besides: the text boxes.
export interface PickerPartKitDeps extends PickerKitDeps {
  boxes: Pick<EditorBoxes<PickerBox>, 'place' | 'release'>;
}

// The base kit for one part draw in scope `audio-picker.list`, each anchor it
// names recorded in `rollback`.
export function createPickerKit(
  deps: PickerKitDeps,
  rollback: RollbackDeps,
): PickerKit {
  return createBaseKit(
    ownerBaseKitDeps(audioPickerManifest, deps, 'list', rollback),
  );
}

// The base kit for the cancel prompt's parts in scope `audio-picker.confirm`,
// each anchor it names recorded in `rollback`.
export function createConfirmKit(
  deps: PickerKitDeps,
  rollback: RollbackDeps,
): PickerKit {
  return createBaseKit(
    ownerBaseKitDeps(audioPickerManifest, deps, 'confirm', rollback),
  );
}

// The kit of candidate row `input`, its waveform drawn from `peaks` (each 0 to
// 1; null until the sound decodes).
export function createCandidateKit(
  deps: PickerKitDeps,
  input: CandidateRowInput,
  peaks: readonly number[] | null,
  rollback: RollbackDeps,
): CandidateKit {
  const base = createPickerKit(deps, rollback);
  return {
    ...base,
    playButton(parent) {
      const play = base.command(audioPickerCommand('playRow'), {
        moment: input.moment,
        candidate: input.row,
      });
      const node = input.isPlaying
        ? iconButton('debug-stop', 'Stop', play, 'sm')
        : iconButton('play', 'Play', play, 'sm');
      node.classList.add('audio-picker-play');
      // The row root's click chooses the row; a play click must not.
      node.addEventListener('click', (event) => event.stopPropagation());
      return appended(parent, node);
    },
    waveform: (parent) => appended(parent, waveform(peaks)),
  };
}

// The notes kit of `box`, its box placed with `text`, and what the app does
// around the layout's part: append the box at the part's end when the part
// left it out.
export function createNotesKit(
  deps: PickerPartKitDeps,
  box: PickerBox,
  text: string,
  rollback: RollbackDeps,
): { kit: NotesKit; appendUnplacedBox(part: HTMLElement): void } {
  let isPlaced = false;
  const textBox = (parent: HTMLElement) => {
    if (isPlaced) {
      throw new Error('the notes box is already on the part');
    }
    isPlaced = true;
    return appendNotesField(deps, rollback, parent, box, text);
  };
  return {
    kit: { ...createPickerKit(deps, rollback), textBox },
    appendUnplacedBox(part) {
      if (!isPlaced) {
        textBox(part);
      }
    },
  };
}

// `span.audio-picker-waveform`: an SVG bar per peak at `x = i`, centred on the
// box's middle; no bars and `is-loading` while `peaks` is null.
function waveform(peaks: readonly number[] | null): HTMLElement {
  const node = element('span', 'audio-picker-waveform');
  node.setAttribute('aria-hidden', 'true');
  node.classList.toggle('is-loading', peaks === null);
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('viewBox', `0 0 ${Math.max(peaks?.length ?? 0, 1)} 2`);
  svg.setAttribute('preserveAspectRatio', 'none');
  for (const [index, peak] of (peaks ?? []).entries()) {
    const height = Math.max(2 * peak, MIN_BAR_HEIGHT);
    const bar = document.createElementNS(SVG_NAMESPACE, 'rect');
    bar.setAttribute('x', String(index));
    bar.setAttribute('y', String(1 - height / 2));
    bar.setAttribute('width', String(BAR_WIDTH));
    bar.setAttribute('height', String(height));
    svg.append(bar);
  }
  node.append(svg);
  return node;
}

// The notes field: the box's input frame, then its `⇧⇥ ⇥` keys, which show on
// the frame's bottom edge while the box has focus. The box is placed once the
// field is appended to `parent`, its release recorded in `rollback`.
function appendNotesField(
  deps: PickerPartKitDeps,
  rollback: RollbackDeps,
  parent: HTMLElement,
  box: PickerBox,
  text: string,
): HTMLElement {
  const field = element('div', 'audio-picker-notes-field');
  parent.append(field);
  const frame = deps.boxes.place(field, box, text);
  frame.classList.add('audio-picker-notes-box');
  field.append(
    boxHint('box-keys', [
      anchoredSpan(deps, rollback, 'audio-picker-box-key', 'prevBox'),
      anchoredSpan(deps, rollback, 'audio-picker-box-key', 'nextBox'),
    ]),
  );
  rollback.recordBox(() => deps.boxes.release(box));
  return field;
}

// A `span` of `className` anchored to the audio picker `command` in scope
// `audio-picker.list`, its anchor recorded in `rollback`.
function anchoredSpan(
  deps: PickerKitDeps,
  rollback: RollbackDeps,
  className: string,
  command: AudioPickerCommandName,
): HTMLElement {
  const node = element('span', className);
  rollback.recordAnchor(
    deps.keys.anchor(node, audioPickerCommand(command), {
      scope: audioPickerScope('list'),
    }),
  );
  return node;
}
