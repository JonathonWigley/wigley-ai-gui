import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asFake, installFakeDom } from '../../../../shared/page/test-dom';
import type { Layout } from '../../layouts/layout';
import { stashPartsSetup } from './session-stash-parts.test-support';

const INPUT = { session: 'gamma', hint: 'the hint' };

beforeEach(() => installFakeDom(vi.stubGlobal));
afterEach(() => vi.unstubAllGlobals());

describe('sessionStashParts', () => {
  it.each<{ case: string; layout: Layout | undefined; drawnBy: string }>([
    { case: 'the default layout', layout: undefined, drawnBy: 'default' },
    {
      case: 'layout leaves the box out',
      layout: {
        noteDialog: (parent, input, kit) => {
          const element = kit.el(parent, 'div', 'mine-note');
          kit.el(element, 'p', 'mine-hint', input.hint);
          return { element };
        },
      },
      drawnBy: 'mine',
    },
    {
      case: 'layout places the box twice',
      layout: {
        noteDialog: (parent, _input, kit) => {
          const element = kit.el(parent, 'div', 'mine-note');
          kit.noteBox(element);
          kit.noteBox(element);
          return { element };
        },
      },
      drawnBy: 'default',
    },
  ])(
    'noteDialog_EachLayout_HoldsTheNoteBoxOnce ($case)',
    ({ layout, drawnBy }) => {
      const { parts } = stashPartsSetup(layout);
      const box = document.createElement('div');

      const drawn = parts.noteDialog(document.createElement('div'), INPUT, box);

      const element = asFake(drawn.built.element);
      expect(drawn.layoutName).toBe(drawnBy);
      expect(element.contains(asFake(box))).toBe(true);
      expect(element.textContent).toContain('the hint');
      if (drawnBy === 'mine') {
        expect(element.children[0]).toBe(asFake(box));
      }
    },
  );

  it('noteDialog_PartThrows_DrawsWithDefaultAndLogsOnce', () => {
    const { parts, logged } = stashPartsSetup({
      noteDialog: () => {
        throw new Error('broken part');
      },
    });
    const box = document.createElement('div');

    const drawn = parts.noteDialog(document.createElement('div'), INPUT, box);

    expect(drawn.layoutName).toBe('default');
    expect(asFake(drawn.built.element).textContent).toContain('gamma');
    expect(asFake(drawn.built.element).contains(asFake(box))).toBe(true);
    expect(
      logged.filter((line) => line.startsWith('layout mine noteDialog failed')),
    ).toHaveLength(1);
  });
});
