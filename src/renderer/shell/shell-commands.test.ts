import { describe, expect, it } from 'vitest';
import {
  coreRuntimeMainSlot,
  coreRuntimePageSlot,
} from '../../contracts/core-state';
import type { PageCommandContext } from '../../contracts/plugin';
import { CommandRegistry } from '../../shared/command-registry';
import { commandRunner } from '../../shared/page/layout-host/base-kit';
import { createRuntimeCommands } from '../../shared/runtime-commands';
import { createSlotStore } from '../../shared/state/slot-store';
import { shellCommands } from './shell-commands';

describe('shellCommands', () => {
  it('shellCommands_RuntimeCommandRegisteredAtPartStart_CountsAtFirstDraw', () => {
    const store = createSlotStore(() => undefined);
    const runtime = createRuntimeCommands<PageCommandContext<any>>({
      process: 'page',
      registry: new CommandRegistry(() => undefined),
      writer: store.publish(coreRuntimePageSlot),
      other: store.read(coreRuntimeMainSlot, 'core'),
      served: () => ({}),
      leader: () => ' ',
      remote: () => Promise.resolve(),
    });
    const ran: unknown[] = [];
    runtime
      .forPlugin('p', (handle) => handle)
      .commands.register(
        'go',
        { label: 'go', group: 'p', runsIn: 'page', arg: 'number' },
        ({ arg }) => {
          ran.push(arg);
        },
      );
    const commands = shellCommands(runtime, () => undefined);

    commandRunner('p.go', commands, 4)();

    expect(ran).toEqual([4]);
  });
});
