import type { Disposable } from '../../../contracts/disposable';
import { type Files, readIfPresent } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';
import type { SubmissionRecord } from '../contract';
import { parseProblem, type Problem } from '../problem';

// The files of one problem folder `problems/<slug>/` the app reads or writes;
// `solution.<attempt id>.cpp` is an earlier attempt's kept code.
export type ProblemFile =
  | 'problem.json'
  | 'problem.md'
  | 'reference.cpp'
  | 'approach.md'
  | 'solution.cpp'
  | `solution.${string}.cpp`
  | 'notes.md'
  | 'custom-cases.json'
  | 'progress.json';

// `folder` is the practice folder, read at each call so a settings change
// applies to the next one.
export interface ProblemStoreDeps {
  files: Files;
  paths: Paths;
  log: PluginLog;
  folder(): string;
}

// Every read and write of the practice folder: `problems/<slug>/` per problem,
// `interviewer.md` and the judge's `.build/` at its root. `readProblem` rejects
// with `problems/<slug>/problem.json: <field>: <reason>`. `readText` resolves
// null for a missing file. `submissions` resolves newest first, skipping and
// logging a file that does not parse. `writeBuildFile` writes only under
// `.build/` and resolves the absolute path written. `watch` reports the slug of
// each change under `problems/`, null when the change names none; it starts
// watching, which makes `problems/`, at the store's first `slugs` call, and
// logs a watch that cannot start.
export interface ProblemStore {
  folder(): string;
  buildFolder(): string;
  slugs(): Promise<string[]>;
  hasProblem(slug: string): Promise<boolean>;
  readProblem(slug: string): Promise<Problem>;
  filePath(slug: string, file: ProblemFile): string;
  readText(slug: string, file: ProblemFile): Promise<string | null>;
  writeText(slug: string, file: ProblemFile, text: string): Promise<void>;
  writeBuildFile(relativePath: string, text: string): Promise<string>;
  submissions(slug: string): Promise<SubmissionRecord[]>;
  writeSubmission(slug: string, record: SubmissionRecord): Promise<void>;
  interviewerText(): Promise<string | null>;
  watch(onChange: (slug: string | null) => void): Disposable;
}

const PROBLEMS_FOLDER = 'problems';
const SUBMISSIONS_FOLDER = 'submissions';
const BUILD_FOLDER = '.build';

export function createProblemStore(deps: ProblemStoreDeps): ProblemStore {
  const { files, paths, log } = deps;
  const problemsFolder = () => paths.join(deps.folder(), PROBLEMS_FOLDER);
  const filePath = (slug: string, file: ProblemFile) =>
    paths.join(problemsFolder(), slug, file);
  const submissionsFolder = (slug: string) =>
    paths.join(problemsFolder(), slug, SUBMISSIONS_FOLDER);
  const buildFolder = () => paths.join(deps.folder(), BUILD_FOLDER);
  let hasListed = false;
  // The starts of the watches made before the first `slugs` call.
  const waitingWatches = new Set<() => void>();

  return {
    folder: () => deps.folder(),
    buildFolder,
    async slugs() {
      if (!hasListed) {
        hasListed = true;
        waitingWatches.forEach((start) => start());
        waitingWatches.clear();
      }
      const entries = await files.list(problemsFolder(), { recursive: false });
      return entries
        .filter((entry) => entry.kind === 'folder')
        .map((entry) => entry.path)
        .sort();
    },
    async hasProblem(slug) {
      return (await files.stat(filePath(slug, 'problem.json'))) !== null;
    },
    async readProblem(slug) {
      const name = `${PROBLEMS_FOLDER}/${slug}/problem.json`;
      const text = await readIfPresent(files, filePath(slug, 'problem.json'));
      if (text === null) {
        throw new Error(`${name}: missing`);
      }
      try {
        return parseProblem(JSON.parse(text), slug);
      } catch (error) {
        throw new Error(`${name}: ${errorText(error)}`);
      }
    },
    filePath,
    readText: (slug, file) => readIfPresent(files, filePath(slug, file)),
    writeText: (slug, file, text) => files.write(filePath(slug, file), text),
    async writeBuildFile(relativePath, text) {
      const climbsOut = relativePath
        .split(/[\\/]/)
        .some((segment) => segment === '..');
      if (paths.isAbsolute(relativePath) || climbsOut) {
        throw new Error(`build file ${relativePath} is outside .build`);
      }
      const path = paths.join(buildFolder(), relativePath);
      await files.write(path, text);
      return path;
    },
    async submissions(slug) {
      const folder = submissionsFolder(slug);
      const entries = await files.list(folder, { recursive: false });
      const records = await Promise.all(
        entries
          .filter(
            (entry) => entry.kind === 'file' && entry.path.endsWith('.json'),
          )
          .map(async (entry) => {
            try {
              return readSubmission(
                await files.read(paths.join(folder, entry.path)),
              );
            } catch (error) {
              log(
                `${PROBLEMS_FOLDER}/${slug}/${SUBMISSIONS_FOLDER}/${entry.path}: ${errorText(error)}`,
              );
              return null;
            }
          }),
      );
      return records
        .filter((record) => record !== null)
        .sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
    },
    async writeSubmission(slug, record) {
      const stamp = record.time.replace(/[:.]/g, '-');
      await files.write(
        paths.join(submissionsFolder(slug), `${stamp}.json`),
        `${JSON.stringify(record, null, 2)}\n`,
      );
    },
    interviewerText: () =>
      readIfPresent(files, paths.join(deps.folder(), 'interviewer.md')),
    watch(onChange) {
      let watching: Disposable | null = null;
      const start = () => {
        try {
          watching = files.watch(
            problemsFolder(),
            (path) => onChange(path.split('/')[0] || null),
            { onError: (error) => log(`watch stopped: ${errorText(error)}`) },
          );
        } catch (error) {
          log(`watch not started: ${errorText(error)}`);
        }
      };
      if (hasListed) {
        start();
      } else {
        waitingWatches.add(start);
      }
      return {
        dispose() {
          waitingWatches.delete(start);
          watching?.dispose();
        },
      };
    },
  };
}

// A submission file's record; throws when the text is no JSON object with a
// string `time`, the one field the order reads.
function readSubmission(text: string): SubmissionRecord {
  const json: unknown = JSON.parse(text);
  const hasTime =
    typeof json === 'object' &&
    json !== null &&
    typeof (json as { time?: unknown }).time === 'string';
  if (!hasTime) {
    throw new Error('expected an object with a string time');
  }
  return json as SubmissionRecord;
}
