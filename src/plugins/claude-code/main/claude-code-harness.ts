import {
  type AccountStatus,
  type AgentEvent,
  type AgentHarness,
  type AgentProcess,
  type AgentProcessEvents,
  type AgentStart,
  type ChatEntry,
  type HarnessConfigRoots,
  type HarnessProfile,
  type InstalledPlugin,
  type LogInEvents,
  type LogInProcess,
  type PermissionDecision,
  type PlanUsage,
  type ProcessActivity,
  type UserMessage,
} from '../../../contracts/agent';
import type { Clock, RandomUuid } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import { type Files, readIfPresent } from '../../../contracts/files';
import type { Log } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import type { ProgramCandidate } from '../../../contracts/platform';
import type {
  ProcessRunner,
  SpawnedProcess,
} from '../../../contracts/processes';
import type {
  HostedExit,
  HostedProcess,
  HostedProcessEvents,
  HostedSpawn,
  PipeLine,
  SessionHost,
} from '../../../contracts/session-host';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import { programNotFoundMessage } from '../../../shared/program-lookup';
import { toolSummary } from '../../../shared/tool-summary';
import {
  type AgentDefinitions,
  loadAgentDefinitions,
} from './agent-definitions';
import { askClaude } from './claude-ask';
import { readAccountStatus, signInLink } from './claude-auth';
import {
  CLAUDE_CARRIED_ENV,
  type ClaudeStart,
  claudeConfigFolder,
  claudeEnv,
  claudeSpawn,
  cliSpawnError,
  defaultConfigFolder,
  exitText,
  withStderr,
} from './claude-launch';
import {
  CLAUDE_OPENING_REQUESTS,
  capClaudeControls,
  claudeOpeningLines,
  claudeStartControls,
  controlMessage,
  controlOf,
  controlRequest,
  isChoice,
  startingControls,
  userMessage,
} from './claude-controls';
import {
  installedPluginsFile,
  readInstalledPlugins,
} from './installed-plugins';
import {
  listPastSessions,
  listProjectFolders,
  readHistory,
  readLastUsage,
  readSavedReplies,
  readSessionName,
} from './past-sessions';
import { createPendingPipe } from './pending-pipe';
import {
  CANCELLED_REASON,
  permissionReplyText,
  type PermissionRoute,
  type PermissionTarget,
} from './permission-route';
import { readPlanUsage } from './plan-usage';
import {
  advanceFold,
  APP_COMPACT_TEXT,
  appCommandUuid,
  createSessionFoldState,
  type FoldEffect,
  type FoldStep,
  foldPipeLine,
  foldProcessClosed,
  foldUsageInput,
  heldUserMessage,
  nextFoldDeadline,
  replayPipeLog,
  type SessionFoldState,
} from './session-fold';
import {
  configuredPercent,
  type SavedReply,
  withConfiguredPercent,
  withSavedReplies,
} from './session-usage';
import { projectFolderName } from './transcripts';

// The harness id relay hellos and saved sessions carry for Claude Code.
export const CLAUDE_HARNESS_ID = 'claude';

// The `_meta` key Claude Code puts a tool call's id under in an MCP call.
export const CLAUDE_TOOL_USE_ID_META_KEY = 'claudecode/toolUseId';

// The other names of Claude's built-in `clear` command.
export const CLAUDE_CLEAR_ALIASES: readonly string[] = ['reset', 'new'];

// `host` runs each session's `claude` process, so it outlives the app;
// `processes` spawns the one-shot commands, which must not. `command` gives the
// `claude` program and its leading args, read once per launch and once per
// `prepareRun`, null when none was found;
// `permissions` routes each row's `permission_prompt` calls to the row's
// process; `env` the environment every process starts from, of which a
// prepared run carries only `CLAUDE_CARRIED_ENV`; `files` reads
// saved transcripts, `homeDir` holds the default config folder `.claude`, is
// what a `~` profile folder resolves against and is where `claude auth` and
// `claude -p /usage` run, and `paths` joins and compares paths by the rules of
// the OS `claude` runs on; `clock` gives each line this harness writes its `at`,
// which stamps the entries and agent events the line folds to; `randomUuid`
// gives each stdin user message its `uuid`. `files` also
// reads the profile's `settings.json` and the agent definitions at each session
// start. `profiles` reads the harness's profiles at each `info()` call.
// `askModel` reads the model an `ask` runs on at each ask, '' for the CLI's
// default; `tempFolders` holds the OS temp folders, the first of which holds
// the ask's own folder (`claude-ask.ts`).
export interface ClaudeCodeHarnessDeps {
  command(): Promise<ProgramCandidate | null>;
  profiles(): readonly HarnessProfile[];
  askModel(): string;
  tempFolders: readonly string[];
  permissions: PermissionRoute;
  env: Readonly<Record<string, string>>;
  log: Log;
  host: SessionHost;
  processes: Pick<ProcessRunner, 'spawn'>;
  files: Files;
  homeDir: string;
  paths: Paths;
  // The `auri` plugin's folder, loaded into every launch with `--plugin-dir`.
  agentPluginDir: string;
  clock: Clock;
  randomUuid: RandomUuid;
}

