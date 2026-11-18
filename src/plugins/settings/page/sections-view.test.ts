import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { element } from '../../../shared/page/dom';
import { installFakeDom } from '../../../shared/page/test-dom';
import { createSectionsView } from './sections-view';

const SECTIONS = [
  { id: 'core', title: 'Core' },
  { id: 'plugins', title: 'Plugins' },
];

describe('createSectionsView', () => {
  beforeEach(() => {
    installFakeDom(vi.stubGlobal);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dispose disposes the pane and every row drawn last', () => {
    const paneDispose = vi.fn();
    const rowDisposes: ReturnType<typeof vi.fn>[] = [];
    const view = createSectionsView({
      clicked: () => undefined,
      drawPane(container) {
        const pane = element('div');
        const sectionRows = element('div');
        pane.append(sectionRows);
        container.append(pane);
        return {
          built: { element: pane, sectionRows },
          layoutName: 'default',
          drewBundled: true,
          dispose: paneDispose,
        };
      },
      drawRow(parent) {
        const row = element('div');
        parent.append(row);
        const dispose = vi.fn();
        rowDisposes.push(dispose);
        return {
          built: { element: row },
          layoutName: 'default',
          drewBundled: true,
          dispose,
        };
      },
    });
    view.draw(SECTIONS, 0, 'core', true);

    view.dispose();

    expect(paneDispose).toHaveBeenCalledTimes(1);
    expect(rowDisposes.map((dispose) => dispose.mock.calls.length)).toEqual([
      1, 1,
    ]);
  });
});
