import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  type AccountStatus,
  type AgentEvent,
  type AgentHarness,
  type AgentProcess,
  type AgentProcessEvents,
  type AgentStart,
  type LogInEvents,
  type LogInProcess,
  MAIN_AGENT_ID,
  type PlanUsage,
  type ProcessActivity,
  type SessionControl,
  type UsageAgentEvent,
} from '../../contracts/agent';
import type { Clock, RandomUuid } from '../../contracts/ambient';
import { type Files, readIfPresent } from '../../contracts/files';
import type { Log } from '../../contracts/log';
import type { Paths } from '../../contracts/paths';
import { errorText } from '../../shared/error-text';
import { isSameJson } from '../../shared/json';
import { type TypedSkill, typedSkill } from '../../shared/typed-skill';
import {
  type AgentDefinitions,
  loadAgentDefinitions,
} from './agent-definitions';
import { readAccountStatus, signInLink } from './claude-auth';
import { claudeConfigFolder, claudeEnv, claudeLaunch } from './claude-launch';
import {
  CLAUDE_CONTROLS,
  type ClaudeControlId,
  controlMessage,
  controlValue,
  userMessage,
} from './claude-controls';
import { createEntryStamp, type EntryDraft } from '../../shared/entry-stamp';
import {
  listPastSessions,
  listProjectFolders,
  readHistory,
  readLastUsage,
  readSavedReplies,
} from './past-sessions';
import { readPlanUsage } from './plan-usage';
import {
  configuredPercent,
  contextUsageOf,
  EMPTY_SESSION_USAGE,
  foldContextUsage,
  foldReply,
  foldTurn,
  usageEvent,
  withConfiguredPercent,
  withSavedReplies,
} from './session-usage';
import {
  type AgentEventDraft,
  createStreamDecoder,
  type DecodedLine,
} from './stream-decoder';
import { projectFolderName } from './transcripts';
import {
  type ControlCommand,
  createTurnTracker,
  TERMINAL_STATES,
} from './turn-tracker';

export type ClaudeSpawn = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => ChildProcessWithoutNullStreams;

// `command` reads the `claude` binary's path, once per spawned session;
// `permissionTool` the MCP tool Claude asks what the session's permission mode
// would still prompt; `env` the environment the process inherits; `files` reads
// saved transcripts, `homeDir` holds the default config folder `.claude`, is
// what a `~` profile folder resolves against and is where `claude auth` and
// `claude -p /usage` run, and `paths` joins and compares paths by the rules of
// the OS `claude` runs on; `clock` stamps each live entry's and agent event's
// `at`; `randomUuid` gives each stdin user message its `uuid`. `files` also
// reads the profile's `settings.json` and the agent definitions at each session
// start.
export interface ClaudeCodeHarnessDeps {
  command(): string;
  permissionTool: string;
  env: NodeJS.ProcessEnv;
  log: Log;
  spawn: ClaudeSpawn;
  files: Files;
  homeDir: string;
  paths: Paths;
  clock: Clock;
  randomUuid: RandomUuid;
}

// How long `end` waits after closing stdin before SIGTERM, and again before
// SIGKILL.
const END_GRACE_MS = 3000;
// How long an interrupt waits for the turn to end before the session shows
// idle.
const INTERRUPT_GRACE_MS = 5000;
// A typed `/effort <value>` or `/model <value>` sets that control.
const CONTROL_COMMAND = /^\/(effort|model) (\S+)$/;
// How long a `claude -p /usage` poll may run before it is killed.
export const PLAN_USAGE_TIMEOUT_MS = 20_000;
const PLAN_USAGE_ARGS = [
  '-p',
  '/usage',
  '--output-format',
  'stream-json',
  '--verbose',
  '--no-session-persistence',
];

// A sent message's user entry and the skill it starts (null for none), held
// until the CLI takes the message in.
interface HeldMessage {
  draft: EntryDraft;
  skill: TypedSkill | null;
}

