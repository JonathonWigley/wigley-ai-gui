import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Disposable } from '../../../../contracts/disposable';
import { fakeKitCommandsOf } from '../../../../shared/page/layout-host/fake-kit-commands.test-support';
import { noLayoutState } from '../../../../shared/page/layout-host/fake-layout-state.test-support';
import { PLAIN_MARKDOWN } from '../../../../shared/page/markdown-mount.test-support';
import {
  asFake,
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../../../shared/page/test-dom';
import type { CandidateRowInput } from '../../layouts/layout';
import { audioPickerManifest } from '../../manifest';
import {
  createCandidateKit,
  createNotesKit,
  type PickerBox,
  type PickerPartKitDeps,
} from './picker-kit';

// Kit deps whose commands are the audio picker's, each run recorded, whose
// anchors draw nothing, and whose boxes record each place and release; a
// place appends a fresh `div` frame to its parent and returns it.
function fakeDeps() {
  const run = vi.fn();
  const boxes = {
    place: vi.fn(
      (parent: HTMLElement, _box: PickerBox, _text: string): HTMLElement => {
        const frame = asHtml(new FakeElement('div'));
        parent.append(frame);
        return frame;
      },
    ),
    release: vi.fn<(box: PickerBox) => void>(),
  };
  const deps: PickerPartKitDeps = {
    markdown: PLAIN_MARKDOWN,
    keys: {
      keysFor: () => null,
      anchor: () => ({ dispose: () => undefined }),
    },
    commands: fakeKitCommandsOf(audioPickerManifest, run),
    platform: 'macos',
    state: noLayoutState,
    boxes,
  };
  return { deps, run, boxes };
}

// A rollback that records each box's undo and anchor.
function recordingRollback() {
  const undos: (() => void)[] = [];
  const anchors: Disposable[] = [];
  return {
    undos,
    rollback: {
      recordBox: (undo: () => void) => undos.push(undo),
      recordAnchor: (anchor: Disposable) => anchors.push(anchor),
    },
  };
}

function candidateInput(
  overrides: Partial<CandidateRowInput>,
): CandidateRowInput {
  return {
    moment: 0,
    row: 0,
    number: 1,
    name: 'click_a',
    library: 'UI',
    play: 'one-shot',
    fileCount: 1,
    pitch: null,
    loudnessLufs: null,
    durationSeconds: 1.2,
    load: 'ready',
    error: null,
    isPlaying: false,
    isCursor: false,
    isChosen: false,
    isRecommended: false,
    ...overrides,
  };
}

function newParent(): HTMLElement {
  return asHtml(new FakeElement('div'));
}

describe('picker kit', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => vi.unstubAllGlobals());

  it('createCandidateKit_PlayButtonClick_RunsPlayRowForItsRowOnly', () => {
    const { deps, run } = fakeDeps();
    const kit = createCandidateKit(
      deps,
      candidateInput({ moment: 1, row: 2, number: 3 }),
      null,
      recordingRollback().rollback,
    );
    const button = asFake(kit.playButton(newParent()));
    const stopPropagation = vi.fn();

    button.fire('click', { stopPropagation });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('audio-picker.playRow', {
      moment: 1,
      candidate: 2,
    });
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  it.each([
    { isPlaying: false, label: 'Play' },
    { isPlaying: true, label: 'Stop' },
  ])(
    'createCandidateKit_PlayButton_ShowsStopWhilePlaying (playing $isPlaying)',
    ({ isPlaying, label }) => {
      const { deps } = fakeDeps();
      const kit = createCandidateKit(
        deps,
        candidateInput({ isPlaying }),
        null,
        recordingRollback().rollback,
      );

      const button = asFake(kit.playButton(newParent()));

      expect(button.attributes.get('aria-label')).toBe(label);
    },
  );

  it.each([
    { case: 'peaks', peaks: [0.5, 1], bars: 2, isLoading: false },
    { case: 'no peaks yet', peaks: null, bars: 0, isLoading: true },
  ])(
    "draws the row's waveform from its peaks, classed for the layout: $case",
    ({ peaks, bars, isLoading }) => {
      const { deps } = fakeDeps();
      const kit = createCandidateKit(
        deps,
        candidateInput({}),
        peaks,
        recordingRollback().rollback,
      );
      const parent = newParent();

      const waveform = asFake(kit.waveform(parent));

      expect(asFake(parent).children.at(-1)).toBe(waveform);
      expect(waveform.classList.contains('ui-waveform')).toBe(true);
      expect(waveform.classList.contains('audio-picker-waveform')).toBe(true);
      expect(waveform.classList.contains('is-loading')).toBe(isLoading);
      expect(
        waveform.children[0].children.filter((node) => node.tagName === 'RECT'),
      ).toHaveLength(bars);
    },
  );

  it('createNotesKit_TextBox_PlacesTheMomentsBoxOnce', () => {
    const { deps, boxes } = fakeDeps();
    const { undos, rollback } = recordingRollback();
    const box = { formId: 'f1', moment: 2 };
    const drawn = createNotesKit(deps, box, 'softer', rollback);
    const part = newParent();

    const field = drawn.kit.textBox(part);

    expect(boxes.place).toHaveBeenCalledTimes(1);
    expect(boxes.place).toHaveBeenCalledWith(field, box, 'softer');
    const [frame, keys] = asFake(field).children;
    expect(frame).toBe(asFake(boxes.place.mock.results[0].value));
    expect(frame.classList.contains('audio-picker-notes-box')).toBe(true);
    expect(keys.classList.contains('box-keys')).toBe(true);
    expect(undos).toHaveLength(1);
    undos[0]();
    expect(boxes.release).toHaveBeenCalledWith(box);
    expect(() => drawn.kit.textBox(part)).toThrow(/already on the part/);
    drawn.appendUnplacedBox(part);
    expect(boxes.place).toHaveBeenCalledTimes(1);
  });

  it('createNotesKit_NoTextBoxCall_AppendUnplacedBoxPlacesAtThePartsEnd', () => {
    const { deps, boxes } = fakeDeps();
    const box = { formId: 'f1', moment: 2 };
    const drawn = createNotesKit(
      deps,
      box,
      'softer',
      recordingRollback().rollback,
    );
    const part = asFake(newParent());
    part.append(new FakeElement('span'));

    drawn.appendUnplacedBox(asHtml(part));

    expect(boxes.place).toHaveBeenCalledTimes(1);
    const [field, placed, text] = boxes.place.mock.calls[0];
    expect(part.lastElementChild).toBe(asFake(field));
    expect(placed).toEqual(box);
    expect(text).toBe('softer');
  });
});
