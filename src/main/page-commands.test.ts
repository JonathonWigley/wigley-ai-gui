import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { BRIDGE_CHANNELS } from '../contracts/bridge';
import type { CommandOutcome } from '../contracts/commands';
import { createPageCommands } from './page-commands';

type Done = (
  event: unknown,
  request: number,
  outcome: CommandOutcome,
  errorText: string | null,
) => void;

function setup(page: boolean, isStarted: boolean) {
  const logs: string[] = [];
  const send = vi.fn();
  let done: Done = () => {};
  const commands = createPageCommands({
    page: () => (page ? ({ send } as unknown as WebContents) : null),
    isStarted: () => isStarted,
    ipc: {
      on(channel: string, listener: (event: never, ...args: never[]) => void) {
        if (channel === BRIDGE_CHANNELS.commandRunDone) {
          done = listener as Done;
        }
        return undefined as never;
      },
    },
    log: (source, message) => logs.push(`${source}: ${message}`),
  });
  return {
    commands,
    logs,
    send,
    done: (
      request: number,
      outcome: CommandOutcome = 'ran',
      errorText: string | null = null,
    ) => done({}, request, outcome, errorText),
  };
}

// Whether `promise` has settled once queued work has run.
async function isSettled(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  const markSettled = () => {
    settled = true;
  };
  void promise.then(markSettled, markSettled);
  await Promise.resolve();
  await Promise.resolve();
  return settled;
}

describe('createPageCommands', () => {
  it.each([
    {
      case: 'no page',
      page: false,
      isStarted: true,
      reportErrors: undefined,
    },
    {
      case: 'a page still starting',
      page: true,
      isStarted: false,
      reportErrors: undefined,
    },
    {
      case: 'no page, reporting',
      page: false,
      isStarted: true,
      reportErrors: true,
    },
    {
      case: 'a page still starting, reporting',
      page: true,
      isStarted: false,
      reportErrors: true,
    },
  ] as const)('run_NoPageOrNotStarted_LogsAndResolves: $case', async (row) => {
    const { commands, logs, send } = setup(row.page, row.isStarted);

    const run = commands.run('p.go', undefined, {
      reportErrors: row.reportErrors,
    });

    if (row.reportErrors) {
      await expect(run).rejects.toThrow(/^p\.go not run: no page$/);
      expect(logs).toEqual([]);
    } else {
      await expect(run).resolves.toBe('skipped');
      expect(logs).toEqual(['commands: p.go not run: no page']);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('run_PageAnswers_SendsTheHopAndResolvesOnDone', async () => {
    const { commands, send, done } = setup(true, true);
    const hop = { targetSessionId: 's1', callerSessionId: 'c1' };

    const first = commands.run('p.go', 3, hop);
    const second = commands.run('p.other', undefined);
    const [channel, firstRequest, id, arg, sentHop] = send.mock.calls[0];
    const [, secondRequest] = send.mock.calls[1];

    expect(channel).toBe(BRIDGE_CHANNELS.commandRunInPage);
    expect([id, arg, sentHop]).toEqual(['p.go', 3, hop]);
    expect(firstRequest).not.toBe(secondRequest);
    expect(await isSettled(first)).toBe(false);

    done(firstRequest, 'skipped');

    await expect(first).resolves.toBe('skipped');
    expect(await isSettled(second)).toBe(false);
  });

  it.each([
    { case: 'plain', reportErrors: undefined },
    { case: 'reporting', reportErrors: true },
  ] as const)(
    'run_PageSendsErrorText_RejectsOnlyAReportingRun: $case',
    async ({ reportErrors }) => {
      const { commands, send, done } = setup(true, true);

      const run = commands.run('p.go', undefined, { reportErrors });
      done(send.mock.calls[0][1], 'skipped', 'boom');

      if (reportErrors) {
        await expect(run).rejects.toThrow(/^boom$/);
      } else {
        await expect(run).resolves.toBe('skipped');
      }
    },
  );

  it.each([
    { case: 'plain', reportErrors: undefined },
    { case: 'reporting', reportErrors: true },
  ] as const)(
    'pageGone_WaitingRun_LogsAndResolves: $case',
    async ({ reportErrors }) => {
      const { commands, logs, send, done } = setup(true, true);
      const answered = commands.run('p.answered', undefined, { reportErrors });
      const waiting = commands.run('p.waiting', undefined, { reportErrors });
      done(send.mock.calls[0][1]);
      await answered;

      commands.pageGone();

      if (reportErrors) {
        await expect(waiting).rejects.toThrow(
          /^p\.waiting ended with the page$/,
        );
      } else {
        await expect(waiting).resolves.toBe('skipped');
      }
      expect(logs).toEqual(['commands: p.waiting ended with the page']);
    },
  );
});
