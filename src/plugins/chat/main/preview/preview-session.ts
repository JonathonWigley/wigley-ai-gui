import type { ChatEntry, SessionControl } from '../../../../contracts/agent';
import { FAKE_HISTORY_IMAGES } from '../../../../shared/fake-agent-harness';

// The preview row's host session id; no harness holds a session by it.
export const PREVIEW_HOST_ID = 'chat-layout-preview';
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

// One entry of every kind, a tool and a permission in each of their states,
// both notice tones, and a streaming reply last.
export function previewEntries(): ChatEntry[] {
  return [
    {
      kind: 'user',
      id: 'preview-1',
      text: 'Draw this chat in your layout.',
      images: FAKE_HISTORY_IMAGES.map((image) => ({ ...image })),
      raw: [{ preview: 'user' }],
    },
    {
      kind: 'thinking',
      id: 'preview-2',
      text: 'Weighing how the entries should look.',
      streaming: false,
      raw: [{ preview: 'thinking' }],
    },
    {
      kind: 'assistant',
      id: 'preview-3',
      text: ASSISTANT_TEXT,
      streaming: false,
      raw: [{ preview: 'assistant' }],
    },
    {
      kind: 'tool',
      id: 'preview-4',
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
      toolName: 'Edit',
      input: { file_path: 'src/app.ts' },
      answer: { allowed: true, reason: null },
      raw: [{ preview: 'permission' }],
    },
    {
      kind: 'permission',
      id: 'preview-8',
      toolName: 'Bash',
      input: { command: 'rm -rf build' },
      answer: { allowed: false, reason: 'Keep the build folder.' },
      raw: [{ preview: 'permission' }],
    },
    {
      kind: 'permission',
      id: 'preview-9',
      toolName: 'Write',
      input: { file_path: 'notes.md' },
      answer: null,
      raw: [{ preview: 'permission' }],
    },
    {
      kind: 'result',
      id: 'preview-10',
      stopReason: 'end_turn',
      costUsd: 0.0123,
      durationMs: 4200,
      raw: [{ preview: 'result' }],
    },
    {
      kind: 'notice',
      id: 'preview-11',
      text: 'A notice in the info tone.',
      tone: 'info',
      raw: [{ preview: 'notice' }],
    },
    {
      kind: 'notice',
      id: 'preview-12',
      text: 'A notice in the error tone.',
      tone: 'error',
      raw: [{ preview: 'notice' }],
    },
    { kind: 'raw', id: 'preview-13', raw: [{ preview: 'raw' }] },
    {
      kind: 'assistant',
      id: 'preview-14',
      text: 'Still writing…',
      streaming: true,
      raw: [{ preview: 'assistant' }],
    },
  ];
}

// Every chip state the composer bar draws: a set value, the unset state, and
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
