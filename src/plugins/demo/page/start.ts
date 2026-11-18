import { coreModeSlot, corePluginsSlot } from '../../../contracts/core-state';
import {
  DEMO_HARNESS_ID,
  type DemoStage,
  type DemoStep,
} from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import {
  createBaseKit,
  kitCommandsOf,
  type OwnerKitServices,
  type OwnerScope,
  ownerBaseKitDeps,
} from '../../../shared/page/layout-host/base-kit';
import type {
  DrawnPart,
  RollbackDeps,
} from '../../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../../shared/page/layout-host/layout-parts';
import { createSerialQueue } from '../../../shared/serial-queue';
import { scopedAgentsPageKey } from '../../scoped-agents/contract';
import { sessionsPageKey } from '../../sessions/contract';
import {
  type DemoChannel,
  type DemoRunState,
  demoRunSlot,
  STEP_AGENT_ID,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { CompleteLayout, DemoPart, Layout } from '../layouts/layout';
import { demoManifest } from '../manifest';
import { missingCoverage } from './coverage';
import { readDemoLayout } from './layout/read-demo-layout';
import { captionInput, movedCursor, stepListInput } from './panel-view-model';
import { realSessionPageStep } from './real-session-step';
import { createRunDriver } from './run-driver';

type DemoApi = PageApi<typeof demoManifest, DemoChannel>;

// Ahead of any later left-bar contribution at the default order (0): the Demo panel tops the left bar.
const PANEL_ORDER = -10;
const SECTION_ID = 'demo';
// The longest the panel keeps its turn through a step its Enter enters, so a hung enter cannot hold the turn.
const PANEL_ENTER_TURN_MS = 10_000;
const PANE_HINT =
  "Ask for a change to the feature on screen; the agent works in the app's own clone.";
const NOT_RUNNING: DemoRunState = {
  running: false,
  stepId: null,
  beat: 0,
  autoplay: false,
  realShown: false,
};

// What a live run holds on the page. `showOnly` is null while the real sessions show beside the Demo section.
interface LiveRun {
  scratchDir: string;
  section: Disposable;
  showOnly: Disposable | null;
  caption: Disposable;
}

// Drives the demo run from the page. The first `togglePanel` (or a `goTo`) starts a run: main's `start` gives the
// scratch folder, the Demo section claims the demo rows and shows alone, the panel joins the top of the left bar and
// the caption the status bar's centre, and the run driver enters the first step. Each step enters main's half first,
// then the page's, and leaves in the reverse order; main is told each step's brief for its step agent. `togglePanel`
// then hides and shows the panel, the run kept; `stop` ends the run and removes all it set up. Every command that
// reads or changes whether a run lives runs in one queue, so two arriving during a start act on the run it started.
// The panel holds the step list, drawn by the `demo.layout` layout's `steps` part, over the step agent's pane, whose
// scope is the held step; as a left-bar stop it walks a cursor over the steps, and `i` moves the keys into the pane
// and back. `demo.run` is published at each change. At each stop it first logs and reports to main the built-in
// plugins with no step or skip and the run's failed steps. At `ready` it stops a run a reload left in main. Registers
// the real-session step's page half.
export const demoPagePart: PagePart<typeof demoManifest> = {
  manifest: demoManifest,
  start(api: DemoApi) {
    const { services, channel } = api;
    const log = services.log;
    const sessions = api.dependency(sessionsPageKey);
    const scopedAgents = api.dependency(scopedAgentsPageKey);
    const runSlot = api.state.publish(demoRunSlot);
    const modeSlot = api.state.read(coreModeSlot);
    const plugins = api.state.read(corePluginsSlot);
    const kitServices: OwnerKitServices = {
      markdown: services.markdown,
      keys: api.keys,
      commands: kitCommandsOf(api),
      platform: api.platform.os,
      state: api.state.forLayouts,
    };
    const kitFor = (scope: OwnerScope | null, rollback: RollbackDeps) =>
      createBaseKit(
        ownerBaseKitDeps(demoManifest, kitServices, scope, rollback),
      );
    const layoutParts = createLayoutParts<Layout, CompleteLayout>({
      owner: demoManifest.id,
      defaultLayout,
      log,
    });
    const queue = createSerialQueue();

    const panelSlot = element('div', 'demo-panel-slot');
    panelSlot.tabIndex = -1;
    // The cursor's row draws the focus ring, so the slot draws none.
    panelSlot.style.outline = 'none';
    const stepsSlot = element('div', 'demo-steps-slot');
    const agentSlot = element('div', 'demo-agent-slot');
    panelSlot.append(stepsSlot, agentSlot);
    const captionSlot = element('span', 'demo-caption-slot');

    let run: LiveRun | null = null;
    let panelContribution: Disposable | null = null;
    let steps: DrawnPart<DemoPart> | null = null;
    let caption: DrawnPart<DemoPart> | null = null;
    let cursorId: string | null = null;
    // True while the panel itself holds the keys, its agent pane not.
    let hasKeys = false;
    // True from the panel's Enter on the cursor's step until the driver has entered it (or failed to), and for
    // `PANEL_ENTER_TURN_MS` at most; `enteringTimer` ends it then.
    let isEnteringFromPanel = false;
    let enteringTimer: number | null = null;
    // The live run's failed step ids, once each in first-failure order.
    const failedSteps: string[] = [];

    // Gives up the DOM focus held by a text box outside the panel (the message box, a form's answer, a note), whose
    // insert mode would type the demo's `<Leader>d` keys as text; the step agent's pane in the panel keeps its own.
    const takeKeysFromTextBox = () => {
      const focused = document.activeElement;
      if (
        focused instanceof HTMLElement &&
        !panelSlot.contains(focused) &&
        (services.editor.contains(focused) ||
          focused.isContentEditable ||
          focused.matches('input, textarea'))
      ) {
        focused.blur();
        log('took the keys back from a text box');
      }
    };

    // Runs `work`, then takes the keys back from a text box, whether `work` focused it or the user was typing in it.
    const keepingKeys = async <T>(work: () => T | Promise<T>): Promise<T> => {
      try {
        return await work();
      } finally {
        takeKeysFromTextBox();
      }
    };

    // Main's half first, then the page's, whose enter and each beat's show run under `keepingKeys`.
    const enter = async (step: DemoStep): Promise<DemoStage> => {
      if (run === null) {
        throw new Error('The demo is not running.');
      }
      const { scratchDir } = run;
      const stepSessions = await channel.invoke('enterStep', step.id);
      let stage: DemoStage;
      try {
        stage = await keepingKeys(() =>
          step.enter({ scratchDir, sessions: stepSessions }),
        );
      } catch (error) {
        await channel
          .invoke('leaveStep', step.id)
          .catch((leaveError: unknown) =>
            log(`leaving ${step.id} failed: ${errorText(leaveError)}`),
          );
        throw error;
      }
      channel
        .invoke('describeStep', {
          id: step.id,
          plugin: step.id.slice(0, step.id.indexOf('.')),
          title: step.title,
          caption: step.caption,
          files: step.files,
          beats: stage.beats.map(({ name }) => name),
        })
        .catch((error: unknown) =>
          log(`describeStep failed: ${errorText(error)}`),
        );
      return {
        beats: stage.beats.map((beat) => ({
          ...beat,
          show: () => keepingKeys(() => beat.show()),
        })),
        dispose: () => stage.dispose(),
      };
    };

    // The page's stage first, under `keepingKeys`, then main's.
    const leave = async (step: DemoStep, stage: DemoStage) => {
      try {
        await keepingKeys(() => {
          stage.dispose();
        });
      } finally {
        await channel.invoke('leaveStep', step.id);
      }
    };

    const endEnteringFromPanel = () => {
      isEnteringFromPanel = false;
      if (enteringTimer !== null) {
        services.timers.clear(enteringTimer);
        enteringTimer = null;
      }
    };

    const driver = createRunDriver({
      steps: () => services.demoSteps.list(),
      enter,
      leave,
      timers: services.timers,
      autoplaySeconds: () => api.settings().autoplaySeconds,
      changed(state) {
        publish();
        pane.scopeOpened(state.stepId);
        draw();
      },
      failed(stepId, error) {
        log(`step ${stepId} failed: ${errorText(error)}`);
        if (!failedSteps.includes(stepId)) {
          failedSteps.push(stepId);
        }
      },
      log,
    });

    const publish = () => {
      if (run === null) {
        runSlot.set(NOT_RUNNING);
        return;
      }
      const { stepId, beat, autoplay } = driver.state();
      runSlot.set({
        running: true,
        stepId,
        beat,
        autoplay,
        realShown: run.showOnly === null,
      });
    };

    const drawSteps = (live: LiveRun) => {
      const state = driver.state();
      const beats = driver.current()?.stage.beats.map(({ name }) => name) ?? [];
      const input = stepListInput(
        services.demoSteps.list(),
        state,
        beats,
        hasKeys ? cursorId : null,
        state.autoplay,
        live.showOnly === null,
      );
      const last = steps;
      steps = null;
      callEach<() => void>(
        [
          () => last?.dispose(),
          () => {
            stepsSlot.replaceChildren();
            steps = layoutParts.draw(
              'steps',
              stepsSlot,
              (part, slot, rollback) =>
                part(slot, input, kitFor('panel', rollback)),
            );
          },
        ],
        (each) => each(),
      );
      if (hasKeys) {
        stepsSlot
          .querySelector('.is-cursor')
          ?.scrollIntoView({ block: 'nearest' });
      }
    };

    // An empty slot while no step is held.
    const drawCaption = () => {
      const input = captionInput(services.demoSteps.list(), driver.state());
      const last = caption;
      caption = null;
      callEach<() => void>(
        [
          () => last?.dispose(),
          () => {
            captionSlot.replaceChildren();
            if (input !== null) {
              caption = layoutParts.draw(
                'caption',
                captionSlot,
                (part, slot, rollback) =>
                  part(slot, input, kitFor(null, rollback)),
              );
            }
          },
        ],
        (each) => each(),
      );
    };

    // Draws while a run lives, into the panel's slot whether or not it is contributed.
    const draw = () => {
      if (run === null) {
        return;
      }
      drawSteps(run);
      drawCaption();
    };

    const clearDrawn = () => {
      const drawn = [steps, caption];
      steps = null;
      caption = null;
      callEach<() => void>(
        [
          ...drawn.map((part) => () => part?.dispose()),
          () => stepsSlot.replaceChildren(),
          () => captionSlot.replaceChildren(),
        ],
        (each) => each(),
      );
    };

    const isListed = (stepId: string) =>
      services.demoSteps.list().some(({ id }) => id === stepId);

    // The core gives the panel the keys: a cursor on no listed step takes the held one.
    const focusPanel = () => {
      hasKeys = true;
      if (cursorId === null || !isListed(cursorId)) {
        cursorId = driver.state().stepId;
      }
      api.keys.setScope('panel');
      panelSlot.focus();
      draw();
      log('panel focused');
      if (cursorId !== null) {
        log(`cursor on ${cursorId}`);
      }
    };

    // The core ended the panel's turn.
    const leavePanel = () => {
      hasKeys = false;
      pane.hostTookKeys();
      draw();
    };

    const showPanel = () => {
      panelContribution = api.areas.leftBar.contribute(panelSlot, {
        order: PANEL_ORDER,
        focus: focusPanel,
        left: leavePanel,
        keepsTurn: () => pane.holdsKeys() || isEnteringFromPanel,
      });
    };

    const hidePanel = () => {
      const contribution = panelContribution;
      panelContribution = null;
      contribution?.dispose();
    };

    const pane = scopedAgents.addAgentPane({
      owner: demoManifest.id,
      agentId: STEP_AGENT_ID,
      heading() {
        const held = driver.current();
        return held === null ? 'Step agent' : `Step agent · ${held.step.title}`;
      },
      hint: PANE_HINT,
      setShown(shown) {
        agentSlot.hidden = !shown;
      },
      isAlwaysShown: true,
      entersFrom: null,
      resizeTarget: null,
      tookKeys() {
        hasKeys = false;
        draw();
      },
      leave() {
        hasKeys = true;
        api.keys.setScope('panel');
        panelSlot.focus();
        draw();
      },
    });
    agentSlot.append(pane.element);

    // Inside the queue; `enterFirst` enters the run's first step. A rejection of main's `start` changes nothing.
    const startRun = async (enterFirst: () => Promise<void>) => {
      let scratchDir: string;
      try {
        ({ scratchDir } = await channel.invoke('start'));
      } catch (error) {
        log(`start failed: ${errorText(error)}`);
        services.toast(`The demo did not start: ${errorText(error)}`, 'error');
        return;
      }
      const section = sessions.addSection({
        id: SECTION_ID,
        label: 'Demo',
        order: 0,
        claims: (row) =>
          row.harness === DEMO_HARNESS_ID ||
          (row.projectDir !== null &&
            services.paths.samePath(row.projectDir, scratchDir)),
      });
      const showOnly = sessions.showOnly(SECTION_ID);
      showPanel();
      const captionContribution = api.areas.statusBar.contribute(captionSlot, {
        align: 'center',
      });
      run = { scratchDir, section, showOnly, caption: captionContribution };
      failedSteps.length = 0;
      publish();
      draw();
      log('run started');
      takeKeysFromTextBox();
      await enterFirst();
    };

    // Before the driver leaves the held step, while the plugin switch still runs the off-by-default plugins and their
    // steps are registered. A rejection of `report` is logged.
    const reportRun = async () => {
      const missing = missingCoverage(
        plugins.get() ?? [],
        services.demoSteps.list().map(({ id }) => id),
      );
      log(
        missing.length === 0
          ? 'coverage: every built-in plugin has a step or a skip'
          : `coverage: no step or skip for ${missing.join(', ')}`,
      );
      if (failedSteps.length > 0) {
        log(`failed steps: ${failedSteps.join(', ')}`);
      }
      try {
        await channel.invoke('report', { missing, failed: [...failedSteps] });
      } catch (error) {
        log(`report failed: ${errorText(error)}`);
      }
    };

    // Inside the queue, with a run live. Each part's failure is logged and never stops the next.
    const stopRun = async (live: LiveRun) => {
      await reportRun();
      const undos: { name: string; undo(): void | Promise<void> }[] = [
        { name: 'leaving the step', undo: () => driver.stop() },
        { name: 'stopping main', undo: () => channel.invoke('stop') },
        { name: 'showing every section', undo: () => live.showOnly?.dispose() },
        { name: 'removing the section', undo: () => live.section.dispose() },
        { name: 'removing the panel', undo: hidePanel },
        { name: 'removing the caption', undo: () => live.caption.dispose() },
        { name: 'closing the step agent', undo: () => pane.scopeOpened(null) },
      ];
      for (const { name, undo } of undos) {
        try {
          await undo();
        } catch (error) {
          log(`${name} failed: ${errorText(error)}`);
        }
      }
      run = null;
      hasKeys = false;
      cursorId = null;
      clearDrawn();
      publish();
      log('run stopped');
    };

    const logNotRunning = () => log('the demo is not running');

    // Runs `work` in the queue on the live run; logs `the demo is not running` with none.
    const onRun = (work: (live: LiveRun) => void | Promise<void>) =>
      queue.run(async () => {
        if (run === null) {
          logNotRunning();
          return;
        }
        await work(run);
      });

    const togglePanel = () =>
      queue.run(async () => {
        if (run === null) {
          await startRun(() => driver.start());
          return;
        }
        if (panelContribution === null) {
          showPanel();
          log('panel shown');
        } else {
          hidePanel();
          log('panel hidden');
        }
      });

    const goTo = (stepId: string) =>
      queue.run(async () => {
        if (run !== null) {
          await driver.goTo(stepId);
          return;
        }
        if (!isListed(stepId)) {
          throw new Error(`No demo step ${stepId}.`);
        }
        await startRun(() => driver.goTo(stepId));
      });

    const showReal = (live: LiveRun) => {
      if (live.showOnly === null) {
        live.showOnly = sessions.showOnly(SECTION_ID);
        log('real sessions hidden');
      } else {
        live.showOnly.dispose();
        live.showOnly = null;
        log('real sessions shown');
      }
      publish();
      draw();
    };

    const moveCursor = (move: 'down' | 'up') => {
      const moved = movedCursor(services.demoSteps.list(), cursorId, move);
      if (moved === null) {
        return;
      }
      cursorId = moved;
      draw();
      log(`cursor on ${moved}`);
    };

    const goToCursor = async () => {
      if (run === null) {
        logNotRunning();
        return;
      }
      if (cursorId === null) {
        return;
      }
      // The step's first beat may show another mode, whose base scope change would end the panel's turn: the panel
      // keeps its turn until the driver has entered the step, `PANEL_ENTER_TURN_MS` at most, so a hung enter cannot
      // hold it, and takes its scope back after.
      endEnteringFromPanel();
      isEnteringFromPanel = true;
      enteringTimer = services.timers.set(
        endEnteringFromPanel,
        PANEL_ENTER_TURN_MS,
      );
      try {
        await driver.goTo(cursorId);
        if (hasKeys && !pane.holdsKeys()) {
          api.keys.setScope('panel');
          panelSlot.focus();
        }
      } finally {
        endEnteringFromPanel();
      }
    };

    // While the step agent's pane holds the keys, a mode change ends the panel's turn: the core gives main the keys
    // once the focus leaves the left bar.
    const modeListener = modeSlot.on(() => {
      if (!pane.holdsKeys()) {
        return;
      }
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && panelSlot.contains(focused)) {
        focused.blur();
      }
    });
    const stepsListener = services.demoSteps.onChanged(() => draw());
    api.onSettingsChanged(() => draw());
    api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readDemoLayout,
      userLayout: () => api.settings().layout,
      setLayouts(shown) {
        layoutParts.setLayouts(shown);
        draw();
      },
    });
    services.demoSteps.register(realSessionPageStep(sessions));
    channel.on('selfTestOpened', (selfTestRun) =>
      log(`self-test run ${selfTestRun}`),
    );
    publish();

    return {
      commands: {
        togglePanel,
        next: () => onRun(() => driver.next()),
        previous: () => onRun(() => driver.previous()),
        goTo: ({ arg }) => goTo(arg),
        autoplay: () =>
          onRun(() => driver.setAutoplay(!driver.state().autoplay)),
        reset: () => onRun(() => driver.reset()),
        showReal: () => onRun(showReal),
        stop: () => onRun(stopRun),
        cursorDown: () => moveCursor('down'),
        cursorUp: () => moveCursor('up'),
        goToCursor,
        askAgent: () => pane.toggle(),
      },
      ready() {
        queue
          .run(() => channel.invoke('stop'))
          .catch((error: unknown) =>
            log(`stopping a leftover run failed: ${errorText(error)}`),
          );
      },
      dispose: () =>
        queue.run(async () => {
          modeListener.dispose();
          stepsListener.dispose();
          if (run !== null) {
            await stopRun(run);
          }
        }),
    };
  },
};
