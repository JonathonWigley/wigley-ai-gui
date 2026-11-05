import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import type { ChatSidePart } from '../contract';
import type { WorkingInput } from '../layouts/layout';
import type { ComposerSurface } from './composer-kit';
import { createMainAgentPart } from './main-agent-part';

function liveInput(seconds: number): WorkingInput {
  return {
    state: 'thinking',
    steps: [],
    startedAt: 1000,
    now: 1000 + seconds * 1000,
    compaction: null,
  };
}

const DONE_INPUT: WorkingInput = {
  state: 'done',
  steps: [],
  startedAt: 1000,
  endedAt: 2000,
  stopReason: 'end_turn',
  costUsd: null,
};

// The surface's dock as the part reads it: `change` sets what the dock shows and
// tells each listener still subscribed.
function fakeSurface(shown: WorkingInput | null = null) {
  const dockSlot = new FakeElement('div');
  const listeners = new Set<(input: WorkingInput | null) => void>();
  const surface = {
    dockSlot: asHtml(dockSlot),
    dockInput: () => shown,
    onDockChanged(listener: (input: WorkingInput | null) => void) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  } as unknown as ComposerSurface;
  const change = (input: WorkingInput | null) => {
    shown = input;
    for (const listener of listeners) {
      listener(input);
    }
  };
  return { surface, dockSlot, listeners, change };
}

// Builds `part` into a new parent, keeping each summary it sets.
function buildIn(part: ChatSidePart) {
  const parent = new FakeElement('div');
  const summaries: (string | null)[] = [];
  const built = part.build(asHtml(parent), 'row-1', {
    setSummary: (text) => summaries.push(text),
  });
  return { parent, summaries, built };
}

describe('Main agent part', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('build_DockChanges_SummaryFollows', () => {
    const { surface, dockSlot, change } = fakeSurface(liveInput(65));
    const part = createMainAgentPart({ surfaceOf: () => surface });

    const { parent, summaries } = buildIn(part);
    change(liveInput(66));
    change(DONE_INPUT);
    change(null);

    expect(dockSlot.parentNode).toBe(parent);
    expect(summaries).toEqual(['1:05', '1:06', null, null]);
  });

  it('build_DisposedThenBuiltAgain_MovesTheSameSlotWithOneListener', () => {
    const { surface, dockSlot, listeners, change } = fakeSurface();
    const part = createMainAgentPart({ surfaceOf: () => surface });

    const first = buildIn(part);
    first.built.dispose?.();
    const detachedParent = dockSlot.parentNode;
    const listenersAfterDispose = listeners.size;
    const second = buildIn(part);
    change(liveInput(5));

    expect(detachedParent).toBeNull();
    expect(first.parent.children).toEqual([]);
    expect(listenersAfterDispose).toBe(0);
    expect(dockSlot.parentNode).toBe(second.parent);
    expect(listeners.size).toBe(1);
    expect(first.summaries).toEqual([null]);
    expect(second.summaries).toEqual([null, '0:05']);
  });

  it('build_NoSurface_DrawsNothing', () => {
    const part = createMainAgentPart({ surfaceOf: () => null });

    const { parent, summaries, built } = buildIn(part);

    expect(parent.children).toEqual([]);
    expect(summaries).toEqual([]);
    expect(built.dispose).toBeUndefined();
  });
});
