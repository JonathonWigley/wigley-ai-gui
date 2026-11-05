import {
  type AgentSession,
  errorResult,
  textResult,
  type ToolDefinition,
  type ToolResult,
  type ToolSession,
} from '../../sessions/contract';
import type { MainStage, StageId } from '../contract';

export const SET_WORKFLOW_STEP_TOOL = 'set_workflow_step';

function reportedSteps(stages: readonly MainStage[]): string[] {
  return stages.flatMap((stage) => stage.reportedAs ?? []);
}

export function stepToolDefinition(
  stages: readonly MainStage[],
): ToolDefinition {
  return {
    name: SET_WORKFLOW_STEP_TOOL,
    description:
      "Set this session's step in the wigley workflow, so the app shows it. Call it each time a skill moves to one of these steps.",
    inputSchema: {
      type: 'object',
      properties: {
        step: {
          type: 'string',
          enum: reportedSteps(stages),
          description: 'The step the session moves to.',
        },
      },
      required: ['step'],
      additionalProperties: false,
    },
  };
}

export interface StepToolDeps {
  // Read on each call, so a stage added later is accepted at once.
  stages(): readonly MainStage[];
  // Folds the report; resolves whether the flow is now in `stage`.
  reportStep(sessionId: string, stage: StageId): Promise<boolean>;
}

// An unknown step is an error naming the accepted ones. A report the flow's stage
// rules ignore, or from a session with no flow, succeeds with text saying so.
async function setWorkflowStep(
  deps: StepToolDeps,
  sessionId: string,
  args: unknown,
): Promise<ToolResult> {
  const step = (args as { step?: unknown } | null | undefined)?.step;
  const stage =
    typeof step === 'string'
      ? deps.stages().find((held) => held.reportedAs === step)
      : undefined;
  if (stage === undefined) {
    const accepted = reportedSteps(deps.stages()).join(', ');
    return errorResult(`Unknown step. Use one of: ${accepted}.`);
  }
  return (await deps.reportStep(sessionId, stage.id))
    ? textResult(`Step set to ${stage.reportedAs}.`)
    : textResult(
        `Ignored ${stage.reportedAs}: this session is not at a place in the workflow that takes it.`,
      );
}

// The `start` workflow hands sessions' `contributeTools`: each session's calls
// report that session's step.
export function startStepTool(
  deps: StepToolDeps,
): (session: Pick<AgentSession, 'id'>) => ToolSession {
  return (session) => ({
    call(name, args) {
      if (name !== SET_WORKFLOW_STEP_TOOL) {
        return Promise.reject(new Error(`no workflow tool "${name}"`));
      }
      return setWorkflowStep(deps, session.id, args);
    },
    end: () => undefined,
  });
}
