import { describe, expect, it, vi } from 'vitest';
import type {
  AgentFormListener,
  PresentedAgentForm,
} from '../../../contracts/agent-forms';
import type {
  AnswerResult,
  AnswersPayload,
  ConfirmRequest,
  ConfirmSubject,
  FormBody,
  FormsSession,
  OpenConfirm,
  Question,
  Round,
} from '../contract';
import {
  askConfirm,
  confirmAllowed,
  confirmRoundArgs,
  createConfirmTracker,
} from './confirm';
import { BUILT_IN_KINDS } from './kinds/formats';
import { createRoundType } from './round-type';

const roundType = createRoundType(() => BUILT_IN_KINDS);

const REQUEST: ConfirmRequest = {
  title: 'Trash notes.md',
  detail:
    'Moves docs/notes.md to the trash.\n\nArgument:\n```json\n"notes.md"\n```',
  subject: null,
};

const SUBJECT: ConfirmSubject = {
  toolName: 'app command docs.trash',
  input: 'notes.md',
};

const NO_LISTENER: AgentFormListener<FormBody> = {
  draft: () => Promise.resolve(),
  finish: () => undefined,
  cancel: () => undefined,
};

// A payload of the round `Allow or deny n1` submitted with Allow; each part
// can be overridden.
function payload(
  fields: Partial<AnswersPayload> = {},
  answer: Partial<AnswerResult> = {},
): AnswersPayload {
  return {
    outcome: 'submitted',
    summary: 'The user answered.',
    next: 'Act on the answers.',
    answers: [
      {
        index: 1,
        title: 'Allow or deny n1',
        status: 'answered',
        choice: 1,
        choice_text: 'Allow',
        took_recommendation: false,
        ...answer,
      },
    ],
    findings: [],
    notices: [],
    ...fields,
  };
}

type Open = FormsSession['open'];

// A forms session whose opens `open` answers; `collect` rejects, so a confirm
// that collects fails.
function fakeSession(open: Open) {
  const opens = vi.fn<Open>(open);
  const collect = vi.fn<FormsSession['collect']>(() =>
    Promise.reject(new Error('a confirm never collects')),
  );
  const session: FormsSession = { open: opens, collect, end: () => undefined };
  return { session, opens, collect };
}

// Opens answering each payload in turn.
function answering(...replies: AnswersPayload[]): Open {
  let next = 0;
  return () => {
    const reply = replies[next];
    next += 1;
    return reply === undefined
      ? Promise.reject(new Error('no more replies'))
      : Promise.resolve(reply);
  };
}

function live(): AbortSignal {
  return new AbortController().signal;
}

