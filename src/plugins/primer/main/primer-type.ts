import type { AgentFormType } from '../../../contracts/agent-forms';
import type { Primer, PrimerBody, PrimerPayload } from '../contract';
import {
  noPrimerPayload,
  parsePrimer,
  primerFingerprint,
  primerHandedBackPayload,
  primerNotShownPayload,
  primerPayload,
  readPrimerBody,
  savedPrimerHeading,
} from './primer';
import { PrimerError } from './primer-error';

// The feature primer as an agent form type: `open_primer` opens one and
// `collect_last_primer` collects it. A primer has no Don't-ask state, so a
// saved body pre-fills as it is.
export const primerType: AgentFormType<Primer, PrimerBody, PrimerPayload> = {
  openTool: 'open_primer',
  collectTool: 'collect_last_primer',
  noun: 'primer',
  argsErrorText: (error) =>
    error instanceof PrimerError ? error.message : null,
  parse: parsePrimer,
  fingerprint: primerFingerprint,
  heading: (primer) => primer.feature.name,
  savedHeading: savedPrimerHeading,
  readBody: readPrimerBody,
  prefill: (_primer, saved) => saved,
  payload: primerPayload,
  handedBackPayload: primerHandedBackPayload,
  noFormPayload: noPrimerPayload,
  notShownPayload: primerNotShownPayload,
};
