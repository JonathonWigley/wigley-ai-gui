import { describe, expect, it } from 'vitest';
import {
  coreRuntimeMainSlot,
  coreRuntimePageSlot,
} from '../contracts/core-state';
import type { MainCommandContext } from '../contracts/plugin';
import { CommandRegistry } from './command-registry';
import { createRuntimeCommands } from './runtime-commands';
import { createSlotStore } from './state/slot-store';

describe('createRuntimeCommands', () => {
  it('bind_AppBindOnABadAccelerator_ThrowsAtTheCall', () => {
    const state = createSlotStore(() => {});
    const commands = createRuntimeCommands<MainCommandContext<any>>({
      process: 'main',
      registry: new CommandRegistry(() => {}),
      writer: state.publish(coreRuntimeMainSlot),
      other: state.read(coreRuntimePageSlot, 'core'),
      served: () => ({}),
      leader: () => '<Space>',
      remote: () => Promise.resolve(),
    });
    const { commands: api, bind } = commands.forPlugin('p', (handle) => handle);
    api.register('go', { label: 'Go', group: 'g', runsIn: 'main' }, () => {});

    expect(() =>
      bind({ kind: 'app', bind: { accelerator: 'Alt+Nope', command: 'p.go' } }),
    ).toThrow('"Nope"');
    expect(state.read(coreRuntimeMainSlot, 'core').get()?.binds.app).toEqual(
      [],
    );
  });
});
