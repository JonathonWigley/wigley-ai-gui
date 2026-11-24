// The sample workflows and plan format: the one copy in the app, which the
// tests, the self-tests and the demo run on, declared under the sample plugin
// (`src/shared/sample-plugin.ts`). The JSON sits under `fixtures/`, since its
// skill names are sample data the boundary check exempts (`AGENTS.md` § README,
// changelog and boundary).

import type { AuriFile } from '../../../contracts/contributions';
import { SAMPLE_PLUGIN_NAME } from '../../../shared/sample-plugin';
import { type DeclaredWorkflow, qualifiedWorkflowId } from '../contract';
import sampleAuri from './fixtures/sample-auri.json';

export const SAMPLE_AURI_FILE: AuriFile = sampleAuri as AuriFile;

export { SAMPLE_PLUGIN_NAME };

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
