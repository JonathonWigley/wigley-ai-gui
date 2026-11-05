import {
  type ChatEntry,
  MAIN_AGENT_ID,
  type SessionControl,
} from '../../../../contracts/agent';
import { FAKE_HISTORY_IMAGES } from '../../../../shared/fake-agent-harness';
import { SAMPLE_VISUALS_TEXT } from '../../../../shared/sample-visuals';

// The row label and the Chat tab's name are this folder's basename.
export const PREVIEW_PROJECT_DIR = 'Chat preview';
export const PREVIEW_PROFILE = 'preview';

const ASSISTANT_TEXT = [
  'The sample holds **every entry kind**.',
  '',
  '- a list item',
  '- `inline code`',
  '',
  '```ts',
  "const layout = 'default';",
  '```',
].join('\n');

// A reply still streaming, its html block not closed yet.
const STREAMING_TEXT = [
  'Still writing…',
  '',
  '```html',
  '<!doctype html>',
  '<html>',
].join('\n');

// The `at` of the preview's first entry; each entry after it is two seconds
// later, so the finished lines read stable times.
const PREVIEW_START_AT = 1767225600000;
const PREVIEW_ENTRY_STEP_MS = 2000;

const previewAt = (index: number) =>
  PREVIEW_START_AT + index * PREVIEW_ENTRY_STEP_MS;

// One entry of every kind, a tool and a permission in each of their states,
// both notice tones, a reply holding two visuals, and a streaming reply last,
// its visual still open.
export function previewEntries(): ChatEntry[] {
  return [
    {
      kind: 'user',
      id: 'preview-1',
      at: previewAt(0),
      text: 'Draw this chat in your layout.',
      images: FAKE_HISTORY_IMAGES.map((image) => ({ ...image })),
      raw: [{ preview: 'user' }],
    },
    {
      kind: 'thinking',
      id: 'preview-2',
      at: previewAt(1),
      text: 'Weighing how the entries should look.',
      streaming: false,
      raw: [{ preview: 'thinking' }],
    },
    {
      kind: 'assistant',
      id: 'preview-3',
      at: previewAt(2),
      text: ASSISTANT_TEXT,
      streaming: false,
      raw: [{ preview: 'assistant' }],
    },
    {
      kind: 'tool',
      id: 'preview-4',
      at: previewAt(3),
      agentId: MAIN_AGENT_ID,
      toolUseId: 'preview-tool-4',
      name: 'Read',
      input: { file_path: 'src/app.ts' },
      summary: 'src/app.ts',
      result: { text: 'export const app = 1;', isError: false },
      raw: [{ preview: 'tool' }],
    },
    {
      kind: 'tool',
      id: 'preview-5',
      at: previewAt(4),
      agentId: MAIN_AGENT_ID,
      toolUseId: 'preview-tool-5',
      name: 'Bash',
      input: { command: 'false' },
      summary: 'false',
      result: { text: 'exit code 1', isError: true },
      raw: [{ preview: 'tool' }],
    },
    {
      kind: 'tool',
      id: 'preview-6',
      at: previewAt(5),
      agentId: MAIN_AGENT_ID,
      toolUseId: 'preview-tool-6',
      name: 'Bash',
      input: { command: 'npm test' },
      summary: 'npm test',
      result: null,
      raw: [{ preview: 'tool' }],
    },
    {
      kind: 'permission',
      id: 'preview-7',
      at: previewAt(6),
      toolName: 'Edit',
      input: { file_path: 'src/app.ts' },
      answer: { allowed: true, reason: null },
      raw: [{ preview: 'permission' }],
    },
    {
      kind: 'permission',
      id: 'preview-8',
      at: previewAt(7),
      toolName: 'Bash',
      input: { command: 'rm -rf build' },
      answer: { allowed: false, reason: 'Keep the build folder.' },
      raw: [{ preview: 'permission' }],
    },
    {
      kind: 'permission',
      id: 'preview-9',
      at: previewAt(8),
      toolName: 'Write',
      input: { file_path: 'notes.md' },
      answer: null,
      raw: [{ preview: 'permission' }],
    },
    {
      kind: 'result',
      id: 'preview-10',
      at: previewAt(9),
      stopReason: 'end_turn',
      costUsd: 0.0123,
      durationMs: 4200,
      raw: [{ preview: 'result' }],
    },
    {
      kind: 'notice',
      id: 'preview-11',
      at: previewAt(10),
      text: 'A notice in the info tone.',
      tone: 'info',
      raw: [{ preview: 'notice' }],
    },
    {
      kind: 'notice',
      id: 'preview-12',
      at: previewAt(11),
      text: 'A notice in the error tone.',
      tone: 'error',
      raw: [{ preview: 'notice' }],
    },
    {
      kind: 'raw',
      id: 'preview-13',
      at: previewAt(12),
      raw: [{ preview: 'raw' }],
    },
    {
      kind: 'compaction',
      id: 'preview-14',
      at: previewAt(13),
      trigger: 'app',
      beforeTokens: 182000,
      afterTokens: 24000,
      durationMs: 9000,
      raw: [{ preview: 'compaction' }],
    },
    {
      kind: 'assistant',
      id: 'preview-15',
      at: previewAt(14),
      text: SAMPLE_VISUALS_TEXT,
      streaming: false,
      raw: [{ preview: 'visuals' }],
    },
    {
      kind: 'assistant',
      id: 'preview-16',
      at: previewAt(15),
      text: STREAMING_TEXT,
      streaming: true,
      raw: [{ preview: 'assistant' }],
    },
  ];
}

// Every chip state the status line draws: a set value, the unset state, and
// `verbosity`, which no pick key reaches.
export function previewControls(): SessionControl[] {
  return [
    {
      id: 'mode',
      label: 'Mode',
      choices: [
        { value: 'default', label: 'Manual' },
        { value: 'auto', label: 'Auto' },
        { value: 'plan', label: 'Plan' },
      ],
      value: 'auto',
    },
    {
      id: 'effort',
      label: 'Effort',
      choices: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ],
      value: null,
    },
    {
      id: 'model',
      label: 'Model',
      choices: [
        { value: 'sonnet', label: 'Sonnet' },
        { value: 'opus', label: 'Opus' },
      ],
      value: 'opus',
    },
    {
      id: 'verbosity',
      label: 'Verbosity',
      choices: [
        { value: 'brief', label: 'Brief' },
        { value: 'full', label: 'Full' },
      ],
      value: 'brief',
    },
  ];
}
