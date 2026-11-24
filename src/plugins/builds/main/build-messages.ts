import { kindLabel, type SetRun, shortRevision } from '../builds-model';
import type { BuildFile, BuildJob, BuildRecord, GameEntry } from '../contract';

// The messages a session gets about its builds; agents read them, so each line keeps its form.

// `Build failing:` with one clause per failed job.
export function failingMessage(
  game: GameEntry,
  build: BuildRecord,
  failedJobs: BuildJob[],
): string {
  const clauses = failedJobs.map((job) => {
    const text = failureText(job, build);
    const failed = `${job.label} (${job.id}) failed`;
    return text === null ? failed : `${failed}: ${text}`;
  });
  return `Build failing: ${head(game, build, false)} — ${clauses.join('; ')}`;
}

// `Build ended:` with the result, branch, each failed job of a failure, the links, the files on disk by full path and
// the build's page.
export function endedMessage(
  game: GameEntry,
  build: BuildRecord,
  files: readonly BuildFile[],
): string {
  const result = build.result ?? 'failure';
  const lines = [
    `Build ended: ${head(game, build, true)} — ${result}`,
    build.revision === null
      ? `Branch ${build.branch}`
      : `Branch ${build.branch} @ ${shortRevision(build.revision)}`,
  ];
  if (result === 'failure') {
    lines.push(...failedLines(game, build));
  }
  if (build.links.length > 0) {
    const links = build.links.map((link) => `${link.label} ${link.url}`);
    lines.push(`Links: ${links.join(' · ')}`);
  }
  if (files.length > 0) {
    const named = files.map((file) => `${file.label} ${file.path}`);
    lines.push(`Files: ${named.join(' · ')}`);
  }
  if (build.webUrl !== null) {
    lines.push(`Open: ${build.webUrl}`);
  }
  return lines.join('\n');
}

// `Set ended:` with how many succeeded, then each build's `Build ended:` block in set order, or a line for a build no
// longer listed. `files` holds each build's files by build id.
export function setEndedMessage(
  game: GameEntry,
  setRun: SetRun,
  builds: BuildRecord[],
  files: Record<string, BuildFile[]>,
): string {
  const succeeded = builds.filter((build) => build.result === 'success').length;
  const blocks = setRun.builds.map((ref) => {
    const build = builds.find((listed) => listed.id === ref.buildId);
    return build === undefined
      ? `Build ${ref.buildId}: no longer listed`
      : endedMessage(game, build, files[build.id] ?? []);
  });
  return [
    `Set ended: ${game.label} ${setRun.label} — ${succeeded} of ${setRun.builds.length} succeeded`,
    ...blocks,
  ].join('\n\n');
}

function head(game: GameEntry, build: BuildRecord, withVersion: boolean) {
  let text = `${game.label} ${kindLabel(game, build.kind)}`;
  if (build.number !== null) {
    text += ` #${build.number}`;
  }
  if (withVersion && build.version !== null) {
    text += ` (${build.version})`;
  }
  return text;
}

function failedLines(game: GameEntry, build: BuildRecord): string[] {
  const failedJobs = build.jobs.filter((job) => job.result === 'failure');
  if (failedJobs.length === 0) {
    const failed = `Failed: ${kindLabel(game, build.kind)} (${build.id})`;
    return [
      build.statusText === null ? failed : `${failed} — ${build.statusText}`,
    ];
  }
  return failedJobs.map((job) => {
    const text = failureText(job, build);
    const failed = `Failed: ${job.label} (${job.id})`;
    return text === null ? failed : `${failed} — ${text}`;
  });
}

// What a failed job says: its step text, else the build's status text.
function failureText(job: BuildJob, build: BuildRecord): string | null {
  return job.stepText ?? build.statusText;
}