type PendingRequest =
  | { kind: 'mode'; value: string }
  | { kind: 'interrupt' }
  | { kind: 'contextUsage' };

function controlOf(id: string) {
  return CLAUDE_CONTROLS.find((control) => control.id === id);
}

function isChoice(id: ClaudeControlId, value: string): boolean {
  const choices = controlOf(id)?.choices ?? [];
  return choices.some((choice) => choice.value === value);
}

function exitText(code: number | null, signal: NodeJS.Signals | null): string {
  return code === null ? `signal ${signal}` : `code ${code}`;
}

function exitError(
  code: number | null,
  signal: NodeJS.Signals | null,
  lastStderr: string | null,
): string {
  const how = exitText(code, signal);
  const why = lastStderr === null ? '' : `: ${lastStderr}`;
  return `claude exited with ${how}${why}`;
}

// Spawn reports a missing `cwd` as ENOENT just as it does a missing binary,
// so the hint names both causes.
function spawnError(error: Error, command: string, cwd: string): string {
  const isMissing = (error as NodeJS.ErrnoException).code === 'ENOENT';
  return isMissing
    ? `claude was not found at ${command}, or the project folder ${cwd} does not exist; set claude.command`
    : error.message;
}

// One `claude` process in stream-json mode. Events a call causes are emitted
// in a microtask, never inside the call, as the fake harness does. Its agent
// events open with `sessionStarted` and close with `sessionEnded`, just before
// `ended`; a subagent still running then gets no `agentFinished`. Outside
// fallback mode a sent message's user entry waits for its `started` line, or
// for the init that fixes fallback mode; a message ended before it started is
// reported through `messageDropped`, and one still held when the process
// closes is dropped silently.
function startClaudeProcess(
  deps: ClaudeCodeHarnessDeps,
  request: AgentStart,
  events: AgentProcessEvents,
): AgentProcess {
  const launch = claudeLaunch(
    request,
    deps.permissionTool,
    deps.env,
    deps.homeDir,
    deps.paths,
  );
  const command = deps.command();
  const child = deps.spawn(command, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
  });
  const stamp = createEntryStamp(deps.clock);
  let controls: SessionControl[] = CLAUDE_CONTROLS.map((control) => ({
    ...control,
    value: request.controls[control.id] ?? null,
  }));
  let activity: ProcessActivity = 'idle';
  let sendCount = 0;
  let requestCount = 0;
  let noticeCount = 0;
  const pendingRequests = new Map<string, PendingRequest>();
  // Keyed by the message's uuid, in write order; never filled in fallback mode.
  const heldMessages = new Map<string, HeldMessage>();
  // The session's agent definitions, empty until their load resolves.
  let definitions: AgentDefinitions = new Map();
  // The adapter's own `get_context_usage` replies stay out of the chat.
  const decoder = createStreamDecoder(
    (requestId) => pendingRequests.get(requestId)?.kind === 'contextUsage',
    (agentType) => definitions.get(agentType) ?? null,
  );
  const tracker = createTurnTracker();
  let lastStderr: string | null = null;
  let isEndCalled = false;
  let hasClosed = false;
  let hasEmittedEnded = false;
  let endPromise: Promise<void> | null = null;
  const closeWaiters: (() => void)[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  // Pending from an interrupt until a turn's result or idle.
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  // A new session knows its context from the start; a resumed one waits for
  // its transcript or its first live reply.
  let usage = request.resume
    ? EMPTY_SESSION_USAGE
    : withSavedReplies(EMPTY_SESSION_USAGE, []);
  let lastUsageEvent: UsageAgentEvent | null = null;

  // Every emission goes through the microtask queue, so events keep the
  // order of the calls and lines that caused them.
  const emit = (emission: () => void) => queueMicrotask(emission);

  const emitControls = () => {
    const reported = controls.map((control) => ({ ...control }));
    emit(() => events.controls(reported));
  };

  const emitActivity = (next: ProcessActivity) => {
    activity = next;
    emit(() => events.activity(next));
  };

  const clearGraceTimer = () => {
    if (graceTimer !== null) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
  };

  // Emits the tracker's activity when it changed; a line read after `close`
  // emits nothing, so no activity follows `ended`.
  const syncActivity = () => {
    if (hasClosed) {
      return;
    }
    const next = tracker.activity();
    if (next !== activity) {
      emitActivity(next);
    }
    if (next === 'idle') {
      clearGraceTimer();
    }
  };

  const emitEntry = (draft: EntryDraft) => {
    const entry = stamp(draft);
    emit(() => events.entry(entry));
  };

  const emitAgentEvent = (draft: AgentEventDraft) => {
    const event = { ...draft, at: deps.clock.now() } as AgentEvent;
    emit(() => events.agentEvent(event));
  };

  const emitUserMessage = ({ draft, skill }: HeldMessage) => {
    emitEntry(draft);
    emitAgentEvent({ type: 'userMessage' });
    if (skill !== null) {
      emitAgentEvent({
        type: 'skillStarted',
        agentId: MAIN_AGENT_ID,
        ...skill,
      });
    }
  };

  // Emits a held message's entry on its `started` line, and reports one that
  // ended without starting as dropped.
  const releaseHeldMessage = (
    lifecycle: NonNullable<DecodedLine['lifecycle']>,
  ) => {
    const held = heldMessages.get(lifecycle.uuid);
    if (held === undefined) {
      return;
    }
    if (lifecycle.state === 'started') {
      heldMessages.delete(lifecycle.uuid);
      emitUserMessage(held);
    } else if (TERMINAL_STATES.has(lifecycle.state)) {
      heldMessages.delete(lifecycle.uuid);
      const entryId = held.draft.id;
      emit(() => events.messageDropped(entryId));
    }
  };

  const releaseAllHeldMessages = () => {
    for (const held of heldMessages.values()) {
      emitUserMessage(held);
    }
    heldMessages.clear();
  };

  // Emits the usage event when it differs from the last one in any field but
  // `at`; once `ended` is emitted, emits nothing, so no usage follows it.
  const emitUsage = () => {
    if (hasEmittedEnded) {
      return;
    }
    const event = usageEvent(usage, deps.clock.now());
    const isRepeat =
      event !== null &&
      lastUsageEvent !== null &&
      isSameJson({ ...event, at: 0 }, { ...lastUsageEvent, at: 0 });
    if (event === null || isRepeat) {
      return;
    }
    lastUsageEvent = event;
    emit(() => events.agentEvent(event));
  };

  const harnessNotice = (
    text: string,
    tone: 'info' | 'error',
    raw: unknown,
  ) => {
    noticeCount += 1;
    emitEntry({
      kind: 'notice',
      id: `control-notice-${noticeCount}`,
      text,
      tone,
      raw: [raw],
    });
  };

  // True when the value changed.
  const setValue = (id: ClaudeControlId, value: string | null): boolean => {
    const current = controls.find((control) => control.id === id);
    if (current?.value === value) {
      return false;
    }
    controls = controls.map((control) =>
      control.id === id ? { ...control, value } : control,
    );
    return true;
  };

  const write = (message: object) => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const nextRequestId = () => {
    requestCount += 1;
    return `wigley-${requestCount}`;
  };

  const requireRunning = () => {
    if (isEndCalled || hasClosed) {
      throw new Error('Claude Code process has ended');
    }
  };

  const emitEnded = (end: { code: number | null; error: string | null }) => {
    if (hasEmittedEnded) {
      return;
    }
    hasEmittedEnded = true;
    emitAgentEvent({ type: 'sessionEnded' });
    emit(() => events.ended(end));
  };

  // `end()` resolves after the `ended` emission it follows.
  const markClosed = () => {
    hasClosed = true;
    heldMessages.clear();
    for (const timer of timers) {
      clearTimeout(timer);
    }
    const waiters = closeWaiters.splice(0);
    emit(() => {
      for (const resolve of waiters) {
        resolve();
      }
    });
  };

  const answerControlResponse = (
    response: NonNullable<DecodedLine['controlResponse']>,
  ) => {
    const pending = pendingRequests.get(response.requestId);
    if (pending === undefined) {
      return;
    }
    pendingRequests.delete(response.requestId);
    if (pending.kind === 'contextUsage') {
      if (response.error !== null) {
        deps.log('claude', `get_context_usage failed: ${response.error}`);
        return;
      }
      usage = foldContextUsage(usage, contextUsageOf(response.response));
      emitUsage();
      return;
    }
    if (pending.kind === 'interrupt') {
      if (response.error !== null) {
        harnessNotice(
          `Could not interrupt: ${response.error}`,
          'error',
          response,
        );
      }
      tracker.interruptAnswered();
      syncActivity();
      return;
    }
    if (response.error !== null) {
      harnessNotice(
        `Could not set Mode to ${pending.value}: ${response.error}`,
        'error',
        response,
      );
      return;
    }
    if (setValue('mode', pending.value)) {
      emitControls();
    }
  };

  const refuseHostRequest = (
    hostRequest: NonNullable<DecodedLine['hostRequest']>,
  ) => {
    write({
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: hostRequest.requestId,
        error: `wigley-ai-gui answers no ${hostRequest.subtype} requests`,
      },
    });
  };

  // Asked at start and after every turn, a control command's included:
  // `/model` changes the window and the limit.
  const requestContextUsage = () => {
    const requestId = nextRequestId();
    pendingRequests.set(requestId, { kind: 'contextUsage' });
    write({
      type: 'control_request',
      request_id: requestId,
      request: { subtype: 'get_context_usage' },
    });
  };

  const foldUsage = (decoded: DecodedLine) => {
    const { planRows, replyUsage, turnUsage } = decoded;
    if (planRows !== null) {
      emit(() => events.planUsage({ rows: planRows, at: deps.clock.now() }));
    }
    if (replyUsage !== null) {
      usage = foldReply(usage, replyUsage, deps.clock.now());
    }
    if (turnUsage !== null) {
      usage = foldTurn(usage, turnUsage);
    }
    if (replyUsage !== null || turnUsage !== null) {
      emitUsage();
    }
  };

  // A control command's own result entry is not shown; its success sets the
  // control, since the turn's init still reports the value from before. A
  // value that is not among the control's choices leaves the control unknown.
  const handleLine = (line: string) => {
    const decoded = decoder.decode(line);
    const turn = tracker.read(decoded);
    const { command } = turn;
    if (decoded.lifecycle !== null) {
      releaseHeldMessage(decoded.lifecycle);
    }
    if (turn.fellBack) {
      releaseAllHeldMessages();
    }
    for (const entry of decoded.entries) {
      const isCommandResult = command !== null && entry.kind === 'result';
      if (!isCommandResult) {
        emitEntry(entry);
      }
    }
    if (turn.fellBack) {
      deps.log(
        'claude',
        'msg_lifecycle_v1 missing from init capabilities; tracking turns by results',
      );
      harnessNotice(
        'This Claude Code version reports no message lifecycle; the working state follows turn results only.',
        'info',
        line,
      );
    }
    for (const draft of decoded.agentEvents) {
      emitAgentEvent(draft);
    }
    let hasChanged = false;
    for (const [id, value] of Object.entries(decoded.reported)) {
      const controlId = id as ClaudeControlId;
      hasChanged =
        setValue(controlId, controlValue(controlId, value)) || hasChanged;
    }
    if (command !== null && !decoded.turnFailed) {
      const value = controlValue(command.id, command.value);
      const known = isChoice(command.id, value) ? value : null;
      hasChanged = setValue(command.id, known) || hasChanged;
    }
    if (hasChanged) {
      emitControls();
    }
    const { commands } = decoded;
    if (commands !== null) {
      emit(() => events.commands(commands));
    }
    foldUsage(decoded);
    if (decoded.controlResponse !== null) {
      answerControlResponse(decoded.controlResponse);
    }
    if (decoded.hostRequest !== null) {
      refuseHostRequest(decoded.hostRequest);
    }
    if (decoded.turnEnded) {
      clearGraceTimer();
    }
    const isRunning = !isEndCalled && !hasClosed;
    if (decoded.turnEnded && isRunning) {
      requestContextUsage();
    }
    syncActivity();
  };

  const kill = () => {
    if (hasClosed) {
      return;
    }
    isEndCalled = true;
    child.kill('SIGTERM');
  };

  createInterface({ input: child.stdout }).on('line', handleLine);
  createInterface({ input: child.stderr }).on('line', (line) => {
    deps.log('claude', line);
    lastStderr = line;
  });
  child.stdin.on('error', (error) => deps.log('claude', errorText(error)));
  child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
    if (activity === 'working') {
      emitActivity('idle');
    }
    const isCleanExit = code === 0 || isEndCalled;
    emitEnded({
      code,
      error: isCleanExit ? null : exitError(code, signal, lastStderr),
    });
    markClosed();
  });
  child.on('error', (error: Error) => {
    emitEnded({
      code: null,
      error: spawnError(error, command, launch.cwd),
    });
    // A child that never spawned has no pid and sends no `close` to wait for.
    if (child.pid === undefined) {
      markClosed();
    }
  });

  emitAgentEvent({ type: 'sessionStarted' });
  emitControls();
  emitActivity('idle');
  requestContextUsage();
  // The profile's autocompact override, read once: a change applies to the
  // next session.
  const configFolder = claudeConfigFolder(
    request.profileDir,
    deps.env,
    deps.homeDir,
    deps.paths,
  );
  const settingsPath = deps.paths.join(configFolder, 'settings.json');
  void readIfPresent(deps.files, settingsPath).then(
    (text) => {
      usage = withConfiguredPercent(usage, configuredPercent(text));
      emitUsage();
    },
    (error: unknown) =>
      deps.log('claude', `settings.json not read: ${errorText(error)}`),
  );
  // A resumed session seeds its context from the saved main replies, unless a
  // live reply came first.
  if (request.resume) {
    void readSavedReplies(
      deps.files,
      deps.paths,
      projectsFolder(deps, request.projectDir, request.profileDir),
      request.sessionId,
    ).then(
      (replies) => {
        usage = withSavedReplies(usage, replies);
        emitUsage();
      },
      (error: unknown) =>
        deps.log('claude', `saved usage not read: ${errorText(error)}`),
    );
  }
  // Read once per session: an agent definition added later applies to the next session.
  void loadAgentDefinitions(
    { files: deps.files, paths: deps.paths, log: deps.log },
    request.projectDir,
    configFolder,
  ).then((loaded) => {
    definitions = loaded;
  });

  return {
    send(userInput) {
      requireRunning();
      const uuid = deps.randomUuid();
      const message = userMessage(userInput, uuid);
      write(message);
      sendCount += 1;
      const entryId = `user-${sendCount}`;
      const typed = CONTROL_COMMAND.exec(userInput.text);
      // Claude prints no skill line for a typed skill, so it starts with the
      // message.
      const skill = typed === null ? typedSkill(userInput.text) : null;
      const sent: HeldMessage = {
        draft: {
          kind: 'user',
          id: entryId,
          text: userInput.text,
          images: userInput.images,
          raw: [message],
        },
        skill,
      };
      if (tracker.mode() === 'fallback') {
        emitUserMessage(sent);
      } else {
        heldMessages.set(uuid, sent);
      }
      tracker.written(
        uuid,
        typed === null
          ? null
          : { id: typed[1] as ControlCommand['id'], value: typed[2] },
      );
      syncActivity();
      return entryId;
    },
    interrupt() {
      requireRunning();
      if (activity !== 'working') {
        return;
      }
      if (graceTimer !== null) {
        harnessNotice(
          'Interrupted again; ending the Claude process.',
          'info',
          null,
        );
        deps.log(
          'claude',
          'second interrupt while working; killing the process',
        );
        kill();
        return;
      }
      const requestId = nextRequestId();
      const message = {
        type: 'control_request',
        request_id: requestId,
        request: { subtype: 'interrupt' },
      };
      pendingRequests.set(requestId, { kind: 'interrupt' });
      write(message);
      harnessNotice('Interrupted', 'info', message);
      graceTimer = setTimeout(() => {
        graceTimer = null;
        if (activity !== 'working') {
          return;
        }
        tracker.abandon();
        const grace = `${INTERRUPT_GRACE_MS / 1000} s`;
        harnessNotice(
          `Claude did not stop within ${grace}; showing the session idle.`,
          'info',
          null,
        );
        deps.log(
          'claude',
          `interrupt unanswered after ${grace}; dropping turn state`,
        );
        syncActivity();
      }, INTERRUPT_GRACE_MS);
      timers.push(graceTimer);
    },
    setControl(id, value) {
      requireRunning();
      const control = controlOf(id);
      if (control === undefined) {
        throw new Error(`Claude Code has no control ${id}`);
      }
      if (!isChoice(control.id, value)) {
        throw new Error(`Claude Code control ${id} has no choice ${value}`);
      }
      if (control.id === 'mode') {
        const requestId = nextRequestId();
        pendingRequests.set(requestId, { kind: 'mode', value });
        write(controlMessage('mode', value, requestId));
        return;
      }
      if (activity === 'working') {
        throw new Error(
          `Claude is working; change ${control.label} when the turn ends`,
        );
      }
      const uuid = deps.randomUuid();
      write(controlMessage(control.id, value, uuid));
      tracker.written(uuid, { id: control.id, value });
      syncActivity();
    },
    end() {
      if (endPromise !== null) {
        return endPromise;
      }
      isEndCalled = true;
      if (hasClosed) {
        endPromise = Promise.resolve();
        return endPromise;
      }
      endPromise = new Promise<void>((resolve) => closeWaiters.push(resolve));
      child.stdin.end();
      timers.push(
        setTimeout(() => {
          child.kill('SIGTERM');
          timers.push(setTimeout(() => child.kill('SIGKILL'), END_GRACE_MS));
        }, END_GRACE_MS),
      );
      return endPromise;
    },
    kill,
    detach() {
      throw new Error('detach is not implemented until task 08');
    },
  };
}

