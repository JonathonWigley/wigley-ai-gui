import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { BRIDGE_CHANNELS } from '../contracts/bridge';
import { createPageCommands } from './page-commands';

function setup(page: boolean, isStarted: boolean) {
  const logs: string[] = [];
  const send = vi.fn();
  let done: (event: unknown, request: number) => void = () => {};
  const commands = createPageCommands({
    page: () => (page ? ({ send } as unknown as WebContents) : null),
    isStarted: () => isStarted,
    ipc: {
      on(channel: string, listener: (event: never, request: number) => void) {
        if (channel === BRIDGE_CHANNELS.commandRunDone) {
          done = listener as typeof done;
        }
        return undefined as never;
      },
    },
    log: (source, message) => logs.push(`${source}: ${message}`),
  });
  return { commands, logs, send, done: (request: number) => done({}, request) };
}

// Whether `promise` has settled once queued work has run.
async function isSettled(promise: Promise<void>): Promise<boolean> {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  return settled;
}

describe('createPageCommands', () => {
  it.each([
    { case: 'no page', page: false, isStarted: true },
    { case: 'a page still starting', page: true, isStarted: false },
  ])('run_NoPageOrNotStarted_LogsAndResolves: $case', async (row) => {
    const { commands, logs, send } = setup(row.page, row.isStarted);

    await commands.run('p.go', undefined);

    expect(logs).toEqual(['commands: p.go not run: no page']);
    expect(send).not.toHaveBeenCalled();
  });

  it('run_PageAnswers_ResolvesOnDone', async () => {
    const { commands, send, done } = setup(true, true);

    const first = commands.run('p.go', 3);
    const second = commands.run('p.other', undefined);
    const [, firstRequest, id, arg] = send.mock.calls[0];
    const [, secondRequest] = send.mock.calls[1];

    expect(send.mock.calls[0][0]).toBe(BRIDGE_CHANNELS.commandRunInPage);
    expect([id, arg]).toEqual(['p.go', 3]);
    expect(firstRequest).not.toBe(secondRequest);
    expect(await isSettled(first)).toBe(false);

    done(firstRequest);

    expect(await isSettled(first)).toBe(true);
    expect(await isSettled(second)).toBe(false);
  });

  it('pageGone_WaitingRun_LogsAndResolves', async () => {
    const { commands, logs, send, done } = setup(true, true);
    const answered = commands.run('p.answered', undefined);
    const waiting = commands.run('p.waiting', undefined);
    done(send.mock.calls[0][1]);
    await answered;

    commands.pageGone();

    await waiting;
    expect(logs).toEqual(['commands: p.waiting ended with the page']);
  });
});
