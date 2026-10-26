import path from 'node:path';
import type { Disposable } from '../../../contracts/disposable';
import type {
  DriveHost,
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import {
  argsObject,
  nullableStringOr,
  optionalOneOf,
  optionalString,
  requiredString,
} from '../../../shared/drive-args';
import { createAgentFormChannelPresenter } from '../../../shared/agent-forms/channel-presenter';
import { createAgentFormService } from '../../../shared/agent-forms/form-service';
import { createFolderFormStore } from '../../../shared/agent-forms/form-store';
import { createAgentFormToolSession } from '../../../shared/agent-forms/tool-session';
import {
  type ConnectedSession,
  DRIVE_SESSION_DEFAULTS,
  HARNESSES,
  type Harness,
  type SessionsMainEvents,
  type SessionsMainExports,
  type ToolResult,
} from '../../sessions/contract';
import { PRIMER_ERROR_NAME, type PrimerChannel } from '../contract';
import { primerManifest } from '../manifest';
import {
  connectFixtureSession,
  openFixturePrimer,
  SAMPLE_PRIMER_ARGS,
} from './fixtures';
import { primerType } from './primer-type';
import { primerSelfTestScript } from './selftest-script';
import { PRIMER_TOOLS } from './tool-definitions';

type PrimerApi = MainApi<
  typeof primerManifest,
  PrimerChannel,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsMainEvents>
>;

// A session primer opened for a drive run, whether it has since ended, and
// where its latest primer stands.
interface DrivePrimerSession {
  connected: ConnectedSession;
  ended: boolean;
  latest:
    | { state: 'pending' }
    | { state: 'resolved'; result: ToolResult }
    | { state: 'failed'; error: unknown };
}

// Opens primers in a drive run's sessions and reads their answers. A
// session's id is `drive-primer-<n>` unless the caller names one; a name
// primer opened before reuses that session while it is live, and connects a
// fresh one once it has ended. `onSessionEnded` hears each session that ends,
// by its row id. Disposing removes the actions and ends every live session
// primer opened.
export function addDriveActions(
  host: DriveHost,
  sessions: Pick<SessionsMainExports, 'connect'>,
  onSessionEnded: (listener: (rowId: string) => void) => void,
): Disposable {
  const opened = new Map<string, DrivePrimerSession>();
  let defaultIds = 0;
  onSessionEnded((rowId) => {
    for (const session of opened.values()) {
      if (session.connected.session.id === rowId) {
        session.ended = true;
      }
    }
  });
  const sessionFor = (spec: {
    sessionId: string;
    projectDir: string | null;
    harness: Harness;
  }): DrivePrimerSession => {
    const known = opened.get(spec.sessionId);
    if (known !== undefined && !known.ended) {
      return known;
    }
    const session: DrivePrimerSession = {
      connected: connectFixtureSession(sessions, {
        ...spec,
        deadlineSeconds: DRIVE_SESSION_DEFAULTS.deadlineSeconds,
      }),
      ended: false,
      latest: { state: 'pending' },
    };
    opened.set(spec.sessionId, session);
    return session;
  };
  const actions = [
    host.add('openPrimer', {
      description:
        'Opens a primer in the live session primer opened before under sessionId, or in a new one, without waiting for its answers; the default primer is the four-entry sample.',
      args: '{ sessionId?: string, projectDir?: string | null, harness?: "claude" | "codex", primer?: object }',
      async run(rawArgs) {
        const args = argsObject(rawArgs);
        const sessionId =
          optionalString(args, 'sessionId') ?? `drive-primer-${++defaultIds}`;
        const projectDir = nullableStringOr(
          args,
          'projectDir',
          DRIVE_SESSION_DEFAULTS.projectDir,
        );
        const harness =
          optionalOneOf(args, 'harness', HARNESSES) ??
          DRIVE_SESSION_DEFAULTS.harness;
        const primer =
          args.primer === undefined ? SAMPLE_PRIMER_ARGS : args.primer;
        const session = sessionFor({ sessionId, projectDir, harness });
        const pending: DrivePrimerSession['latest'] = { state: 'pending' };
        session.latest = pending;
        // A primer opened after this one stays the latest when this one settles.
        const settle = (latest: DrivePrimerSession['latest']) => {
          if (session.latest === pending) {
            session.latest = latest;
          }
        };
        openFixturePrimer(session.connected, primer).then(
          (result) => settle({ state: 'resolved', result }),
          (error: unknown) => settle({ state: 'failed', error }),
        );
        return { sessionId, rowId: session.connected.session.id };
      },
    }),
    host.add('answers', {
      description:
        "The latest primer's tool result once submit or cancel resolved it, else { pending: true }.",
      args: '{ sessionId: string }',
      async run(rawArgs) {
        const sessionId = requiredString(argsObject(rawArgs), 'sessionId');
        const session = opened.get(sessionId);
        if (session === undefined) {
          throw new Error(`no session ${sessionId} from primer.openPrimer`);
        }
        const { latest } = session;
        if (latest.state === 'failed') {
          throw latest.error;
        }
        return latest.state === 'resolved' ? latest.result : { pending: true };
      },
    }),
  ];
  return {
    dispose() {
      for (const action of actions) {
        action.dispose();
      }
      for (const session of opened.values()) {
        if (!session.ended) {
          session.connected.end();
        }
      }
      opened.clear();
    },
  };
}

// Serves open_primer and collect_last_primer to every agent session, saves
// each primer in the primer folder and shows it on the page; in the self-test
// it hands the driver its script, and in a drive run it adds the drive
// actions.
export const primerMainPart: MainPart<typeof primerManifest> = {
  manifest: primerManifest,
  start(api: PrimerApi) {
    const { services } = api;
    const sessions = api.dependency<SessionsMainExports>('sessions');
    const store = createFolderFormStore({
      dir: path.join(services.homeDir, '.agents', 'wigley-primer', 'primers'),
      clock: services.clock,
      randomHex: services.randomHex,
      paths: services.paths,
      log: services.log,
      logSource: 'primer',
    });
    store.prune();
    const presenter = createAgentFormChannelPresenter({
      channel: api.channel,
      alerts: services.alerts,
      source: 'primer',
      announceTitle: 'Feature primer ready',
      window: services.window,
      log: services.log,
      sessions,
    });
    const primer = createAgentFormService({
      type: primerType,
      presenter,
      store,
      defaultDeadlineSeconds: () => api.settings().deadlineSeconds,
    });
    sessions.contributeTools(PRIMER_TOOLS, (session) =>
      createAgentFormToolSession(
        primer.startSession(session),
        { open: 'open_primer', collect: 'collect_last_primer' },
        PRIMER_ERROR_NAME,
      ),
    );
    services.selfTest?.run(primerSelfTestScript(sessions));
    const driveActions =
      api.drive !== null
        ? addDriveActions(api.drive, sessions, (listener) =>
            api.events.on('sessions.ended', ({ sessionId }) =>
              listener(sessionId),
            ),
          )
        : null;
    return {
      commands: {},
      dispose: () => {
        driveActions?.dispose();
      },
    };
  },
};
