import { describe, expect, it } from 'vitest';
import type { WorkflowSignal } from '../workflow/contract';
import { largeMainWorkflow } from './large-workflow';

const started = (skill: string): WorkflowSignal => ({
  type: 'skillStarted',
  skill,
  args: '',
  argsPath: null,
});

describe('largeMainWorkflow', () => {
  it.each<{ name: string; signal: WorkflowSignal; claims: boolean }>([
    ...[
      'wigley:feature',
      'feature',
      'wigley:feature-primer',
      'feature-primer',
      'wigley:make',
      'make',
    ].map((skill) => ({ name: skill, signal: started(skill), claims: true })),
    ...['wigley:review', 'wigley:featurex', 'wigley:small'].map((skill) => ({
      name: skill,
      signal: started(skill),
      claims: false,
    })),
    { name: 'a turn end', signal: { type: 'turnEnded' }, claims: false },
  ])('claims_NamesOnlyLargeSkills ($name)', ({ signal, claims }) => {
    expect(largeMainWorkflow.claims(signal)).toBe(claims);
  });
});
