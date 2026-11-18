import { describe, expect, it, vi } from 'vitest';
import { fakeDriveHost } from '../../../shared/fake-drive-host';
import {
  errorResult,
  textResult,
  type ToolCallContext,
  type ToolResult,
  type ToolSession,
} from '../../sessions/contract';
import { addDriveActions } from './drive-actions';

// A macrotask, so every pending promise chain settles first.
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// The drive actions over a `toolsFor` whose every call waits until the test
// settles it; `lastCall` gives the settler of the latest call.
function startActions() {
  const drive = fakeDriveHost();
  let settleCall: {
    resolve(result: ToolResult): void;
    reject(error: Error): void;
  } = { resolve: () => undefined, reject: () => undefined };
  const call = vi.fn<
    (name: string, args: unknown, context: ToolCallContext) => Promise<ToolResult>
  >(
    () =>
      new Promise((resolve, reject) => {
        settleCall = { resolve, reject };
      }),
  );
  const toolsFor = vi.fn<(callerId: string) => ToolSession>(() => ({
    call,
    end: () => undefined,
  }));
  addDriveActions(drive.host, toolsFor);
  return { drive, call, toolsFor, lastCall: () => settleCall };
}

describe('addDriveActions', () => {
  it.each<{
    given: string;
    finish(settler: {
      resolve(result: ToolResult): void;
      reject(error: Error): void;
    }): void;
    result: ToolResult;
  }>([
    {
      given: 'a call that resolves',
      finish: ({ resolve }) => resolve(textResult('Ran window.summon.')),
      result: textResult('Ran window.summon.'),
    },
    {
      given: 'a call that rejects',
      finish: ({ reject }) => reject(new Error('boom')),
      result: errorResult('boom'),
    },
  ])(
    'agent-commands.result is pending until the call settles, then its result: $given',
    async ({ finish, result }) => {
      const actions = startActions();
      const args = { command: 'window.summon' };

      const first = await actions.drive.run('call', {
        sessionId: 'c1',
        tool: 'run_command',
        args,
      });
      const second = await actions.drive.run('call', {
        sessionId: 'c1',
        tool: 'read_state',
      });
      const pending = await actions.drive.run('result', { callId: '1' });
      finish(actions.lastCall());
      await settle();

      expect([first, second]).toEqual([{ callId: '1' }, { callId: '2' }]);
      expect(actions.toolsFor.mock.calls).toEqual([['c1']]);
      expect(actions.call.mock.calls[0]?.slice(0, 2)).toEqual([
        'run_command',
        args,
      ]);
      expect(actions.call.mock.calls[0]?.[2].toolUseId).toBeNull();
      expect(actions.call.mock.calls[0]?.[2].signal.aborted).toBe(false);
      expect(pending).toEqual({ pending: true });
      expect(await actions.drive.run('result', { callId: '2' })).toEqual(
        result,
      );
      expect(await actions.drive.run('result', { callId: '2' })).toEqual(
        result,
      );
      expect(await actions.drive.run('result', { callId: '1' })).toEqual({
        pending: true,
      });
    },
  );

  it('agent-commands.result rejects an unknown call id', async () => {
    const actions = startActions();

    await expect(actions.drive.run('result', { callId: '7' })).rejects.toThrow(
      'Unknown call 7',
    );
  });
});
