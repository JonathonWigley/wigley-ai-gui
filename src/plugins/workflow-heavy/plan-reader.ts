import { fenceAfterLine } from '../../shared/markdown-fence';

// One counted box under `## Tasks`: the `### Wave N` it sits under (null
// before any wave heading), its text with links reduced to their text and
// `~~` removed, and whether it is ticked or struck.
export interface PlanTaskLine {
  wave: number | null;
  text: string;
  done: boolean;
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
const PLAN_TITLE_SUFFIX = ' — plan';

type PlanSection = 'tasks' | 'runLog' | null;

export function readPlanProgress(text: string): PlanProgress {
  const tasks: PlanTaskLine[] = [];
  let title: string | null = null;
  let section: PlanSection = null;
  let wave: number | null = null;
  let inReviewRounds = false;
  let reviewRounds = 0;
  for (const line of linesOutsideFences(text)) {
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
        tasks.push({
          wave,
          text: taskText(line.slice(box[0].length)),
          done: box[1] !== ' ',
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

// The lines outside fenced code, fence lines left out, as `markdown.py`'s
// `_lines_outside_fences` reads them.
function linesOutsideFences(text: string): string[] {
  const outside: string[] = [];
  let fence: string | null = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
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
