import { describe, expect, it } from 'vitest';
import { createModes } from './modes';

// The test environment has no DOM, so each mode's element is a plain object
// holding `hidden`; `calls` records each mode's `shown` and each change heard.
function setup() {
  const attached: HTMLElement[] = [];
  const logs: string[] = [];
  const calls: string[] = [];
  const modes = createModes(
    (element) => attached.push(element),
    (source, message) => logs.push(`[${source}] ${message}`),
  );
  modes.onChanged((modeId) => calls.push(`changed ${modeId}`));
  const add = (id: string, title: string) => {
    const element = { hidden: false } as HTMLElement;
    const handle = modes.add({
      id,
      title,
      element,
      shown: () => calls.push(`shown ${id}`),
    });
    return { element, handle };
  };
  return { modes, attached, logs, calls, add };
}

describe('createModes', () => {
  it('shows the first mode added and hides later ones', () => {
    const { modes, attached, logs, calls, add } = setup();

    const one = add('a.one', 'One');
    const two = add('b.two', 'Two');

    expect(one.element.hidden).toBe(false);
    expect(two.element.hidden).toBe(true);
    expect(modes.shown()).toBe('a.one');
    expect(attached).toEqual([one.element, two.element]);
    expect(logs).toEqual(['[page] showed One mode']);
    expect(calls).toEqual(['shown a.one']);
  });

  it('shows a mode and hides the shown one, telling the mode, then listeners', () => {
    const { modes, logs, calls, add } = setup();
    const one = add('a.one', 'One');
    const two = add('b.two', 'Two');

    two.handle.show();

    expect(one.element.hidden).toBe(true);
    expect(two.element.hidden).toBe(false);
    expect(modes.shown()).toBe('b.two');
    expect(calls).toEqual(['shown a.one', 'shown b.two', 'changed b.two']);
    expect(logs.at(-1)).toBe('[page] showed Two mode');
    expect(two.handle.isShown()).toBe(true);
    expect(one.handle.isShown()).toBe(false);
  });

  it('does nothing when the shown mode shows again', () => {
    const { logs, calls, add } = setup();
    const one = add('a.one', 'One');
    add('b.two', 'Two');

    one.handle.show();

    expect(calls).toEqual(['shown a.one']);
    expect(logs).toEqual(['[page] showed One mode']);
  });

  it('rejects a mode id added twice', () => {
    const { add } = setup();
    add('a.one', 'One');

    expect(() => add('a.one', 'One')).toThrow('Mode "a.one" is added twice');
  });

  it('has no shown mode before the first is added', () => {
    const { modes } = setup();

    expect(() => modes.shown()).toThrow('No mode is added yet');
  });
});
