import { describe, expect, it } from 'vitest';
import {
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