// A finished `claude` run: its exit code and what it printed, stderr trimmed.
interface CliRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

// The one-shot commands run in the home folder, so ENOENT names the binary
// alone.
function cliSpawnError(error: Error, command: string): string {
  const isMissing = (error as NodeJS.ErrnoException).code === 'ENOENT';
  return isMissing
    ? `claude was not found at ${command}; set claude.command`
    : error.message;
}

function withStderr(message: string, stderr: string): string {
  return stderr === '' ? message : `${message}: ${stderr}`;
}

// The command `args` run, up to its first `--` option, as a message names it.
function commandLabel(args: readonly string[]): string {
  const optionAt = args.findIndex((arg) => arg.startsWith('--'));
  const words = optionAt === -1 ? args : args.slice(0, optionAt);
  return ['claude', ...words].join(' ');
}

// `claude <args>` for `profileDir`, in the home folder with the session
// launch's environment.
function spawnCli(
  deps: ClaudeCodeHarnessDeps,
  args: readonly string[],
  profileDir: string | null,
): { command: string; child: ChildProcessWithoutNullStreams } {
  const command = deps.command();
  const child = deps.spawn(command, args, {
    cwd: deps.homeDir,
    env: claudeEnv(deps.env, profileDir, deps.homeDir, deps.paths),
  });
  child.stdin.on('error', (error) => deps.log('claude', errorText(error)));
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  return { command, child };
}

