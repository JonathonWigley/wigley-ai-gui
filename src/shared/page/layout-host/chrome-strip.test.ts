import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asFake, asHtml, FakeElement, installFakeDom } from '../test-dom';
import {
  chromeStrip,
  disposeStrip,
  markNoTargets,
  showStrip,
  type StripDraw,
} from './chrome-strip';

interface Input {
  rows: number;
  task: string;
}

// A strip whose draws each append a root holding one no-target element to the
// slot; `events` names each draw, with the slot's child count when it drew,
// and each dispose, in order.
function drawingStrip() {
  const events: string[] = [];
  const strip = chromeStrip<Input, StripDraw>('test-slot');
  let draws = 0;
  const draw = (): StripDraw => {
    draws += 1;
    const number = draws;
    events.push(`draw ${number} into ${asFake(strip.slot).children.length}`);
    const root = asHtml(new FakeElement('div'));
    const noTarget = asHtml(new FakeElement('span'));
    root.append(noTarget);
    strip.slot.append(root);
    return {
      built: { element: root, noTargets: [noTarget] },
      dispose: () => events.push(`dispose ${number}`),
    };
  };
  return { strip, draw, events };
}

// The input each table row shows second.
const NEXT: Input = { rows: 3, task: 'a' };

describe('chrome strip', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { case: 'no draw yet', shown: null, force: false, draws: true },
    {
      case: 'same fields',
      shown: { rows: 3, task: 'a' },
      force: false,
      draws: false,
    },
    {
      case: 'one field changed',
      shown: { rows: 3, task: 'b' },
      force: false,
      draws: true,
    },
    {
      case: 'same fields forced',
      shown: { rows: 3, task: 'a' },
      force: true,
      draws: true,
    },
  ])('showStrip draws again: $draws on $case', ({ shown, force, draws }) => {
    const { strip, draw } = drawingStrip();
    if (shown !== null) {
      showStrip(strip, shown, draw);
    }
    const before = strip.drawn;
    const next = { ...NEXT };

    showStrip(strip, next, draw, force);

    expect(strip.drawn !== before).toBe(draws);
    expect(strip.input).toBe(draws ? next : shown);
  });

  it('showStrip_Redraw_DisposesTheLastDrawEmptiesTheSlotThenDraws', () => {
    const { strip, draw, events } = drawingStrip();
    showStrip(strip, { rows: 1, task: 'a' }, draw);

    showStrip(strip, { rows: 2, task: 'a' }, draw);

    expect(events).toEqual(['draw 1 into 0', 'dispose 1', 'draw 2 into 0']);
    expect(asFake(strip.slot).children).toEqual([
      asFake(strip.drawn!.built.element),
    ]);
  });

  it.each([{ isNoTarget: true }, { isNoTarget: false }])(
    'markNoTargets sets is-no-target to $isNoTarget on the last draw only',
    ({ isNoTarget }) => {
      const { strip, draw } = drawingStrip();
      showStrip(strip, { rows: 1, task: 'a' }, draw);
      const oldNoTarget = strip.drawn!.built.noTargets[0];
      showStrip(strip, { rows: 2, task: 'a' }, draw);
      const noTarget = strip.drawn!.built.noTargets[0];
      noTarget.classList.toggle('is-no-target', !isNoTarget);

      markNoTargets(strip, isNoTarget);

      expect(noTarget.classList.contains('is-no-target')).toBe(isNoTarget);
      expect(oldNoTarget.classList.contains('is-no-target')).toBe(false);
    },
  );

  it('disposeStrip_Drawn_DisposesTheDrawAndTheSameInputDrawsAgain', () => {
    const { strip, draw, events } = drawingStrip();
    const input = { rows: 1, task: 'a' };
    showStrip(strip, input, draw);

    disposeStrip(strip);
    showStrip(strip, input, draw);

    expect(events).toEqual(['draw 1 into 0', 'dispose 1', 'draw 2 into 0']);
  });
});
