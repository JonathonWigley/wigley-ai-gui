import { describe, expect, it } from 'vitest';
import type { UserMessage } from '../../contracts/agent';
import { type ChatFormWakeTarget, createChatFormWake } from './chat-wake';

const TEXT = 'The user submitted the round "Naming" in the forms app.';

// A chat whose `profileOf` answers `profile` for every session, recording
// each send and settling it with `sendResult`.
function fakeChat(
  profile: string | null,
  sendResult: () => Promise<void> = () => Promise.resolve(),
): ChatFormWakeTarget & { sent: [string, UserMessage][] } {
  const sent: [string, UserMessage][] = [];
  return {
    sent,
    profileOf: () => profile,
    send: (sessionId, message) => {
      sent.push([sessionId, message]);
      return sendResult();
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
});
