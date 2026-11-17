import type {
  CommandOutcome,
  CommandSessions,
} from '../../../contracts/commands';
import type { CommandInfo } from '../../../contracts/plugin';
import type { SlotSnapshot } from '../../../contracts/state';
import { errorText } from '../../../shared/error-text';
import { isJsonObject, type JsonObject } from '../../../shared/json';
import { chatSendToCommand } from '../../chat/contract';
import { type ConfirmRequest, formsMainKey } from '../../forms/contract';
import {
  errorResult,
  textResult,
  type ToolCallContext,
  type ToolDefinition,
  type ToolResult,
  type ToolSession,
} from '../../sessions/contract';

const LIST_COMMANDS = 'list_commands';
const RUN_COMMAND = 'run_command';
const READ_STATE = 'read_state';

// What the tools read and run, each a plain function over the app: the
// command catalog and a reporting run, the app ids of `sessions.rows`, chat's
// name and flags of a session, forms' Allow or Deny round in a session, and
// any slot by id.
export interface AgentCommandToolDeps {
  list(): readonly CommandInfo[];
  runFor(
    id: string,
    arg: unknown,
    sessions: CommandSessions,
  ): Promise<CommandOutcome>;
  rowIds(): readonly string[];
  senderName(sessionId: string): string;
  isHeadless(sessionId: string): boolean;
  isUnattended(sessionId: string): boolean;
  confirm(
    callerId: string,
    request: ConfirmRequest,
    signal: AbortSignal,
    toolUseId: string | null,
  ): Promise<boolean>;
  readAny(id: string): SlotSnapshot | undefined;
  slotIds(): readonly string[];
}

const LIST_COMMANDS_DESCRIPTION =
  "Lists the app's commands, which run_command runs, as a JSON array sorted " +
  'by id. Each entry gives the id, label, group, the process it runs in ' +
  '(runsIn), its argument shape (arg) when it takes one, risky when it runs ' +
  "only on the user's Allow, and targets when it acts on the session " +
  "run_command's session names. Input: filter (optional) keeps the commands " +
  'whose id, label or group holds it, case ignored.';

const RUN_COMMAND_DESCRIPTION =
  'Runs one app command by its id, as a key or a click would. Inputs: ' +
  'command (required), an id from list_commands; arg (optional), the ' +
  'argument in the shape list_commands gives; session (optional), the app ' +
  'id of the session the command acts on, from read_state sessions.rows, ' +
  'only for a command marked targets. To message another session, run ' +
  'chat.sendTo with arg { sessionId, text }. A risky command first asks the ' +
  "user Allow or Deny in this session's form and runs only on Allow; from a " +
  'session with no user watching (headless or unattended) it is refused. ' +
  "'Ran <id>.' means the command's handler finished without an error; it " +
  'does not prove the effect, so read the state with read_state to check ' +
  "it. 'Skipped' means an intercept did not run the handler. A refusal or " +
  "the handler's failure comes back as an error.";

const READ_STATE_DESCRIPTION =
  "Reads the app's state slots as JSON. Inputs: slot (optional), a slot id; " +
  'key (optional, needs slot), one entry of that slot. With no slot it lists ' +
  'the slot ids. A value slot gives its value (null when unset), a keyed ' +
  'slot an object of key: value, and a list slot an array of [key, items] ' +
  "pairs; with key, a keyed slot gives that key's value and a list slot " +
  "that key's items. sessions.rows holds every session, keyed by the app id " +
  "run_command's session takes.";

// The three agent-commands tools as MCP tools/list publishes them.
export const AGENT_COMMAND_TOOLS: ToolDefinition[] = [
  {
    name: LIST_COMMANDS,
    description: LIST_COMMANDS_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        filter: {
          type: 'string',
          description:
            'Text the id, label or group holds, case ignored; left out lists every command.',
        },
      },
    },
  },
  {
    name: RUN_COMMAND,
    description: RUN_COMMAND_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['command'],
      properties: {
        command: {
          type: 'string',
          description: 'The command id, from list_commands.',
        },
        arg: {
          description:
            "The command's argument, in the shape list_commands gives as arg; left out for a command that takes none.",
        },
        session: {
          type: 'string',
          description:
            'The app id of the session the command acts on, from read_state sessions.rows; only for a command marked targets.',
        },
      },
    },
  },
  {
    name: READ_STATE,
    description: READ_STATE_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        slot: {
          type: 'string',
          description: 'The slot id; left out lists the slot ids.',
        },
        key: {
          type: 'string',
          description:
            'One entry of a keyed or list slot; needs slot, and left out reads the whole slot.',
        },
      },
    },
  },
];

