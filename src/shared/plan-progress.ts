import { fenceAfterLine } from './markdown-fence';

// A task document's `Status:` value.
export type TaskStatus = 'not started' | 'in progress' | 'done';

export const TASK_STATUSES: readonly TaskStatus[] = [
  'not started',
  'in progress',
  'done',
];

// One counted box under `## Tasks`: the `### Wave N` it sits under (null
// before any wave heading), its text with links reduced to their text and
// `~~` removed, whether it is ticked or struck, its first link's target when
// that is a bare `.md` file name in the plan folder, and that file's status.
export interface PlanTaskLine {
  readonly wave: number | null;
  readonly text: string;
  readonly done: boolean;
  readonly file: string | null;
  readonly status: TaskStatus | null;
}

// A plan.md read for progress. `checked` and `total` count the boxes under
// `## Tasks`; `wave` is the first `### Wave N` holding an open box, null when
// none is open; `reviewRounds` counts the `- ` lines under `### Review rounds`
// in `## Run log`; `title` is the first `# ` heading less a trailing ` — plan`.
export interface PlanProgress {
  checked: number;
  total: number;
  wave: number | null;
  reviewRounds: number;
  title: string;
  tasks: readonly PlanTaskLine[];
}

const FENCE = /^(`{3,}|~{3,})(.*)/;
const CHECKBOX = /^\s*[-*] \[( |x|X)\]/;
const HEADING = /^(#+) /;
const WAVE_HEADING = /^### Wave (\d+)\b/;
const MARKDOWN_LINK = /\[([^\]]*)\]\([^)]*\)/g;
const FIRST_LINK_TARGET = /\[[^\]]*\]\(([^)]*)\)/;
const NOT_A_BARE_FILE_NAME = /[/\\:#]/;
const STATUS_LINE = /^(\*\*)?Status:(\*\*)?\s*(.+)$/;
// `STATUS_SEARCH_LINES` in the docs index's `markdown.py`.
const STATUS_SEARCH_LINES = 15;
const PLAN_TITLE_SUFFIX = ' — plan';

type PlanSection = 'tasks' | 'runLog' | null;

// `taskTexts` maps a task document's file name in the plan folder to its text.
export function readPlanProgress(
  planText: string,
  taskTexts: ReadonlyMap<string, string>,
): PlanProgress {
  const tasks: PlanTaskLine[] = [];
  let title: string | null = null;
  let section: PlanSection = null;
  let wave: number | null = null;
  let inReviewRounds = false;
  let reviewRounds = 0;
  for (const line of linesOutsideFences(splitLines(planText))) {
    const level = headingLevel(line);
    if (level !== null) {
      if (level === 1 && title === null) {
        title = planTitle(line);
      }
      if (level <= 2) {
        section = sectionOf(line);
      }
      if (level <= 3) {
        wave = section === 'tasks' ? waveNumber(line) : null;
        inReviewRounds =
          section === 'runLog' && line.trimEnd() === '### Review rounds';
      }
      continue;
    }
    if (section === 'tasks') {
      const box = CHECKBOX.exec(line);
      if (box) {
        const afterBox = line.slice(box[0].length);
        const file = taskFile(afterBox);
        const taskDocument = file === null ? undefined : taskTexts.get(file);
        tasks.push({
          wave,
          text: taskText(afterBox),
          done: box[1] !== ' ',
          file,
          status:
            taskDocument === undefined ? null : readTaskStatus(taskDocument),
        });
      }
    } else if (inReviewRounds && line.startsWith('- ')) {
      reviewRounds++;
    }
  }
  return {
    checked: tasks.filter((task) => task.done).length,
    total: tasks.length,
    wave: tasks.find((task) => !task.done && task.wave !== null)?.wave ?? null,
    reviewRounds,
    title: title ?? '',
    tasks,
  };
}

// The first `Status:` line's value among the first `STATUS_SEARCH_LINES`
// lines outside fences, as the docs index's `status_line` reads it; null when
// none, or when its value is not one of `TASK_STATUSES`.
export function readTaskStatus(taskText: string): TaskStatus | null {
  const searched = splitLines(taskText).slice(0, STATUS_SEARCH_LINES);
  for (const line of linesOutsideFences(searched)) {
    const match = STATUS_LINE.exec(line);
    if (match) {
      return asTaskStatus(match[3].trim());
    }
  }
  return null;
}

function asTaskStatus(value: string): TaskStatus | null {
  return TASK_STATUSES.find((status) => status === value) ?? null;
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

function sectionOf(heading: string): PlanSection {
  switch (heading.trimEnd()) {
    case '## Tasks':
      return 'tasks';
    case '## Run log':
      return 'runLog';
    default:
      return null;
  }
}

function waveNumber(heading: string): number | null {
  const match = WAVE_HEADING.exec(heading);
  return match ? Number(match[1]) : null;
}

function planTitle(heading: string): string {
  const title = heading.slice(2).trim();
  return title.endsWith(PLAN_TITLE_SUFFIX)
    ? title.slice(0, -PLAN_TITLE_SUFFIX.length)
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
