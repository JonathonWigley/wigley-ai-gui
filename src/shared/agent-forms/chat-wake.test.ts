import { describe, expect, it } from 'vitest';
import type { UserMessage } from '../../contracts/agent';
import { type ChatFormWakeTarget, createChatFormWake } from './chat-wake';

const TEXT = 'The user submitted the round "Naming" in the forms app.';
const APPROVAL = 'Approved in form: push main past PR protection';

// A chat whose `profileOf` answers `profile` for every session, recording
// each send and settling it with `sendResult`; `sent` holds plain sends and
// `sentIntoTurn` the sends into a running turn.
function fakeChat(
  profile: string | null,
  sendResult: () => Promise<void> = () => Promise.resolve(),
): ChatFormWakeTarget & {
  sent: [string, UserMessage][];
  sentIntoTurn: [string, UserMessage][];
} {
  const sent: [string, UserMessage][] = [];
  const sentIntoTurn: [string, UserMessage][] = [];
  return {
    sent,
    sentIntoTurn,
    profileOf: () => profile,
    send: (sessionId, message) => {
      sent.push([sessionId, message]);
      return sendResult();
    },
    sendIntoTurn: async (sessionId, message) => {
      sentIntoTurn.push([sessionId, message]);
      await sendResult();
      return true;
    },
  };
}

describe('createChatFormWake', () => {
  it.each([
    {
      session: 'owned by chat',
      profile: 'claude',
      expected: [['s1', { text: TEXT, images: [] }]],
    },
    { session: 'chat does not own', profile: null, expected: [] },
  ])('sends the wake text to a session $session', ({ profile, expected }) => {
    const chat = fakeChat(profile);

    createChatFormWake(chat, () => {}).formFinishedUnheard('s1', TEXT);

    expect(chat.sent).toEqual(expected);
  });

  it('logs a send that rejects, without throwing', async () => {
    const chat = fakeChat('claude', () =>
      Promise.reject(new Error('process gone')),
    );
    const logged: string[] = [];
    const wake = createChatFormWake(chat, (message: string) =>
      logged.push(message),
    );

    expect(() => wake.formFinishedUnheard('s1', TEXT)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('s1');
    expect(logged[0]).toContain('process gone');
  });

  it.each([
    {
      session: 'owned by chat',
      profile: 'claude',
      expected: [['s1', { text: APPROVAL, images: [] }]],
      isQueued: true,
    },
    {
      session: 'chat does not own',
      profile: null,
      expected: [],
      isQueued: false,
    },
  ])(
    'sends a message ahead of the answers into the turn of a session $session',
    async ({ profile, expected, isQueued }) => {
      const chat = fakeChat(profile);

      const queued = await createChatFormWake(chat, () => {}).sendBeforeAnswers(
        's1',
        APPROVAL,
      );

      expect(queued).toBe(isQueued);
      expect(chat.sentIntoTurn).toEqual(expected);
      expect(chat.sent).toEqual([]);
    },
  );

  it('settles a message ahead of the answers whose send rejects, logging it', async () => {
    const chat = fakeChat('claude', () =>
      Promise.reject(new Error('process gone')),
    );
    const logged: string[] = [];

    const queued = await createChatFormWake(chat, (message: string) =>
      logged.push(message),
    ).sendBeforeAnswers('s1', APPROVAL);

    expect(queued).toBe(false);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('process gone');
  });
});
