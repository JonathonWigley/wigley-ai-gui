import { describe, expect, it, vi } from 'vitest';
import type { AgentHarness } from '../../../contracts/agent';
import { DEMO_HARNESS_ID } from '../../../contracts/demo';
import { readIfPresent } from '../../../contracts/files';
import { harnessRegistryOf } from '../../../shared/agent-harness-registry.test-support';
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
import { SESSION_EVENTS_FILE } from './session-event-log';
import { sessionLogMainPart } from './start';

const LOG_PATH = `/data/session-log/${SESSION_EVENTS_FILE}`;
const TITLES = { user: 'Renamed', agent: null, firstMessage: 'hello' };

const closedEvent = (hostSessionId: string) => ({
  sessionId: `row-${hostSessionId}`,
  hostSessionId,
  projectDir: `/projects/${hostSessionId}`,
  profile: 'work',
  titles: TITLES,
  sent: true,
  reason: 'user',
});

// The part on the harness, over a chat that records each section and files its
// handle with `consumer.track`, as chat's view does. `setting` is the object the
// part reads its settings from; `agentHarnesses` is the registry it reads.
function startPart(agentHarnesses = harnessRegistryOf([])) {
  const setting = { recentlyClosedCount: 10 };
  const sections = new Set<ResumeSection>();
  const harness = startMainPart(sessionLogMainPart, {
    settings: setting,
    services: { agentHarnesses },
    dependencies: [
      fakeDependency(
        chatMainKey,
        (consumer) =>
          ({
            addResumeSection(section: ResumeSection) {
              sections.add(section);
              return consumer.track({
                dispose: () => sections.delete(section),
              });
            },
          }) as unknown as ChatMainExports,
      ),
    ],
  });
  return { setting, sections, harness };
}

// Stopping waits for the last append, so the file then holds every line.
async function stopAndReadLines(
  part: ReturnType<typeof startPart>,
): Promise<unknown[]> {
  await part.harness.stop();
  const text = await readIfPresent(part.harness.files, LOG_PATH);
  return text === null
    ? []
    : text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as unknown);
}

