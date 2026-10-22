import path from 'node:path';
import type { Disposable } from '../../../contracts/disposable';
import type { DriveHost, MainApi, MainPart } from '../../../contracts/plugin';
import {
  argsObject,
  optionalNullableString,
  optionalOneOf,
  optionalString,
  requiredString,
} from '../../../shared/drive-args';
import { errorText } from '../../../shared/error-text';
import {
  type LayoutRegistry,
  startLayoutRegistry,
} from '../../../shared/layouts/layout-registry';
import {
  type ConnectedSession,
  DRIVE_SESSION_DEFAULTS,
  HARNESSES,
  type Harness,
  type SessionsMainExports,
  type ToolResult,
} from '../../sessions/contract';
import type { FormsChannel, FormsService } from '../contract';
import defaultLayout from '../layouts/default/layout.js?raw';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { formsManifest } from '../manifest';
import { createChannelPresenter } from './channel-presenter';
import { askFixtureRound, connectFixtureSession } from './fixtures';
import { createFormsService } from './forms-service';
import { createLayoutPreview } from './preview/layout-preview';
import { createMemoryRoundStore } from './preview/memory-round-store';
import { PREVIEW_ROUND_ARGS } from './preview/preview-round';
import { createRoundStore } from './round-store';
import { formsSelfTestScript, SELFTEST_LAYOUT } from './selftest-script';
import { FORMS_TOOLS } from './tool-definitions';
import { createFormsToolSession } from './tool-session';

type FormsApi = MainApi<typeof formsManifest, FormsChannel>;

// How many saved rounds the preview cycles through.
const PREVIEW_SAVED_ROUNDS = 20;

// The agents' FormsService over the saved-round folder, and the layout
// preview over a FormsService of its own whose store is in memory. Both share
// one presenter, which owns the channel's `finish` and `draft` handlers; the
// preview's rounds go through its quiet view.
function createForms(
  api: FormsApi,
  sessions: SessionsMainExports,
): { forms: FormsService; preview: { open(): void } } {
  const { services } = api;
  const store = createRoundStore({
    roundsDir: path.join(services.homeDir, '.agents', 'wigley-forms', 'rounds'),
    clock: services.clock,
    randomHex: services.randomHex,
    log: services.log,
  });
  store.prune();
  const presenter = createChannelPresenter(
    api.channel,
    services.alerts,
    services.window,
    services.log,
    sessions,
  );
  const defaultDeadlineSeconds = () => api.settings().deadlineSeconds;
  const forms = createFormsService({
    presenter,
    store,
    defaultDeadlineSeconds,
  });
  const preview = createLayoutPreview({
    sessions,
    forms: createFormsService({
      presenter: presenter.quiet,
      store: createMemoryRoundStore(services.clock, services.randomHex),
      defaultDeadlineSeconds,
    }),
    savedArgs: () => store.recentArgs(PREVIEW_SAVED_ROUNDS),
    log: services.log,
  });
  return { forms, preview };
}

// Starts the layout registry once `written` settles and serves it to the
// page; a handler called before the registry is ready answers once it is, and
// every handler rejects with the start's error when it failed.
function serveLayouts(
  api: FormsApi,
  written: Promise<void>,
): Promise<LayoutRegistry> {
  const { log } = api.services;
  const layouts = written.then(() =>
    startLayoutRegistry({
      data: api.data,
      send: (choice) => api.channel.send('layoutChanged', choice),
      log,
      logSource: 'forms',
      layoutTypes,
      defaultLayout,
    }),
  );
  layouts.catch((error: unknown) =>
    log('forms', `layouts not started: ${errorText(error)}`),
  );
  api.channel.handle('layout', async () => (await layouts).current());
  api.channel.handle('cycleLayout', async (step) =>
    (await layouts).cycle(step),
  );
  api.channel.handle('copyLayout', async () => (await layouts).copy());
  return layouts;
}

// A session forms opened for a drive run, and where its latest round stands.
interface DriveFormsSession {
  connected: ConnectedSession;
  latest:
    | { state: 'pending' }
    | { state: 'resolved'; result: ToolResult }
    | { state: 'failed'; error: unknown };
}

