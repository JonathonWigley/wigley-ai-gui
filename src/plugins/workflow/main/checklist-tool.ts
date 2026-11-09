import {
  type AgentSession,
  errorResult,
  textResult,
  type ToolDefinition,
  type ToolResult,
  type ToolSession,
} from '../../sessions/contract';
import type { ChecklistItem } from '../contract';
import { isChecklistItem } from './flow-store';
import { createHeadlessLines } from './headless-line';

export const SET_WORKFLOW_CHECKLIST_TOOL = 'set_workflow_checklist';

const BAD_ITEMS =
  'items must be an array of { text: string, done: boolean }, with text not empty.';

export function checklistToolDefinition(): ToolDefinition {
  return {
    name: SET_WORKFLOW_CHECKLIST_TOOL,
    description:
      "Set this session's checklist, so the app shows it. Send the whole list each time: this call replaces the list before it.",
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              done: { type: 'boolean' },
            },
            required: ['text', 'done'],
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  };
}

// The items with only their `text` and `done`, or the error text for a bad shape.
export function parseChecklistItems(
  value: unknown,
): readonly ChecklistItem[] | string {
  if (!Array.isArray(value)) {
    return BAD_ITEMS;
  }
  const items: ChecklistItem[] = [];
  for (const entry of value as unknown[]) {
    if (!isChecklistItem(entry) || entry.text === '') {
      return BAD_ITEMS;
    }
    items.push({ text: entry.text, done: entry.done });
  }
  return items;
}

export interface ChecklistToolDeps {
  // Folds the list; resolves whether the session has a workflow to hold it.
  reportChecklist(
    sessionId: string,
    items: readonly ChecklistItem[],
  ): Promise<boolean>;
  // Read on each call; a headless session's results carry the headless line.
  isHeadless(sessionId: string): boolean;
}

// Bad items are an error. A session with no workflow succeeds with text saying
// so, since a skill's first call may come before the app knows of the flow.
// `lines` adds the headless line to each success.
async function setWorkflowChecklist(
  deps: ChecklistToolDeps,
  sessionId: string,
  args: unknown,
  lines: { append(text: string): string },
): Promise<ToolResult> {
  const items = parseChecklistItems(
    (args as { items?: unknown } | null | undefined)?.items,
  );
  if (typeof items === 'string') {
    return errorResult(items);
  }
  if (!(await deps.reportChecklist(sessionId, items))) {
    return textResult(
      lines.append('Ignored the checklist: this session has no workflow yet.'),
    );
  }
  const done = items.filter((item) => item.done).length;
  return textResult(
    lines.append(
      `Checklist set: ${String(done)} of ${String(items.length)} done.`,
    ),
  );
}

// The `start` workflow hands sessions' `contributeTools`: each session's calls
// report that session's checklist.
export function startChecklistTool(
  deps: ChecklistToolDeps,
): (session: Pick<AgentSession, 'id'>) => ToolSession {
  return (session) => {
    const lines = createHeadlessLines(() => deps.isHeadless(session.id));
    return {
      call(name, args) {
        if (name !== SET_WORKFLOW_CHECKLIST_TOOL) {
          return Promise.reject(new Error(`no workflow tool "${name}"`));
        }
        return setWorkflowChecklist(deps, session.id, args, lines);
      },
      end: () => undefined,
    };
  };
}
