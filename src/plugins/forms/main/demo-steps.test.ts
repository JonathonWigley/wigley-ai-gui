import { describe, expect, it, vi } from 'vitest';
import type { PresentedAgentForm } from '../../../contracts/agent-forms';
import type { DemoMainContext, DemoMainStep } from '../../../contracts/demo';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import {
  fakeDependency,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import { previewSessions } from '../../agent-form-fakes.test-support';
import { type ChatMainExports, chatMainKey } from '../../chat/contract';
import {
  type FormBody,
  type FormsMainExports,
  type Round,
  SAVED_ROUNDS_FOLDER,
} from '../contract';
import { DEMO_ROUND_ARGS } from './demo-steps';
import { formsMainPart } from './start';

const HOME = '/home/user';

const EMPTY_BODY: FormBody = {
  note: '',
  answers: [],
  finding_answers: [],
  notice_comments: [],
};

// The confirm round's one question answered Allow.
const ALLOW_BODY: FormBody = {
  ...EMPTY_BODY,
  answers: [
    {
      index: 1,
      choice: 1,
      not_applicable: false,
      notes: '',
      dont_ask: false,
      dont_ask_reason: '',
    },
  ],
};

const CONTEXT: DemoMainContext = {
  scratchDir: '/scratch',
  launchSession: () => Promise.resolve('demo-1'),
  processEvents: () => {
    throw new Error('no process events in this test');
  },
};

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Forms started with a demo-step registry the test reads, chat's wake and
// close recorded.
function startForms() {
  const demoSteps = createDemoStepRegistry<DemoMainStep>();
  const sessions = previewSessions();
  const chat = { send: vi.fn(), close: vi.fn() };
  const harness = startMainPart(formsMainPart, {
    dependencies: [
      fakeDependency(
        chatMainKey,
        () =>
          ({
            profileOf: () => 'claude',
            isHeadless: () => false,
            send: chat.send,
            close: chat.close,
          }) as unknown as ChatMainExports,
      ),
      sessions.dependency,
    ],
    services: {
      demoSteps,
      homeDir: HOME,
      alerts: { setOpenCount() {} },
      git: { originRepoName: () => Promise.resolve(null) } as never,
    },
  });
  const step = demoSteps.list().find((each) => each.id === 'forms.round');
  if (step === undefined) {
    throw new Error('forms registered no forms.round step');
  }
  return { harness, sessions, chat, step };
}

function shownRounds(
  sent: readonly { message: string; data: unknown }[],
): PresentedAgentForm<Round, FormBody>[] {
  return sent
    .filter((each) => each.message === 'formShown')
    .map((each) => each.data as PresentedAgentForm<Round, FormBody>);
}

function closedIds(sent: readonly { message: string; data: unknown }[]) {
  return sent
    .filter((each) => each.message === 'formClosed')
    .map((each) => (each.data as { formId: string }).formId);
}

async function savedRoundFiles(
  harness: ReturnType<typeof startForms>['harness'],
): Promise<string[]> {
  const entries = await harness.files.list(`${HOME}/${SAVED_ROUNDS_FOLDER}`, {
    recursive: true,
  });
  return entries
    .filter((entry) => entry.kind === 'file')
    .map((entry) => entry.path);
}

describe('forms demo steps', () => {
  it('entering forms.round asks the sample service and saves no round', async () => {
    const { harness, chat, step } = startForms();

    const stage = await step.enter(CONTEXT);
    await flush();
    const shown = shownRounds(harness.sent);
    harness.invoke('finish', shown[0]?.formId, {
      kind: 'cancelled',
      body: EMPTY_BODY,
    });
    await flush();

    expect(stage.sessions).toEqual({ session: 'demo-1' });
    expect(shown.map((round) => [round.sessionId, round.form.heading])).toEqual(
      [['demo-1', 'Daily quests: first pass']],
    );
    expect(await savedRoundFiles(harness)).toEqual([]);
    expect(chat.send).not.toHaveBeenCalled();
    stage.dispose();
    await harness.stop();
  });

  // The page's focusItem positions rest on these counts.
  it('DEMO_ROUND_ARGS keeps 3 findings, 2 questions and notices', () => {
    const lengthOf = (field: string) =>
      (DEMO_ROUND_ARGS[field] as unknown[]).length;

    expect([lengthOf('findings'), lengthOf('questions')]).toEqual([3, 2]);
    expect(lengthOf('notices')).toBeGreaterThan(0);
  });

  it('confirmSample resolves the answer and starts no agent session', async () => {
    const { harness, chat } = startForms();
    const forms = harness
      .started()
      .exports?.(createRegistrations()) as FormsMainExports;

    const allowed = forms.confirmSample(
      'demo-1',
      { title: 'Run close session?', detail: 'A sample confirm.' },
      new AbortController().signal,
    );
    await flush();
    const shown = shownRounds(harness.sent);
    harness.invoke('finish', shown[0]?.formId, {
      kind: 'submitted',
      body: ALLOW_BODY,
    });

    await expect(allowed).resolves.toBe(true);
    expect(shown.map((round) => round.sessionId)).toEqual(['demo-1']);
    expect(closedIds(harness.sent)).toContain(shown[0]?.formId);
    expect(await savedRoundFiles(harness)).toEqual([]);
    expect(chat.send).not.toHaveBeenCalled();
    await harness.stop();
  });

  it('leaving forms.round ends the form and closes no session', async () => {
    const { harness, sessions, chat, step } = startForms();
    const stage = await step.enter(CONTEXT);
    await flush();
    const [shown] = shownRounds(harness.sent);

    stage.dispose();
    await flush();

    expect(closedIds(harness.sent)).toEqual([shown?.formId]);
    expect(sessions.end).not.toHaveBeenCalled();
    expect(chat.close).not.toHaveBeenCalled();
    await harness.stop();
  });
});
