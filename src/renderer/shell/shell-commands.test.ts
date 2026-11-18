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

// A page runtime with `p.go` registered at part start, taking a number.
function runtimeWithGo(ran: unknown[]) {
  const store = createSlotStore(() => undefined);
  const runtime = createRuntimeCommands<PageCommandContext<any>>({
    process: 'page',
    registry: new CommandRegistry(() => undefined),
    writer: store.publish(coreRuntimePageSlot),
    other: store.read(coreRuntimeMainSlot, 'core'),
    served: () => ({}),
    leader: () => ' ',
    remote: async () => 'ran',
  });
  runtime
    .forPlugin('p', (handle) => handle)
    .commands.register(
      'go',
      { label: 'go', group: 'p', runsIn: 'page', arg: 'number' },
      ({ arg }) => {
        ran.push(arg);
      },
    );
  return runtime;
}

describe('shellCommands', () => {
  it('shellCommands_RuntimeCommandRegisteredAtPartStart_CountsAtFirstDraw', () => {
    const ran: unknown[] = [];
    const commands = shellCommands(runtimeWithGo(ran), () => undefined);

    commandRunner('p.go', commands, 4)();

    expect(ran).toEqual([4]);
  });

  it('shellCommands_RunThrowsAtCall_LogsUnderCommandsAndRunsNothing', () => {
    const ran: unknown[] = [];
    const logged: string[] = [];
    const commands = shellCommands(runtimeWithGo(ran), (source, line) =>
      logged.push(`[${source}] ${line}`),
    );

    commands.run('p.go', 'not a number');

    expect(ran).toEqual([]);
    expect(logged).toEqual([
      expect.stringMatching(/^\[commands\] command p\.go failed: /),
    ]);
  });
});
