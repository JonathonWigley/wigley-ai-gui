import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorHost } from '../../../contracts/editor';
import { startDrawingPagePart } from '../../../shared/page/layout-host/page-part-harness.test-support';
import { fakeListPickerService } from '../../../shared/page/fake-list-picker-service.test-support';
import { asFake, installFocusFakeDom } from '../../../shared/page/test-dom';
import {
  countingEditors,
  deferred,
  noCounts,
  providerManifest,
} from '../../../shared/plugin-part-harness.test-support';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  type SessionsPageExports,
  type SidebarSection,
  sessionsPageKey,
} from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import {
  type EditorChoices,
  type ScheduledTaskView,
  type SchedulingState,
  schedulingStateSlot,
} from '../contract';
import { coreModeSlot } from '../../../contracts/core-state';
import { schedulingPagePart } from './start';

const CHOICES: EditorChoices = {
  profiles: ['main'],
  projects: [],
  controls: [],
};

function taskView(id: string, name: string): ScheduledTaskView {
  return {
    task: {
      id,
      name,
      target: { projectDir: '~/dev/app' },
      profile: 'main',
      prompt: 'Run the checks.',
      schedule: { kind: 'daily', time: '09:00' },
      controls: {},
      paused: false,
      updatedAt: 0,
    },
    nextRun: null,
    history: [],
  };
}

function schedulingState(changes: Partial<SchedulingState>): SchedulingState {
  return {
    tasks: [],
    fileError: null,
    fires: true,
    loginStart: null,
    runRows: [],
    unviewedRows: [],
    ...changes,
  };
}

// One box the fake editor host made: `type` changes its text as the user's typing does.
interface FakeBox {
  type(text: string): void;
}

