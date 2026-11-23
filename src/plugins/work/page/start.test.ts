import { describe, expect, it } from 'vitest';
import {
  type PagePartHarness,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import type { WorkChannel } from '../contract';
import type { workManifest } from '../manifest';
import { workPagePart } from './start';

type WorkHarness = PagePartHarness<typeof workManifest>;
type WorkCommand = keyof WorkChannel['invoke'];
type Handler = (context: { arg: unknown }) => void | Promise<void>;

// The part over a main that records each invoke and answers it with `answer`.
function startOver(answer: () => Promise<unknown>) {
  const invokes: [string, unknown[]][] = [];
  const harness = startPagePart(workPagePart, {
    invoke: (method, ...args) => {
      invokes.push([method, args]);
      return answer();
    },
  });
  return { harness, invokes };
}

// Runs the page handler of `command` with `arg`.
async function run(harness: WorkHarness, command: WorkCommand, arg: unknown) {
  const handler = harness.started().commands[command] as unknown as Handler;
  await handler({ arg });
}

describe('workPagePart', () => {
  it.each<{ command: WorkCommand; arg: unknown; args: unknown[] }>([
    { command: 'sweep', arg: undefined, args: [] },
    {
      command: 'send',
      arg: { itemId: 'p1', text: 'On it' },
      args: [{ itemId: 'p1', text: 'On it' }],
    },
    { command: 'dismiss', arg: 'p1', args: ['p1'] },
    { command: 'restore', arg: 'p2', args: ['p2'] },
    { command: 'snooze', arg: 'p3', args: ['p3'] },
    { command: 'addToBoard', arg: 'p4', args: ['p4'] },
    {
      command: 'moveCard',
      arg: { cardId: 'WS-1', column: 'Done' },
      args: [{ cardId: 'WS-1', column: 'Done' }],
    },
    { command: 'acceptSuggestion', arg: 'WS-2', args: ['WS-2'] },
    { command: 'notYet', arg: 'WS-3', args: ['WS-3'] },
    { command: 'deleteTask', arg: 'local-1', args: ['local-1'] },
    {
      command: 'startSession',
      arg: { source: 'card', id: 'WS-4' },
      args: [{ source: 'card', id: 'WS-4' }],
    },
    { command: 'openJobRow', arg: undefined, args: [] },
  ])('command_invokesChannel ($command)', async ({ command, arg, args }) => {
    const answering = startOver(() => Promise.resolve(undefined));
    await run(answering.harness, command, arg);
    expect(answering.invokes).toEqual([[command, args]]);
    await answering.harness.stop();

    const refusing = startOver(() => Promise.reject(new Error('no card')));
    const refusal = run(refusing.harness, command, arg);
    await expect(refusal).rejects.toThrow('no card');
    await refusing.harness.stop();
  });
});