describe('confirm', () => {
  it.each([
    { case: "this round's submitted Allow", read: payload(), allowed: true },
    {
      case: 'choice 2',
      read: payload({}, { choice: 2, choice_text: 'Deny' }),
      allowed: false,
    },
    {
      case: 'a cancelled outcome',
      read: payload({ outcome: 'cancelled' }),
      allowed: false,
    },
    {
      case: 'an auto_answered outcome',
      read: payload({ outcome: 'auto_answered' }),
      allowed: false,
    },
    {
      case: 'an untouched answer',
      read: payload({}, { status: 'untouched' }),
      allowed: false,
    },
    {
      case: 'a not_applicable answer',
      read: payload({}, { status: 'not_applicable' }),
      allowed: false,
    },
    {
      case: 'a dont_ask answer',
      read: payload({}, { dont_ask: true }),
      allowed: false,
    },
    {
      case: 'a handed-back payload',
      read: payload({ earlier_heading: 'Trash notes.md' }),
      allowed: null,
    },
    {
      case: "another round's submitted Allow",
      read: payload({}, { title: 'Allow or deny n2' }),
      allowed: null,
    },
  ])(
    "confirmAllowed reads only this round's submitted Allow as allowed: $case",
    ({ read, allowed }) => {
      expect(confirmAllowed(read, 'n1')).toBe(allowed);
    },
  );

  it('askConfirm re-opens after a draft and resolves on its own answer', async () => {
    const draft = payload({ outcome: 'draft' }, { status: 'untouched' });
    const { session, opens, collect } = fakeSession(
      answering(draft, payload()),
    );

    const allowed = await askConfirm(session, REQUEST, 'n1', live(), 'tool-1');

    expect(allowed).toBe(true);
    expect(opens).toHaveBeenCalledTimes(2);
    expect(opens.mock.calls[1]?.slice(0, 2)).toEqual(
      opens.mock.calls[0]?.slice(0, 2),
    );
    expect(collect).not.toHaveBeenCalled();
  });

  it("askConfirm re-opens when the open returns another round's answer", async () => {
    const { session, opens, collect } = fakeSession(
      answering(
        payload({}, { title: 'Allow or deny other' }),
        payload({}, { choice: 2, choice_text: 'Deny' }),
      ),
    );

    const allowed = await askConfirm(session, REQUEST, 'n1', live(), null);

    expect(allowed).toBe(false);
    expect(opens).toHaveBeenCalledTimes(2);
    expect(collect).not.toHaveBeenCalled();
  });

  it.each([
    {
      case: 'aborted before the call',
      abortsFirst: true,
      allowsOnAbort: false,
      openCount: 0,
    },
    {
      case: 'aborted while the open waits',
      abortsFirst: false,
      allowsOnAbort: false,
      openCount: 1,
    },
    {
      case: 'an open that resolves Allow after the abort',
      abortsFirst: false,
      allowsOnAbort: true,
      openCount: 1,
    },
  ])(
    'askConfirm resolves false on an abort: $case',
    async ({ abortsFirst, allowsOnAbort, openCount }) => {
      const abort = new AbortController();
      // An open made on an aborted signal answers Allow, so a confirm that
      // opens after the abort resolves true; a waiting open rejects on the
      // abort, as the host's cancel does, or answers Allow when
      // `allowsOnAbort` is set.
      const { session, opens } = fakeSession((_args, _toolUseId, signal) =>
        signal.aborted
          ? Promise.resolve(payload())
          : new Promise<AnswersPayload>((resolve, reject) => {
              signal.addEventListener(
                'abort',
                () =>
                  allowsOnAbort
                    ? resolve(payload())
                    : reject(new Error('cancelled by the host')),
                { once: true },
              );
            }),
      );
      if (abortsFirst) {
        abort.abort();
      }

      const confirmed = askConfirm(session, REQUEST, 'n1', abort.signal, null);
      abort.abort();

      await expect(confirmed).resolves.toBe(false);
      expect(opens).toHaveBeenCalledTimes(openCount);
    },
  );

  it("confirmRoundArgs passes forms' round parser, recommends Deny and keeps the detail's blocks out of the overview", () => {
    const round = roundType.parse(confirmRoundArgs(REQUEST, 'n1'));

    const questions = (round.items.question ?? []) as Question[];
    const [question] = questions;
    expect(questions).toHaveLength(1);
    expect(question.title).toBe('Allow or deny n1');
    expect(question.choices[question.recommend - 1]).toBe('Deny');
    expect(round.overview).toBe('Moves docs/notes.md to the trash.');
    expect(question.context).toBe(REQUEST.detail);
  });

  // Breaks if a re-show makes a second key or the set follows the show.
  it('tracker_ReShowOfOneForm_HoldsOneKey', async () => {
    const events: string[] = [];
    const held = new Map<string, OpenConfirm>();
    const tracker = createConfirmTracker({
      set: (key, value) => {
        events.push(`set ${key}`);
        held.set(key, value);
      },
      delete: (key) => {
        events.push(`delete ${key}`);
        held.delete(key);
      },
    });
    const presenter = tracker.presenter({
      show: (form) => {
        events.push(`show ${form.formId}`);
      },
      close: () => undefined,
    });
    const form: PresentedAgentForm<Round, FormBody> = {
      formId: 'f1',
      sessionId: 'app-a',
      label: REQUEST.title,
      form: roundType.parse(confirmRoundArgs(REQUEST, 'n1')),
      draft: null,
    };
    let heldWhileOpen: [string, OpenConfirm][] = [];

    const allowed = await tracker.track('app-a', SUBJECT, 'n1', () => {
      presenter.show(form, NO_LISTENER);
      presenter.show(form, NO_LISTENER);
      heldWhileOpen = [...held];
      return Promise.resolve(true);
    });

    expect(allowed).toBe(true);
    expect(heldWhileOpen).toEqual([
      ['f1', { sessionId: 'app-a', subject: SUBJECT }],
    ]);
    expect(events).toEqual([
      'set f1',
      'show f1',
      'set f1',
      'show f1',
      'delete f1',
    ]);
    expect(held.size).toBe(0);
  });
});