// How long `end` waits after closing stdin before SIGTERM, and again before
// SIGKILL.
const END_GRACE_MS = 3000;
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

function exitError(
  code: number | null,
  signal: string | null,
  lastStderr: string | null,
): string {
  const how = exitText(code, signal);
  const why = lastStderr === null ? '' : `: ${lastStderr}`;
  return `claude exited with ${how}${why}`;
}

// Spawn reports a missing `cwd` as ENOENT just as it does a missing binary,
// so the hint names both causes.
function spawnError(error: string, command: string, cwd: string): string {
  return error.includes('ENOENT')
    ? `claude was not found at ${command}, or the project folder ${cwd} does not exist; set claude-code.command`
    : error;
}

// The `claude` program a launch runs. Rejects with `programNotFoundMessage`
// when the lookup found none, and with `command`'s own error when it rejects.
async function claudeProgram(
  deps: ClaudeCodeHarnessDeps,
): Promise<ProgramCandidate> {
  const program = await deps.command();
  if (program === null) {
    throw new Error(programNotFoundMessage('claude'));
  }
  return program;
}

// `events` with a failed spawn's error carrying `spawnError`'s hint.
function withSpawnHint(
  events: HostedProcessEvents,
  command: string,
  cwd: string,
): HostedProcessEvents {
  return {
    line: (line) => events.line(line),
    spawned: (pid) => events.spawned(pid),
    closed: (exit) =>
      events.closed(
        exit.error === null
          ? exit
          : { ...exit, error: spawnError(exit.error, command, cwd) },
      ),
  };
}

// Calls `events` for an effect that only reports; the others call nothing.
function reportEffect(events: AgentProcessEvents, effect: FoldEffect) {
  switch (effect.kind) {
    case 'entry':
      events.entry(effect.entry);
      break;
    case 'agentEvent':
      events.agentEvent(effect.event);
      break;
    case 'controls':
      events.controls(effect.controls);
      break;
    case 'activity':
      events.activity(effect.activity);
      break;
    case 'commands':
      events.commands(effect.commands);
      break;
    case 'planUsage':
      events.planUsage(effect.update);
      break;
    case 'messageQueued':
      events.messageQueued(effect.entryId);
      break;
    case 'messageDropped':
      events.messageDropped(effect.entryId, effect.message);
      break;
    case 'requestContextUsage':
    case 'requestAppliedSettings':
    case 'refuseHostRequest':
    case 'log':
      break;
  }
}

// What `start` and `attach` share of one session process: the process object
// and the parts each calls in its own order.
interface ClaudeSession {
  process: AgentProcess;
  // Fold each line and run its effects, or end the process on `closed`.
  pipeEvents: HostedProcessEvents;
  // What a new process emits first, `sessionId` leading, then its first
  // context and settings requests.
  open(sessionId: string): void;
  // Arms the live grace timer for `nextFoldDeadline(state)`.
  syncGraceTimer(): void;
  // Writes what a replay shows the process is owed, unless it has closed: a
  // refusal for each unanswered host request, then the context request, then the
  // settings request.
  answerOwed(): void;
  // Starts the `settings.json` read no pipe line records.
  readConfiguredPercent(): void;
  foldSavedReplies(replies: readonly SavedReply[]): void;
  // Asks the user about the row's `permission_prompt` calls through this
  // process.
  permissions: PermissionTarget;
  // Holds the row's route record, disposed when the process closes or
  // detaches, at once when it already has.
  keepRoute(record: Disposable): void;
}

const CANCELLED: PermissionDecision = {
  allowed: false,
  reason: CANCELLED_REASON,
};

type PermissionEntry = Extract<ChatEntry, { kind: 'permission' }>;

// A `permission_prompt` call waiting on the user; `reply` settles the call
// with its reply text.
interface WaitingPermission {
  entry: PermissionEntry;
  reply(text: string): void;
}

