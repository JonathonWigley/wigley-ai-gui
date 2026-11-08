import { describe, expect, it } from 'vitest';
import { readIfPresent } from '../../../contracts/files';
import {
  fakeDependency,
  noCounts,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type ChatMainExports,
  chatMainKey,
  type ResumeSection,
} from '../../chat/contract';
import {
  type SessionsMainExports,
  sessionsMainKey,
} from '../../sessions/contract';
import { sessionStashMainPart } from './start';
import { STASHED_FILE } from './stash-store';

const STASHED_PATH = `/data/session-stash/${STASHED_FILE}`;

const closedEvent = (sessionId: string) => ({
  sessionId,
  hostSessionId: `host-${sessionId}`,
  projectDir: `/projects/${sessionId}`,
  profile: 'work',
  titles: { user: 'Parked', agent: null, firstMessage: 'hello' },
  sent: true,
  reason: 'user',
});

// The part on the harness, over a chat that owns every session but
// `terminal` and records each section.
function startPart() {
  const sections: ResumeSection[] = [];
  const harness = startMainPart(sessionStashMainPart, {
    dependencies: [
      fakeDependency(
        chatMainKey,
        (consumer) =>
          ({
            profileOf: (sessionId: string) =>
              sessionId === 'terminal' ? null : 'work',
            addResumeSection(section: ResumeSection) {
              sections.push(section);
              return consumer.track({ dispose: () => undefined });
            },
          }) as unknown as ChatMainExports,
      ),
      fakeDependency(
        sessionsMainKey,
        () => ({}) as unknown as SessionsMainExports,
      ),
    ],
  });
  return { harness, sections };
}

// Stopping waits for the last write, so the file then holds every stash.
async function stopAndReadStashed(
  part: ReturnType<typeof startPart>,
): Promise<unknown> {
  await part.harness.stop();
  const text = await readIfPresent(part.harness.files, STASHED_PATH);
  return text === null ? [] : (JSON.parse(text) as unknown);
}

describe('sessionStashMainPart', () => {
  it('stop_LeavesNoLiveRegistration', async () => {
    const part = startPart();

    await part.harness.stop();

    expect(part.harness.counts()).toEqual(noCounts);
  });

  it.each([
    {
      given: 'a message sent while the close confirm is open',
      run: (part: ReturnType<typeof startPart>) => {
        expect(
          part.harness.invoke('stash', { sessionId: 's1', note: 'n' }),
        ).toBe(true);
        part.harness.emit('chat.messageSent', {
          sessionId: 's1',
          entryId: 'e1',
        });
        part.harness.emit('chat.sessionClosed', closedEvent('s1'));
      },
      hosts: ['host-s1'],
    },
    {
      given: 'a close kept open, then a later plain close',
      run: (part: ReturnType<typeof startPart>) => {
        part.harness.invoke('stash', { sessionId: 's1', note: 'n' });
        part.harness.invoke('drop', 's1');
        part.harness.emit('chat.sessionClosed', closedEvent('s1'));
      },
      hosts: [],
    },
    {
      given: 'a page reloaded while the close confirm was open',
      run: (part: ReturnType<typeof startPart>) => {
        part.harness.invoke('stash', { sessionId: 's1', note: 'n' });
        part.harness.invoke('forgetKept');
        part.harness.emit('chat.sessionClosed', closedEvent('s1'));
      },
      hosts: [],
    },
    {
      given: 'a session chat does not own',
      run: (part: ReturnType<typeof startPart>) => {
        expect(
          part.harness.invoke('stash', { sessionId: 'terminal', note: 'n' }),
        ).toBe(false);
        part.harness.emit('chat.sessionClosed', closedEvent('terminal'));
      },
      hosts: [],
    },
  ])('stash_CloseOutcome_WritesOnlyALandedClose given $given', async (test) => {
    const part = startPart();

    test.run(part);

    const stashed = (await stopAndReadStashed(part)) as {
      hostSessionId: string;
    }[];
    expect(stashed.map((record) => record.hostSessionId)).toEqual(test.hosts);
  });

  it('start_RegistersTheStashedSection', () => {
    const part = startPart();

    expect(part.sections.map((section) => section.title)).toEqual(['Stashed']);
  });
});
