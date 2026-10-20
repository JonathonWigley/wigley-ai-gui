import type { ControlChoice } from '../../contracts/agent';

export type ClaudeControlId = 'mode' | 'effort' | 'model';

const MODEL_CHOICES: ControlChoice[] = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'fable', label: 'Fable' },
];

// `bypassPermissions` is left out: Claude refuses it mid-session unless the
// process was launched with `--dangerously-skip-permissions`.
export const CLAUDE_CONTROLS: readonly {
  id: ClaudeControlId;
  label: string;
  choices: ControlChoice[];
}[] = [
  {
    id: 'mode',
    label: 'Mode',
    choices: [
      { value: 'auto', label: 'Auto' },
      { value: 'acceptEdits', label: 'Accept edits' },
      { value: 'manual', label: 'Manual' },
      { value: 'plan', label: 'Plan' },
      { value: 'dontAsk', label: "Don't ask" },
    ],
  },
  {
    id: 'effort',
    label: 'Effort',
    choices: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'xhigh', label: 'Extra high' },
      { value: 'max', label: 'Max' },
    ],
  },
  {
    id: 'model',
    label: 'Model',
    choices: MODEL_CHOICES,
  },
];

// Claude reports the `manual` mode as `default`.
const REPORTED_MODES: Readonly<Record<string, string>> = { default: 'manual' };

// The control value a value Claude reported stands for: a full model name
// (`claude-opus-5-5[1m]`) becomes the alias it contains (`opus`).
export function controlValue(id: ClaudeControlId, reported: string): string {
  if (id === 'mode') {
    return REPORTED_MODES[reported] ?? reported;
  }
  if (id === 'effort') {
    return reported;
  }
  const name = reported.toLowerCase();
  const alias = MODEL_CHOICES.find((choice) => name.includes(choice.value));
  return alias?.value ?? reported;
}

// One stdin line sending `text` as the user's message.
export function userMessage(text: string): object {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
  };
}

// The stdin line that sets control `id` to `value`: the mode by a control
// request, effort and model by their slash commands.
export function controlMessage(
  id: ClaudeControlId,
  value: string,
  requestId: string,
): object {
  if (id === 'mode') {
    return {
      type: 'control_request',
      request_id: requestId,
      request: { subtype: 'set_permission_mode', mode: value },
    };
  }
  return userMessage(`/${id} ${value}`);
}