// Runs `claude <args>` to its exit, stdin closed. Rejects with the
// `claude.command` hint when the process cannot start, and, given `timeoutMs`,
// kills the child and rejects when it has not exited by then.
function runCli(
  deps: ClaudeCodeHarnessDeps,
  args: readonly string[],
  profileDir: string | null,
  timeoutMs: number | null,
): Promise<CliRun> {
  const { command, child } = spawnCli(deps, args, profileDir);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  child.stdin.end();
  return new Promise((resolve, reject) => {
    const timer =
      timeoutMs === null
        ? null
        : setTimeout(() => {
            child.kill('SIGKILL');
            reject(
              new Error(
                `${commandLabel(args)} gave no answer in ${timeoutMs / 1000} s`,
              ),
            );
          }, timeoutMs);
    const stopTimer = () => {
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
    child.on('error', (error: Error) => {
      stopTimer();
      reject(new Error(cliSpawnError(error, command)));
    });
    child.on('close', (code: number | null) => {
      stopTimer();
      resolve({ code, stdout, stderr: stderr.trim() });
    });
  });
}

async function readAuthStatus(
  deps: ClaudeCodeHarnessDeps,
  profileDir: string | null,
): Promise<AccountStatus> {
  const run = await runCli(
    deps,
    ['auth', 'status', '--json'],
    profileDir,
    null,
  );
  if (run.code !== 0) {
    throw new Error(
      withStderr(`claude auth status exited with code ${run.code}`, run.stderr),
    );
  }
  try {
    return readAccountStatus(run.stdout);
  } catch (error) {
    throw new Error(withStderr(errorText(error), run.stderr));
  }
}

// One `claude -p /usage` poll of `profileDir`. `--no-session-persistence`
// keeps the poll from saving a transcript of the home folder. The usage's `at`
// is when the poll started.
async function readProfilePlanUsage(
  deps: ClaudeCodeHarnessDeps,
  profileDir: string | null,
): Promise<PlanUsage> {
  const startedAt = deps.clock.now();
  const run = await runCli(
    deps,
    PLAN_USAGE_ARGS,
    profileDir,
    PLAN_USAGE_TIMEOUT_MS,
  );
  if (run.code !== 0) {
    throw new Error(
      withStderr(`claude -p /usage exited with code ${run.code}`, run.stderr),
    );
  }
  try {
    return readPlanUsage(run.stdout, startedAt);
  } catch (error) {
    throw new Error(withStderr(errorText(error), run.stderr));
  }
}

async function logOut(
  deps: ClaudeCodeHarnessDeps,
  profileDir: string | null,
): Promise<void> {
  const run = await runCli(deps, ['auth', 'logout'], profileDir, null);
  if (run.code !== 0) {
    throw new Error(
      withStderr(`claude auth logout exited with code ${run.code}`, run.stderr),
    );
  }
}

// Whether the status `after` a login that exited with `code` is a sign-in
// that login made, given the status `before` it (null when unknown).
function isNewSignIn(
  before: AccountStatus | null,
  after: AccountStatus,
  code: number | null,
): boolean {
  const wasSignedIn = before?.signedIn === true;
  const isOtherAccount = before?.account !== after.account;
  return after.signedIn && (code === 0 || !wasSignedIn || isOtherAccount);
}

// `claude auth login` with stdin a pipe for the pasted code. Its exit code
// after a finished sign-in is unmeasured, so every exit reads the status, and
// a status read as the login starts tells a new sign-in from the profile's
// old one: a signed-in status ends the sign-in finished when the login exited
// 0, the profile was signed out before, or the account changed.
function startLogIn(
  deps: ClaudeCodeHarnessDeps,
  profileDir: string | null,
  events: LogInEvents,
): LogInProcess {
  // A failed read leaves the earlier status unknown, read as signed out.
  const statusBefore = readAuthStatus(deps, profileDir).catch(() => null);
  const { command, child } = spawnCli(deps, ['auth', 'login'], profileDir);
  let stdout = '';
  let stderr = '';
  let hasLink = false;
  let hasEnded = false;

  const end = (status: AccountStatus | null, error: string | null) => {
    if (hasEnded) {
      return;
    }
    hasEnded = true;
    queueMicrotask(() => events.ended({ status, error }));
  };

  // The link line may arrive on either stream, split across chunks; each
  // stream is searched alone, so the other's chunks cannot split the line.
  const findLink = (output: string) => {
    if (hasLink) {
      return;
    }
    const url = signInLink(output);
    if (url !== null) {
      hasLink = true;
      queueMicrotask(() => events.link(url));
    }
  };

  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
    findLink(stdout);
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
    findLink(stderr);
  });
  child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
    if (hasEnded) {
      return;
    }
    const lastStderr = stderr.trim().split('\n').at(-1) ?? '';
    const failure =
      lastStderr === ''
        ? `claude auth login exited with ${exitText(code, signal)}`
        : lastStderr;
    Promise.all([statusBefore, readAuthStatus(deps, profileDir)]).then(
      ([before, after]) =>
        end(after, isNewSignIn(before, after, code) ? null : failure),
      (error: unknown) => end(null, errorText(error)),
    );
  });
  child.on('error', (error: Error) => end(null, cliSpawnError(error, command)));

  return {
    sendCode(code) {
      if (hasEnded) {
        return;
      }
      child.stdin.write(`${code}\n`);
    },
    cancel() {
      if (hasEnded) {
        return;
      }
      child.kill();
      end(null, 'Sign-in cancelled');
    },
  };
}