// One `claude` process in stream-json mode, its state a fold over its pipe lines
// (`session-fold.ts`): every line written and read goes through the fold, and
// this closure runs the fold's effects. Events a call causes are emitted in a
// microtask, never inside the call, as the fake harness does. Its agent events
// open with `sessionStarted` and close with `sessionEnded`, just before `ended`;
// a subagent still running then gets no `agentFinished`. Outside fallback mode a
// sent message's user entry waits for its `started` line, or for the init that
// fixes fallback mode; a message ended before it started is reported through
// `messageDropped`, and one still held when the process closes is dropped
// silently, unless a replay left it held: the caller never wrote that one, so it
// gets `messageDropped` before `ended`. Once the process has closed or detached,
// nothing more is emitted or written; a detached process keeps running on the
// host. `compact` writes `/compact` under an app command uuid, as a control pick
// does, so a replay also reads it as the app's; the fold owns the compaction's
// events. The caller delivers `pipe`'s events to `pipeEvents`. Each
// `permission_prompt` call the route hands `permissions` mints a permission
// entry `permission-<n>`, counted per process outside the fold (a replay
// cannot rebuild it, as with `control-notice-kill`), and waits; an answer, the
// call's abort or the process's close settles it and emits its answered entry,
// a close before `sessionEnded`, and a detach settles it emitting nothing.
// Every settle that is no answer replies cancelled.
function createClaudeSession(
  deps: ClaudeCodeHarnessDeps,
  request: AgentStart,
  events: AgentProcessEvents,
  state: SessionFoldState,
  pipe: HostedProcess,
): ClaudeSession {
  const heldByReplay = new Set(state.heldMessages.keys());
  let isEndCalled = false;
  let hasClosed = false;
  let isDetached = false;
  let endPromise: Promise<void> | null = null;
  const closeWaiters: (() => void)[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  // Armed for `armedGraceDeadline`, which follows `nextFoldDeadline(state)`.
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let armedGraceDeadline: number | null = null;
  const waitingPermissions = new Map<string, WaitingPermission>();
  let permissionCount = 0;
  let routeRecord: Disposable | null = null;

  // Every emission goes through the microtask queue, so events keep the
  // order of the calls and lines that caused them; one still queued at a detach
  // is dropped.
  const emit = (emission: () => void) =>
    queueMicrotask(() => {
      if (!isDetached) {
        emission();
      }
    });

  const emitAgentEvent = (event: AgentEvent) =>
    emit(() => events.agentEvent(event));

  const emitActivity = (activity: ProcessActivity) =>
    emit(() => events.activity(activity));

  const stopTimers = () => {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    graceTimer = null;
    armedGraceDeadline = null;
  };

  const runGraceDeadline = (deadline: number) => {
    graceTimer = null;
    armedGraceDeadline = null;
    if (hasClosed || nextFoldDeadline(state) !== deadline) {
      return;
    }
    runStep(advanceFold(state, deadline));
  };

  const syncGraceTimer = () => {
    const deadline = nextFoldDeadline(state);
    if (deadline === armedGraceDeadline) {
      return;
    }
    if (graceTimer !== null) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
    armedGraceDeadline = deadline;
    if (deadline !== null) {
      graceTimer = setTimeout(
        () => runGraceDeadline(deadline),
        Math.max(deadline - deps.clock.now(), 0),
      );
      timers.push(graceTimer);
    }
  };

  const runEffect = (effect: FoldEffect) => {
    switch (effect.kind) {
      case 'requestContextUsage':
        if (!isEndCalled && !hasClosed) {
          requestContextUsage();
        }
        break;
      case 'requestAppliedSettings':
        if (!isEndCalled && !hasClosed) {
          requestAppliedSettings();
        }
        break;
      case 'refuseHostRequest':
        refuseHostRequest(effect.requestId, effect.subtype);
        break;
      case 'log':
        deps.log('claude', effect.text);
        break;
      default:
        emit(() => reportEffect(events, effect));
    }
  };

  const runStep = (step: FoldStep) => {
    if (hasClosed || isDetached) {
      return;
    }
    syncGraceTimer();
    for (const effect of step.effects) {
      runEffect(effect);
    }
  };

  const writeMessage = (message: object) => {
    const text = JSON.stringify(message);
    const step = foldPipeLine(state, {
      seq: 0,
      dir: 'in',
      at: deps.clock.now(),
      text,
    });
    pipe.write(text);
    runStep(step);
  };

  const refuseHostRequest = (requestId: string, subtype: string) => {
    writeMessage({
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: requestId,
        error: `wigley-ai-gui answers no ${subtype} requests`,
      },
    });
  };

  const nextRequestId = () => `wigley-${state.requestCount + 1}`;

  // This request and `requestAppliedSettings` are asked at start and after every
  // turn, a control command's included: `/model` changes the window and the limit,
  // and `/effort` and `/model` change the applied model and effort.
  const requestContextUsage = () => {
    writeMessage(controlRequest('get_context_usage', nextRequestId()));
  };

  const requestAppliedSettings = () => {
    writeMessage(controlRequest('get_settings', nextRequestId()));
  };

  const answerOwed = () => {
    if (hasClosed) {
      return;
    }
    for (const [requestId, subtype] of state.owedHostRequests) {
      refuseHostRequest(requestId, subtype);
    }
    if (state.isContextRequestOwed) {
      requestContextUsage();
    }
    if (state.isSettingsRequestOwed) {
      requestAppliedSettings();
    }
  };

  const requireRunning = () => {
    if (isDetached) {
      throw new Error('Claude Code process has detached');
    }
    if (isEndCalled || hasClosed) {
      throw new Error('Claude Code process has ended');
    }
  };

  const releaseRoute = () => {
    routeRecord?.dispose();
    routeRecord = null;
  };

  // Replies to the waiting call `id` with `decision`, emitting its answered
  // entry when `isShown`. False when `id` is not waiting.
  const settlePermission = (
    id: string,
    decision: PermissionDecision,
    isShown: boolean,
  ): boolean => {
    const waiting = waitingPermissions.get(id);
    if (waiting === undefined) {
      return false;
    }
    waitingPermissions.delete(id);
    waiting.reply(permissionReplyText(decision, waiting.entry.input));
    if (isShown) {
      const answered: PermissionEntry = {
        ...waiting.entry,
        answer: { allowed: decision.allowed, reason: decision.reason },
      };
      emit(() => events.entry(answered));
    }
    return true;
  };

  const cancelWaitingPermissions = (isShown: boolean) => {
    for (const id of waitingPermissions.keys()) {
      settlePermission(id, CANCELLED, isShown);
    }
  };

  const permissions: PermissionTarget = {
    ask(call, signal) {
      if (signal.aborted || hasClosed || isDetached) {
        return Promise.resolve(permissionReplyText(CANCELLED, call.input));
      }
      permissionCount += 1;
      const entry: PermissionEntry = {
        kind: 'permission',
        id: `permission-${permissionCount}`,
        at: deps.clock.now(),
        toolName: call.toolName,
        input: call.input,
        summary: toolSummary(call.toolName, call.input),
        answer: null,
        raw: [call.args],
      };
      return new Promise<string>((resolve) => {
        const onAbort = () => settlePermission(entry.id, CANCELLED, true);
        waitingPermissions.set(entry.id, {
          entry,
          reply(text) {
            signal.removeEventListener('abort', onAbort);
            resolve(text);
          },
        });
        signal.addEventListener('abort', onAbort, { once: true });
        emit(() => events.permission({ entry }));
      });
    },
  };

  // `end()` resolves after the `ended` emission it follows.
  const markClosed = () => {
    hasClosed = true;
    releaseRoute();
    state.heldMessages.clear();
    state.graceDeadline = null;
    stopTimers();
    const waiters = closeWaiters.splice(0);
    emit(() => {
      for (const resolve of waiters) {
        resolve();
      }
    });
  };

  const kill = () => {
    if (hasClosed || isDetached) {
      return;
    }
    isEndCalled = true;
    pipe.kill('SIGTERM');
  };

  const pipeEvents: HostedProcessEvents = {
    line(line) {
      if (!isDetached) {
        runStep(foldPipeLine(state, line));
      }
    },
    closed(exit) {
      if (isDetached) {
        return;
      }
      if (state.activity === 'working') {
        state.activity = 'idle';
        emitActivity('idle');
      }
      for (const [uuid, held] of state.heldMessages) {
        if (heldByReplay.has(uuid)) {
          emit(() =>
            events.messageDropped(held.draft.id, heldUserMessage(held)),
          );
        }
      }
      const isCleanExit = exit.code === 0 || isEndCalled;
      const exitFailure = isCleanExit
        ? null
        : exitError(exit.code, exit.signal, state.lastStderr);
      const end = { code: exit.code, error: exit.error ?? exitFailure };
      runStep(foldProcessClosed(state, deps.clock.now()));
      cancelWaitingPermissions(true);
      emitAgentEvent({ type: 'sessionEnded', at: deps.clock.now() });
      emit(() => events.ended(end));
      markClosed();
    },
    spawned(pid) {
      if (!isDetached && !hasClosed) {
        emit(() => events.pid(pid));
      }
    },
  };

  const readConfiguredPercent = () => {
    // The profile's autocompact override, read once: a change applies to the
    // next session.
    const settingsPath = deps.paths.join(
      claudeConfigFolder(
        request.profileDir,
        deps.env,
        deps.homeDir,
        deps.paths,
      ),
      'settings.json',
    );
    void readIfPresent(deps.files, settingsPath).then(
      (text) => {
        runStep(
          foldUsageInput(
            state,
            (usage) => withConfiguredPercent(usage, configuredPercent(text)),
            deps.clock.now(),
          ),
        );
      },
      (error: unknown) =>
        deps.log('claude', `settings.json not read: ${errorText(error)}`),
    );
  };

  const foldSavedReplies = (replies: readonly SavedReply[]) => {
    runStep(
      foldUsageInput(
        state,
        (usage) => withSavedReplies(usage, replies),
        deps.clock.now(),
      ),
    );
  };

  const open = (sessionId: string) => {
    emit(() => events.sessionId(sessionId));
    emitAgentEvent({ type: 'sessionStarted', at: deps.clock.now() });
    emit(() =>
      events.controls(state.controls.map((control) => ({ ...control }))),
    );
    emitActivity('idle');
    // `initialize` answers at once, where `init` waits for the first message.
    for (const subtype of CLAUDE_OPENING_REQUESTS) {
      writeMessage(controlRequest(subtype, nextRequestId()));
    }
  };

  const agentProcess: AgentProcess = {
    send(userInput, options) {
      requireRunning();
      writeMessage(
        userMessage(userInput, deps.randomUuid(), options?.now === true),
      );
      return `user-${state.sendCount}`;
    },
    interrupt() {
      requireRunning();
      const isTurnWorking = state.activity === 'working';
      const runningTaskIds = state.backgroundTaskIds;
      if (!isTurnWorking && runningTaskIds.length === 0) {
        return;
      }
      if (isTurnWorking && state.graceDeadline !== null) {
        // A call makes this notice, not a line: a replay cannot rebuild it, so
        // its id stays outside `noticeCount`.
        const entry: ChatEntry = {
          kind: 'notice',
          id: 'control-notice-kill',
          at: deps.clock.now(),
          text: 'Interrupted again; ending the agent process.',
          tone: 'info',
          raw: [null],
        };
        emit(() => events.entry(entry));
        deps.log(
          'claude',
          'second interrupt while working; killing the process',
        );
        kill();
        return;
      }
      writeMessage(controlRequest('interrupt', nextRequestId()));
      // Claude's interrupt leaves a main agent's background Bash running.
      for (const taskId of runningTaskIds) {
        writeMessage({
          type: 'control_request',
          request_id: nextRequestId(),
          request: { subtype: 'stop_task', task_id: taskId },
        });
      }
    },
    setControl(id, value) {
      requireRunning();
      const control = controlOf(id);
      if (control === undefined) {
        throw new Error(`Claude Code has no control ${id}`);
      }
      if (!isChoice(state.controls, control.id, value)) {
        throw new Error(`Claude Code control ${id} has no choice ${value}`);
      }
      if (control.id === 'mode') {
        writeMessage(controlMessage('mode', value, nextRequestId()));
        return;
      }
      if (state.activity === 'working') {
        throw new Error(
          `The agent is working; change ${control.label} when the turn ends`,
        );
      }
      writeMessage(
        controlMessage(control.id, value, appCommandUuid(deps.randomUuid())),
      );
    },
    compact() {
      requireRunning();
      if (state.activity !== 'idle') {
        throw new Error('The agent is working; compact when the turn ends');
      }
      writeMessage(
        userMessage(
          { text: APP_COMPACT_TEXT, images: [] },
          appCommandUuid(deps.randomUuid()),
        ),
      );
    },
    end() {
      if (endPromise !== null) {
        return endPromise;
      }
      isEndCalled = true;
      if (hasClosed || isDetached) {
        endPromise = Promise.resolve();
        return endPromise;
      }
      endPromise = new Promise<void>((resolve) => closeWaiters.push(resolve));
      pipe.endInput();
      timers.push(
        setTimeout(() => {
          pipe.kill('SIGTERM');
          timers.push(setTimeout(() => pipe.kill('SIGKILL'), END_GRACE_MS));
        }, END_GRACE_MS),
      );
      return endPromise;
    },
    kill,
    detach() {
      if (hasClosed || isDetached) {
        return;
      }
      isDetached = true;
      try {
        callEach<() => void>(
          [
            () => pipe.detach(),
            stopTimers,
            () => cancelWaitingPermissions(false),
            releaseRoute,
          ],
          (step) => step(),
        );
      } finally {
        for (const resolve of closeWaiters.splice(0)) {
          resolve();
        }
      }
    },
    answerPermission(requestId, decision) {
      if (!settlePermission(requestId, decision, true)) {
        deps.log(
          'claude',
          `answerPermission for ${requestId} ignored: not waiting`,
        );
      }
    },
  };

  return {
    process: agentProcess,
    pipeEvents,
    open,
    syncGraceTimer,
    answerOwed,
    readConfiguredPercent,
    foldSavedReplies,
    permissions,
    keepRoute(record) {
      if (hasClosed || isDetached) {
        record.dispose();
        return;
      }
      routeRecord = record;
    },
  };
}