describe('sessionLogMainPart', () => {
  it('connected_OwnedRow_WritesNothing', async () => {
    const part = startPart();

    part.harness.emit('sessions.connected', {
      id: 'row-1',
      info: {
        sessionId: 'h1',
        projectDir: '/projects/one',
        harness: 'claude',
        rowId: null,
      },
      owned: true,
    });
    part.harness.emit('sessions.ended', { sessionId: 'row-1' });

    expect(await stopAndReadLines(part)).toEqual([]);
  });

  it('connected_TerminalRow_WritesBothLines', async () => {
    const part = startPart();

    part.harness.advance(100);
    part.harness.emit('sessions.connected', {
      id: 'row-1',
      info: {
        sessionId: 'h1',
        projectDir: null,
        harness: null,
        rowId: null,
      },
      owned: false,
    });
    part.harness.advance(100);
    part.harness.emit('sessions.ended', { sessionId: 'row-1' });
    part.harness.emit('sessions.ended', { sessionId: 'row-1' });

    expect(await stopAndReadLines(part)).toEqual([
      {
        at: 100,
        event: 'terminalConnected',
        sessionId: 'row-1',
        hostSessionId: 'h1',
        projectDir: null,
        harness: null,
      },
      {
        at: 200,
        event: 'terminalEnded',
        sessionId: 'row-1',
        hostSessionId: 'h1',
        projectDir: null,
      },
    ]);
  });

  it.each([
    {
      name: 'chat.sessionOpened',
      data: {
        sessionId: 'row-1',
        profileDir: '~/.claude-work',
        hostSessionId: 'h1',
        projectDir: '/projects/one',
        profile: 'work',
        origin: 'restored',
      },
      line: {
        event: 'opened',
        sessionId: 'row-1',
        hostSessionId: 'h1',
        projectDir: '/projects/one',
        profile: 'work',
        origin: 'restored',
      },
    },
    {
      name: 'chat.sessionClosed',
      data: closedEvent('h1'),
      line: { event: 'closed', ...closedEvent('h1') },
    },
    {
      name: 'chat.sessionCleared',
      data: {
        sessionId: 'row-1',
        oldHostSessionId: 'h1',
        newHostSessionId: 'h2',
        projectDir: '/projects/one',
        profile: 'work',
        titles: TITLES,
        sent: false,
      },
      line: {
        event: 'cleared',
        sessionId: 'row-1',
        oldHostSessionId: 'h1',
        newHostSessionId: 'h2',
        projectDir: '/projects/one',
        profile: 'work',
        titles: TITLES,
        sent: false,
      },
    },
    {
      name: 'chat.processEnded',
      data: {
        sessionId: 'row-1',
        hostSessionId: 'h1',
        reason: 'crash',
        code: 3,
        error: 'boom',
      },
      line: {
        event: 'processEnded',
        sessionId: 'row-1',
        hostSessionId: 'h1',
        reason: 'crash',
        code: 3,
        error: 'boom',
      },
    },
    {
      name: 'chat.sessionArchived',
      data: { hostSessionId: 'h1', archived: true },
      line: { event: 'archived', hostSessionId: 'h1', archived: true },
    },
  ])('chatEvents_EachEvent_WritesItsLine: $name', async (test) => {
    const part = startPart();

    part.harness.advance(5000);
    part.harness.emit(test.name, test.data);

    expect(await stopAndReadLines(part)).toEqual([{ at: 5000, ...test.line }]);
  });

  // Breaks if a demo session's lifecycle reaches the log, where a later run's
  // Recently closed would list it.
  it.each([
    {
      name: 'chat.sessionOpened',
      data: {
        sessionId: 'row-1',
        profileDir: '~/.claude-work',
        hostSessionId: 'h1',
        projectDir: '/projects/one',
        profile: 'work',
        origin: 'launched',
        ephemeral: true,
      },
    },
    {
      name: 'chat.sessionClosed',
      data: { ...closedEvent('h1'), ephemeral: true },
    },
    {
      name: 'chat.sessionCleared',
      data: {
        sessionId: 'row-1',
        oldHostSessionId: 'h1',
        newHostSessionId: 'h2',
        projectDir: '/projects/one',
        profile: 'work',
        titles: TITLES,
        sent: true,
        ephemeral: true,
      },
    },
    {
      name: 'chat.processEnded',
      data: {
        sessionId: 'row-1',
        hostSessionId: 'h1',
        reason: 'clean',
        code: 0,
        error: null,
        ephemeral: true,
      },
    },
  ])('chatEvents_Ephemeral_WritesNothing: $name', async (test) => {
    const part = startPart();

    part.harness.emit(test.name, test.data);

    expect(await stopAndReadLines(part)).toEqual([]);
  });

  it('section_CountSetting_ReadAtEachAsk', async () => {
    const part = startPart();
    for (const host of ['h1', 'h2', 'h3']) {
      part.harness.emit('chat.sessionClosed', closedEvent(host));
    }
    const [section] = part.sections;
    const hosts = async () =>
      (await section.rows(() => true)).map((row) => row.hostSessionId);

    expect(await hosts()).toEqual(['h1', 'h2', 'h3']);

    part.setting.recentlyClosedCount = 1;
    expect(await hosts()).toEqual(['h3']);
  });

  // Breaks if a team demo's start prompt lists the user's closed sessions.
  it('the section answers samples while the demo runs', async () => {
    const harnesses = harnessRegistryOf([]);
    const part = startPart(harnesses);
    part.harness.emit('chat.sessionClosed', closedEvent('h1'));
    const [section] = part.sections;
    const hosts = async () =>
      (await section.rows(() => true)).map((row) => row.hostSessionId);
    const demo = harnesses.register({
      id: DEMO_HARNESS_ID,
    } as unknown as AgentHarness);

    expect(await hosts()).toEqual([
      'demo-closed-1',
      'demo-closed-2',
      'demo-closed-3',
    ]);

    demo.dispose();
    expect(await hosts()).toEqual(['h1']);
  });

  it('dispose_WaitsForLastAppend', async () => {
    const part = startPart();
    let release = () => {};
    vi.spyOn(part.harness.files, 'append').mockReturnValueOnce(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    part.harness.emit('chat.sessionArchived', {
      hostSessionId: 'h1',
      archived: true,
    });
    let isStopped = false;

    const stopping = part.harness.stop().then(() => {
      isStopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(isStopped).toBe(false);

    release();
    await stopping;
    expect(part.sections.size).toBe(0);
    expect(part.harness.counts()).toEqual(noCounts);
  });
});
