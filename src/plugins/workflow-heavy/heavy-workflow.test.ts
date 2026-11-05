import { describe, expect, it } from 'vitest';
import type { WorkflowSignal } from '../workflow/contract';
import { heavyMainWorkflow } from './heavy-workflow';

const started = (skill: string): WorkflowSignal => ({
  type: 'skillStarted',
  skill,
  args: '',
  argsPath: null,
});

describe('heavyMainWorkflow', () => {
  it.each<{ name: string; signal: WorkflowSignal; claims: boolean }>([
    ...[
      'wigley:feature',
      'feature',
      'wigley:feature-primer',
      'feature-primer',
      'wigley:make',
      'make',
    ].map((skill) => ({ name: skill, signal: started(skill), claims: true })),
    ...['wigley:review', 'wigley:featurex', 'wigley:light'].map((skill) => ({
      name: skill,
      signal: started(skill),
      claims: false,
    })),
    { name: 'a turn end', signal: { type: 'turnEnded' }, claims: false },
  ])('claims_NamesOnlyHeavySkills ($name)', ({ signal, claims }) => {
    expect(heavyMainWorkflow.claims(signal)).toBe(claims);
  });
});
