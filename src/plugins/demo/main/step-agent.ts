import { type Files, readIfPresent } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import { isJsonObject } from '../../../shared/json';
import { createSerialQueue } from '../../../shared/serial-queue';
import type {
  ScopedAgentRecord,
  ScopedAgentStore,
} from '../../scoped-agents/contract';
import type { DemoRunState, DemoStepBrief } from '../contract';

const STEP_AGENTS_FILE = 'step-agents.json';

type StepAgentRecords = Record<string, ScopedAgentRecord>;

// The step agent's title: the brief's step title, else the step id.
export function stepAgentTitle(
  stepId: string,
  brief: DemoStepBrief | undefined,
): string {
  return `Demo · ${brief?.title ?? stepId}`;
}

// The opening: the step, its plugin, title, caption, beats and files, or the
// step id alone with no brief.
function briefLines(
  stepId: string,
  brief: DemoStepBrief | undefined,
): string[] {
  if (brief === undefined) {
    return [
      `You are the step agent of the wigley-ai-gui demo for step ${stepId}.`,
    ];
  }
  const beats = brief.beats.map((name, at) => `${at + 1}. ${name}`).join('; ');
  return [
    `You are the step agent of the wigley-ai-gui demo for step ${stepId} of the ${brief.plugin} plugin: ${brief.title}.`,
    `Its caption: ${brief.caption}`,
    `Its beats, in order: ${beats}`,
    'Its files:',
    ...brief.files.map((file) => `- ${file}`),
  ];
}

// The step agent's instructions for step `stepId`, working in `folder`. They
// reach the agent only at launch and resume, so the beat they name is the one
// on screen then; the text sends the agent to `demo.run` for the beat now.
export function stepAgentInstructions(
  stepId: string,
  brief: DemoStepBrief | undefined,
  run: DemoRunState | undefined,
  folder: string,
): string {
  const isStepOnScreen = run !== undefined && run.stepId !== null;
  return [
    ...briefLines(stepId, brief),
    ...(isStepOnScreen
      ? [
          `When this conversation started, beat ${run.beat + 1} of step ${run.stepId} showed.`,
        ]
      : []),
    '',
    `The user watches this step in the app and asks you to change the feature it shows. You work in the app's own clone, ${folder}. Read its AGENTS.md before you change code, and land each change by its rules.`,
    '',
    "The demo's state is the demo.run slot: call read_state with slot demo.run for the step and beat on screen now (beat counts from 0). Drive the demo with run_command: demo.goTo with a step id as its arg, demo.next, demo.previous, demo.reset (sets the step up again from its first beat, for example after a change lands) and demo.stop. Call list_commands for the other commands.",
  ].join('\n');
}

function isRecord(value: unknown): value is ScopedAgentRecord {
  return (
    isJsonObject(value) &&
    typeof value.sessionId === 'string' &&
    typeof value.hostSessionId === 'string'
  );
}

// `step-agents.json`'s records by scope; none when it is missing, and none,
// logged, when it is unreadable or holds a value that is not a record.
async function readRecords(
  data: Pick<Files, 'read'>,
  log: PluginLog,
): Promise<StepAgentRecords> {
  try {
    const text = await readIfPresent(data, STEP_AGENTS_FILE);
    if (text === null) {
      return {};
    }
    const parsed: unknown = JSON.parse(text);
    if (!isJsonObject(parsed) || !Object.values(parsed).every(isRecord)) {
      throw new Error(`${STEP_AGENTS_FILE} holds a value that is no record`);
    }
    return parsed as StepAgentRecords;
  } catch {
    log(`${STEP_AGENTS_FILE} unreadable; the step agents start fresh`);
    return {};
  }
}

// The step agents' records in `step-agents.json` in demo's plugin data, as
// `{ "<step id>": ScopedAgentRecord }`. Every call reads the file, and runs
// after the one before it settles. A fresh launch replaces no record, and an
// ask may launch at any time.
export function createStepAgentStore(
  data: Pick<Files, 'read' | 'write'>,
  log: PluginLog,
): ScopedAgentStore {
  const queue = createSerialQueue();

  return {
    read: (scope) =>
      queue.run(async () => (await readRecords(data, log))[scope] ?? null),
    write: (scope, record) =>
      queue.run(async () => {
        const records = await readRecords(data, log);
        if (record === null) {
          delete records[scope];
        } else {
          records[scope] = record;
        }
        await data.write(STEP_AGENTS_FILE, JSON.stringify(records, null, 2));
      }),
    entries: () =>
      queue.run(async () =>
        Object.entries(await readRecords(data, log)).map(([scope, record]) => ({
          scope,
          record,
        })),
      ),
    superseded: async () => null,
    checkAsk: async () => undefined,
  };
}
