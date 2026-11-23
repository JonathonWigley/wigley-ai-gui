import type { ToolDefinition } from '../../sessions/contract';
import {
  MAX_PRIMER_ENTRIES,
  MAX_PRIMER_ITEMS,
  PRIMER_NEEDS,
  PRIMER_SLUG_PATTERN,
} from '../contract';

const OPEN_PRIMER_DESCRIPTION =
  "Open the primer form in the wigley-ai-gui app's primer popup, " +
  "pre-filled with the agent's triage, and wait for the user's answers. " +
  "Send the primer rows (group 'primer') and then any standing tasks " +
  "(group 'standing'); each entry carries its work items. The auri:primer " +
  'skill holds the steps. The form lets the user set ' +
  "each task's need, tick items, comment, and add tasks and items; the " +
  'result carries the edited feature ' +
  'and entries. Re-sending a primer is safe: the same primer re-attaches to ' +
  'the one still open, returns the answers of the primer just submitted, or ' +
  "opens pre-filled with the user's saved answers. When the result carries " +
  "'earlier_heading', those answers belong to an earlier primer you never " +
  "received; read them, then send your primer again. On outcome 'draft', " +
  "call collect_last_primer. Outcome 'needs_manual_open' means the relay " +
  'could not start the app and no primer exists: send the same primer again ' +
  'with open_primer once, which tries the start again; if it comes back a ' +
  "second time, tell the user the reason in its 'summary'. " +
  'collect_last_primer is never the answer to it. While the user is still ' +
  'answering another primer of this session, an open_primer for a different ' +
  'primer waits until the user submits or cancels that primer in the app; if ' +
  "its deadline passes first, it returns a 'draft' whose 'next' says the " +
  'primer was not opened: send it again with open_primer, not ' +
  'collect_last_primer.';

const COLLECT_LAST_PRIMER_DESCRIPTION =
  'Re-attach to the primer already open in the app and wait for the ' +
  "answers, or return the last finished primer's answers again. Takes no " +
  "required arguments. Call this after open_primer returns outcome 'draft', " +
  "and after any failure that lost the answers. Outcome 'no_primer' means " +
  'no primer is open and no finished answers are waiting: send the primer ' +
  "again with open_primer, and the user's saved answers fill in.";

const ENTRY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'task', 'need', 'items'],
  properties: {
    id: {
      type: 'string',
      description: "The row number as a string, or a standing task's slug.",
    },
    group: { type: 'string', enum: ['primer', 'standing'], default: 'primer' },
    number: { type: 'integer' },
    area: { type: 'string' },
    question: { type: 'string' },
    task: { type: 'string' },
    need: { type: 'string', enum: [...PRIMER_NEEDS] },
    evidence: {
      type: 'string',
      description: 'The spec section or code behind the answer.',
    },
    probes: { type: 'string' },
    pointer: { type: 'string' },
    items: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_PRIMER_ITEMS,
      items: { type: 'string', minLength: 1 },
      description:
        'Two to six work items: what the task will do for this feature, at a high level.',
    },
  },
};

// The two primer tools as MCP tools/list publishes them; the relay's own copy
// of the open_primer schema matches this one but for descriptions and defaults.
export const PRIMER_TOOLS: ToolDefinition[] = [
  {
    name: 'open_primer',
    description: OPEN_PRIMER_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['feature', 'entries'],
      properties: {
        feature: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'slug'],
          properties: {
            name: { type: 'string' },
            slug: {
              type: 'string',
              pattern: PRIMER_SLUG_PATTERN.source,
              description: "Lowercase kebab-case; names the feature's folder.",
            },
            spec: { type: 'string', description: "The spec's path or link." },
            summary: {
              type: 'string',
              description: 'One paragraph on the feature.',
            },
          },
        },
        entries: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_PRIMER_ENTRIES,
          items: ENTRY_SCHEMA,
        },
      },
    },
  },
  {
    name: 'collect_last_primer',
    description: COLLECT_LAST_PRIMER_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        wait: {
          type: 'boolean',
          default: true,
          description:
            'false returns the current draft at once instead of waiting.',
        },
      },
    },
  },
];
