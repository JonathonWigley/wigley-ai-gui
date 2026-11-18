import type { AgentHarnessRegistry } from '../../../contracts/agent';
import {
  DEMO_HARNESS_ID,
  DEMO_PROFILE,
  type DemoMainContext,
  type DemoMainStage,
  type DemoMainStep,
  type DemoStepRegistry,
} from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { Files } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import type { PluginSwitchService } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type {
  FakeAgentHarness,
  FakeHarnessIdentity,
} from '../../../shared/fake-agent-harness';
import { createSerialQueue } from '../../../shared/serial-queue';
import type { ChatMainExports } from '../../chat/contract';

// The run's folders in the plugin data folder.
export const SCRATCH_FOLDER = 'scratch';
export const PROFILE_FOLDER = 'profile';

// `data` is the plugin's data folder, which holds `SCRATCH_FOLDER` and
// `PROFILE_FOLDER`; `scratchDir` and `profileDir` are their full paths.
export interface DemoRunDeps {
  chat: Pick<ChatMainExports, 'launch' | 'close' | 'closeSessionsIn'>;
  harnesses: Pick<AgentHarnessRegistry, 'register'>;
  makeHarness(identity: FakeHarnessIdentity): FakeAgentHarness;
  steps: Pick<DemoStepRegistry<DemoMainStep>, 'list'>;
  pluginSwitch: Pick<PluginSwitchService, 'runDisabledForNow'>;
  data: Pick<Files, 'list' | 'deleteFile' | 'makeFolder'>;
  scratchDir: string;
  profileDir: string;
  log: PluginLog;
}

// The demo's main side, every call run after the one before it settles.
// `start` stops a live run first. `enterStep` leaves a held main stage first
// and rejects `The demo is not running.` with no live run. `leaveStep` acts
// only on the held stage's id. `stop` does nothing with no live run.
export interface DemoRun {
  start(): Promise<{ scratchDir: string }>;
  enterStep(stepId: string): Promise<Readonly<Record<string, string>>>;
  leaveStep(stepId: string): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

interface HeldStage {
  id: string;
  stage: DemoMainStage;
}

interface LiveRun {
  harness: FakeAgentHarness;
  registration: Disposable;
  hold: Disposable;
  // The demo sessions this run's context launched.
  launched: Set<string>;
  context: DemoMainContext;
  held: HeldStage | null;
}

export function createDemoRun(deps: DemoRunDeps): DemoRun {
  const { chat, data, log, scratchDir } = deps;
  const queue = createSerialQueue();
  let live: LiveRun | null = null;

  const emptyScratch = async () => {
    const entries = await data.list(SCRATCH_FOLDER, { recursive: true });
    for (const entry of entries) {
      if (entry.kind === 'file') {
        await data.deleteFile(`${SCRATCH_FOLDER}/${entry.path}`);
      }
    }
  };

  // Disposes the held stage, then closes its sessions in its map's order,
  // each failure logged; holds nothing after.
  const leaveHeld = async (run: LiveRun) => {
    const { held } = run;
    if (held === null) {
      return;
    }
    run.held = null;
    try {
      held.stage.dispose();
    } catch (error) {
      log(`leave ${held.id} failed: ${errorText(error)}`);
    }
    for (const sessionId of Object.values(held.stage.sessions)) {
      try {
        await chat.close(sessionId, 'finished');
      } catch (error) {
        log(`session ${sessionId} not closed: ${errorText(error)}`);
      }
    }
  };

  const tearDown = async (run: LiveRun) => {
    await leaveHeld(run);
    const undos: { failure: string; undo(): void | Promise<void> }[] = [
      {
        failure: 'demo sessions not closed',
        undo: () => chat.closeSessionsIn(scratchDir),
      },
      {
        failure: 'plugin switch not given back',
        undo: () => run.hold.dispose(),
      },
      {
        failure: 'demo harness not removed',
        undo: () => run.registration.dispose(),
      },
    ];
    for (const { failure, undo } of undos) {
      try {
        await undo();
      } catch (error) {
        log(`${failure}: ${errorText(error)}`);
      }
    }
    run.launched.clear();
    log('run stopped');
  };

  const contextFor = (
    launched: Set<string>,
    harness: FakeAgentHarness,
  ): DemoMainContext => ({
    scratchDir,
    async launchSession(text) {
      const sessionId = await chat.launch({
        projectDir: scratchDir,
        profile: DEMO_PROFILE,
        message: { text, images: [] },
        ephemeral: true,
      });
      launched.add(sessionId);
      return sessionId;
    },
    processEvents(sessionId) {
      const record = launched.has(sessionId)
        ? harness.processes.findLast(
            (record) => record.request.rowId === sessionId,
          )
        : undefined;
      if (record === undefined) {
        throw new Error(`No demo session ${sessionId}.`);
      }
      return record.events;
    },
  });

  const requireLive = (): LiveRun => {
    if (live === null) {
      throw new Error('The demo is not running.');
    }
    return live;
  };

  return {
    start: () =>
      queue.run(async () => {
        if (live !== null) {
          const old = live;
          live = null;
          await tearDown(old);
        }
        await data.makeFolder(SCRATCH_FOLDER);
        await data.makeFolder(PROFILE_FOLDER);
        await emptyScratch();
        const harness = deps.makeHarness({
          id: DEMO_HARNESS_ID,
          label: 'Demo',
          profiles: [{ name: DEMO_PROFILE, configDir: deps.profileDir }],
          unlisted: true,
        });
        const registration = deps.harnesses.register(harness);
        let hold: Disposable;
        try {
          hold = await deps.pluginSwitch.runDisabledForNow();
        } catch (error) {
          registration.dispose();
          throw error;
        }
        const launched = new Set<string>();
        live = {
          harness,
          registration,
          hold,
          launched,
          context: contextFor(launched, harness),
          held: null,
        };
        log(`run started in ${scratchDir}`);
        return { scratchDir };
      }),
    enterStep: (stepId) =>
      queue.run(async () => {
        const run = requireLive();
        await leaveHeld(run);
        const step = deps.steps.list().find(({ id }) => id === stepId);
        if (step === undefined) {
          return {};
        }
        const stage = await step.enter(run.context);
        run.held = { id: stepId, stage };
        const keys = Object.keys(stage.sessions);
        log(
          `entered ${stepId}: ${keys.length === 0 ? 'none' : keys.join(', ')}`,
        );
        return stage.sessions;
      }),
    leaveStep: (stepId) =>
      queue.run(async () => {
        if (live !== null && live.held?.id === stepId) {
          await leaveHeld(live);
        }
      }),
    stop: () =>
      queue.run(async () => {
        if (live === null) {
          return;
        }
        const run = live;
        live = null;
        await tearDown(run);
      }),
    isRunning: () => live !== null,
  };
}
