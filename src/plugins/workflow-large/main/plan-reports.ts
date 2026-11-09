import type { Disposable } from '../../../contracts/disposable';
import type { Files, FileWatch } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';
import { normalPlanDir, type PlanReporter } from './plan-report';

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
  reportPlan: PlanReporter;
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
    ? { planDir: normalPlanDir(paths, planDir) }
    : { problem: 'planDir is not an absolute path' };
}

// Watches `folder` and reports each `<row id>.json` that changes; any other
// name is ignored. Applies a report only when its file changes: no scan at
// start, and no file is deleted. A watch that fails, to open or later, is
// logged and not reopened. A read that settles after the dispose reports
// nothing.
export function createPlanReports(deps: PlanReportsDeps): Disposable {
  const { files, paths, log, folder, reportPlan } = deps;
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
    await reportPlan(rowId, read.planDir);
  };

  let watch: FileWatch;
  try {
    watch = files.watch(
      folder,
      (name) => {
        if (name.endsWith(REPORT_SUFFIX)) {
          readReport(name).catch((error: unknown) => {
            log(`report ${name} not applied: ${errorText(error)}`);
          });
        }
      },
      {
        recursive: false,
        onError: (error) => {
          log(`plan report watch failed: ${errorText(error)}`);
        },
      },
    );
  } catch (error) {
    log(`plan report watch not opened: ${errorText(error)}`);
    return { dispose: () => undefined };
  }
  return {
    dispose: () => {
      disposed = true;
      watch.dispose();
    },
  };
}
