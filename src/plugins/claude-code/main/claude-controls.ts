import {
  type AgentStart,
  type ControlChoice,
  CONTROL_ROLES,
  type SessionControl,
  type UserMessage,
} from '../../../contracts/agent';
import { capPermission } from '../../../shared/permission-cap';
import { asJson, asString, type Json } from './json-fields';

export type ClaudeControlId = 'mode' | 'effort' | 'model';

const MODEL_CHOICES: ControlChoice[] = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'fable', label: 'Fable' },
];

// `bypassPermissions` is no choice of a normal process: Claude refuses it
// mid-session unless the process launched with `SKIP_PERMISSIONS_FLAG`. A
// permissive launch starts at `BYPASS_MODE`, with `BYPASS_CHOICE` added to its
// own Mode choices (`startingControls`). The model choices are the ones a
// process starts with; its `initialize` answer replaces them.
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

// The permission mode a process launches with when its request sets none.
const LAUNCH_MODE = 'auto';

// The permission mode, launch flag and Mode choice of a permissive launch
// (`AgentStart.permissions` 'auto').
export const BYPASS_MODE = 'bypassPermissions';
export const SKIP_PERMISSIONS_FLAG = '--dangerously-skip-permissions';
export const BYPASS_CHOICE: ControlChoice = {
  value: BYPASS_MODE,
  label: 'Bypass permissions',
};

// The `mode` values from least to most permissive.
export const CLAUDE_PERMISSION_ORDER: readonly string[] = [
  'plan',
  'dontAsk',
  'manual',
  'acceptEdits',
  'auto',
];

// The permission mode a process launches with: `BYPASS_MODE` for a permissive
// request, whatever its `mode` control holds; else the request's `mode`, else
// `auto`.
export function launchMode(
  request: Pick<AgentStart, 'controls' | 'permissions'>,
): string {
  if (request.permissions === 'auto') {
    return BYPASS_MODE;
  }
  return request.controls.mode ?? LAUNCH_MODE;
}

// Each Claude control with its role, a copy of its choices and no value, in
// `CLAUDE_CONTROLS` order.
export function claudeStartControls(): SessionControl[] {
  return CLAUDE_CONTROLS.map((control) => ({
    ...control,
    choices: control.choices.map((choice) => ({ ...choice })),
    value: null,
  }));
}

// `controls` with `mode` lowered to `cap`'s mode where it grants more.
export function capClaudeControls(
  controls: Readonly<Record<string, string>>,
  cap: Readonly<Record<string, string>>,
): Record<string, string> {
  return capPermission(controls, cap, {
    controlId: 'mode',
    order: CLAUDE_PERMISSION_ORDER,
    launchDefault: LAUNCH_MODE,
  });
}

// The controls a process launched with `request` starts with: the mode it
// launches in (`launchMode`), and the model and effort its `controls` holds,
// else null. A permissive process's Mode choices end with `BYPASS_CHOICE`.
export function startingControls(
  request: Pick<AgentStart, 'controls' | 'permissions'>,
): SessionControl[] {
  const launched: Readonly<Record<string, string>> = {
    ...request.controls,
    mode: launchMode(request),
  };
  const isPermissive = request.permissions === 'auto';
  return CLAUDE_CONTROLS.map((control) => {
    const addsBypass = isPermissive && control.id === 'mode';
    return {
      ...control,
      choices: addsBypass
        ? [...control.choices, BYPASS_CHOICE]
        : [...control.choices],
      value: launched[control.id] ?? null,
    };
  });
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

// The control requests a new process is sent when it opens, in order.
export const CLAUDE_OPENING_REQUESTS: readonly string[] = [
  'initialize',
  'get_context_usage',
  'get_settings',
];

// The stdin line asking Claude for `subtype`, answered under `requestId`.
export function controlRequest(subtype: string, requestId: string): object {
  return {
    type: 'control_request',
    request_id: requestId,
    request: { subtype },
  };
}

// The stdin lines a new session opens with, as `JSON.stringify` text: the
// `CLAUDE_OPENING_REQUESTS` under request ids `wigley-1` onward, then
// `firstMessage` under `uuid`.
export function claudeOpeningLines(
  firstMessage: UserMessage,
  uuid: string,
): string[] {
  const requests = CLAUDE_OPENING_REQUESTS.map((subtype, index) =>
    controlRequest(subtype, `wigley-${index + 1}`),
  );
  return [...requests, userMessage(firstMessage, uuid)].map((line) =>
    JSON.stringify(line),
  );
}
