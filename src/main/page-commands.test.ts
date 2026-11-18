import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { BRIDGE_CHANNELS } from '../contracts/bridge';
import type { CommandOutcome } from '../contracts/commands';
import { createPageCommands } from './page-commands';

type Done = (
  event: unknown,
  request: unknown,
  outcome: unknown,
  errorText: unknown,
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
    // No default for `outcome`: a row passing `undefined` must reach the
    // listener as a missing outcome.
    done: (request: unknown, outcome: unknown, errorText: unknown = null) =>
      done({}, request, outcome, errorText),
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
  ] as const)(
    'run_NoPageOrNotStarted_SkipsWithALogOrRejectsAReportingRun: $case',
    async (row) => {
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
    },
  );

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

  // `settles` is the outcome the run resolves, or the error text it rejects
  // with as a pattern.
  it.each<{
    case: string;
    reportErrors: true | undefined;
    outcome: unknown;
    errorText: unknown;
    settles: CommandOutcome | RegExp;
  }>([
    {
      case: 'error text, plain',
      reportErrors: undefined,
      outcome: 'skipped',
      errorText: 'boom',
      settles: 'skipped',
    },
    {
      case: 'error text, reporting',
      reportErrors: true,
      outcome: 'skipped',
      errorText: 'boom',
      settles: /^boom$/,
    },
    {
      case: 'a non-string error, plain',
      reportErrors: undefined,
      outcome: 'ran',
      errorText: 42,
      settles: 'ran',
    },
    {
      case: 'a non-string error, reporting',
      reportErrors: true,
      outcome: 'ran',
      errorText: { message: 'boom' },
      settles: /^p\.go failed with no error text from the page$/,
    },
    {
      case: 'an unknown outcome',
      reportErrors: true,
      outcome: 'done',
      errorText: null,
      settles: 'skipped',
    },
    {
      case: 'a missing outcome',
      reportErrors: undefined,
      outcome: undefined,
      errorText: null,
      settles: 'skipped',
    },
  ])(
    'run_PageReplies_ResolvesATypedOutcomeOrRejectsAReportingRunWithItsError: $case',
    async ({ reportErrors, outcome, errorText, settles }) => {
      const { commands, send, done } = setup(true, true);

      const run = commands.run('p.go', undefined, { reportErrors });
      done(send.mock.calls[0][1], outcome, errorText);

      if (settles instanceof RegExp) {
        await expect(run).rejects.toThrow(settles);
      } else {
        await expect(run).resolves.toBe(settles);
      }
    },
  );

  it.each([
    { case: 'plain', reportErrors: undefined },
    { case: 'reporting', reportErrors: true },
  ] as const)(
    'pageGone_WaitingRun_LogsAndSkipsOrRejectsAReportingRun: $case',
    async ({ reportErrors }) => {
      const { commands, logs, send, done } = setup(true, true);
      const answered = commands.run('p.answered', undefined, { reportErrors });
      const waiting = commands.run('p.waiting', undefined, { reportErrors });
      done(send.mock.calls[0][1], 'ran');
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