// Where Claude saves every project's transcripts: `projects` in the
// session's config folder.
function projectsRoot(
  deps: ClaudeCodeHarnessDeps,
  profileDir: string | null,
): string {
  return deps.paths.join(
    claudeConfigFolder(profileDir, deps.env, deps.homeDir, deps.paths),
    'projects',
  );
}

// Where Claude saves `projectDir`'s transcripts.
function projectsFolder(
  deps: ClaudeCodeHarnessDeps,
  projectDir: string,
  profileDir: string | null,
): string {
  return deps.paths.join(
    projectsRoot(deps, profileDir),
    projectFolderName(projectDir),
  );
}

// The Claude Code CLI behind `AgentHarness`: one `claude` process per
// session, the only place the app spawns it, the sessions and project folders
// it saved, its `claude auth` sign-in, and each profile's `/usage` poll.
export function createClaudeCodeHarness(
  deps: ClaudeCodeHarnessDeps,
): AgentHarness {
  return {
    id: 'claude',
    start: (request, events) => startClaudeProcess(deps, request, events),
    attach: () =>
      Promise.reject(new Error('attach is not implemented until task 08')),
    listSessions: (projectDir, profileDir) =>
      listPastSessions(
        { files: deps.files, paths: deps.paths, log: deps.log },
        projectsFolder(deps, projectDir, profileDir),
        projectDir,
      ),
    history: (sessionId, projectDir, profileDir) =>
      readHistory(
        deps.files,
        deps.paths,
        projectsFolder(deps, projectDir, profileDir),
        sessionId,
      ),
    lastUsage: (sessionId, projectDir, profileDir) =>
      readLastUsage(
        deps.files,
        deps.paths,
        projectsFolder(deps, projectDir, profileDir),
        sessionId,
      ),
    accountStatus: (profileDir) => readAuthStatus(deps, profileDir),
    logIn: (profileDir, events) => startLogIn(deps, profileDir, events),
    logOut: (profileDir) => logOut(deps, profileDir),
    listProjects: (profileDir) =>
      listProjectFolders(
        { files: deps.files, paths: deps.paths, log: deps.log },
        projectsRoot(deps, profileDir),
      ),
    planUsage: (profileDir) => readProfilePlanUsage(deps, profileDir),
  };
}
