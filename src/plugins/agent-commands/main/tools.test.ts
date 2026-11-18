import { describe, expect, it, vi } from 'vitest';
import type {
  CommandOutcome,
  CommandSessions,
} from '../../../contracts/commands';
import type { CommandInfo } from '../../../contracts/plugin';
import type { SlotSnapshot } from '../../../contracts/state';
import type { ConfirmRequest } from '../../forms/contract';
import {
  errorResult,
  textResult,
  type ToolResult,
} from '../../sessions/contract';
import {
  AGENT_COMMAND_TOOLS,
  type AgentCommandToolDeps,
  createAgentCommandTools,
} from './tools';

const CALLER = 'c1';
const OTHER_CALLER = 'c3';
const TARGET = 's2';
const NAMES: Record<string, string> = {
  [CALLER]: 'gamma 1',
  [TARGET]: 'gamma 2',
  [OTHER_CALLER]: 'gamma 3',
};

const COMMANDS: CommandInfo[] = [
  {
    id: 'chat.sendTo',
    plugin: 'chat',
    label: 'send a message to another session',
    group: 'chat',
    runsIn: 'main',
    arg: { sessionId: 'string', text: 'string' },
  },
  {
    id: 'docs.trash',
    plugin: 'docs',
    label: 'move the doc to the Trash',
    group: 'doc',
    runsIn: 'page',
    risky: true,
  },
  {
    id: 'forms.submit',
    plugin: 'forms',
    label: 'send answers',
    group: 'review',
    runsIn: 'page',
    risky: true,
  },
  {
    id: 'sessions.closeSession',
    plugin: 'sessions',
    label: 'close the session',
    group: 'sessions',
    runsIn: 'page',
    arg: { keep: 'string' },
    risky: true,
    targets: true,
  },
  {
    id: 'window.summon',
    plugin: 'window',
    label: 'show the app',
    group: 'window',
    runsIn: 'main',
  },
];

const SLOTS: Record<string, SlotSnapshot> = {
  'chat.flag': { kind: 'value', value: { on: true } },
  'chat.unset': { kind: 'value', value: undefined },
  'sessions.rows': {
    kind: 'keyed',
    entries: [
      ['s2', { label: 'gamma 2' }],
      ['c1', { label: 'gamma 1' }],
    ],
  },
  'agents.rosters': {
    kind: 'list',
    entries: [
      ['s2', [{ id: 'a' }]],
      ['c1', [{ id: 'b' }, { id: 'c' }]],
    ],
  },
};

// The confirm CALLER's forms.submit asks.
const SUBMIT_CONFIRM: ConfirmRequest = {
  title: 'Run send answers?',
  detail:
    'The agent in session "gamma 1" asks to run forms.submit (send answers).',
};

const context = (signal = new AbortController().signal) => ({
  toolUseId: 'tu-1',
  signal,
});

// A macrotask, so every pending promise chain settles first.
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// The tools over plain fakes: COMMANDS, rows c1, s2 and c3, NAMES, SLOTS, a
// caller with a user watching, a confirm that allows and a run that ran,
// each replaced by `overrides`.
function startTools(overrides: Partial<AgentCommandToolDeps> = {}) {
  const runFor = vi.fn<AgentCommandToolDeps['runFor']>(
    overrides.runFor ?? (() => Promise.resolve<CommandOutcome>('ran')),
  );
  const confirm = vi.fn<AgentCommandToolDeps['confirm']>(
    overrides.confirm ?? (() => Promise.resolve(true)),
  );
  const toolsFor = createAgentCommandTools({
    list: () => COMMANDS,
    rowIds: () => [CALLER, TARGET, OTHER_CALLER],
    senderName: (sessionId) => NAMES[sessionId] ?? sessionId,
    isHeadless: () => false,
    isUnattended: () => false,
    readAny: (id) => SLOTS[id],
    slotIds: () => [
      'agents.rosters',
      'chat.flag',
      'chat.unset',
      'sessions.rows',
    ],
    ...overrides,
    runFor,
    confirm,
  });
  const caller = toolsFor(CALLER);
  return { toolsFor, caller, runFor, confirm };
}