// The session's agent definitions, read once: one added later applies to the
// next session.
function loadSessionDefinitions(
  deps: ClaudeCodeHarnessDeps,
  request: ClaudeStart,
): Promise<AgentDefinitions> {
  return loadAgentDefinitions(
    { files: deps.files, paths: deps.paths, log: deps.log },
    request.projectDir,
    claudeConfigFolder(request.profileDir, deps.env, deps.homeDir, deps.paths),
  );
}

// A resumed session's saved main replies. Null for a new session and for a read
// that failed, which it logs.
async function readSessionReplies(
  deps: ClaudeCodeHarnessDeps,
  request: ClaudeStart,
): Promise<SavedReply[] | null> {
  if (!request.resume) {
    return null;
  }
  try {
    return await readSavedReplies(
      deps.files,
      deps.paths,
      projectsFolder(deps, request.projectDir, request.profileDir),
      request.sessionId,
    );
  } catch (error) {
    deps.log('claude', `saved usage not read: ${errorText(error)}`);
    return null;
  }
}

// The hosted events of a process no session holds yet. `takeQueuedLines` hands a
// replay the lines delivered so far; `goLive` gives `live` whatever is still
// queued, then forwards to it.
function createPipeForwarder() {
  const queuedLines: PipeLine[] = [];
  let queuedExit: HostedExit | null = null;
  let live: HostedProcessEvents | null = null;
  const events: HostedProcessEvents = {
    line(line) {
      if (live === null) {
        queuedLines.push(line);
      } else {
        live.line(line);
      }
    },
    closed(exit) {
      if (live === null) {
        queuedExit = exit;
      } else {
        live.closed(exit);
      }
    },
    // Never arrives before `goLive`: the host's `spawned` comes on a later socket read than `spawn`.
    spawned(pid) {
      live?.spawned(pid);
    },
  };
  return {
    events,
    takeQueuedLines: () => queuedLines.splice(0),
    goLive(target: HostedProcessEvents) {
      live = target;
      for (const line of queuedLines.splice(0)) {
        target.line(line);
      }
      if (queuedExit !== null) {
        target.closed(queuedExit);
      }
    },
  };
}

