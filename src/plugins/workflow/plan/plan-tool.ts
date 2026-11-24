import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';
import {
  type AgentSession,
  errorResult,
  textResult,
  type ToolDefinition,
  type ToolResult,
  type ToolSession,
} from '../../sessions/contract';
import {
  KEEPS_NO_PLAN_IGNORED,
  normalPlanDir,
  type PlanReporter,
  type PlanWorkflowLookup,
} from './plan-report';
import { planFileName } from './read-plan';

export const SET_WORKFLOW_PLAN_TOOL = 'set_workflow_plan';

export function planToolDefinition(): ToolDefinition {
  return {
    name: SET_WORKFLOW_PLAN_TOOL,
    description:
      "Set the plan folder this session's run writes, so the app shows that copy's progress. Call it once the run knows its folder, and again when the run moves to another copy.",
    inputSchema: {
      type: 'object',
      properties: {
        folder: {
          type: 'string',
          description:
            "The plan folder's absolute path: the folder holding the plan file.",
        },
      },
      required: ['folder'],
      additionalProperties: false,
    },
  };
}

export interface PlanToolDeps {
  paths: Paths;
  files: Pick<Files, 'stat'>;
  reportPlan: PlanReporter;
  // Once flows load, the session's flow's workflow when it keeps a plan, else
  // why the report is ignored.
  planWorkflowOf(sessionId: string): Promise<PlanWorkflowLookup>;
}

// A folder that is not absolute is an error; a session with no plan workflow
// succeeds with text saying which case ignored it; a folder that holds no plan
// file in that workflow's format is an error naming it. A flow that left its
// plan workflow before the report folds answers that its workflow keeps no
// plan.
async function setWorkflowPlan(
  deps: PlanToolDeps,
  sessionId: string,
  args: unknown,
): Promise<ToolResult> {
  const folder = (args as { folder?: unknown } | null | undefined)?.folder;
  if (typeof folder !== 'string' || !deps.paths.isAbsolute(folder)) {
    return errorResult('folder must be an absolute path.');
  }
  const { workflow, ignored } = await deps.planWorkflowOf(sessionId);
  if (workflow === null) {
    return textResult(ignored);
  }
  const planDir = normalPlanDir(deps.paths, folder);
  const fileName = planFileName(workflow.planFormat);
  try {
    const stat = await deps.files.stat(deps.paths.join(planDir, fileName));
    if (stat === null || stat.isFolder) {
      return errorResult(`${folder} holds no ${fileName}.`);
    }
  } catch (error) {
    return errorResult(`${folder} not read: ${errorText(error)}`);
  }
  return (await deps.reportPlan(sessionId, planDir))
    ? textResult(`Plan folder set to ${folder}.`)
    : textResult(KEEPS_NO_PLAN_IGNORED);
}

// What `start` hands sessions' `contributeTools`: each session's calls report
// that session's plan folder.
export function startPlanTool(
  deps: PlanToolDeps,
): (session: Pick<AgentSession, 'id'>) => ToolSession {
  return (session) => ({
    call(name, args) {
      if (name !== SET_WORKFLOW_PLAN_TOOL) {
        return Promise.reject(new Error(`no workflow tool "${name}"`));
      }
      return setWorkflowPlan(deps, session.id, args);
    },
    end: () => undefined,
  });
}
