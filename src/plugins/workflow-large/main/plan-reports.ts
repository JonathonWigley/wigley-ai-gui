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
  files: Pick<Files, 'read' | 'watch' | 'list' | 'modified'>;
  paths: Paths;
  log: PluginLog;
  // The `plan-runs` folder.
  folder: string;
  reportPlan: PlanReporter;
  // Epoch milliseconds; `Date.now` when left out.
  now?: () => number;
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
// start, and no file is deleted. When the watch may have missed changes, each
// report modified after the watch opened and after the version last read is
// read. A watch that fails, to open or later, is logged and not reopened. A
// read that settles after the dispose reports nothing.
export function createPlanReports(deps: PlanReportsDeps): Disposable {
  const { files, paths, log, folder, reportPlan } = deps;
  const now = deps.now ?? Date.now;
  let disposed = false;
  // The modified time of each report name's last read.
  const readTimes = new Map<string, number>();

  // `modified` is the file's modified time when the caller has it.
  const readReport = async (name: string, modified?: number) => {
    const rowId = name.slice(0, -REPORT_SUFFIX.length);
    const file = paths.join(folder, name);
    let readTime: number;
    let text: string;
    try {
      readTime = modified ?? (await files.modified(file));
      text = await files.read(file);
    } catch (error) {
      if (!disposed) {
        log(`report ${name} not read: ${errorText(error)}`);
      }
      return;
    }
    if (disposed) {
      return;
    }
    readTimes.set(name, readTime);
    const read = reportedPlanDir(paths, text);
    if ('problem' in read) {
      log(`report ${name} not read: ${read.problem}`);
      return;
    }
    await reportPlan(rowId, read.planDir);
  };

  const applyReport = (name: string, modified?: number) => {
    readReport(name, modified).catch((error: unknown) => {
      log(`report ${name} not applied: ${errorText(error)}`);
    });
  };

  // Reads each report modified after `openedAt` and after its last read.
  const applyMissed = async (openedAt: number) => {
    const entries = await files.list(folder);
    const reports = entries.filter(
      (entry) => entry.kind === 'file' && entry.path.endsWith(REPORT_SUFFIX),
    );
    await Promise.all(
      reports.map(async ({ path: name }) => {
        const modified = await files.modified(paths.join(folder, name));
        const isUnread =
          modified > openedAt && modified > (readTimes.get(name) ?? -Infinity);
        if (!disposed && isUnread) {
          applyReport(name, modified);
        }
      }),
    );
  };

  const openedAt = now();
  let watch: FileWatch;
  try {
    watch = files.watch(
      folder,
      (name) => {
        if (name.endsWith(REPORT_SUFFIX)) {
          applyReport(name);
        }
      },
      {
        recursive: false,
        onError: (error) => {
          log(`plan report watch failed: ${errorText(error)}`);
        },
        onMissed: () => {
          applyMissed(openedAt).catch((error: unknown) => {
            log(`plan report rescan failed: ${errorText(error)}`);
          });
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