// How many confirms wait on the user, across every caller.
interface ConfirmCount {
  waiting: number;
}

// The tool session of each caller, by its app id, over `deps`. Every caller
// shares one count of waiting confirms; `end` has nothing to clean up.
export function createAgentCommandTools(
  deps: AgentCommandToolDeps,
): (callerId: string) => ToolSession {
  const confirms: ConfirmCount = { waiting: 0 };
  return (callerId) => ({
    call: async (name, args, context) => {
      const isKnownTool = AGENT_COMMAND_TOOLS.some(
        (tool) => tool.name === name,
      );
      if (!isKnownTool) {
        return errorResult(`Unknown tool ${name}`);
      }
      const input = inputObject(args);
      if (input === null) {
        return errorResult('arguments must be an object');
      }
      if (name === LIST_COMMANDS) {
        return listCommands(deps, input);
      }
      if (name === RUN_COMMAND) {
        return runCommand(deps, confirms, callerId, input, context);
      }
      return readState(deps, input);
    },
    end: () => undefined,
  });
}

// A call's arguments as an object, none reading as an empty one; null for
// any other value.
function inputObject(args: unknown): JsonObject | null {
  if (args === undefined || args === null) {
    return {};
  }
  return isJsonObject(args) ? args : null;
}

// The first of `fields` that `input` gives as anything but a string, or null.
function firstNonString(
  input: JsonObject,
  fields: readonly string[],
): string | null {
  const isGivenNonString = (field: string) =>
    input[field] !== undefined && typeof input[field] !== 'string';
  return fields.find(isGivenNonString) ?? null;
}

function listCommands(
  deps: AgentCommandToolDeps,
  input: JsonObject,
): ToolResult {
  const badField = firstNonString(input, ['filter']);
  if (badField !== null) {
    return errorResult(`${badField} must be a string`);
  }
  const filter = (input.filter as string | undefined)?.toLowerCase();
  const holdsFilter = (info: CommandInfo) =>
    filter === undefined ||
    [info.id, info.label, info.group].some((text) =>
      text.toLowerCase().includes(filter),
    );
  return textResult(
    JSON.stringify(deps.list().filter(holdsFilter).map(commandEntry)),
  );
}

// An info as list_commands gives it; JSON leaves out the fields it lacks.
function commandEntry(info: CommandInfo) {
  return {
    id: info.id,
    label: info.label,
    group: info.group,
    runsIn: info.runsIn,
    arg: info.arg,
    risky: info.risky,
    targets: info.targets,
  };
}

async function runCommand(
  deps: AgentCommandToolDeps,
  confirms: ConfirmCount,
  callerId: string,
  input: JsonObject,
  context: ToolCallContext,
): Promise<ToolResult> {
  const { command, arg } = input;
  if (typeof command !== 'string') {
    return errorResult('command must be a string');
  }
  const badField = firstNonString(input, ['session']);
  if (badField !== null) {
    return errorResult(`${badField} must be a string`);
  }
  const session = input.session as string | undefined;
  const info = deps.list().find((each) => each.id === command);
  if (info === undefined) {
    return errorResult(
      `Unknown command ${command}. Call list_commands for the ids.`,
    );
  }
  const refusal = runRefusal(deps, confirms, callerId, info, session, arg);
  if (refusal !== null) {
    return errorResult(refusal);
  }
  if (info.risky === true) {
    const denial = await confirmRun(
      deps,
      confirms,
      callerId,
      confirmRequest(deps, callerId, info, session, arg),
      info.id,
      context,
    );
    if (denial !== null) {
      return denial;
    }
  }
  const sessions: CommandSessions =
    session === undefined
      ? { callerSessionId: callerId }
      : { targetSessionId: session, callerSessionId: callerId };
  return runAndReport(deps, info.id, arg, sessions);
}

// Why the run is refused before any confirm, or null: a session on a command
// that takes none, a session that names no row, a forms command while a
// confirm waits, or a risky command from a session with no user watching.
function runRefusal(
  deps: AgentCommandToolDeps,
  confirms: ConfirmCount,
  callerId: string,
  info: CommandInfo,
  session: string | undefined,
  arg: unknown,
): string | null {
  if (session !== undefined && info.targets !== true) {
    return `${info.id} does not act on a given session. Run it without session.`;
  }
  const rows = deps.rowIds();
  const unknownSession = namedSessions(info.id, session, arg).find(
    (each) => !rows.includes(each),
  );
  if (unknownSession !== undefined) {
    return `No session ${unknownSession}. Read read_state sessions.rows for the ids.`;
  }
  const isFormsCommand = info.plugin === formsMainKey.id;
  if (isFormsCommand && confirms.waiting > 0) {
    return 'forms commands wait until the open Allow or Deny is answered.';
  }
  const hasNoUserWatching =
    deps.isHeadless(callerId) || deps.isUnattended(callerId);
  if (info.risky === true && hasNoUserWatching) {
    return `${info.id} is risky and needs the user's Allow, but this session runs with no user watching.`;
  }
  return null;
}