// A new session (a null `request.sessionId`) runs under a uuid the adapter mints; the session id is reported first.
// The session holds a pending pipe from the start, and the host spawns once the
// command resolves: a kill before then ends the session with its signal and a
// detach ends nothing, each spawning nothing; a command not found ends it with
// the lookup's text.
function startClaudeProcess(
  deps: ClaudeCodeHarnessDeps,
  request: AgentStart,
  events: AgentProcessEvents,
): AgentProcess {
  const started: ClaudeStart = {
    ...request,
    sessionId: request.sessionId ?? deps.randomUuid(),
  };
  const forwarder = createPipeForwarder();
  const pending = createPendingPipe(started.processId);
  const state = createSessionFoldState(started);
  const session = createClaudeSession(
    deps,
    started,
    events,
    state,
    pending.pipe,
  );
  void claudeProgram(deps)
    .then(
      (program): ProgramCandidate | string => program,
      (error: unknown) => errorText(error),
    )
    .then((found) => {
      const stoppedBy = pending.stoppedBy();
      if (stoppedBy === 'detach') {
        return;
      }
      if (stoppedBy !== null) {
        forwarder.events.closed({ code: null, signal: stoppedBy, error: null });
        return;
      }
      if (typeof found === 'string') {
        forwarder.events.closed({ code: null, signal: null, error: found });
        return;
      }
      const spec = claudeSpawn({
        request: started,
        program: found,
        env: deps.env,
        homeDir: deps.homeDir,
        paths: deps.paths,
        pluginDir: deps.agentPluginDir,
        stdin: [],
        inheritEnv: false,
      });
      pending.attach(
        deps.host.spawn(
          spec,
          withSpawnHint(forwarder.events, spec.command, spec.cwd),
        ),
      );
    });
  session.keepRoute(
    deps.permissions.route(started.rowId, Promise.resolve(session.permissions)),
  );
  session.open(started.sessionId);
  forwarder.goLive(session.pipeEvents);
  session.readConfiguredPercent();
  // A resumed session seeds its context from the saved main replies, unless a
  // live reply came first.
  void readSessionReplies(deps, started).then((replies) => {
    if (replies !== null) {
      session.foldSavedReplies(replies);
    }
  });
  void loadSessionDefinitions(deps, started).then((loaded) => {
    state.definitions = loaded;
  });
  return session.process;
}

