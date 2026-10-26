import type { PresentedAgentForm } from '../../../contracts/agent-forms';
import type { FormBody, PresentedRound, Round } from '../contract';

// A form main presented, as the page's round state holds it.
export function presentedRoundOf(
  form: PresentedAgentForm<Round, FormBody>,
): PresentedRound {
  return {
    roundId: form.formId,
    sessionId: form.sessionId,
    label: form.label,
    round: form.form,
    draft: form.draft,
  };
}
