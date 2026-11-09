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
import { normalPlanDir, type PlanReporter } from './plan-report';

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
            "The plan folder's absolute path: the folder holding plan.md.",
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
}

// A folder that is not absolute or holds no `plan.md` is an error naming it; a
// session no Large flow holds succeeds with text saying it was ignored.
async function setWorkflowPlan(
  deps: PlanToolDeps,
  sessionId: string,
  args: unknown,
): Promise<ToolResult> {
  const folder = (args as { folder?: unknown } | null | undefined)?.folder;
  if (typeof folder !== 'string' || !deps.paths.isAbsolute(folder)) {
    return errorResult('folder must be an absolute path.');
  }
  const planDir = normalPlanDir(deps.paths, folder);
  try {
    const stat = await deps.files.stat(deps.paths.join(planDir, 'plan.md'));
    if (stat === null || stat.isFolder) {
      return errorResult(`${folder} holds no plan.md.`);
    }
  } catch (error) {
    return errorResult(`${folder} not read: ${errorText(error)}`);
  }
  return (await deps.reportPlan(sessionId, planDir))
    ? textResult(`Plan folder set to ${folder}.`)
    : textResult('Ignored: this session runs no Large workflow.');
}

// What `start` hands sessions' `contributeTools`: each session's calls report
// that session's plan folder.
export function startPlanTool(
  deps: PlanToolDeps,
): (session: Pick<AgentSession, 'id'>) => ToolSession {
  return (session) => ({
    call(name, args) {
      if (name !== SET_WORKFLOW_PLAN_TOOL) {
        return Promise.reject(new Error(`no workflow-large tool "${name}"`));
      }
      return setWorkflowPlan(deps, session.id, args);
    },
    end: () => undefined,
  });
}
