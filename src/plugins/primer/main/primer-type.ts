import type { AgentFormType } from '../../../contracts/agent-forms';
import {
  type Primer,
  type PrimerBody,
  PRIMER_ERROR_NAME,
  type PrimerPayload,
} from '../contract';
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

// The feature primer as an agent form type: `open_primer` opens one and
// `collect_last_primer` collects it. A primer has no Don't-ask state, so a
// saved body pre-fills as it is.
export const primerType: AgentFormType<Primer, PrimerBody, PrimerPayload> = {
  openTool: 'open_primer',
  collectTool: 'collect_last_primer',
  noun: 'primer',
  argsErrorName: PRIMER_ERROR_NAME,
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