// The controls whose values a launch passes to a flag Claude checks only at
// run time; `model` also takes a full model id, so it is not checked.
const CHECKED_START_CONTROLS = ['mode', 'effort'] as const;

// The spec of a new session the host starts later: its stdin opens the session
// and sends `firstMessage`, its env holds the `CLAUDE_CARRIED_ENV` names of
// `deps.env` under `env`, before the launch's own values, and its unset names
// also hold each carried name that env lacks, so the child takes none from the
// host's own environment. Rejects on a resumed request, on a request with no
// session id, on a `mode` or `effort` value Claude does not offer, and as a
// launch does when the `claude` program is not found.
async function prepareClaudeRun(
  deps: ClaudeCodeHarnessDeps,
  request: AgentStart,
  firstMessage: UserMessage,
  env: Readonly<Record<string, string>>,
): Promise<HostedSpawn> {
  if (request.resume) {
    throw new Error('A prepared run starts a new session');
  }
  const { sessionId } = request;
  if (sessionId === null) {
    throw new Error('A prepared run needs a session id');
  }
  const offered = claudeStartControls();
  for (const id of CHECKED_START_CONTROLS) {
    const value = request.controls[id];
    if (value !== undefined && !isChoice(offered, id, value)) {
      throw new Error(`Claude Code control ${id} has no choice ${value}`);
    }
  }
  const carried = Object.fromEntries(
    CLAUDE_CARRIED_ENV.flatMap((name) => {
      const value = deps.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
  const spec = claudeSpawn({
    request: { ...request, sessionId },
    program: await claudeProgram(deps),
    env: { ...carried, ...env },
    homeDir: deps.homeDir,
    paths: deps.paths,
    pluginDir: deps.agentPluginDir,
    stdin: claudeOpeningLines(firstMessage, deps.randomUuid()),
    inheritEnv: true,
  });
  const absentNames = CLAUDE_CARRIED_ENV.filter(
    (name) => !(name in spec.env) && !spec.unsetEnv.includes(name),
  );
  return { ...spec, unsetEnv: [...spec.unsetEnv, ...absentNames] };
}

// Attaches to the running process `request.processId`: replays a resumed
// session's saved replies and its pipe log on a new fold state, firing the
// replay's events before the promise resolves, then goes live. `request` carries
// the `resume` and `controls` the process was launched with, the seeds the fold's
// usage and controls start from. Writes only what fell due while no app was
// attached: a refusal for each unanswered host request, the context request of a
// turn that ended, and the settings request of a turn that ended or of a log that
// has none. Rejects, having detached from the host, when a step after the host's
// attach fails; it never fires `ended` for that. Rejects at once for a null
// `request.sessionId`. Reports the session id before the replay's events. The row's `permission_prompt`
// calls are routed here from the start of the attach and wait for it: they reach
// the process once it resolves, and get no process when it resolves null or
// rejects.
async function attachClaudeProcess(
  deps: ClaudeCodeHarnessDeps,
  request: AgentStart,
  events: AgentProcessEvents,
): Promise<AgentProcess | null> {
  if (request.sessionId === null) {
    throw new Error('attach needs a session id');
  }
  const started: ClaudeStart = { ...request, sessionId: request.sessionId };
  let settleTarget: (target: PermissionTarget | null) => void = () => {};
  const record = deps.permissions.route(
    request.rowId,
    new Promise<PermissionTarget | null>((resolve) => {
      settleTarget = resolve;
    }),
  );
  const giveUpRoute = () => {
    settleTarget(null);
    record.dispose();
  };
  // The host may deliver during the reads, ahead of the replay.
  const forwarder = createPipeForwarder();
  let attached: Awaited<ReturnType<SessionHost['attach']>>;
  try {
    attached = await deps.host.attach(request.processId, forwarder.events);
  } catch (error) {
    giveUpRoute();
    throw error;
  }
  if (attached === null) {
    giveUpRoute();
    return null;
  }
  try {
    const state = createSessionFoldState(started);
    const [definitions, savedReplies] = await Promise.all([
      loadSessionDefinitions(deps, started),
      readSessionReplies(deps, started),
    ]);
    state.definitions = definitions;
    const lastLoggedSeq = attached.log.at(-1)?.seq ?? 0;
    const effects = replayPipeLog(
      state,
      [
        ...attached.log,
        ...forwarder
          .takeQueuedLines()
          .filter((line) => line.seq > lastLoggedSeq),
      ],
      deps.clock.now(),
      savedReplies,
    );
    events.sessionId(started.sessionId);
    const session = createClaudeSession(
      deps,
      started,
      events,
      state,
      attached.process,
    );
    for (const effect of effects) {
      reportEffect(events, effect);
    }
    if (attached.process.pid !== null) {
      events.pid(attached.process.pid);
    }
    session.keepRoute(record);
    forwarder.goLive(session.pipeEvents);
    session.syncGraceTimer();
    session.answerOwed();
    session.readConfiguredPercent();
    settleTarget(session.permissions);
    return session.process;
  } catch (error) {
    attached.process.detach();
    giveUpRoute();
    throw error;
  }
}

// A finished `claude` run: its exit code and what it printed, stderr trimmed.
interface CliRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

// The command `args` run, up to its first `--` option, as a message names it.
function commandLabel(args: readonly string[]): string {
  const optionAt = args.findIndex((arg) => arg.startsWith('--'));
  const words = optionAt === -1 ? args : args.slice(0, optionAt);
  return ['claude', ...words].join(' ');
}

// What a one-shot `claude` run reports: its output, then its exit, or the
// `claude-code.command` hint when it could not start.
interface CliEvents {
  stdout(chunk: string): void;
  stderr(chunk: string): void;
  exited(code: number | null, signal: string | null): void;
  failed(message: string): void;
}

// `claude <args>` as `program` for `profileDir`, in the home folder with the
// session launch's environment, the program's leading args first.
function spawnCli(
  deps: ClaudeCodeHarnessDeps,
  program: ProgramCandidate,
  args: readonly string[],
  profileDir: string | null,
  events: CliEvents,
): SpawnedProcess {
  return deps.processes.spawn(program.command, [...program.args, ...args], {
    cwd: deps.homeDir,
    env: claudeEnv(deps.env, profileDir, deps.homeDir, deps.paths),
    events: {
      stdout: (chunk) => events.stdout(chunk),
      stderr: (chunk) => events.stderr(chunk),
      closed: (exit) => {
        if (exit.startError === null) {
          events.exited(exit.code, exit.signal);
        } else {
          events.failed(cliSpawnError(exit.startError, program.command));
        }
      },
    },
  });
}

// Runs `claude <args>` to its exit, stdin closed. Rejects with the lookup's
// not-found text when no `claude` was found, spawning nothing, with the
// `claude-code.command` hint when the process cannot start, and, given
// `timeoutMs`, kills the child and rejects when it has not exited by then.
async function runCli(
  deps: ClaudeCodeHarnessDeps,
  args: readonly string[],
  profileDir: string | null,
  timeoutMs: number | null,
): Promise<CliRun> {
  const program = await claudeProgram(deps);
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stopTimer = () => {
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
    const child = spawnCli(deps, program, args, profileDir, {
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: (chunk) => {
        stderr += chunk;
      },
      exited: (code) => {
        stopTimer();
        resolve({ code, stdout, stderr: stderr.trim() });
      },
      failed: (message) => {
        stopTimer();
        reject(new Error(message));
      },
    });
    child.endInput();
    if (timeoutMs !== null) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(
          new Error(
            `${commandLabel(args)} gave no answer in ${timeoutMs / 1000} s`,
          ),
        );
      }, timeoutMs);
    }
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
// 0, the profile was signed out before, or the account changed. The login
// spawns once the command resolves: a code sent before then is dropped, since
// the user pastes one only after the link, and a cancel before then spawns
// nothing.
function startLogIn(
  deps: ClaudeCodeHarnessDeps,
  profileDir: string | null,
  events: LogInEvents,
): LogInProcess {
  // A failed read leaves the earlier status unknown, read as signed out.
  const statusBefore = readAuthStatus(deps, profileDir).catch(() => null);
  let child: SpawnedProcess | null = null;
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

  const endAfterExit = (code: number | null, signal: string | null) => {
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
  };

  void claudeProgram(deps).then(
    (program) => {
      if (hasEnded) {
        return;
      }
      child = spawnCli(deps, program, ['auth', 'login'], profileDir, {
        stdout: (chunk) => {
          stdout += chunk;
          findLink(stdout);
        },
        stderr: (chunk) => {
          stderr += chunk;
          findLink(stderr);
        },
        exited: endAfterExit,
        failed: (message) => end(null, message),
      });
    },
    (error: unknown) => end(null, errorText(error)),
  );

  return {
    sendCode(code) {
      if (hasEnded) {
        return;
      }
      child?.write(`${code}\n`);
    },
    cancel() {
      if (hasEnded) {
        return;
      }
      child?.kill();
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

// The config folder `profileDir` names: the default `.claude` under `homeDir`
// for null, whatever the environment sets, else `profileDir` with `~` expanded.
function profileConfigFolder(
  deps: ClaudeCodeHarnessDeps,
  profileDir: string | null,
): string {
  return profileDir === null
    ? defaultConfigFolder(deps.homeDir, deps.paths)
    : deps.paths.expandTilde(profileDir, deps.homeDir);
}

function configRoots(
  deps: ClaudeCodeHarnessDeps,
  profileDir: string | null,
): HarnessConfigRoots {
  const configDir = profileConfigFolder(deps, profileDir);
  return {
    configDir,
    pluginCacheDirs: [deps.paths.join(configDir, 'plugins', 'cache')],
    installedPluginsFile: installedPluginsFile(deps.paths, configDir),
  };
}

async function listInstalledPlugins(
  deps: ClaudeCodeHarnessDeps,
  profileDir: string | null,
): Promise<InstalledPlugin[]> {
  const records = await readInstalledPlugins(
    { files: deps.files, paths: deps.paths, log: deps.log },
    configRoots(deps, profileDir).configDir,
  );
  return records.map(({ key, installDir, version, listedAt }) => ({
    key,
    installDir,
    version,
    listedAt,
  }));
}

// The tool-use id under `CLAUDE_TOOL_USE_ID_META_KEY`; null when it is no
// non-empty string.
function toolUseIdOf(
  meta: Readonly<Record<string, unknown>> | null,
): string | null {
  const id = meta?.[CLAUDE_TOOL_USE_ID_META_KEY];
  return typeof id === 'string' && id !== '' ? id : null;
}

// The Claude Code CLI behind `AgentHarness`: one `claude` process per
// session on the session host, the one-shot runs, the only place the app asks
// for either, the sessions and project folders
// it saved, its `claude auth` sign-in, each profile's `/usage` poll, and the
// isolated `claude -p` run of an `ask`.
export function createClaudeCodeHarness(
  deps: ClaudeCodeHarnessDeps,
): AgentHarness {
  return {
    id: CLAUDE_HARNESS_ID,
    info: () => ({
      label: 'Claude Code',
      capabilities: {
        interrupt: true,
        resume: true,
        images: true,
        midTurnSend: true,
      },
      clearAliases: CLAUDE_CLEAR_ALIASES,
      projectConfigFolder: '.claude',
      profiles: deps.profiles(),
    }),
    controls: () => startingControls({ controls: {}, permissions: 'default' }),
    toolUseIdOf,
    configRoots: (profileDir) => configRoots(deps, profileDir),
    installedPlugins: (profileDir) => listInstalledPlugins(deps, profileDir),
    start: (request, events) => startClaudeProcess(deps, request, events),
    attach: (request, events) => attachClaudeProcess(deps, request, events),
    listSessions: (projectDir, profileDir) =>
      listPastSessions(
        { files: deps.files, paths: deps.paths, log: deps.log },
        projectsFolder(deps, projectDir, profileDir),
        projectDir,
      ),
    history: (sessionId, projectDir, profileDir, before) =>
      readHistory(
        deps.files,
        deps.paths,
        projectsFolder(deps, projectDir, profileDir),
        sessionId,
        before,
      ),
    lastUsage: (sessionId, projectDir, profileDir) =>
      readLastUsage(
        deps.files,
        deps.paths,
        projectsFolder(deps, projectDir, profileDir),
        sessionId,
      ),
    sessionName: (sessionId, projectDir, profileDir) =>
      readSessionName(
        deps.files,
        deps.paths,
        projectsFolder(deps, projectDir, profileDir),
        sessionId,
      ),
    configFolder: (profileDir) => profileConfigFolder(deps, profileDir),
    accountStatus: (profileDir) => readAuthStatus(deps, profileDir),
    logIn: (profileDir, events) => startLogIn(deps, profileDir, events),
    logOut: (profileDir) => logOut(deps, profileDir),
    listProjects: (profileDir) =>
      listProjectFolders(
        { files: deps.files, paths: deps.paths, log: deps.log },
        projectsRoot(deps, profileDir),
      ),
    planUsage: (profileDir) => readProfilePlanUsage(deps, profileDir),
    ask: (request) => askClaude(deps, request),
    prepareRun: (request, firstMessage, env) =>
      prepareClaudeRun(deps, request, firstMessage, env),
    startControls: claudeStartControls,
    capControls: capClaudeControls,
  };
}
