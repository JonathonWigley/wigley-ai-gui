import {
  errorResult,
  textResult,
  type ToolDefinition,
  type ToolResult,
  type ToolSession,
} from '../../sessions/contract';
import type { ChecklistItem } from '../contract';
import { isChecklistItem } from './flow-store';
import type { HeadlessLineSession, HeadlessLines } from './headless-line';

export const SET_WORKFLOW_CHECKLIST_TOOL = 'set_workflow_checklist';

const BAD_ITEMS =
  'items must be an array of { text: string, done: boolean, running?: boolean }, with text not empty.';

export function checklistToolDefinition(): ToolDefinition {
  return {
    name: SET_WORKFLOW_CHECKLIST_TOOL,
    description:
      "Set this session's checklist, so the app shows it. Send the whole list each time: this call replaces the list before it. Mark the item being worked on with running: true; with none marked, the app shows the first item not done as running and the rest as not started.",
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
              running: { type: 'boolean' },
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

// The items with only their `text`, `done` and any `running`, or the error text
// for a bad shape.
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
    items.push(
      entry.running === undefined
        ? { text: entry.text, done: entry.done }
        : { text: entry.text, done: entry.done, running: entry.running },
    );
  }
  return items;
}

export interface ChecklistToolDeps {
  // Folds the list; resolves whether the app holds a flow for the session.
  reportChecklist(
    sessionId: string,
    items: readonly ChecklistItem[],
  ): Promise<boolean>;
  // Shared with every workflow tool; adds the headless line to each success.
  lines: HeadlessLines;
}

// Bad items are an error. A session with no flow succeeds with text saying
// so, since a skill's first call may come before the app knows of the flow.
// `deps.lines` adds the headless line to each success.
async function setWorkflowChecklist(
  deps: ChecklistToolDeps,
  session: HeadlessLineSession,
  args: unknown,
): Promise<ToolResult> {
  const items = parseChecklistItems(
    (args as { items?: unknown } | null | undefined)?.items,
  );
  if (typeof items === 'string') {
    return errorResult(items);
  }
  if (!(await deps.reportChecklist(session.id, items))) {
    return textResult(
      deps.lines.append(
        session,
        'Ignored the checklist: the app holds no flow for this session.',
      ),
    );
  }
  const done = items.filter((item) => item.done).length;
  return textResult(
    deps.lines.append(
      session,
      `Checklist set: ${String(done)} of ${String(items.length)} done.`,
    ),
  );
}

// The `start` workflow hands sessions' `contributeTools`: each session's calls
// report that session's checklist.
export function startChecklistTool(
  deps: ChecklistToolDeps,
): (session: HeadlessLineSession) => ToolSession {
  return (session) => ({
    call(name, args) {
      if (name !== SET_WORKFLOW_CHECKLIST_TOOL) {
        return Promise.reject(new Error(`no workflow tool "${name}"`));
      }
      return setWorkflowChecklist(deps, session, args);
    },
    end: () => deps.lines.forget(session),
  });
}
