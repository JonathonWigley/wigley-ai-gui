import type { DriveHost } from '../../../contracts/plugin';
import { argsObject, requiredString } from '../../../shared/drive-args';
import type { ChecklistItem } from '../contract';
import { parseChecklistItems } from './checklist-tool';

// The tools' own report paths: each resolves whether the flow took the report.
export interface WorkflowDriveDeps {
  reportStep(sessionId: string, step: string): Promise<boolean>;
  reportChecklist(
    sessionId: string,
    items: readonly ChecklistItem[],
  ): Promise<boolean>;
}

// `workflow.reportStep` and `workflow.reportChecklist`, since a fake harness makes
// no tool call.
export function addDriveActions(
  drive: DriveHost,
  deps: WorkflowDriveDeps,
): void {
  drive.add('reportStep', {
    description:
      "Reports a step for a session as set_workflow_step does. `accepted` is false for a step outside the flow's workflow or one its stage rules ignore.",
    args: '{ "sessionId": string, "step": string }',
    async run(rawArgs) {
      const args = argsObject(rawArgs);
      const accepted = await deps.reportStep(
        requiredString(args, 'sessionId'),
        requiredString(args, 'step'),
      );
      return { accepted };
    },
  });
  drive.add('reportChecklist', {
    description:
      'Reports a whole checklist for a session as set_workflow_checklist does. `accepted` is false for a session with no workflow.',
    args: '{ "sessionId": string, "items": { "text": string, "done": boolean, "running"?: boolean }[] }',
    async run(rawArgs) {
      const args = argsObject(rawArgs);
      const sessionId = requiredString(args, 'sessionId');
      const items = parseChecklistItems(args.items);
      if (typeof items === 'string') {
        throw new Error(items);
      }
      return { accepted: await deps.reportChecklist(sessionId, items) };
    },
  });
}
