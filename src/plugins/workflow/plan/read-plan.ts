// The plan reader: a plan file read for progress in a workflow's
// `planFormat`, and where a plan file and its folder sit. Pure. Every knob left
// out reads a plain checklist (docs/features/feature-contributions/design.md
// § Section: planFormat).

import type { PlanFormat } from '../../../contracts/contributions';
import { escapeRegExp } from '../../../shared/escape-reg-exp';
import { fenceAfterLine } from '../../../shared/markdown-fence';
import type { PlanProgress, PlanTaskLine } from '../contract';

type TaskDocsFormat = NonNullable<PlanFormat['taskDocs']>;
type CounterFormat = NonNullable<PlanFormat['counters']>[string];

const DEFAULT_PLAN_FILE = 'plan.md';
const FENCE = /^(`{3,}|~{3,})(.*)/;
const CHECKBOX = /^\s*[-*] \[( |x|X)\]/;
const HEADING = /^(#+) /;
const MARKDOWN_LINK = /\[([^\]]*)\]\([^)]*\)/g;
const FIRST_LINK_TARGET = /\[[^\]]*\]\(([^)]*)\)/;
const NOT_A_BARE_FILE_NAME = /[/\\:#]/;
const TRAILING_SEPARATORS = /[\\/]+$/;
// The heading level of a `tasksSection` or counter heading knob: its leading
// `#` run.
const KNOB_LEVEL = /^(#+)/;

// The plan file's name in its folder.
export function planFileName(format: PlanFormat | null): string {
  return format?.file ?? DEFAULT_PLAN_FILE;
}

// A path, either separator, whose last segment is the plan file and whose
// parent folder's name matches `format.folder`; always false with no
// `folder` knob.
export function isPlanFilePath(
  path: string,
  format: PlanFormat | null,
): boolean {
  const folder = folderPattern(format);
  if (folder === null) {
    return false;
  }
  const segments = path.split(/[\\/]/);
  if (segments.length < 2) {
    return false;
  }
  const fileName = segments[segments.length - 1];
  const folderName = segments[segments.length - 2];
  return fileName === planFileName(format) && folder.test(folderName);
}

// The plan folder a skill argument names: the folder of a plan file path, or
// a folder, trailing separators dropped, whose name matches `format.folder`.
// Null when it names neither, for a null argument, and with no `folder` knob.
export function planDirOfArgs(
  argsPath: string | null,
  format: PlanFormat | null,
): string | null {
  const folder = folderPattern(format);
  if (argsPath === null || folder === null) {
    return null;
  }
  if (isPlanFilePath(argsPath, format)) {
    return argsPath.slice(0, lastSeparatorIndex(argsPath));
  }
  const trimmed = argsPath.replace(TRAILING_SEPARATORS, '');
  return folder.test(folderNameOf(trimmed)) ? trimmed : null;
}

// `format.folder` as a whole-name pattern: `*` matches one or more characters
// that are not a separator, and every other character matches itself. Null
// with no `folder` knob.
function folderPattern(format: PlanFormat | null): RegExp | null {
  const glob = format?.folder;
  if (glob === undefined) {
    return null;
  }
  const body = glob.split('*').map(escapeRegExp).join('[^\\\\/]+');
  return new RegExp(`^${body}$`);
}

// One counter's place while the plan is read.
interface CounterRead {
  readonly name: string;
  readonly format: CounterFormat;
  readonly sectionLevel: number | null;
  readonly headingLevel: number;
  inSection: boolean;
  active: boolean;
  count: number;
}

// `taskDocs` maps a task document's file name in the plan folder to its text.
export function readPlan(
  text: string,
  taskDocs: ReadonlyMap<string, string>,
  format: PlanFormat,
): PlanProgress {
  const tasks: PlanTaskLine[] = [];
  const { tasksSection, groupHeading } = format;
  const tasksLevel =
    tasksSection === undefined ? null : knobLevel(tasksSection);
  // The level of a heading that sets the group: one below the tasks section,
  // or `##` with no tasks section.
  const groupLevel = (tasksLevel ?? 1) + 1;
  const groupPattern =
    groupHeading === undefined ? null : new RegExp(groupHeading.pattern);
  const counters = counterReads(format);
  let title: string | null = null;
  let inTasks = tasksSection === undefined;
  let group: number | null = null;
  for (const line of linesOutsideFences(splitLines(text))) {
    const level = headingLevel(line);
    if (level !== null) {
      const heading = line.trimEnd();
      if (level === 1 && title === null) {
        title = planTitle(line, format.titleSuffix);
      }
      if (tasksSection !== undefined && tasksLevel !== null) {
        if (heading === tasksSection) {
          inTasks = true;
          group = null;
        } else if (level <= tasksLevel) {
          inTasks = false;
          group = null;
        }
      }
      if (inTasks && level === groupLevel) {
        group = groupPattern === null ? null : groupNumber(line, groupPattern);
      } else if (inTasks && level < groupLevel) {
        group = null;
      }
      for (const counter of counters) {
        enterHeading(counter, heading, level);
      }
      continue;
    }
    for (const counter of counters) {
      if (counter.active && line.startsWith(counter.format.itemPrefix)) {
        counter.count++;
      }
    }
    if (!inTasks) {
      continue;
    }
    const box = CHECKBOX.exec(line);
    if (box) {
      const afterBox = line.slice(box[0].length);
      const file = format.taskDocs === undefined ? null : taskFile(afterBox);
      const taskDocument = file === null ? undefined : taskDocs.get(file);
      tasks.push({
        group: groupPattern === null ? null : group,
        text: taskText(afterBox),
        done: box[1] !== ' ',
        file,
        status:
          taskDocument === undefined || format.taskDocs === undefined
            ? null
            : readTaskStatus(taskDocument, format.taskDocs),
        verification: false,
      });
    }
  }
  if (format.verificationTask !== undefined) {
    markVerificationTask(
      tasks,
      taskDocs,
      format.verificationTask.lastTaskDocLacking,
    );
  }
  return {
    title: title ?? '',
    checked: tasks.filter((task) => task.done).length,
    total: tasks.length,
    wave:
      tasks.find((task) => !task.done && task.group !== null)?.group ?? null,
    counters: Object.fromEntries(
      counters.map((counter) => [counter.name, counter.count]),
    ),
    tasks,
  };
}

function counterReads(format: PlanFormat): CounterRead[] {
  return Object.entries(format.counters ?? {}).map(([name, counter]) => ({
    name,
    format: counter,
    sectionLevel:
      counter.section === undefined ? null : knobLevel(counter.section),
    headingLevel: knobLevel(counter.heading),
    inSection: false,
    active: false,
    count: 0,
  }));
}

// A counter counts after its heading until the next heading of the same level
// or higher, and with a `section`, only while inside that section (bounded as
// the tasks section is).
function enterHeading(
  counter: CounterRead,
  heading: string,
  level: number,
): void {
  const { section } = counter.format;
  if (section !== undefined && counter.sectionLevel !== null) {
    if (heading === section) {
      counter.inSection = true;
    } else if (level <= counter.sectionLevel) {
      counter.inSection = false;
    }
  }
  const isInSection = section === undefined || counter.inSection;
  if (heading === counter.format.heading && isInSection) {
    counter.active = true;
  } else if (level <= counter.headingLevel || !isInSection) {
    counter.active = false;
  }
}

// The level of a heading knob such as `## Tasks`; 1 for a knob with no `#`.
function knobLevel(knob: string): number {
  return KNOB_LEVEL.exec(knob)?.[1].length ?? 1;
}

// Capture 1 of `pattern` on the heading as a number; null when the heading
// does not match or the capture is no number.
function groupNumber(heading: string, pattern: RegExp): number | null {
  const capture = pattern.exec(heading)?.[1];
  if (capture === undefined) {
    return null;
  }
  const value = Number(capture);
  return Number.isFinite(value) ? value : null;
}

// Marks the last task whose document was read and holds no `field:` or
// `field (<qualifier>):` line outside fences.
function markVerificationTask(
  tasks: PlanTaskLine[],
  taskDocs: ReadonlyMap<string, string>,
  field: string,
): void {
  const fieldLine = new RegExp(`^${escapeRegExp(field)}(?: \\([^)\\n]*\\))?:`);
  const index = tasks.findLastIndex((task) => {
    const taskDocument =
      task.file === null ? undefined : taskDocs.get(task.file);
    return (
      taskDocument !== undefined &&
      !linesOutsideFences(splitLines(taskDocument)).some((line) =>
        fieldLine.test(line),
      )
    );
  });
  if (index !== -1) {
    tasks[index] = { ...tasks[index], verification: true };
  }
}

// The first `<statusField>:` or `**<statusField>:**` line's value among the
// document's first `statusLines` lines, fenced lines dropped after the slice so
// they count toward the window, as the docs index's `status_line` reads it;
// null when none, or when its value is not one of `statuses`.
export function readTaskStatus(
  taskText: string,
  taskDocs: TaskDocsFormat,
): string | null {
  const statusLine = new RegExp(
    `^(\\*\\*)?${escapeRegExp(taskDocs.statusField)}:(\\*\\*)?\\s*(.+)$`,
  );
  const searched = splitLines(taskText).slice(0, taskDocs.statusLines);
  for (const line of linesOutsideFences(searched)) {
    const match = statusLine.exec(line);
    if (match) {
      const value = match[3].trim();
      return taskDocs.statuses.includes(value) ? value : null;
    }
  }
  return null;
}

function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

// The lines outside fenced code, fence lines left out, as `markdown.py`'s
// `_lines_outside_fences` reads them.
function linesOutsideFences(lines: readonly string[]): string[] {
  const outside: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const fenceBefore: string | null = fence;
    fence = fenceAfterLine(line, fence, FENCE);
    if (fenceBefore === null && fence === null) {
      outside.push(line);
    }
  }
  return outside;
}

function headingLevel(line: string): number | null {
  return HEADING.exec(line)?.[1].length ?? null;
}

function planTitle(heading: string, suffix: string | undefined): string {
  const title = heading.slice(2).trim();
  return suffix !== undefined && suffix !== '' && title.endsWith(suffix)
    ? title.slice(0, -suffix.length)
    : title;
}

function taskText(afterBox: string): string {
  return afterBox.replace(MARKDOWN_LINK, '$1').replaceAll('~~', '').trim();
}

// The first link's target, trimmed, when it is a bare `.md` file name; null
// for no link, a folder, a URL or a fragment.
function taskFile(afterBox: string): string | null {
  const target = FIRST_LINK_TARGET.exec(afterBox)?.[1].trim();
  const isBareMarkdownFile =
    target !== undefined &&
    target.endsWith('.md') &&
    !NOT_A_BARE_FILE_NAME.test(target);
  return isBareMarkdownFile ? target : null;
}

function folderNameOf(folder: string): string {
  return folder.slice(lastSeparatorIndex(folder) + 1);
}

function lastSeparatorIndex(path: string): number {
  return Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
}
