import {
  errorResult,
  textResult,
  type ToolDefinition,
  type ToolResult,
  type ToolSession,
} from '../../sessions/contract';
import type { MainWorkflow } from '../contract';
import type { HeadlessLineSession, HeadlessLines } from './headless-line';

export const SET_WORKFLOW_STEP_TOOL = 'set_workflow_step';

// Each `reportedAs` once, in the order of `workflows` and then of their stages.
export function reportedSteps(workflows: readonly MainWorkflow[]): string[] {
  const steps = workflows.flatMap((workflow) =>
    workflow.stages.flatMap((stage) => stage.reportedAs ?? []),
  );
  return [...new Set(steps)];
}

export function stepToolDefinition(
  workflows: readonly MainWorkflow[],
): ToolDefinition {
  return {
    name: SET_WORKFLOW_STEP_TOOL,
    description:
      "Set this session's step in its workflow, so the app shows it. Call it each time a skill moves to one of these steps.",
    inputSchema: {
      type: 'object',
      properties: {
        step: {
          type: 'string',
          enum: reportedSteps(workflows),
          description: 'The step the session moves to.',
        },
      },
      required: ['step'],
      additionalProperties: false,
    },
  };
}

export interface StepToolDeps {
  // Read on each call, so a workflow added later is accepted at once.
  workflows(): readonly MainWorkflow[];
  // Folds the report; resolves whether the flow is now in the stage its own
  // workflow reports as `step`.
  reportStep(sessionId: string, step: string): Promise<boolean>;
  // Shared with every workflow tool; adds the headless line to each success.
  lines: HeadlessLines;
}

// A step no workflow lists is an error naming the accepted ones. A report the
// flow's own workflow does not take, or from a session with no flow, succeeds with
// text saying so, and `deps.lines` adds the headless line to each success.
async function setWorkflowStep(
  deps: StepToolDeps,
  session: HeadlessLineSession,
  args: unknown,
): Promise<ToolResult> {
  const step = (args as { step?: unknown } | null | undefined)?.step;
  const accepted = reportedSteps(deps.workflows());
  if (typeof step !== 'string' || !accepted.includes(step)) {
    return errorResult(`Unknown step. Use one of: ${accepted.join(', ')}.`);
  }
  return (await deps.reportStep(session.id, step))
    ? textResult(deps.lines.append(session, `Step set to ${step}.`))
    : textResult(
        deps.lines.append(
          session,
          `Ignored ${step}: this session is not at a place in the workflow that takes it.`,
        ),
      );
}

// The `start` workflow hands sessions' `contributeTools`: each session's calls
// report that session's step.
export function startStepTool(
  deps: StepToolDeps,
): (session: HeadlessLineSession) => ToolSession {
  return (session) => ({
    call(name, args) {
      if (name !== SET_WORKFLOW_STEP_TOOL) {
        return Promise.reject(new Error(`no workflow tool "${name}"`));
      }
      return setWorkflowStep(deps, session, args);
    },
    end: () => deps.lines.forget(session),
  });
}
