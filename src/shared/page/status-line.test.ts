import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStatusLine } from './status-line';
import { asFake, findAll, installFakeDom } from './test-dom';

describe('createStatusLine', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createStatusLine_Update_DrawsTheSaveStateAlone', () => {
    const line = createStatusLine();

    line.update(true, { save: 'Saved', saveState: 'saved' });

    const root = asFake(line.element);
    expect(root.textContent).toBe('Saved');
    expect(findAll(root, 'ui-status-line-mode')).toEqual([]);
    const [save] = findAll(root, 'ui-status-line-save');
    expect(save.dataset.state).toBe('saved');
    expect(root.hidden).toBe(false);
  });

  it('createStatusLine_NotShown_Hides', () => {
    const line = createStatusLine();

    line.update(false, { save: '', saveState: '' });

    expect(line.element.hidden).toBe(true);
  });
});