describe('createAgentCommandTools', () => {
  it.each<{
    given: string;
    args: unknown;
    overrides?: Partial<AgentCommandToolDeps>;
    confirmWaits?: true;
    aborted?: true;
    text: string;
    asksConfirm: boolean;
  }>([
    {
      given: 'arguments that are not an object',
      args: 'x',
      text: 'arguments must be an object',
      asksConfirm: false,
    },
    {
      given: 'no command',
      args: {},
      text: 'command must be a string',
      asksConfirm: false,
    },
    {
      given: 'a session that is not a string',
      args: { command: 'sessions.closeSession', session: 2 },
      text: 'session must be a string',
      asksConfirm: false,
    },
    {
      given: 'an unknown command',
      args: { command: 'docs.burn' },
      text: 'Unknown command docs.burn. Call list_commands for the ids.',
      asksConfirm: false,
    },
    {
      given: 'a session on a command without targets',
      args: { command: 'docs.trash', session: TARGET },
      text: 'docs.trash does not act on a given session. Run it without session.',
      asksConfirm: false,
    },
    {
      given: 'a session on chat.sendTo',
      args: {
        command: 'chat.sendTo',
        arg: { sessionId: TARGET, text: 'run the tests' },
        session: TARGET,
      },
      text: 'chat.sendTo does not act on a given session. Run it without session.',
      asksConfirm: false,
    },
    {
      given: 'a session that names no row',
      args: { command: 'sessions.closeSession', session: 's9' },
      text: 'No session s9. Read read_state sessions.rows for the ids.',
      asksConfirm: false,
    },
    {
      given: "chat.sendTo's sessionId that names no row",
      args: {
        command: 'chat.sendTo',
        arg: { sessionId: 's9', text: 'run the tests' },
      },
      text: 'No session s9. Read read_state sessions.rows for the ids.',
      asksConfirm: false,
    },
    {
      given: 'forms.submit while a confirm waits',
      args: { command: 'forms.submit' },
      confirmWaits: true,
      text: 'forms commands wait until the open Allow or Deny is answered.',
      asksConfirm: false,
    },
    {
      given: 'a risky command from a headless caller',
      args: { command: 'docs.trash' },
      overrides: { isHeadless: (sessionId) => sessionId === CALLER },
      text: "docs.trash is risky and needs the user's Allow, but this session runs with no user watching.",
      asksConfirm: false,
    },
    {
      given: 'a risky command from an unattended caller',
      args: { command: 'docs.trash' },
      overrides: { isUnattended: (sessionId) => sessionId === CALLER },
      text: "docs.trash is risky and needs the user's Allow, but this session runs with no user watching.",
      asksConfirm: false,
    },
    {
      given: 'a risky command the user denies',
      args: { command: 'docs.trash' },
      overrides: { confirm: () => Promise.resolve(false) },
      text: 'The user denied docs.trash.',
      asksConfirm: true,
    },
    {
      given: 'a risky command allowed after the call aborted',
      args: { command: 'docs.trash' },
      aborted: true,
      text: 'The user denied docs.trash.',
      asksConfirm: true,
    },
    {
      given: 'a confirm that rejects',
      args: { command: 'docs.trash' },
      overrides: {
        confirm: () => Promise.reject(new Error('no forms session for c1')),
      },
      text: 'no forms session for c1',
      asksConfirm: true,
    },
  ])(
    'run_command refuses before running: $given',
    async ({ args, overrides, confirmWaits, aborted, text, asksConfirm }) => {
      const confirmOverride = confirmWaits
        ? { confirm: () => new Promise<boolean>(() => undefined) }
        : {};
      const tools = startTools({ ...overrides, ...confirmOverride });
      if (confirmWaits) {
        void tools
          .toolsFor(OTHER_CALLER)
          .call('run_command', { command: 'docs.trash' }, context());
        await settle();
      }
      const confirmsBefore = tools.confirm.mock.calls.length;
      const controller = new AbortController();
      if (aborted) {
        controller.abort();
      }

      const result = await tools.caller.call(
        'run_command',
        args,
        context(controller.signal),
      );

      expect(result).toEqual(errorResult(text));
      expect(tools.runFor).not.toHaveBeenCalled();
      expect(tools.confirm.mock.calls.length - confirmsBefore).toBe(
        asksConfirm ? 1 : 0,
      );
    },
  );

  // `earlierConfirm` answers the confirm of a docs.trash run from OTHER_CALLER
  // that settles first, so its waiting count must be gone by the row's run.
  it.each<{
    given: string;
    args: unknown;
    runFor?: AgentCommandToolDeps['runFor'];
    earlierConfirm?: AgentCommandToolDeps['confirm'];
    ran: [string, unknown, CommandSessions];
    confirmed: ConfirmRequest | null;
    result: ToolResult;
  }>([
    {
      given: 'a plain command',
      args: { command: 'window.summon' },
      ran: ['window.summon', undefined, { callerSessionId: CALLER }],
      confirmed: null,
      result: textResult('Ran window.summon.'),
    },
    {
      given: 'chat.sendTo to a row',
      args: {
        command: 'chat.sendTo',
        arg: { sessionId: TARGET, text: 'run the tests' },
      },
      ran: [
        'chat.sendTo',
        { sessionId: TARGET, text: 'run the tests' },
        { callerSessionId: CALLER },
      ],
      confirmed: null,
      result: textResult('Ran chat.sendTo.'),
    },
    {
      given: 'a risky targetable command allowed with a target',
      args: {
        command: 'sessions.closeSession',
        arg: { keep: 'log' },
        session: TARGET,
      },
      ran: [
        'sessions.closeSession',
        { keep: 'log' },
        { targetSessionId: TARGET, callerSessionId: CALLER },
      ],
      confirmed: {
        title: 'Run close the session?',
        detail:
          'The agent in session "gamma 1" asks to run sessions.closeSession (close the session) on session "gamma 2".\n\nArgument:\n```json\n{\n  "keep": "log"\n}\n```',
      },
      result: textResult('Ran sessions.closeSession.'),
    },
    {
      given: 'a run an intercept skipped',
      args: { command: 'window.summon' },
      runFor: () => Promise.resolve('skipped'),
      ran: ['window.summon', undefined, { callerSessionId: CALLER }],
      confirmed: null,
      result: textResult('Skipped window.summon: an intercept did not run it.'),
    },
    {
      given: 'a run that rejects',
      args: { command: 'window.summon' },
      runFor: () => Promise.reject(new Error('boom')),
      ran: ['window.summon', undefined, { callerSessionId: CALLER }],
      confirmed: null,
      result: errorResult('boom'),
    },
    {
      given: "forms.submit after another caller's confirm was denied",
      args: { command: 'forms.submit' },
      earlierConfirm: () => Promise.resolve(false),
      ran: ['forms.submit', undefined, { callerSessionId: CALLER }],
      confirmed: SUBMIT_CONFIRM,
      result: textResult('Ran forms.submit.'),
    },
    {
      given: "forms.submit after another caller's confirm rejected",
      args: { command: 'forms.submit' },
      earlierConfirm: () => Promise.reject(new Error('no forms session')),
      ran: ['forms.submit', undefined, { callerSessionId: CALLER }],
      confirmed: SUBMIT_CONFIRM,
      result: textResult('Ran forms.submit.'),
    },
    {
      given: "forms.submit after another caller's confirm allowed and ran",
      args: { command: 'forms.submit' },
      earlierConfirm: () => Promise.resolve(true),
      ran: ['forms.submit', undefined, { callerSessionId: CALLER }],
      confirmed: SUBMIT_CONFIRM,
      result: textResult('Ran forms.submit.'),
    },
  ])(
    'run_command runs and reports: $given',
    async ({ args, runFor, earlierConfirm, ran, confirmed, result }) => {
      const tools = startTools(runFor === undefined ? {} : { runFor });
      if (earlierConfirm !== undefined) {
        tools.confirm.mockImplementationOnce(earlierConfirm);
        await tools
          .toolsFor(OTHER_CALLER)
          .call('run_command', { command: 'docs.trash' }, context());
      }
      const runsBefore = tools.runFor.mock.calls.length;
      const confirmsBefore = tools.confirm.mock.calls.length;
      const callContext = context();

      const answer = await tools.caller.call('run_command', args, callContext);

      expect(answer).toEqual(result);
      expect(tools.runFor.mock.calls.slice(runsBefore)).toEqual([ran]);
      expect(tools.confirm.mock.calls.slice(confirmsBefore)).toEqual(
        confirmed === null
          ? []
          : [[CALLER, confirmed, callContext.signal, 'tu-1']],
      );
    },
  );

  it.each<{ given: string; args: unknown; result: ToolResult }>([
    {
      given: 'no filter',
      args: {},
      result: textResult(
        '[{"id":"a.x","label":"alpha","group":"one","runsIn":"main"},{"id":"b.y","label":"beta","group":"two","runsIn":"page","arg":"string","risky":true,"targets":true}]',
      ),
    },
    {
      given: 'an id, case ignored',
      args: { filter: 'B' },
      result: textResult(
        '[{"id":"b.y","label":"beta","group":"two","runsIn":"page","arg":"string","risky":true,"targets":true}]',
      ),
    },
    {
      given: 'a label',
      args: { filter: 'ALP' },
      result: textResult(
        '[{"id":"a.x","label":"alpha","group":"one","runsIn":"main"}]',
      ),
    },
    {
      given: 'a group',
      args: { filter: 'two' },
      result: textResult(
        '[{"id":"b.y","label":"beta","group":"two","runsIn":"page","arg":"string","risky":true,"targets":true}]',
      ),
    },
    {
      given: 'a filter that is not a string',
      args: { filter: 7 },
      result: errorResult('filter must be a string'),
    },
    {
      given: 'arguments that are not an object',
      args: 'x',
      result: errorResult('arguments must be an object'),
    },
  ])(
    'list_commands filters by id, label or group, or refuses its input: $given',
    async ({ args, result }) => {
      const { caller } = startTools({
        list: () => [
          {
            id: 'a.x',
            plugin: 'a',
            label: 'alpha',
            group: 'one',
            runsIn: 'main',
          },
          {
            id: 'b.y',
            plugin: 'b',
            label: 'beta',
            group: 'two',
            runsIn: 'page',
            arg: 'string',
            risky: true,
            targets: true,
            runtime: true,
          },
        ],
      });

      expect(await caller.call('list_commands', args, context())).toEqual(
        result,
      );
    },
  );

  it.each<{ given: string; args: unknown; result: ToolResult }>([
    {
      given: 'no slot',
      args: {},
      result: textResult(
        '["agents.rosters","chat.flag","chat.unset","sessions.rows"]',
      ),
    },
    {
      given: 'a value slot',
      args: { slot: 'chat.flag' },
      result: textResult('{"on":true}'),
    },
    {
      given: 'an unset value slot',
      args: { slot: 'chat.unset' },
      result: textResult('null'),
    },
    {
      given: 'a keyed slot',
      args: { slot: 'sessions.rows' },
      result: textResult('{"s2":{"label":"gamma 2"},"c1":{"label":"gamma 1"}}'),
    },
    {
      given: 'a list slot',
      args: { slot: 'agents.rosters' },
      result: textResult(
        '[["s2",[{"id":"a"}]],["c1",[{"id":"b"},{"id":"c"}]]]',
      ),
    },
    {
      given: 'a key on a keyed slot',
      args: { slot: 'sessions.rows', key: 'c1' },
      result: textResult('{"label":"gamma 1"}'),
    },
    {
      given: 'a key on a list slot',
      args: { slot: 'agents.rosters', key: 'c1' },
      result: textResult('[{"id":"b"},{"id":"c"}]'),
    },
    {
      given: 'a key on a value slot',
      args: { slot: 'chat.flag', key: 'on' },
      result: errorResult('No entry on in chat.flag.'),
    },
    {
      given: 'an unknown slot',
      args: { slot: 'docs.none' },
      result: errorResult(
        'No slot docs.none. Call read_state with no slot for the ids.',
      ),
    },
    {
      given: 'an unknown key',
      args: { slot: 'sessions.rows', key: 's9' },
      result: errorResult('No entry s9 in sessions.rows.'),
    },
    {
      given: 'a key without a slot',
      args: { key: 'c1' },
      result: errorResult('key needs slot'),
    },
    {
      given: 'a slot that is not a string',
      args: { slot: 7 },
      result: errorResult('slot must be a string'),
    },
    {
      given: 'a key that is not a string',
      args: { slot: 'sessions.rows', key: 7 },
      result: errorResult('key must be a string'),
    },
    {
      given: 'arguments that are not an object',
      args: 'x',
      result: errorResult('arguments must be an object'),
    },
  ])(
    'read_state reads ids, a slot or one entry, or refuses its input: $given',
    async ({ args, result }) => {
      const { caller } = startTools();

      expect(await caller.call('read_state', args, context())).toEqual(result);
    },
  );

  it('the three tool definitions are the pinned literals', async () => {
    const validArgs: Record<string, Record<string, unknown>> = {
      list_commands: {},
      run_command: { command: 'window.summon' },
      read_state: { slot: 'chat.flag' },
    };
    const { caller } = startTools();

    expect(AGENT_COMMAND_TOOLS.map(({ name }) => name)).toEqual([
      'list_commands',
      'run_command',
      'read_state',
    ]);
    for (const { name, inputSchema } of AGENT_COMMAND_TOOLS) {
      expect(inputSchema.additionalProperties, name).toBe(false);
      const properties = inputSchema.properties as Record<
        string,
        { type?: string }
      >;
      for (const [field, schema] of Object.entries(properties)) {
        if (schema.type !== 'string') {
          continue;
        }
        const args = { ...validArgs[name], [field]: 7 };

        expect(await caller.call(name, args, context()), field).toEqual(
          errorResult(`${field} must be a string`),
        );
      }
    }
    expect(
      AGENT_COMMAND_TOOLS.find(({ name }) => name === 'run_command')
        ?.inputSchema.required,
    ).toEqual(['command']);
    expect(await caller.call('drop_table', {}, context())).toEqual(
      errorResult('Unknown tool drop_table'),
    );
  });
});