// Opens rounds in a drive run's sessions and reads their answers. A session's
// id is `drive-forms-<n>` unless the caller names one; a name forms opened
// before reuses that session. Disposing removes the actions and ends every
// session forms opened.
export function addDriveActions(
  host: DriveHost,
  sessions: Pick<SessionsMainExports, 'connect'>,
): Disposable {
  const opened = new Map<string, DriveFormsSession>();
  let defaultIds = 0;
  const sessionFor = (spec: {
    sessionId: string;
    projectDir: string | null;
    harness: Harness;
  }): DriveFormsSession => {
    const known = opened.get(spec.sessionId);
    if (known !== undefined) {
      return known;
    }
    const session: DriveFormsSession = {
      connected: connectFixtureSession(sessions, {
        ...spec,
        deadlineSeconds: DRIVE_SESSION_DEFAULTS.deadlineSeconds,
      }),
      latest: { state: 'pending' },
    };
    opened.set(spec.sessionId, session);
    return session;
  };
  const actions = [
    host.add('openRound', {
      description:
        'Asks a round in a session forms opened before under sessionId, or in a new one, without waiting for its answers; the default round shows every card kind.',
      args: '{ sessionId?: string, projectDir?: string | null, harness?: "claude" | "codex", round?: object }',
      async run(rawArgs) {
        const args = argsObject(rawArgs);
        const sessionId =
          optionalString(args, 'sessionId') ?? `drive-forms-${++defaultIds}`;
        const projectDir =
          optionalNullableString(args, 'projectDir') ??
          DRIVE_SESSION_DEFAULTS.projectDir;
        const harness =
          optionalOneOf(args, 'harness', HARNESSES) ??
          DRIVE_SESSION_DEFAULTS.harness;
        const round =
          args.round === undefined ? PREVIEW_ROUND_ARGS : args.round;
        const session = sessionFor({ sessionId, projectDir, harness });
        const pending: DriveFormsSession['latest'] = { state: 'pending' };
        session.latest = pending;
        // A round asked after this one stays the latest when this one settles.
        const settle = (latest: DriveFormsSession['latest']) => {
          if (session.latest === pending) {
            session.latest = latest;
          }
        };
        askFixtureRound(session.connected, round).then(
          (result) => settle({ state: 'resolved', result }),
          (error: unknown) => settle({ state: 'failed', error }),
        );
        return { sessionId, rowId: session.connected.session.id };
      },
    }),
    host.add('answers', {
      description:
        "The latest round's tool result once submit or cancel resolved it, else { pending: true }.",
      args: '{ sessionId: string }',
      async run(rawArgs) {
        const sessionId = requiredString(argsObject(rawArgs), 'sessionId');
        const session = opened.get(sessionId);
        if (session === undefined) {
          throw new Error(`no session ${sessionId} from forms.openRound`);
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
        session.connected.end();
      }
      opened.clear();
    },
  };
}

// Serves its two tools to every agent session, shows each session's rounds on
// the page, serves the page its layouts and opens the layout preview on the
// page's ask; in the self-test it writes the fixture layout and hands the
// driver its script, and in a drive run it adds the drive actions.
export const formsMainPart: MainPart<typeof formsManifest> = {
  manifest: formsManifest,
  start(api: FormsApi) {
    const sessions = api.dependency<SessionsMainExports>('sessions');
    const { forms, preview } = createForms(api, sessions);
    api.channel.handle('openPreview', () => preview.open());
    sessions.contributeTools(FORMS_TOOLS, (session) =>
      createFormsToolSession(forms.startSession(session)),
    );
    const { selfTest } = api.services;
    // Written before the registry starts, so the registry lists selftest. A
    // late watch report of this write, arriving while selftest is inactive,
    // changes nothing: a save in an inactive layout's folder leaves the
    // revision alone.
    const fixtureWritten =
      api.services.runMode === 'selfTest'
        ? api.data.write(SELFTEST_LAYOUT.path, SELFTEST_LAYOUT.text)
        : Promise.resolve();
    const layouts = serveLayouts(api, fixtureWritten);
    selfTest?.run(formsSelfTestScript(sessions));
    const driveActions =
      api.drive !== null ? addDriveActions(api.drive, sessions) : null;
    return {
      commands: {},
      dispose: () => {
        driveActions?.dispose();
        return layouts.then(
          (registry) => registry.dispose(),
          () => undefined,
        );
      },
    };
  },
};
