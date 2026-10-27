import { openFixtureForm } from '../../../shared/agent-forms/drive-actions';
import type { ConnectedSession, ToolResult } from '../../sessions/contract';
import { primerType } from './primer-type';

// A valid open_primer call: four entries, needs yes, unclear, no and yes.
export const SAMPLE_PRIMER_ARGS: {
  feature: Record<string, string>;
  entries: Record<string, unknown>[];
} = {
  feature: {
    name: 'Sample feature',
    slug: 'sample-feature',
    spec: 'docs/sample-spec.md',
    summary: 'A sample feature the primer tests and the self-test open.',
  },
  entries: [
    {
      id: '1',
      number: 1,
      area: 'Data',
      task: 'Data model',
      need: 'yes',
      items: ['Add the record type', 'Save it with the profile'],
    },
    {
      id: '2',
      number: 2,
      area: 'UI',
      task: 'Screen',
      need: 'unclear',
      items: ['Draw the screen', 'Wire its buttons'],
    },
    {
      id: '3',
      number: 3,
      area: 'Audio',
      task: 'Audio',
      need: 'no',
      items: ['Add the sound cues'],
    },
    {
      id: 'tests',
      group: 'standing',
      task: 'Tests',
      need: 'yes',
      items: ['Unit tests for the rules'],
    },
  ],
};

// Calls open_primer in the session as an agent would, with no tool use id and
// a signal nothing aborts.
export function openFixturePrimer(
  session: ConnectedSession,
  args: unknown,
): Promise<ToolResult> {
  return openFixtureForm(session, primerType.openTool, args);
}
