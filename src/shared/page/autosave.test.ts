import { describe, expect, it } from 'vitest';
import { fakeTimers } from '../fake-timers.test-support';
import { type DraftRevisions, saveLabel, startAutosave } from './autosave';

interface TestDraft extends DraftRevisions {
  id: string;
}

type Teardown = 'subscription' | 'pageHide';

// Autosave over one unsaved draft `d1` whose save waits on `save`, recording
// each log line, each finished save and each dispose of its subscription and
// page hide listener in `calls`; the dispose `throwing` names throws
// `<name> failed`. `hide` runs the page hide listener, which starts the save.
function autosaveOf(throwing: Teardown | null) {
  const calls: string[] = [];
  const save = Promise.withResolvers<void>();
  let hidden: () => void = () => undefined;
  const teardown = (name: Teardown) => ({
    dispose() {
      calls.push(`${name} disposed`);
      if (throwing === name) {
        throw new Error(`${name} failed`);
      }
    },
  });
  const draft: TestDraft = {
    id: 'd1',
    revision: 2,
    savingRevision: null,
    savedRevision: 1,
    saveError: null,
  };
  const autosave = startAutosave<TestDraft, string>({
    subscribe: () => teardown('subscription'),
    drafts: () => [draft],
    idOf: (each) => each.id,
    bodyOf: () => 'body',
    saveStarted: () => undefined,
    saveFinished: (id, _revision, error) =>
      calls.push(`finished ${id}: ${error}`),
    save: () => save.promise,
    delayMs: () => 500,
    onPageHide: (listener) => {
      hidden = listener;
      return teardown('pageHide');
    },
    timers: fakeTimers().timers,
    log: (message) => calls.push(`log ${message}`),
  });
  return { autosave, calls, save, hide: () => hidden() };
}

describe('startAutosave after dispose', () => {
  // Breaks if a save failing after dispose logs or reports, or if a throwing
  // teardown step skips the other.
  it.each<{ row: string; throwing: Teardown | null; error: string | null }>([
    { row: 'no teardown throws', throwing: null, error: null },
    {
      row: 'the subscription dispose throws',
      throwing: 'subscription',
      error: 'subscription failed',
    },
    {
      row: 'the page hide dispose throws',
      throwing: 'pageHide',
      error: 'pageHide failed',
    },
  ])(
    'disposes both listeners and a save failing after reports nothing ($row)',
    async ({ throwing, error }) => {
      const { autosave, calls, save, hide } = autosaveOf(throwing);
      hide();

      if (error === null) {
        autosave.dispose();
      } else {
        expect(() => autosave.dispose()).toThrow(error);
      }
      save.reject(new Error('disk full'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(calls).toEqual(['subscription disposed', 'pageHide disposed']);
    },
  );
});

describe('saveLabel', () => {
  it('shows the failed save message while unsaved', () => {
    expect(saveLabel('unsaved', 'disk full')).toContain('disk full');
  });
});
