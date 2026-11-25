import type { AgentFormPresenter } from '../../../contracts/agent-forms';
import type { KeyedSlotWriter } from '../../../contracts/state';
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

// 1-based, as a question's `recommend` and an answer's `choice` are.
const ALLOW_CHOICE = 1;
const DENY_CHOICE = 2;

// The nonce in the question title gives each confirm its own fingerprint.
function questionTitle(nonce: string): string {
  return `Allow or deny ${nonce}`;
}

// The ask_round args of a confirm: one Allow or Deny question, Deny
// recommended, so a stray Enter and the headless auto-answer never allow. The
// overview, which renders inline markdown only, is the detail's first
// paragraph; the question's context holds the whole detail.
export function confirmRoundArgs(
  request: ConfirmRequest,
  nonce: string,
): unknown {
  return {
    heading: request.title,
    overview: firstParagraph(request.detail),
    questions: [
      {
        title: questionTitle(nonce),
        summary: request.title,
        context: request.detail,
        choices: ['Allow', 'Deny'],
        recommend: DENY_CHOICE,
        rationale:
          'A risky command runs only on your Allow. Deny is the safe pick when you did not ask for this.',
      },
    ],
  };
}

// The text before the first blank line, or all of it when it has none.
function firstParagraph(text: string): string {
  return text.split('\n\n', 1)[0] ?? text;
}

// True for a submitted Allow of the confirm round `nonce` names, false for any
// other answer of that round, and null for a payload that is not that round's
// answer: a handed-back earlier round, or another round's answers.
export function confirmAllowed(
  payload: AnswersPayload,
  nonce: string,
): boolean | null {
  const answer: AnswerResult | undefined = payload.answers[0];
  const isHandedBack = payload.earlier_heading !== undefined;
  const isThisRoundsAnswer = answer?.title === questionTitle(nonce);
  if (isHandedBack || !isThisRoundsAnswer) {
    return null;
  }
  return (
    payload.outcome === 'submitted' &&
    answer?.status === 'answered' &&
    answer.choice === ALLOW_CHOICE &&
    answer.dont_ask !== true
  );
}

// Opens the confirm round in `session` until it returns this round's own
// answer, re-sending the same args after a draft or another round's answers,
// and never collecting. Resolves false once `signal` aborts, an Allow that
// lands after the abort included; rejects with the open's error when the open
// fails unaborted (the session ended).
export async function askConfirm(
  session: FormsSession,
  request: ConfirmRequest,
  nonce: string,
  signal: AbortSignal,
  toolUseId: string | null,
): Promise<boolean> {
  const args = confirmRoundArgs(request, nonce);
  while (!signal.aborted) {
    let payload: AnswersPayload;
    try {
      payload = await session.open(args, toolUseId, signal);
    } catch (error) {
      if (signal.aborted) {
        return false;
      }
      throw error;
    }
    if (signal.aborted) {
      return false;
    }
    const allowed =
      payload.outcome === 'draft' ? null : confirmAllowed(payload, nonce);
    if (allowed !== null) {
      return allowed;
    }
  }
  return false;
}

// Publishes each confirm round that has a subject in `forms.confirms`.
// `presenter` wraps a service's presenter: a shown round whose one question is
// a tracked confirm's sets its form id's key before `inner` shows it. `track`
// tracks the confirm `nonce` names while `ask` runs, and deletes every key its
// rounds set once `ask` settles, however it settles; a null `subject` tracks
// nothing.
export interface ConfirmTracker {
  presenter(
    inner: AgentFormPresenter<Round, FormBody>,
  ): AgentFormPresenter<Round, FormBody>;
  track(
    sessionId: string,
    subject: ConfirmSubject | null,
    nonce: string,
    ask: () => Promise<boolean>,
  ): Promise<boolean>;
}

// A tracked confirm and the form ids its rounds showed under.
interface TrackedConfirm {
  open: OpenConfirm;
  formIds: Set<string>;
}

export function createConfirmTracker(
  confirms: Pick<KeyedSlotWriter<OpenConfirm>, 'set' | 'delete'>,
): ConfirmTracker {
  // By the confirm's question title.
  const tracked = new Map<string, TrackedConfirm>();
  return {
    presenter: (inner) => ({
      show: (form, listener) => {
        const title = onlyQuestionTitle(form.form);
        const confirm = title === undefined ? undefined : tracked.get(title);
        if (confirm !== undefined) {
          confirms.set(form.formId, confirm.open);
          confirm.formIds.add(form.formId);
        }
        inner.show(form, listener);
      },
      close: (formId) => inner.close(formId),
    }),
    track: async (sessionId, subject, nonce, ask) => {
      if (subject === null) {
        return ask();
      }
      const title = questionTitle(nonce);
      const confirm: TrackedConfirm = {
        open: { sessionId, subject },
        formIds: new Set(),
      };
      tracked.set(title, confirm);
      try {
        return await ask();
      } finally {
        for (const formId of confirm.formIds) {
          confirms.delete(formId);
        }
        tracked.delete(title);
      }
    },
  };
}

// The title of the round's question when it has exactly one.
function onlyQuestionTitle(round: Round): string | undefined {
  const questions = (round.items.question ?? []) as readonly Question[];
  return questions.length === 1 ? questions[0]?.title : undefined;
}
