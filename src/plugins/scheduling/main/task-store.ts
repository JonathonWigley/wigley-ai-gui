import type { Clock, RandomHex } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import {
  type Files,
  type FileWatch,
  readIfPresent,
} from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';
import { isSameJson } from '../../../shared/json';
import { createListeners } from '../../../shared/listeners';
import {
  TASK_FILE_NAME,
  type ScheduledTask,
  type TaskDraft,
  type TaskFile,
} from '../contract';
import { readTaskFile, taskFileText } from '../task-file';

export interface TaskStoreDeps {
  files: Files; // absolute paths (`services.files`)
  paths: Paths;
  configFolder: string; // the user config folder, absolute
  clock: Clock;
  randomHex: RandomHex;
  log(line: string): void;
}

// The task file, its last good tasks and its error. Reads and writes run one
// at a time in call order; `settled` resolves once every one asked so far has
// settled.
export interface TaskStore {
  load(): Promise<void>;
  tasks(): ScheduledTask[];
  error(): string | null;
  onChanged(listener: () => void): Disposable;
  save(draft: TaskDraft): Promise<string>;
  setPaused(id: string, paused: boolean): Promise<void>;
  remove(id: string): Promise<void>;
  settled(): Promise<void>;
  dispose(): void;
}

// What one file read found: the text (null for a missing file or a failed
// read), the tasks then held and the error then shown.
interface ReadState {
  text: string | null;
  tasks: ScheduledTask[];
  error: string | null;
}

export function createTaskStore(deps: TaskStoreDeps): TaskStore {
  const { files, paths, configFolder, clock, randomHex, log } = deps;
  const filePath = paths.join(configFolder, TASK_FILE_NAME);
  const changed = createListeners<void>();
  let state: ReadState = { text: null, tasks: [], error: null };
  let watch: FileWatch | null = null;
  let lastStep: Promise<unknown> = Promise.resolve();

  // Runs `step` once every earlier read and write has settled.
  const inTurn = <T>(step: () => Promise<T>): Promise<T> => {
    const result = lastStep.then(step);
    lastStep = result.catch(() => undefined);
    return result;
  };

  // Takes `next`, telling the listeners when the tasks or the error changed.
  const apply = (next: ReadState) => {
    const isChanged =
      next.error !== state.error || !isSameJson(next.tasks, state.tasks);
    state = next;
    if (isChanged) {
      changed.tell();
    }
  };

  const readFile = async () => {
    let text: string | null;
    try {
      text = await readIfPresent(files, filePath);
    } catch (error) {
      apply({
        text: null,
        tasks: state.tasks,
        error: `${TASK_FILE_NAME} not read: ${errorText(error)}`,
      });
      return;
    }
    if (text === null) {
      apply({ text: null, tasks: [], error: null });
      return;
    }
    if (text === state.text) {
      return;
    }
    const file = readTaskFile(text);
    apply(
      typeof file === 'string'
        ? { text, tasks: state.tasks, error: file }
        : { text, tasks: file.tasks, error: null },
    );
  };

  // A read no caller awaits: a listener's throw is logged.
  const readInTurn = () => {
    inTurn(readFile).catch((error: unknown) =>
      log(`${TASK_FILE_NAME} change not told: ${errorText(error)}`),
    );
  };

  const logWatchFailure = (error: unknown) =>
    log(`${TASK_FILE_NAME} not watched: ${errorText(error)}`);

  // Writes the file `build` makes from the current tasks, in turn, and
  // resolves to `build`'s result.
  const mutate = <T>(
    build: (tasks: ScheduledTask[]) => { file: TaskFile; result: T },
  ): Promise<T> =>
    inTurn(async () => {
      if (state.error !== null) {
        throw new Error(
          `${TASK_FILE_NAME} has an error; fix it first: ${state.error}`,
        );
      }
      const { file, result } = build(state.tasks);
      const text = taskFileText(file);
      const checked = readTaskFile(text);
      if (typeof checked === 'string') {
        throw new Error(checked);
      }
      await files.write(filePath, text);
      state = { text, tasks: checked.tasks, error: null };
      changed.tell();
      return result;
    });

  // The index of task `id` in `tasks`; throws when there is none.
  const indexOf = (tasks: ScheduledTask[], id: string): number => {
    const index = tasks.findIndex((task) => task.id === id);
    if (index === -1) {
      throw new Error(`No scheduled task ${id}.`);
    }
    return index;
  };

  const freshId = (tasks: ScheduledTask[]): string => {
    let id = randomHex();
    while (tasks.some((task) => task.id === id)) {
      id = randomHex();
    }
    return id;
  };

  return {
    async load() {
      await files.makeFolder(configFolder);
      try {
        watch = files.watch(
          configFolder,
          (path) => {
            if (path === TASK_FILE_NAME) {
              readInTurn();
            }
          },
          {
            recursive: false,
            onMissed: readInTurn,
            onError: logWatchFailure,
          },
        );
      } catch (error) {
        logWatchFailure(error);
      }
      await inTurn(readFile);
    },
    tasks: () => state.tasks,
    error: () => state.error,
    onChanged: (listener) => changed.add(listener),
    save: (draft) =>
      mutate((tasks) => {
        const id = draft.id ?? freshId(tasks);
        const task: ScheduledTask = { ...draft, id, updatedAt: clock.now() };
        const next = [...tasks];
        if (draft.id === null) {
          next.push(task);
        } else {
          next[indexOf(tasks, draft.id)] = task;
        }
        return { file: { tasks: next }, result: id };
      }),
    setPaused: (id, paused) =>
      mutate((tasks) => {
        const index = indexOf(tasks, id);
        const next = [...tasks];
        next[index] = {
          ...tasks[index],
          paused,
          updatedAt: clock.now(),
        };
        return { file: { tasks: next }, result: undefined };
      }),
    remove: (id) =>
      mutate((tasks) => {
        const index = indexOf(tasks, id);
        return {
          file: { tasks: tasks.filter((_, at) => at !== index) },
          result: undefined,
        };
      }),
    settled: () => lastStep.then(() => undefined),
    dispose() {
      watch?.dispose();
      watch = null;
    },
  };
}
