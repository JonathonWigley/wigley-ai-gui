import { describe, expect, it } from 'vitest';
import {
  fakeDependency,
  type PagePartHarness,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { type ChatPageExports, chatPageKey } from '../../chat/contract';
import type { WorkStartResult } from '../contract';
import type { workManifest } from '../manifest';
import { workPagePart } from './start';

type WorkHarness = PagePartHarness<typeof workManifest>;
type WorkCommand = keyof (typeof workManifest)['commands'];
type Handler = (context: { arg: unknown }) => void | Promise<void>;

// The part over a main that records each invoke and answers it with `answer`, and over a chat page whose
// `newSessionWithDraft` records each text and resolves to `draftRow`.
function startOver(
  answer: (method: string) => Promise<unknown>,
  draftRow: string | null = null,
) {
  const invokes: [string, unknown[]][] = [];
  const drafts: string[] = [];
  const harness = startPagePart(workPagePart, {
    invoke: (method, ...args) => {
      invokes.push([method, args]);
      return answer(method);
    },
    dependencies: [
      fakeDependency(
        chatPageKey,
        () =>
          ({
            newSessionWithDraft: (text: string) => {
              drafts.push(text);
              return Promise.resolve(draftRow);
            },
          }) as unknown as ChatPageExports,
      ),
    ],
  });
  return { harness, invokes, drafts };
}

// Runs the page handler of `command` with `arg`.
async function run(harness: WorkHarness, command: WorkCommand, arg: unknown) {
  const handler = harness.started().commands[command] as unknown as Handler;
  await handler({ arg });
}

const toastsOf = (harness: WorkHarness) =>
  harness.logs
    .filter(({ message }) => message.startsWith('toast '))
    .map(({ message }) => message);

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
    {
      command: 'comment',
      arg: { cardId: 'WS-1', text: 'Hi' },
      args: [{ cardId: 'WS-1', text: 'Hi' }],
    },
    { command: 'acceptSuggestion', arg: 'WS-2', args: ['WS-2'] },
    { command: 'notYet', arg: 'WS-3', args: ['WS-3'] },
    { command: 'deleteTask', arg: 'local-1', args: ['local-1'] },
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

  const arg = { source: 'card', id: 'XYZ-3' };
  const prompt: WorkStartResult = {
    kind: 'prompt',
    message: 'Work on XYZ-3: Fix the crash',
    cardIds: ['XYZ-3'],
  };

  it.each<{
    name: string;
    result: WorkStartResult;
    draftRow: string | null;
    drafts: string[];
    invokes: [string, unknown[]][];
    toasts: string[];
  }>([
    {
      name: 'launched toasts its text and links nothing',
      result: { kind: 'launched', toast: 'Session started in gamma' },
      draftRow: 'row-9',
      drafts: [],
      invokes: [['startSession', [arg]]],
      toasts: ['toast success: Session started in gamma'],
    },
    {
      name: 'prompt with a row id links the cards to it',
      result: prompt,
      draftRow: 'row-9',
      drafts: [prompt.message],
      invokes: [
        ['startSession', [arg]],
        ['linkSession', [{ cardIds: ['XYZ-3'], sessionId: 'row-9' }]],
      ],
      toasts: [],
    },
    {
      name: 'prompt with null links nothing',
      result: prompt,
      draftRow: null,
      drafts: [prompt.message],
      invokes: [['startSession', [arg]]],
      toasts: [],
    },
    {
      name: 'prompt with no cards links nothing',
      result: { ...prompt, cardIds: [] },
      draftRow: 'row-9',
      drafts: [prompt.message],
      invokes: [['startSession', [arg]]],
      toasts: [],
    },
  ])(
    'startSession ($name)',
    async ({ result, draftRow, drafts, invokes, toasts }) => {
      const started = startOver(
        (method) =>
          Promise.resolve(method === 'startSession' ? result : undefined),
        draftRow,
      );

      await run(started.harness, 'startSession', arg);

      expect(started.drafts).toEqual(drafts);
      expect(started.invokes).toEqual(invokes);
      expect(toastsOf(started.harness)).toEqual(toasts);
      await started.harness.stop();
    },
  );

  it('startSession (a rejecting startSession rejects the handler)', async () => {
    const refusing = startOver(
      () => Promise.reject(new Error('No card XYZ-3')),
      'row-9',
    );

    await expect(run(refusing.harness, 'startSession', arg)).rejects.toThrow(
      'No card XYZ-3',
    );
    expect(refusing.drafts).toEqual([]);
    await refusing.harness.stop();
  });
});
