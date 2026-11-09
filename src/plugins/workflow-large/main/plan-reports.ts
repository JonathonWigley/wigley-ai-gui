import type { Disposable } from '../../../contracts/disposable';
import type { Files } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';
import { planDirOf } from './plan-tool';

// The folder under the app's endpoint folder where `plan.py` writes
// `<row id>.json`.
export const PLAN_RUNS_FOLDER = 'plan-runs';

const REPORT_SUFFIX = '.json';

export interface PlanReportsDeps {
  files: Pick<Files, 'read' | 'watch'>;
  paths: Paths;
  log: PluginLog;
  // The `plan-runs` folder.
  folder: string;
  report(rowId: string, planDir: string): void;
}

// The plan folder a report file's text names, or the reason it names none.
function reportedPlanDir(
  paths: Paths,
  text: string,
): { planDir: string } | { problem: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { problem: errorText(error) };
  }
  const planDir =
    typeof value === 'object' && value !== null
      ? (value as { planDir?: unknown }).planDir
      : undefined;
  const isAbsoluteFolder =
    typeof planDir === 'string' && planDir !== '' && paths.isAbsolute(planDir);
  return isAbsoluteFolder
    ? { planDir: planDirOf(paths, planDir) }
    : { problem: 'planDir is not an absolute path' };
}

// Watches `folder` and reports each `<row id>.json` that changes; any other
// name, `plan.py`'s `.json.tmp` file among them, is ignored. Applies a report
// only when its file changes: no scan at start, and no file is deleted. A
// watch that fails is logged and not reopened. A read that settles after the
// dispose reports nothing.
export function createPlanReports(deps: PlanReportsDeps): Disposable {
  const { files, paths, log, folder, report } = deps;
  let disposed = false;

  const readReport = async (name: string) => {
    const rowId = name.slice(0, -REPORT_SUFFIX.length);
    let text: string;
    try {
      text = await files.read(paths.join(folder, name));
    } catch (error) {
      if (!disposed) {
        log(`report ${name} not read: ${errorText(error)}`);
      }
      return;
    }
    if (disposed) {
      return;
    }
    const read = reportedPlanDir(paths, text);
    if ('problem' in read) {
      log(`report ${name} not read: ${read.problem}`);
      return;
    }
    report(rowId, read.planDir);
  };

  const watch = files.watch(
    folder,
    (name) => {
      if (name.endsWith(REPORT_SUFFIX)) {
        void readReport(name);
      }
    },
    {
      recursive: false,
      onError: (error) => {
        log(`plan report watch failed: ${errorText(error)}`);
      },
    },
  );
  return {
    dispose: () => {
      disposed = true;
      watch.dispose();
    },
  };
}
