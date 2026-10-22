import { describe, expect, it } from 'vitest';
import { CHORD_NOTATION_RULE } from '../../shared/chord-notation';
import type { DrivenInput, DrivenWindow } from './driven-window';
import { click, press, waitFor, waitForNewLogLine } from './page-driver';

// A window that records the input it is sent and answers each script `run`
// gets from the first table entry whose fragment the script holds.
function fakeWindow(answers: [fragment: string, answer: () => unknown][] = []) {
  const inputs: DrivenInput[] = [];
  const window: DrivenWindow = {
    sendInput: (input) => inputs.push(input),
    async run<T>(script: string) {
      const entry = answers.find(([fragment]) => script.includes(fragment));
      if (entry === undefined) {
        throw new Error(`The fake window has no answer for ${script}`);
      }
      return entry[1]() as T;
    },
    capture: async () => null,
    contentSize: () => ({ width: 800, height: 600 }),
    minimumWidth: () => 400,
    setContentWidth: () => {},
    setSize: () => {},
    focus: () => {},
    hasPaintedSinceNavigation: () => true,
    onFrame: () => ({ dispose: () => {} }),
    onConsole: () => ({ dispose: () => {} }),
  };
  return { window, inputs };
}

describe('waitForNewLogLine', () => {
  it('waitForNewLogLine_LineLoggedOnThirdRead_ResolvesTrue', async () => {
    let reads = 0;
    const { window } = fakeWindow([
      ['#log li', () => (++reads >= 3 ? ['[x] done'] : [])],
    ]);

    const isLogged = await waitForNewLogLine(window, '[x] done', 0);

    expect(isLogged).toBe(true);
  });
});

describe('waitFor', () => {
  it('waitFor_CheckNeverHolds_GivesUpAtItsTimeout', async () => {
    const holds = await waitFor(async () => false, 100);

    expect(holds).toBe(false);
  });
});

describe('press', () => {
  it('press_AltChord_SendsKeyDownAndUpWithAltAndNoChar', () => {
    const { window, inputs } = fakeWindow();

    press(window, '<A-o>');

    expect(inputs).toEqual([
      { type: 'keyDown', keyCode: 'o', modifiers: ['alt'] },
      { type: 'keyUp', keyCode: 'o', modifiers: ['alt'] },
    ]);
  });

  it('press_CapitalLetter_SendsShiftAndTheChar', () => {
    const { window, inputs } = fakeWindow();

    press(window, 'G');

    expect(inputs).toEqual([
      { type: 'keyDown', keyCode: 'G', modifiers: ['shift'] },
      { type: 'char', keyCode: 'G' },
      { type: 'keyUp', keyCode: 'G', modifiers: ['shift'] },
    ]);
  });

  it('press_MalformedChord_ThrowsNamingTheChordRule', () => {
    const { window } = fakeWindow();

    expect(() => press(window, '<X-q>')).toThrow(CHORD_NOTATION_RULE);
  });
});

describe('click', () => {
  it('click_LeftOnce_PressesAndReleasesAtTheBoxCentre', async () => {
    const { window, inputs } = fakeWindow();

    await click(window, { x: 10, y: 20, width: 100, height: 40 }, 'left', 1);

    const buttonInputs = inputs.filter(
      (input) => input.type === 'mouseDown' || input.type === 'mouseUp',
    );
    expect(buttonInputs).toEqual([
      { type: 'mouseDown', x: 60, y: 40, button: 'left', clickCount: 1 },
      { type: 'mouseUp', x: 60, y: 40, button: 'left', clickCount: 1 },
    ]);
  });
});
