import { describe, expect, it, vi } from 'vitest';
import { MAIN_AGENT_ID } from '../../../contracts/agent';
import type { Timers } from '../../../contracts/ambient';
import type { GuardedToolCall } from '../../sessions/contract';
import {
  CALLER_WAIT_MS,
  callerGuard,
  createToolCallers,
  SUBAGENT_CALL_TEXT,
  type ToolCallers,
} from './tool-callers';

// A `Timers` the test fires by hand; `pending` holds each timer not yet fired
// or cleared, with its delay.
function manualTimers() {
  const pending = new Map<number, { run: () => void; ms: number }>();
  let lastHandle = 0;
  const timers: Timers = {
    set: (run, ms) => {
      lastHandle += 1;
      pending.set(lastHandle, { run, ms });
      return lastHandle;
    },
    clear: (handle) => {
      pending.delete(handle);
    },
  };
  const fireAll = () => {
    for (const [handle, { run }] of pending) {
      pending.delete(handle);
      run();
    }
  };
  return { timers, pending, fireAll };
}

describe('createToolCallers', () => {
  it.each<{
    case: string;
    // Runs while the read waits, given the callers and a way to fire the
    // pending timers.
    before?: (callers: ToolCallers) => void;
    during: (callers: ToolCallers, fireAll: () => void) => void;
    agentId: string | null;
    // Delays of the timers the read set, while it waited.
    waited: number[];
  }>([
    {
      case: 'NotedBeforeTheRead_TheAgent',
      before: (callers) => callers.noteToolStarted('r1', 't1', 'sub-1'),
      during: () => undefined,
      agentId: 'sub-1',
      waited: [],
    },
    {
      case: 'NotedDuringTheWait_TheAgent',
      during: (callers) => callers.noteToolStarted('r1', 't1', 'sub-1'),
      agentId: 'sub-1',
      waited: [CALLER_WAIT_MS],
    },
    {
      case: 'TimerFires_Null',
      during: (callers, fireAll) => {
        callers.noteToolStarted('r1', 't2', 'sub-1');
        fireAll();
      },
      agentId: null,
      waited: [CALLER_WAIT_MS],
    },
    {
      case: 'ForgottenDuringTheWait_Null',
      during: (callers) => callers.forget('r1'),
      agentId: null,
      waited: [CALLER_WAIT_MS],
    },
    {
      case: 'NotedInAnotherRow_NullWhenTheTimerFires',
      before: (callers) => callers.noteToolStarted('r2', 't1', 'sub-1'),
      during: (_callers, fireAll) => fireAll(),
      agentId: null,
      waited: [CALLER_WAIT_MS],
    },
    {
      case: 'NotedThenForgotten_WaitsThenNull',
      before: (callers) => {
        callers.noteToolStarted('r1', 't1', 'sub-1');
        callers.forget('r1');
      },
      during: (_callers, fireAll) => fireAll(),
      agentId: null,
      waited: [CALLER_WAIT_MS],
    },
    {
      case: 'StopDuringTheWait_Null',
      during: (callers) => callers.stop(),
      agentId: null,
      waited: [CALLER_WAIT_MS],
    },
  ])('agentOf_$case', async ({ before, during, agentId, waited }) => {
    const { timers, pending, fireAll } = manualTimers();
    const callers = createToolCallers(timers);
    before?.(callers);

    const read = callers.agentOf('r1', 't1');
    expect([...pending.values()].map(({ ms }) => ms)).toEqual(waited);
    during(callers, fireAll);

    await expect(read).resolves.toBe(agentId);
    expect(pending.size).toBe(0);
  });
});

describe('callerGuard', () => {
  const CALL: GuardedToolCall = {
    sessionId: 'r1',
    tool: 'set_workflow_step',
    toolUseId: 't1',
    mainAgentOnly: true,
  };

  it.each<{
    case: string;
    call: GuardedToolCall;
    owns: boolean;
    agentId: string | null;
    verdict: Awaited<ReturnType<ReturnType<typeof callerGuard>>>;
    asksAgentOf: boolean;
  }>([
    {
      case: 'NotMainAgentOnly_RunsUnasked',
      call: { ...CALL, mainAgentOnly: false },
      owns: true,
      agentId: 'sub-1',
      verdict: { kind: 'run' },
      asksAgentOf: false,
    },
    {
      case: 'NoToolUseId_RunsUnasked',
      call: { ...CALL, toolUseId: null },
      owns: true,
      agentId: 'sub-1',
      verdict: { kind: 'run' },
      asksAgentOf: false,
    },
    {
      case: 'RowNotOwned_RunsUnasked',
      call: CALL,
      owns: false,
      agentId: 'sub-1',
      verdict: { kind: 'run' },
      asksAgentOf: false,
    },
    {
      case: 'MainAgent_Runs',
      call: CALL,
      owns: true,
      agentId: MAIN_AGENT_ID,
      verdict: { kind: 'run' },
      asksAgentOf: true,
    },
    {
      case: 'Subagent_Skips',
      call: CALL,
      owns: true,
      agentId: 'sub-1',
      verdict: { kind: 'skip', text: SUBAGENT_CALL_TEXT },
      asksAgentOf: true,
    },
    {
      case: 'AgentUnknown_Runs',
      call: CALL,
      owns: true,
      agentId: null,
      verdict: { kind: 'run' },
      asksAgentOf: true,
    },
  ])(
    'callerGuard_$case',
    async ({ call, owns, agentId, verdict, asksAgentOf }) => {
      const agentOf = vi.fn(() => Promise.resolve(agentId));
      const guard = callerGuard({
        callers: { agentOf },
        owns: () => owns,
      });

      await expect(guard(call)).resolves.toEqual(verdict);
      expect(agentOf.mock.calls).toEqual(
        asksAgentOf ? [[call.sessionId, call.toolUseId]] : [],
      );
    },
  );
});
