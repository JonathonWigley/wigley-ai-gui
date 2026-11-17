import {
  type AgentStart,
  type ControlChoice,
  CONTROL_ROLES,
  type SessionControl,
  type UserMessage,
} from '../../../contracts/agent';
import { asJson, asString, type Json } from './json-fields';

export type ClaudeControlId = 'mode' | 'effort' | 'model';

const MODEL_CHOICES: ControlChoice[] = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'fable', label: 'Fable' },
];

// `bypassPermissions` is left out: Claude refuses it mid-session unless the
// process was launched with `--dangerously-skip-permissions`. The model choices
// are the ones a process starts with; its `initialize` answer replaces them.
export const CLAUDE_CONTROLS: readonly {
  id: ClaudeControlId;
  label: string;
  choices: ControlChoice[];
  role: string;
}[] = [
  {
    id: 'mode',
    label: 'Mode',
    role: CONTROL_ROLES.permissionMode,
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
    role: CONTROL_ROLES.effort,
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
    role: CONTROL_ROLES.model,
    choices: MODEL_CHOICES,
  },
];

// The `/effort` value that hands the level to Claude: it names no choice.
export const EFFORT_CLEARING_VALUE = 'auto';

// The permission mode a process launches with: the request's, else `auto`.
export function launchMode(controls: AgentStart['controls']): string {
  return controls.mode ?? 'auto';
}

// The controls a process launched with `controls` starts with: the mode it
// launches in (`launchMode`), and the model and effort `controls` holds, else
// null.
export function startingControls(
  controls: AgentStart['controls'],
): SessionControl[] {
  const launched: Readonly<Record<string, string>> = {
    ...controls,
    mode: launchMode(controls),
  };
  return CLAUDE_CONTROLS.map((control) => ({
    ...control,
    choices: [...control.choices],
    value: launched[control.id] ?? null,
  }));
}

// A typed `/effort <value>` or `/model <value>`.
export const CONTROL_COMMAND = /^\/(effort|model) (\S+)$/;

export function controlOf(
  id: string,
): (typeof CLAUDE_CONTROLS)[number] | undefined {
  return CLAUDE_CONTROLS.find((control) => control.id === id);
}

// Whether control `id` in `controls` offers `value`; false when `controls`
// holds no control `id`.
export function isChoice(
  controls: readonly SessionControl[],
  id: ClaudeControlId,
  value: string,
): boolean {
  const choices = controls.find((control) => control.id === id)?.choices ?? [];
  return choices.some((choice) => choice.value === value);
}

// Claude reports the `manual` mode as `default`.
const REPORTED_MODES: Readonly<Record<string, string>> = { default: 'manual' };

// The control value a value Claude reported stands for, given the control's
// current `choices`: a model name that is a choice stays itself, and a full
// model name (`claude-opus-5-5[1m]`) becomes the first choice it contains
// (`opus`).
export function controlValue(
  id: ClaudeControlId,
  reported: string,
  choices: readonly ControlChoice[],
): string {
  if (id === 'mode') {
    return REPORTED_MODES[reported] ?? reported;
  }
  if (id === 'effort') {
    return reported;
  }
  const exact = choices.find((choice) => choice.value === reported);
  const name = reported.toLowerCase();
  const alias = exact ?? choices.find((choice) => name.includes(choice.value));
  return alias?.value ?? reported;
}

// The model and effort a `get_settings` reply says the process applies, as
// Claude reports them; null when it names no applied model. `effort` is null for
// a model with no effort support.
export function appliedControlsOf(
  reply: Json,
): { model: string; effort: string | null } | null {
  const applied = asJson(reply.applied);
  const model = asString(applied.model);
  if (model === '') {
    return null;
  }
  const effort = asString(applied.effort);
  return { model, effort: effort === '' ? null : effort };
}

// One stdin line sending the user's message: plain text content when it has
// no images, else each image's block in order, then a text block when the
// text is not empty. `uuid` is the message's client id, by which Claude
// reports the message's lifecycle. `isNow` adds `priority: 'now'`, which ends
// the running turn so the message runs at once (claude-stream.md § Send now).
export function userMessage(
  message: UserMessage,
  uuid: string,
  isNow = false,
): object {
  return {
    type: 'user',
    message: { role: 'user', content: messageContent(message) },
    parent_tool_use_id: null,
    uuid,
    ...(isNow ? { priority: 'now' } : {}),
  };
}

function messageContent(message: UserMessage): string | object[] {
  if (message.images.length === 0) {
    return message.text;
  }
  const blocks: object[] = message.images.map((image) => ({
    type: 'image',
    source: { type: 'base64', media_type: image.mediaType, data: image.data },
  }));
  if (message.text !== '') {
    blocks.push({ type: 'text', text: message.text });
  }
  return blocks;
}

// The stdin line that sets control `id` to `value`: the mode by a control
// request, effort and model by their slash commands. `lineId` is the mode
// request's `request_id`, and the slash command message's `uuid`.
export function controlMessage(
  id: ClaudeControlId,
  value: string,
  lineId: string,
): object {
  if (id === 'mode') {
    return {
      type: 'control_request',
      request_id: lineId,
      request: { subtype: 'set_permission_mode', mode: value },
    };
  }
  return userMessage({ text: `/${id} ${value}`, images: [] }, lineId);
}
