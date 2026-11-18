import { DEMO_HARNESS_ID } from '../../../contracts/demo';
import type {
  ChannelShape,
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { type ChatMainEvents, chatMainKey } from '../../chat/contract';
import {
  type SessionsMainEvents,
  sessionsMainKey,
} from '../../sessions/contract';
import { sessionLogManifest } from '../manifest';
import { recentlyClosed, sampleRecentlyClosed } from './recently-closed';
import { createSessionEventLog } from './session-event-log';
import { sessionLogSelfTestScript } from './selftest-script';

type SessionLogApi = MainApi<
  typeof sessionLogManifest,
  ChannelShape,
  Record<never, never>,
  QualifiedEvents<'chat', ChatMainEvents> &
    QualifiedEvents<'sessions', SessionsMainEvents>
>;

// Writes one log line for each lifecycle event, gives chat the Recently closed
// section over the log, which reads the file and `recentlyClosedCount` at each
// ask, and hands the self-test its script. While the demo runs (the demo
// harness is registered) the section answers sample rows and reads no log. A
// quit writes no close: this part stops before chat, and chat's stop closes
// nothing. An ephemeral row's events write nothing, so a later run's Recently
// closed never lists it.
export const sessionLogMainPart: MainPart<typeof sessionLogManifest> = {
  manifest: sessionLogManifest,
  start(api: SessionLogApi) {
    const chat = api.dependency(chatMainKey);
    const eventLog = createSessionEventLog({
      files: api.data,
      log: api.services.log,
    });
    const now = () => api.services.clock.now();

    api.events.on('chat.sessionOpened', (opened) => {
      if (opened.ephemeral === true) {
        return;
      }
      void eventLog.append({
        at: now(),
        event: 'opened',
        sessionId: opened.sessionId,
        hostSessionId: opened.hostSessionId,
        projectDir: opened.projectDir,
        profile: opened.profile,
        origin: opened.origin,
      });
    });
    api.events.on('chat.sessionClosed', (closed) => {
      if (closed.ephemeral === true) {
        return;
      }
      void eventLog.append({ at: now(), event: 'closed', ...closed });
    });
    api.events.on('chat.sessionCleared', (cleared) => {
      if (cleared.ephemeral === true) {
        return;
      }
      void eventLog.append({ at: now(), event: 'cleared', ...cleared });
    });
    api.events.on('chat.processEnded', (ended) => {
      if (ended.ephemeral === true) {
        return;
      }
      void eventLog.append({ at: now(), event: 'processEnded', ...ended });
    });
    api.events.on('chat.sessionArchived', (archived) => {
      void eventLog.append({ at: now(), event: 'archived', ...archived });
    });

    const terminalRows = new Map<
      string,
      { hostSessionId: string | null; projectDir: string | null }
    >();
    api.events.on('sessions.connected', ({ id, info, owned }) => {
      if (owned) {
        return;
      }
      const { sessionId: hostSessionId, projectDir, harness } = info;
      terminalRows.set(id, { hostSessionId, projectDir });
      void eventLog.append({
        at: now(),
        event: 'terminalConnected',
        sessionId: id,
        hostSessionId,
        projectDir,
        harness,
      });
    });
    api.events.on('sessions.ended', ({ sessionId }) => {
      const row = terminalRows.get(sessionId);
      if (row === undefined) {
        return;
      }
      terminalRows.delete(sessionId);
      void eventLog.append({
        at: now(),
        event: 'terminalEnded',
        sessionId,
        ...row,
      });
    });

    const { services } = api;
    const sampleProjectDir = services.paths.join(
      services.homeDir,
      'dev',
      'sample-app',
    );
    chat.addResumeSection({
      title: 'Recently closed',
      rows: async (isResumable) => {
        const count = api.settings().recentlyClosedCount;
        if (services.agentHarnesses.get(DEMO_HARNESS_ID) !== null) {
          return sampleRecentlyClosed(
            now(),
            count,
            sampleProjectDir,
            isResumable,
          );
        }
        return recentlyClosed(await eventLog.entries(), count, isResumable);
      },
    });

    services.selfTest?.run(
      sessionLogSelfTestScript({
        homeDir: services.homeDir,
        files: services.files,
        paths: services.paths,
        chat,
        sessions: api.dependency(sessionsMainKey),
      }),
    );

    return { commands: {}, dispose: () => eventLog.settled() };
  },
};
