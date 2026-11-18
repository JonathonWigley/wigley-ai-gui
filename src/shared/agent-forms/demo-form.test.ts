import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Disposable } from '../../contracts/disposable';
import { posixPaths } from '../paths/posix-paths';
import { NO_FORM_WAKE } from './chat-wake';
import { openSampleForm, sampleFormOwner } from './demo-form';
import { createAgentFormService } from './form-service';
import { globalTimers } from './global-timers.test-support';
import { createMemoryFormStore } from './memory-form-store';
import { ScriptedFormPresenter } from './scripted-presenter';
import {
  TEST_FORM_TYPE,
  type TestBody,
  type TestForm,
} from './test-form-type';

const DEADLINE_SECONDS = 30;

const SAMPLE_ARGS = { heading: 'Daily quests', items: ['first pass'] };

const NOTE: TestBody = { note: 'looks fine' };

let presenter: ScriptedFormPresenter<TestForm, TestBody>;
let logged: string[];
let activated: string[];

// A sample over a service of the test form type in memory, in session `s1`.
function openSample(): Disposable {
  let hexCount = 0;
  const forms = createAgentFormService({
    type: TEST_FORM_TYPE,
    presenter,
    store: createMemoryFormStore(
      { now: () => 1_000_000 },
      () => (++hexCount).toString(16).padStart(8, '0'),
      posixPaths,
    ),
    wake: NO_FORM_WAKE,
    defaultDeadlineSeconds: () => DEADLINE_SECONDS,
    timers: globalTimers,
  });
  return openSampleForm(
    {
      forms,
      activate: (sessionId) => activated.push(sessionId),
      log: (line) => logged.push(line),
      noun: 'form',
    },
    sampleFormOwner('s1'),
    SAMPLE_ARGS,
  );
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  presenter = new ScriptedFormPresenter();
  logged = [];
  activated = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('openSampleForm', () => {
  it.each([
    {
      outcome: 'submit',
      answer: (formId: string) => presenter.submit(formId, NOTE),
      logLine: 'form sample closed: submitted',
    },
    {
      outcome: 'cancel',
      answer: (formId: string) => presenter.cancel(formId, NOTE),
      logLine: 'form sample closed: cancelled',
    },
  ])('closes on a final outcome: $outcome', async ({ answer, logLine }) => {
    openSample();
    await flush();
    const { formId, sessionId } = presenter.latest();

    answer(formId);
    await flush();

    expect(sessionId).toBe('s1');
    expect(activated).toEqual(['s1']);
    expect(presenter.closed).toContain(formId);
    expect(logged).toEqual([logLine]);
  });

  it('asks again after a draft', async () => {
    openSample();
    await flush();
    const { formId } = presenter.latest();

    await vi.advanceTimersByTimeAsync(DEADLINE_SECONDS * 1000);

    expect(presenter.closed).toEqual([]);
    expect(logged).toEqual([]);
    presenter.submit(formId, NOTE);
    await flush();
    expect(logged).toEqual(['form sample closed: submitted']);
  });

  it('dispose ends an open form once', async () => {
    const sample = openSample();
    await flush();
    const { formId } = presenter.latest();

    sample.dispose();
    sample.dispose();
    await flush();

    expect(presenter.closed).toEqual([formId]);
    expect(logged).toEqual([]);
  });
});
