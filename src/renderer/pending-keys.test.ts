import { describe, expect, it } from 'vitest';
import type { PendingKeys } from '../contracts/keymap';
import { createPendingKeys } from './pending-keys';

// Sources recording each hold and cancel they receive; `reportEditor` stands
// in for the editor host reporting vim's pending keys.
function fakeSources() {
  const calls: string[] = [];
  let editorListener: (keys: string[]) => void = () => {};
  const sources = {
    page: {
      hold: () => calls.push('page.hold'),
      cancel: () => calls.push('page.cancel'),
    },
    editor: {
      onPendingKeys: (listener: (keys: string[]) => void) => {
        editorListener = listener;
      },
      cancelPendingKeys: () => calls.push('editor.cancel'),
    },
  };
  return {
    sources,
    calls,
    reportEditor: (keys: string[]) => editorListener(keys),
  };
}

describe('createPendingKeys', () => {
  it("tells its listeners the editor's pending keys as the editor's", () => {
    const { sources, reportEditor } = fakeSources();
    const hub = createPendingKeys(sources);
    const heard: (PendingKeys | null)[] = [];
    hub.onPending((pending) => heard.push(pending));

    reportEditor(['<Space>', 'a']);

    expect(heard).toEqual([{ where: 'editor', keys: ['<Space>', 'a'] }]);
  });

  it('sends hold and cancel to the source whose keys are pending', () => {
    const { sources, calls, reportEditor } = fakeSources();
    const hub = createPendingKeys(sources);

    hub.hold();
    hub.cancel();
    hub.reportPage([' '], 'forms.review');
    hub.hold();
    hub.cancel();
    reportEditor(['<Space>']);
    hub.hold();
    hub.cancel();

    expect(calls).toEqual(['page.hold', 'page.cancel', 'editor.cancel']);
  });

  it('tells its listeners null for an empty report', () => {
    const { sources, reportEditor } = fakeSources();
    const hub = createPendingKeys(sources);
    const heard: (PendingKeys | null)[] = [];
    hub.onPending((pending) => heard.push(pending));

    hub.reportPage([' '], 'forms.review');
    hub.reportPage([], 'forms.review');
    reportEditor([]);

    expect(heard).toEqual([
      { where: 'page', keys: [' '], scope: 'forms.review' },
      null,
      null,
    ]);
  });
});
