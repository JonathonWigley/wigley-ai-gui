import { describe, expect, it } from 'vitest';
import type { DriveAction } from '../../contracts/plugin';
import { createActionRegistry } from './action-registry';

function action(description: string): DriveAction {
  return { description, args: '{}', run: async () => ({ ran: description }) };
}

describe('createActionRegistry', () => {
  it('list_TwoActionsAddedByTwoPlugins_ShowsBothSortedByName', () => {
    const registry = createActionRegistry();
    registry.hostFor('forms').add('openRound', action('opens a round'));
    registry.hostFor('docs').add('connectSession', action('connects'));

    expect(registry.list()).toEqual([
      { name: 'docs.connectSession', description: 'connects', args: '{}' },
      { name: 'forms.openRound', description: 'opens a round', args: '{}' },
    ]);
  });

  it('run_ActionDisposed_RejectsNamingActions', async () => {
    const registry = createActionRegistry();
    const added = registry
      .hostFor('forms')
      .add('openRound', action('opens a round'));

    added.dispose();

    await expect(registry.run('forms.openRound', {})).rejects.toThrow(
      'No drive action forms.openRound; `actions` lists them',
    );
  });
});
