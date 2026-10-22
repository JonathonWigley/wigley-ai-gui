import { describe, expect, it } from 'vitest';
import { CHORD_NOTATION_RULE } from '../../shared/chord-notation';
import { fakeDrivenWindow } from './fake-driven-window';
import {
  click,
  drag,
  press,
  waitFor,
  waitForNewLogLine,
  withPrimitiveEllipsis,
} from './page-driver';

describe('waitForNewLogLine', () => {
  it('waitForNewLogLine_LineLoggedOnThirdRead_ResolvesTrue', async () => {
    let reads = 0;
    const { window } = fakeDrivenWindow([
      ['#log li', () => (++reads >= 3 ? ['[x] done'] : [])],
    ]);

    const isLogged = await waitForNewLogLine(window, '[x] done', 0);

    expect(isLogged).toBe(true);
  });

  it('waitForNewLogLine_PageReloadedToFewerLinesThanSeen_FindsTheLineAmongThemAll', async () => {
    const { window } = fakeDrivenWindow([['#log li', () => ['[x] done']]]);

    const isLogged = await waitForNewLogLine(window, '[x] done', 5, 100);

    expect(isLogged).toBe(true);
  });
});

describe('waitFor', () => {
  it('waitFor_CheckNeverHolds_GivesUpAtItsTimeout', async () => {
    const holds = await waitFor(async () => false, 100);

    expect(holds).toBe(false);
  });

  it('waitFor_CheckNeverAnswers_GivesUpAtItsTimeout', async () => {
    const holds = await waitFor(() => new Promise<boolean>(() => {}), 100);

    expect(holds).toBe(false);
  });
});

describe('press', () => {
  it('press_AltChord_SendsKeyDownAndUpWithAltAndNoChar', () => {
    const { window, inputs } = fakeDrivenWindow();

    press(window, '<A-o>');

    expect(inputs).toEqual([
      { type: 'keyDown', keyCode: 'o', modifiers: ['alt'] },
      { type: 'keyUp', keyCode: 'o', modifiers: ['alt'] },
    ]);
  });

  it('press_CapitalLetter_SendsShiftAndTheChar', () => {
    const { window, inputs } = fakeDrivenWindow();

    press(window, 'G');

    expect(inputs).toEqual([
      { type: 'keyDown', keyCode: 'G', modifiers: ['shift'] },
      { type: 'char', keyCode: 'G' },
      { type: 'keyUp', keyCode: 'G', modifiers: ['shift'] },
    ]);
  });

  it('press_MalformedChord_ThrowsNamingTheChordRule', () => {
    const { window } = fakeDrivenWindow();

    expect(() => press(window, '<X-q>')).toThrow(CHORD_NOTATION_RULE);
  });
});

// A page whose element the press script finds centred at (60, 40), with
// `cover` hit there in its place, or nothing in its place when null.
function pageWithTargetAt60x40(cover: string | null) {
  return fakeDrivenWindow([
    [
      'elementFromPoint',
      () => ({ x: 60, y: 40, isShown: true, isInWindow: true, cover }),
    ],
  ]);
}

describe('click', () => {
  it('click_LeftOnce_PressesHoldingTheButtonAndReleasesAtTheCentre', async () => {
    const { window, inputs } = pageWithTargetAt60x40(null);

    await click(window, '.target', 'left', 1);

    const buttonInputs = inputs.filter(
      (input) => input.type === 'mouseDown' || input.type === 'mouseUp',
    );
    expect(buttonInputs).toEqual([
      {
        type: 'mouseDown',
        x: 60,
        y: 40,
        button: 'left',
        clickCount: 1,
        modifiers: ['leftbuttondown'],
      },
      {
        type: 'mouseUp',
        x: 60,
        y: 40,
        button: 'left',
        clickCount: 1,
        modifiers: [],
      },
    ]);
  });

  it('click_AnotherElementCoversTheCentre_RejectsNamingItAndSendsNothing', async () => {
    const { window, inputs } = pageWithTargetAt60x40('div.ui-scrim');

    await expect(click(window, '.target', 'left', 1)).rejects.toThrow(
      '.target is covered at its centre by div.ui-scrim',
    );
    expect(inputs).toEqual([]);
  });
});

describe('drag', () => {
  it('drag_ToTheRight_EveryMoveHoldsTheLeftButton', async () => {
    const { window, inputs } = pageWithTargetAt60x40(null);

    await drag(window, '.target', 80, 0);

    const moves = inputs.filter((input) => input.type === 'mouseMove');
    expect(moves).toHaveLength(10);
    for (const move of moves) {
      expect(move).toMatchObject({ modifiers: ['leftbuttondown'] });
    }
    expect(inputs.at(-1)).toMatchObject({
      type: 'mouseUp',
      x: 140,
      y: 40,
      modifiers: [],
    });
  });
});

describe('withPrimitiveEllipsis', () => {
  it('withPrimitiveEllipsis_ScriptList_AddsTheFourSelectors', () => {
    expect(withPrimitiveEllipsis(['.scroller'])).toEqual([
      '.scroller',
      '.ui-row-label',
      '.ui-row-detail',
      '.ui-tab-label',
      '.ui-collapsible-summary',
    ]);
  });

  it('withPrimitiveEllipsis_ListAlreadyHoldingOne_DoesNotRepeatIt', () => {
    const four = [
      '.ui-row-label',
      '.ui-row-detail',
      '.ui-tab-label',
      '.ui-collapsible-summary',
    ];

    expect(withPrimitiveEllipsis(['.ui-row-label'])).toEqual(four);
    expect(withPrimitiveEllipsis([])).toEqual(four);
  });
});
