import { describe, expect, it } from 'vitest';
import {
  createSessionCloseAnswers,
  type SessionForm,
  type SessionFormsState,
  sessionPaneView,
} from './session-forms';

function form(formId: string): SessionForm {
  return {
    formId,
    sessionId: `${formId}-session`,
    label: formId,
    sending: null,
    revision: 0,
    savedRevision: 0,
    savingRevision: null,
    saveError: null,
  };
}

// Forms a and b open, a active in `view`; a cancel prompt returns to the
// review.
function state(
  view: SessionFormsState<SessionForm, 'edit'>['view'],
  activeSessionId: string | null = 'a-session',
): SessionFormsState<SessionForm, 'edit'> {
  return {
    forms: [form('a'), form('b')],
    activeFormId: activeSessionId === 'a-session' ? 'a' : null,
    activeSessionId,
    view,
    confirmReturnView: 'review',
    confirmClosesSession: false,
  };
}

describe('sessionPaneView', () => {
  it.each<{
    name: string;
    given: SessionFormsState<SessionForm, 'edit'>;
    sessionId: string;
    drawn: 'edit' | 'review' | 'idle';
  }>([
    {
      name: 'the active session in its view',
      given: state('review'),
      sessionId: 'a-session',
      drawn: 'review',
    },
    {
      name: 'the active session under the cancel prompt',
      given: state('confirm'),
      sessionId: 'a-session',
      drawn: 'review',
    },
    {
      name: 'an unfocused session in the form view',
      given: state('review'),
      sessionId: 'b-session',
      drawn: 'edit',
    },
    {
      name: 'a session open with an empty pane focused',
      given: state('idle', null),
      sessionId: 'b-session',
      drawn: 'edit',
    },
    {
      name: 'a session with no form',
      given: state('review'),
      sessionId: 'c-session',
      drawn: 'idle',
    },
  ])('draws $name', ({ given, sessionId, drawn }) => {
    expect(sessionPaneView(given, sessionId, 'edit')).toBe(drawn);
  });
});

describe('createSessionCloseAnswers', () => {
  // A store holding `held` until `set` changes it, telling each listener.
  function heldStore(held: SessionFormsState<SessionForm, 'edit'>) {
    const listeners: (() => void)[] = [];
    return {
      get: () => held,
      subscribe(listener: () => void) {
        listeners.push(listener);
        return { dispose: () => undefined };
      },
      set(next: SessionFormsState<SessionForm, 'edit'>) {
        held = next;
        listeners.forEach((listener) => listener());
      },
    };
  }
  const asking = { ...state('confirm'), confirmClosesSession: true };

  it.each([
    {
      case: 'the cancel closes the form',
      end: (answers: ReturnType<typeof createSessionCloseAnswers>) =>
        answers.closing('a'),
      closes: true,
    },
    {
      case: 'the plugin stops',
      end: (answers: ReturnType<typeof createSessionCloseAnswers>) =>
        answers.dispose(),
      closes: false,
    },
  ])('wait_PromptEnds_Answers ($case)', async ({ end, closes }) => {
    const answers = createSessionCloseAnswers(heldStore(asking));
    const answer = answers.wait('a');

    end(answers);

    expect(await answer).toBe(closes);
  });

  it('wait_StateLeavesThePrompt_AnswersFalseOnce', async () => {
    const store = heldStore(asking);
    const answers = createSessionCloseAnswers(store);
    const answer = answers.wait('a');
    expect(answers.wait('a')).toBe(answer);

    store.set(state('review'));
    answers.closing('a');

    expect(await answer).toBe(false);
  });
});
