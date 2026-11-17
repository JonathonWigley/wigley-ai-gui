import type {
  AgentStart,
  ControlChoice,
  SessionControl,
  UserMessage,
} from '../../contracts/agent';
import { capPermission } from '../../shared/permission-cap';
import { asJson, asString, type Json } from './json-fields';

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

// The `/effort` value that hands the level to Claude: it names no choice.
export const EFFORT_CLEARING_VALUE = 'auto';

// The permission mode a process launches with when its request sets none.
const LAUNCH_MODE = 'auto';

// The `mode` values from least to most permissive.
export const CLAUDE_PERMISSION_ORDER: readonly string[] = [
  'plan',
  'dontAsk',
  'manual',
  'acceptEdits',
  'auto',
];

// The permission mode a process launches with: the request's, else `auto`.
export function launchMode(controls: AgentStart['controls']): string {
  return controls.mode ?? LAUNCH_MODE;
}

// Each Claude control with a copy of its choices and no value, in
// `CLAUDE_CONTROLS` order.
export function claudeStartControls(): SessionControl[] {
  return CLAUDE_CONTROLS.map((control) => ({
    id: control.id,
    label: control.label,
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

// A typed `/effort <value>` or `/model <value>`.
export const CONTROL_COMMAND = /^\/(effort|model) (\S+)$/;

export function controlOf(
  id: string,
): (typeof CLAUDE_CONTROLS)[number] | undefined {
  return CLAUDE_CONTROLS.find((control) => control.id === id);
}

export function isChoice(id: ClaudeControlId, value: string): boolean {
  const choices = controlOf(id)?.choices ?? [];
  return choices.some((choice) => choice.value === value);
}

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
