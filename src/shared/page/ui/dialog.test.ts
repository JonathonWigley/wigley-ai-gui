import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asFake,
  type FakeElement,
  type FocusFakeDocument,
  installFocusFakeDom,
} from '../test-dom';
import {
  createDialog,
  type DialogFrameInput,
  type DialogOptions,
  type DrawDialogFrame,
} from './dialog';

// A dialog over a fake `drawFrame` that appends a panel holding a body and,
// when `hasActions`, an actions row, and records each input. While
// `frames.isBroken` is set it throws `frame broke` before drawing.
function dialogSetup(title: string, options: DialogOptions = {}) {
  const frames = { inputs: [] as DialogFrameInput[], isBroken: false };
  const drawFrame: DrawDialogFrame = (parent, input) => {
    frames.inputs.push(input);
    if (frames.isBroken) {
      throw new Error('frame broke');
    }
    const panel = document.createElement('section');
    const body = document.createElement('div');
    panel.append(body);
    const actions = input.hasActions ? document.createElement('div') : null;
    if (actions !== null) {
      panel.append(actions);
    }
    parent.append(panel);
    return { element: panel, body, actions };
  };
  const dialog = createDialog(title, { ...options, drawFrame });
  return { dialog, frames, scrim: asFake(dialog.element) };
}

// The scrim's one child; fails when it holds any other count.
function onlyChild(scrim: FakeElement): FakeElement {
  expect(scrim.childNodes).toHaveLength(1);
  return scrim.childNodes[0];
}

function dialogMarks(panel: HTMLElement) {
  const { attributes } = asFake(panel);
  return {
    role: attributes.get('role'),
    modal: attributes.get('aria-modal'),
    label: attributes.get('aria-label'),
  };
}

describe('createDialog with drawFrame', () => {
  let doc: FocusFakeDocument;
  beforeEach(() => {
    doc = installFocusFakeDom((name, value) => vi.stubGlobal(name, value));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createDialog_DrawFrame_TheAppKeepsTheScrimAndMarksThePanel', () => {
    const { dialog, frames, scrim } = dialogSetup('Rename', {
      hasActions: false,
    });

    expect(frames.inputs).toEqual([{ title: 'Rename', hasActions: false }]);
    expect(onlyChild(scrim)).toBe(asFake(dialog.panel));
    expect(dialogMarks(dialog.panel)).toEqual({
      role: 'dialog',
      modal: 'true',
      label: 'Rename',
    });
    expect(scrim.contains(dialog.actions)).toBe(false);
    expect(scrim.hidden).toBe(true);
    dialog.show();
    expect(scrim.hidden).toBe(false);
    dialog.hide();
    expect(scrim.hidden).toBe(true);
  });

  it('redrawFrame_ShownDialog_MovesTheContentAndKeepsFocus', () => {
    const { dialog, frames, scrim } = dialogSetup('Rename');
    const input = document.createElement('input');
    const button = document.createElement('button');
    dialog.body.append(input);
    dialog.actions.append(button);
    dialog.show();
    input.focus();
    const earlier = { panel: dialog.panel, body: dialog.body };

    dialog.redrawFrame();

    expect(frames.inputs).toHaveLength(2);
    expect(dialog.panel).not.toBe(earlier.panel);
    expect(dialog.body).not.toBe(earlier.body);
    expect(input.parentNode).toBe(dialog.body);
    expect(button.parentNode).toBe(dialog.actions);
    expect(onlyChild(scrim)).toBe(asFake(dialog.panel));
    expect(dialogMarks(dialog.panel).label).toBe('Rename');
    expect(doc.activeElement).toBe(asFake(input));
    expect(scrim.hidden).toBe(false);
  });

  it('redrawFrame_HiddenActions_StayHidden', () => {
    const { dialog } = dialogSetup('Notes');
    const earlierActions = dialog.actions;
    dialog.actions.hidden = true;

    dialog.redrawFrame();

    expect(dialog.actions).not.toBe(earlierActions);
    expect(dialog.actions.hidden).toBe(true);
    expect(dialog.body.hidden).toBe(false);
  });

  it('setTitle_DrawFrame_RedrawsWithTheTitle', () => {
    const { dialog, frames } = dialogSetup('Allow Bash?');

    dialog.setTitle('Deny Bash?');
    expect(frames.inputs.at(-1)).toEqual({
      title: 'Deny Bash?',
      hasActions: true,
    });
    expect(dialogMarks(dialog.panel).label).toBe('Deny Bash?');

    dialog.setTitle('Deny Bash?');
    expect(frames.inputs).toHaveLength(2);
  });

  it('redrawFrame_DrawFrameThrows_KeepsTheOldFrameAndRetries', () => {
    const { dialog, frames, scrim } = dialogSetup('Rename');
    const earlier = {
      panel: dialog.panel,
      body: dialog.body,
      actions: dialog.actions,
    };
    frames.isBroken = true;

    expect(() => dialog.redrawFrame()).toThrow('frame broke');
    expect(dialog.panel).toBe(earlier.panel);
    expect(dialog.body).toBe(earlier.body);
    expect(dialog.actions).toBe(earlier.actions);

    frames.isBroken = false;
    dialog.redrawFrame();
    expect(dialog.panel).not.toBe(earlier.panel);
    expect(onlyChild(scrim)).toBe(asFake(dialog.panel));
  });
});