// The Schedules page on the harness, drawing its layout for real, with `state` published to `scheduling.state`.
// `saveTask` answers with `save`, else `bbbb2222`; `calls` holds each invoke, `boxes` each box made in order,
// `activated` each row sessions' `activate` got, `sections` each section sessions' `addSection` got, and
// `sessionsShows` one entry per run of sessions' `showMode`.
function startSchedulesPage(
  state: SchedulingState | undefined,
  save: () => Promise<string> = async () => 'bbbb2222',
  firstModeTaken = true,
  options: {
    // Answers an invoke in place of the page's own answer; undefined leaves it to the page.
    held?: (method: string) => Promise<unknown> | undefined;
    // Makes the Scheduled runs section's `dispose` throw it.
    sectionDisposeError?: Error;
  } = {},
) {
  installFocusFakeDom(vi.stubGlobal);
  const calls: { method: string; args: unknown[] }[] = [];
  const boxes: FakeBox[] = [];
  const activated: string[] = [];
  const sections: SidebarSection[] = [];
  const sessionsShows: string[] = [];
  const editor: EditorHost = {
    ...countingEditors().host,
    create(_parent, doc, events) {
      let text = doc;
      boxes.push({
        type(typed) {
          text = typed;
          events.changed(typed);
        },
      });
      return {
        text: () => text,
        setText(next: string) {
          text = next;
        },
        insert: () => undefined,
        charBeforeCursor: () => '',
        focus: () => undefined,
        blur: () => undefined,
        destroy: () => undefined,
      };
    },
  };
  const store = createSlotStore(() => undefined);
  if (state !== undefined) {
    store.publish(schedulingStateSlot).set(state);
  }
  const harness = startDrawingPagePart(schedulingPagePart, {
    firstModeTaken,
    state: store,
    services: { editor, picker: fakeListPickerService() },
    // Sessions as a part rather than a dependency fake: the page runs its `showMode`, which only a part declares.
    parts: [
      {
        manifest: {
          ...providerManifest(sessionsPageKey.id),
          commands: {
            showMode: {
              label: 'Sessions mode',
              group: 'sessions',
              runsIn: 'page',
            },
          },
        },
        start: () => ({
          commands: {
            showMode() {
              sessionsShows.push('showMode');
            },
          },
          exports: () =>
            ({
              activate(sessionId: string) {
                activated.push(sessionId);
              },
              addSection(section: SidebarSection) {
                sections.push(section);
                return {
                  dispose() {
                    if (options.sectionDisposeError !== undefined) {
                      throw options.sectionDisposeError;
                    }
                  },
                };
              },
              setActivity: () => undefined,
            }) as unknown as SessionsPageExports,
        }),
      },
    ],
    invoke: async (method, ...args) => {
      calls.push({ method, args });
      const answer = options.held?.(method);
      if (answer !== undefined) {
        return answer;
      }
      if (method === 'editorChoices') {
        return CHOICES;
      }
      if (method === 'saveTask') {
        return save();
      }
      return undefined;
    },
  });
  const commands = harness.started().commands;
  const run = (
    command: Exclude<keyof typeof commands, 'selectTask' | 'openRunRow'>,
  ) => commands[command]({ arg: undefined });
  return { harness, calls, boxes, activated, sections, sessionsShows, run };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// Shows the mode and opens the new-task editor with its name, project and prompt typed.
async function openFilledEditor(page: ReturnType<typeof startSchedulesPage>) {
  page.run('showMode');
  page.run('newTask');
  await settle();
  // The boxes in row order: Name, Project, Time, Prompt.
  page.boxes[0]!.type('Nightly');
  page.boxes[1]!.type('~/dev/app');
  page.boxes[3]!.type('Run the checks.');
}

const sheetOf = (page: ReturnType<typeof startSchedulesPage>) =>
  asFake(page.harness.mode('scheduling.main').element);

describe('scheduling page part', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws one task row per task under the "+ New task" row', () => {
    const page = startSchedulesPage(
      schedulingState({
        tasks: [
          taskView('aaaa1111', 'Nightly'),
          taskView('cccc3333', 'Weekly'),
        ],
      }),
    );
    page.run('showMode');

    const labels = asFake(page.harness.mode('scheduling.main').sideBar!)
      .querySelectorAll('.ui-row-label')
      .map((label) => label.textContent);

    expect(labels).toEqual(['+ New task', 'Nightly', 'Weekly']);
  });

  it('save sends the draft and logs the saved task', async () => {
    const page = startSchedulesPage(undefined);
    await openFilledEditor(page);

    page.run('save');
    await settle();

    expect(page.calls.filter((call) => call.method === 'saveTask')).toEqual([
      {
        method: 'saveTask',
        args: [
          {
            id: null,
            name: 'Nightly',
            target: { projectDir: '~/dev/app' },
            profile: 'main',
            prompt: 'Run the checks.',
            schedule: { kind: 'daily', time: '09:00' },
            controls: {},
            paused: false,
          },
        ],
      },
    ]);
    expect(page.harness.logs.map((line) => line.message)).toContain(
      'task saved: Nightly',
    );
  });

  it('save run twice before the invoke settles makes one saveTask call', async () => {
    let settleSave: (id: string) => void = () => undefined;
    const page = startSchedulesPage(
      undefined,
      () => new Promise<string>((resolve) => (settleSave = resolve)),
    );
    await openFilledEditor(page);

    page.run('save');
    page.run('save');
    settleSave('bbbb2222');
    await settle();

    expect(
      page.calls.filter((call) => call.method === 'saveTask'),
    ).toHaveLength(1);
  });

  it.each<{ command: 'nextField' | 'previousField'; row: string }>([
    { command: 'nextField', row: 'Time' },
    { command: 'previousField', row: 'Project' },
  ])(
    '$command with no box focused steps from the cursor row to the nearest box row that way',
    async ({ command, row }) => {
      const page = startSchedulesPage(undefined);
      page.run('showMode');
      page.run('newTask');
      await settle();
      // The cursor starts on Name; Profile, the third row, is a choice.
      page.run('fieldDown');
      page.run('fieldDown');

      page.run(command);

      expect(sheetOf(page).querySelector('.is-cursor')?.textContent).toContain(
        row,
      );
    },
  );

  it('a part restarted while Schedules mode shows starts with the mode shown', async () => {
    const page = startSchedulesPage(
      schedulingState({ tasks: [taskView('aaaa1111', 'Nightly')] }),
      undefined,
      false,
    );

    await page.harness.restart();

    expect(page.harness.state.read(coreModeSlot, 'test').get()).toBe(
      'scheduling.main',
    );
    expect(page.harness.modeContext('scheduling.main')).toEqual({
      title: 'Schedules',
      detail: 'Nightly',
    });
  });

  it('a rejected save keeps the editor open with the reason', async () => {
    const page = startSchedulesPage(undefined, async () => {
      throw new Error('scheduled-tasks.json could not be written');
    });
    await openFilledEditor(page);

    page.run('save');
    await settle();

    expect(
      sheetOf(page).querySelector('.scheduling-problem')?.textContent,
    ).toBe('scheduled-tasks.json could not be written');
    expect(page.harness.started().mayStop?.()).not.toBeNull();
  });

  it('openRun on a linked history row activates its run row', () => {
    const view = taskView('aaaa1111', 'Nightly');
    view.history = [
      {
        taskId: 'aaaa1111',
        occurrence: 0,
        at: 0,
        outcome: 'finished',
        reason: null,
        rowId: 's1',
        processId: null,
        viewed: true,
      },
    ];
    const page = startSchedulesPage(
      schedulingState({ tasks: [view], runRows: ['s1'] }),
    );
    page.run('showMode');
    page.run('open');

    page.run('openRun');

    expect(page.activated).toEqual(['s1']);
    expect(page.sessionsShows).toEqual(['showMode']);
  });

  it('the slot runRows reach the Scheduled runs section sessions gets', () => {
    const page = startSchedulesPage(schedulingState({ runRows: ['s1'] }));

    const [section] = page.sections;
    expect(page.sections).toHaveLength(1);
    expect(section!.label).toBe('Scheduled runs');
    expect(['s1', 's2'].map((id) => section!.claims(sessionRow(id)))).toEqual([
      true,
      false,
    ]);
  });

  it.each<{
    case: string;
    method: string;
    outcome: 'resolve' | 'reject';
    start: (page: ReturnType<typeof startSchedulesPage>) => Promise<void>;
  }>([
    {
      case: 'setPaused rejects',
      method: 'setPaused',
      outcome: 'reject',
      start: async (page) => {
        page.run('listDown');
        page.run('togglePaused');
      },
    },
    {
      case: 'runNow resolves',
      method: 'runNow',
      outcome: 'resolve',
      start: async (page) => {
        page.run('listDown');
        page.run('runNow');
      },
    },
    {
      case: 'runNow rejects',
      method: 'runNow',
      outcome: 'reject',
      start: async (page) => {
        page.run('listDown');
        page.run('runNow');
      },
    },
    {
      case: 'editorChoices resolves',
      method: 'editorChoices',
      outcome: 'resolve',
      start: async (page) => page.run('newTask'),
    },
    {
      case: 'editorChoices rejects',
      method: 'editorChoices',
      outcome: 'reject',
      start: async (page) => page.run('newTask'),
    },
    {
      case: 'saveTask resolves',
      method: 'saveTask',
      outcome: 'resolve',
      start: async (page) => page.run('save'),
    },
    {
      case: 'saveTask rejects',
      method: 'saveTask',
      outcome: 'reject',
      start: async (page) => page.run('save'),
    },
  ])(
    'a reply landing after the part stops logs, toasts and draws nothing: $case',
    async ({ method, outcome, start }) => {
      const reply = deferred<unknown>();
      let isArmed = false;
      const page = startSchedulesPage(
        schedulingState({ tasks: [taskView('aaaa1111', 'Nightly')] }),
        undefined,
        true,
        {
          held: (invoked) =>
            isArmed && invoked === method ? reply.promise : undefined,
        },
      );
      page.run('showMode');
      if (method === 'saveTask') {
        page.run('newTask');
        await settle();
        page.boxes[0]!.type('Nightly');
        page.boxes[1]!.type('~/dev/app');
        page.boxes[3]!.type('Run the checks.');
      }
      isArmed = true;
      await start(page);
      await settle();
      await page.harness.stop();
      const logsBefore = page.harness.logs.map((line) => line.message);
      const callsBefore = page.calls.length;

      if (outcome === 'resolve') {
        reply.resolve(method === 'saveTask' ? 'bbbb2222' : undefined);
      } else {
        reply.reject(new Error('late'));
      }
      await settle();

      expect(page.harness.logs.map((line) => line.message)).toEqual(logsBefore);
      expect(page.calls).toHaveLength(callsBefore);
    },
  );

  it('stops with nothing live when the runs section dispose throws', async () => {
    const page = startSchedulesPage(
      schedulingState({ tasks: [taskView('aaaa1111', 'Nightly')] }),
      undefined,
      true,
      { sectionDisposeError: new Error('section dispose failed') },
    );
    page.run('showMode');

    await page.harness.stop().catch(() => undefined);

    expect(page.harness.counts()).toEqual(noCounts);
  });

  it('mayStop refuses while the draft changed', async () => {
    const page = startSchedulesPage(undefined);
    page.run('showMode');
    page.run('newTask');
    await settle();
    page.boxes[0]!.type('Draft');

    expect(page.harness.started().mayStop?.()).toBe(
      'The task editor has unsaved changes.',
    );
  });
});