// The session ids a run names: its `session`, and chat.sendTo's string
// `arg.sessionId`.
function namedSessions(
  id: string,
  session: string | undefined,
  arg: unknown,
): string[] {
  const named = session === undefined ? [] : [session];
  const sendToTarget =
    id === chatSendToCommand.id && isJsonObject(arg)
      ? arg.sessionId
      : undefined;
  return typeof sendToTarget === 'string' ? [...named, sendToTarget] : named;
}

function confirmRequest(
  deps: AgentCommandToolDeps,
  callerId: string,
  info: CommandInfo,
  session: string | undefined,
  arg: unknown,
): ConfirmRequest {
  const onTarget =
    session === undefined ? '' : ` on session "${deps.senderName(session)}"`;
  const argument =
    arg === undefined
      ? ''
      : `\n\nArgument:\n\`\`\`json\n${JSON.stringify(arg, null, 2)}\n\`\`\``;
  return {
    title: `Run ${info.label}?`,
    detail: `The agent in session "${deps.senderName(callerId)}" asks to run ${info.id} (${info.label})${onTarget}.${argument}`,
  };
}

// Asks the user in the caller's forms session, counted as waiting until it
// settles; null on an Allow, else the error result that stops the run. A
// confirm that resolves true after the call aborted still counts as a denial.
async function confirmRun(
  deps: AgentCommandToolDeps,
  confirms: ConfirmCount,
  callerId: string,
  request: ConfirmRequest,
  id: string,
  context: ToolCallContext,
): Promise<ToolResult | null> {
  confirms.waiting += 1;
  let isAllowed: boolean;
  try {
    isAllowed = await deps.confirm(
      callerId,
      request,
      context.signal,
      context.toolUseId,
    );
  } catch (error) {
    return errorResult(errorText(error));
  } finally {
    confirms.waiting -= 1;
  }
  if (!isAllowed || context.signal.aborted) {
    return errorResult(`The user denied ${id}.`);
  }
  return null;
}

async function runAndReport(
  deps: AgentCommandToolDeps,
  id: string,
  arg: unknown,
  sessions: CommandSessions,
): Promise<ToolResult> {
  try {
    const outcome = await deps.runFor(id, arg, sessions);
    return textResult(
      outcome === 'ran'
        ? `Ran ${id}.`
        : `Skipped ${id}: an intercept did not run it.`,
    );
  } catch (error) {
    return errorResult(errorText(error));
  }
}

function readState(deps: AgentCommandToolDeps, input: JsonObject): ToolResult {
  const badField = firstNonString(input, ['slot', 'key']);
  if (badField !== null) {
    return errorResult(`${badField} must be a string`);
  }
  const slot = input.slot as string | undefined;
  const key = input.key as string | undefined;
  if (slot === undefined) {
    return key === undefined
      ? textResult(JSON.stringify(deps.slotIds()))
      : errorResult('key needs slot');
  }
  const snapshot = deps.readAny(slot);
  if (snapshot === undefined) {
    return errorResult(
      `No slot ${slot}. Call read_state with no slot for the ids.`,
    );
  }
  if (key === undefined) {
    return textResult(JSON.stringify(wholeSlot(snapshot)));
  }
  const entry = slotEntry(snapshot, key);
  return entry === undefined
    ? errorResult(`No entry ${key} in ${slot}.`)
    : textResult(JSON.stringify(entry.value));
}

// A value slot's value, null when unset; a keyed slot's object of key: value;
// a list slot's [key, items] pairs in first-set order.
function wholeSlot(snapshot: SlotSnapshot): unknown {
  switch (snapshot.kind) {
    case 'value':
      return snapshot.value ?? null;
    case 'keyed':
      return Object.fromEntries(snapshot.entries);
    case 'list':
      return snapshot.entries;
  }
}

// The value a keyed slot holds at `key`, or the items a list slot holds
// there; undefined for a key the slot lacks and for any key on a value slot.
function slotEntry(
  snapshot: SlotSnapshot,
  key: string,
): { value: unknown } | undefined {
  if (snapshot.kind === 'value') {
    return undefined;
  }
  const entries: readonly (readonly [string, unknown])[] = snapshot.entries;
  const entry = entries.find(([each]) => each === key);
  return entry === undefined ? undefined : { value: entry[1] };
}
