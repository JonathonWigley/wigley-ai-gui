import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorHost } from '../../../contracts/editor';
import { startDrawingPagePart } from '../../../shared/page/layout-host/page-part-harness.test-support';
import { asFake, installFocusFakeDom } from '../../../shared/page/test-dom';
import {
  countingEditors,
  fakeDependency,
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
// `activated` each row sessions' `activate` got, and `sections` each section sessions' `addSection` got.
function startSchedulesPage(
  state: SchedulingState | undefined,
  save: () => Promise<string> = async () => 'bbbb2222',
) {
  installFocusFakeDom(vi.stubGlobal);
  const calls: { method: string; args: unknown[] }[] = [];
  const boxes: FakeBox[] = [];
  const activated: string[] = [];
  const sections: SidebarSection[] = [];
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
    firstModeTaken: true,
    state: store,
    services: { editor },
    dependencies: [
      fakeDependency(
        sessionsPageKey,
        () =>
          ({
            activate(sessionId: string) {
              activated.push(sessionId);
            },
            addSection(section: SidebarSection) {
              sections.push(section);
              return { dispose: () => undefined };
            },
            setActivity: () => undefined,
          }) as unknown as SessionsPageExports,
      ),
    ],
    invoke: async (method, ...args) => {
      calls.push({ method, args });
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
  return { harness, calls, boxes, activated, sections, run };
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
