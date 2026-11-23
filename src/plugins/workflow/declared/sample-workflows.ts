// The user's four workflows and plan format as sample data: the one copy in
// the app, which the tests, the self-tests and the demo run on, and which the
// `wigley` plugin's `auri.json` copies. Its `wigley:` skill names are test
// fixture and demo sample data, which the boundary rules allow
// (docs/features/shareable-app/plan-shareable-app/plan.md § Boundary rules).

import type { AuriFile } from '../../../contracts/contributions';
import { type DeclaredWorkflow, qualifiedWorkflowId } from '../contract';
import sampleAuri from './sample-auri.json';

export const SAMPLE_AURI_FILE: AuriFile = sampleAuri as AuriFile;

export const SAMPLE_PLUGIN_NAME = 'wigley';

export type SampleWorkflowId = 'small' | 'medium' | 'large' | 'spike';

// The sample declaration `id` as the engine enables it: qualified under
// `pluginName`, with the sample's `planFormat`. Each call builds a fresh copy,
// so a caller may change it.
export function sampleDeclared(
  id: SampleWorkflowId,
  pluginName: string = SAMPLE_PLUGIN_NAME,
): DeclaredWorkflow {
  const decl = SAMPLE_AURI_FILE.workflows?.find((each) => each.id === id);
  if (decl === undefined) {
    throw new Error(`no sample workflow ${id}`);
  }
  return {
    id: qualifiedWorkflowId(pluginName, id),
    pluginName,
    decl: structuredClone(decl),
    planFormat: structuredClone(SAMPLE_AURI_FILE.planFormat ?? null),
  };
}
