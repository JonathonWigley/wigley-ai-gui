import { afterEach, beforeEach } from 'vitest';
import type { Disposable } from '../../contracts/disposable';
import type { FindingOriginSpec } from './contract';
import { FINDING_ORIGIN_SPECS, findingOrigins } from './finding-origins';

// A plugin's origin for tests: its own card, severity required, two actions.
export const SECURITY_ORIGIN: FindingOriginSpec = {
  id: 'security',
  card: 'risk',
  words: { kind: 'Risk', finding: 'Risk', proof: 'Exposure' },
  choiceNoun: 'its mitigations',
  meaning: 'a hole an attacker could use',
  minChoices: 1,
  maxChoices: 3,
  requiresSeverity: true,
  requiresProof: false,
  actions: { fix_now: 'Patch', leave_it: 'Accept' },
  chip: 'Security',
  themeToken: 'security.origin',
};

// Registers FINDING_ORIGIN_SPECS in `findingOrigins` before each test and
// disposes them after it. A test that starts forms' main or page part does not
// call it: the part's start registers them.
export function useBuiltInFindingOrigins(): void {
  let registrations: Disposable[] = [];
  beforeEach(() => {
    registrations = FINDING_ORIGIN_SPECS.map((spec) =>
      findingOrigins.register(spec),
    );
  });
  afterEach(() => {
    for (const registration of registrations) {
      registration.dispose();
    }
    registrations = [];
  });
}
