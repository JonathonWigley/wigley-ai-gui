import { isJsonObject, type JsonObject } from '../../../shared/json';
import type {
  BuildJob,
  BuildLink,
  BuildResult,
  BuildState,
} from '../../builds/contract';

const TEAMCITY_DATE =
  /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})([+-])(\d{2})(\d{2})$/;

// Epoch milliseconds of a TeamCity date, `YYYYMMDDTHHMMSS±HHMM`; null for any other text and for a non-string.
export function parseTeamcityDate(text: unknown): number | null {
  const match = typeof text === 'string' ? TEAMCITY_DATE.exec(text) : null;
  if (match === null) {
    return null;
  }
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map(Number);
  const offsetMinutes = Number(match[8]) * 60 + Number(match[9]);
  const sign = match[7] === '+' ? 1 : -1;
  return (
    Date.UTC(year, month - 1, day, hour, minute, second) -
    sign * offsetMinutes * 60_000
  );
}

const DOTTED_NUMBER = /^(\d+(?:\.\d+)*)\.(\d+)$/;

// A build number `<a>.<b>…<n>` as its last part and the version before it; a number with no dot, starting with a
// digit, as the whole number with no version; anything else as both null.
export function parseBuildNumber(text: unknown): {
  number: string | null;
  version: string | null;
} {
  if (typeof text !== 'string') {
    return { number: null, version: null };
  }
  const dotted = DOTTED_NUMBER.exec(text);
  if (dotted !== null) {
    return { number: dotted[2], version: dotted[1] };
  }
  const isUndotted = /^\d/.test(text) && !text.includes('.');
  return isUndotted
    ? { number: text, version: null }
    : { number: null, version: null };
}

// One build of `run list` or of the build queue. Times are epoch milliseconds.
export interface ListedBuild {
  id: string;
  buildTypeId: string;
  number: string | null;
  version: string | null;
  branchName: string | null;
  state: BuildState;
  status: string | null;
  statusText: string | null;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  startEstimate: number | null;
  waitReason: string | null;
  webUrl: string | null;
  triggeredBy: string | null;
}

// The builds of a `run list --json` answer; a row with no numeric `id`, no `buildTypeId`, an unknown `state` or no
// parsable `queuedDate` is left out.
export function parseRunList(json: unknown): ListedBuild[] {
  return buildRows(json).flatMap((row) => listedBuild(row, row.state));
}

// The builds of a `/app/rest/buildQueue` answer, read as `parseRunList` reads a list; a row with no `state` is queued.
export function parseBuildQueue(json: unknown): ListedBuild[] {
  return buildRows(json).flatMap((row) =>
    listedBuild(row, row.state ?? 'queued'),
  );
}

function buildRows(json: unknown): JsonObject[] {
  const rows = isJsonObject(json) ? json.build : undefined;
  return Array.isArray(rows) ? rows.filter(isJsonObject) : [];
}

// The row as a one-item list, or `[]` when it lacks a field every build has.
function listedBuild(row: JsonObject, state: unknown): ListedBuild[] {
  const { id, buildTypeId } = row;
  const queuedAt = parseTeamcityDate(row.queuedDate);
  if (
    typeof id !== 'number' ||
    typeof buildTypeId !== 'string' ||
    !isBuildState(state) ||
    queuedAt === null
  ) {
    return [];
  }
  return [
    {
      id: String(id),
      buildTypeId,
      ...parseBuildNumber(row.number),
      branchName: stringOrNull(row.branchName),
      state,
      status: stringOrNull(row.status),
      statusText: stringOrNull(row.statusText),
      queuedAt,
      startedAt: parseTeamcityDate(row.startDate),
      finishedAt: parseTeamcityDate(row.finishDate),
      startEstimate: parseTeamcityDate(row.startEstimate),
      waitReason: stringOrNull(row.waitReason),
      webUrl: stringOrNull(row.webUrl),
      triggeredBy: triggeredBy(row.triggered),
    },
  ];
}

// `triggered.user.name`, as both the list's `--json` fields and the queue's `triggered(user(name))` nest it.
function triggeredBy(triggered: unknown): string | null {
  const user = isJsonObject(triggered) ? triggered.user : undefined;
  return isJsonObject(user) ? stringOrNull(user.name) : null;
}

// A chain's detail: its revision and progress over its Build jobs, every snapshot dependency as a job, and the jobs
// whose logs hold install links.
export interface ChainDetail {
  revision: string | null;
  percent: number | null;
  leftSeconds: number | null;
  stepText: string | null;
  jobs: BuildJob[];
  logJobIds: string[]; // jobs whose logs hold install links, in dependency order
}

// One snapshot dependency, with what the chain's rules read beside its job.
interface Dependency {
  job: BuildJob;
  isBuildJob: boolean;
  revision: string | null; // its first revision's version
  hasRevisions: boolean;
}

// The detail of a chain from `/app/rest/builds/id:<id>`, null when `json` is not an object. A Build job is a dependency
// whose `buildTypeId` matches `buildJob`, or with no pattern one that carries a revision. A dependency row with no
// numeric `id`, no `buildTypeId` or an unknown `state` is left out.
export function parseChainDetail(
  json: unknown,
  buildJob: RegExp | null,
): ChainDetail | null {
  if (!isJsonObject(json)) {
    return null;
  }
  const dependencies = dependencyRows(json).flatMap((row) =>
    dependency(row, buildJob),
  );
  const buildJobs = dependencies
    .filter((each) => each.isBuildJob)
    .map(({ job, revision }) => ({ ...job, revision }));
  const isChainFinished = json.state === 'finished';
  return {
    revision: mostCommonRevision(buildJobs.map((job) => job.revision)),
    percent: roundedMean(buildJobs.map((job) => job.percent)),
    leftSeconds: largest(buildJobs.map((job) => job.leftSeconds)),
    stepText:
      buildJobs.find((job) => job.state === 'running')?.stepText ?? null,
    jobs: dependencies.map((each) => each.job),
    logJobIds: isChainFinished
      ? dependencies
          .filter((each) => !each.hasRevisions && each.job.result === 'success')
          .map((each) => each.job.id)
      : [],
  };
}

function dependencyRows(detail: JsonObject): JsonObject[] {
  const dependencies = detail['snapshot-dependencies'];
  const rows = isJsonObject(dependencies) ? dependencies.build : undefined;
  return Array.isArray(rows) ? rows.filter(isJsonObject) : [];
}

// The row as a one-item list, or `[]` when it lacks a field every dependency has.
function dependency(
  row: JsonObject,
  buildJob: RegExp | null,
): Dependency[] {
  const { id, buildTypeId, state } = row;
  if (
    typeof id !== 'number' ||
    typeof buildTypeId !== 'string' ||
    !isBuildState(state)
  ) {
    return [];
  }
  const versions = revisionVersions(row.revisions);
  const hasRevisions = versions.length > 0;
  return [
    {
      job: buildJobOf(row, buildTypeId, state),
      isBuildJob: buildJob === null ? hasRevisions : buildJob.test(buildTypeId),
      revision: versions[0] ?? null,
      hasRevisions,
    },
  ];
}

// Each `revisions.revision[].version`; an absent list reads as empty.
function revisionVersions(revisions: unknown): (string | null)[] {
  const list = isJsonObject(revisions) ? revisions.revision : undefined;
  return Array.isArray(list)
    ? list.map((each) =>
        isJsonObject(each) ? stringOrNull(each.version) : null,
      )
    : [];
}

function buildJobOf(
  row: JsonObject,
  buildTypeId: string,
  state: BuildState,
): BuildJob {
  const buildType = isJsonObject(row.buildType) ? row.buildType : {};
  const runningInfo = isJsonObject(row['running-info'])
    ? row['running-info']
    : {};
  const result = resultOf(state, row.status);
  const base = {
    id: String(row.id),
    label: stringOrNull(buildType.name) ?? buildTypeId,
    state,
    result,
  };
  switch (state) {
    case 'queued':
      return { ...base, percent: 0, leftSeconds: null, stepText: null };
    case 'finished':
      return {
        ...base,
        percent: 100,
        leftSeconds: 0,
        stepText: result === 'failure' ? stringOrNull(row.statusText) : null,
      };
    case 'running': {
      const leftSeconds = numberOrNull(runningInfo.leftSeconds);
      return {
        ...base,
        percent:
          numberOrNull(runningInfo.percentageComplete) ??
          numberOrNull(row.percentageComplete),
        leftSeconds: leftSeconds === null ? null : Math.max(0, leftSeconds),
        stepText: stringOrNull(runningInfo.currentStageText),
      };
    }
  }
}

// A build's or job's result from TeamCity's `status`: null until finished; `SUCCESS` succeeded, `UNKNOWN` was
// cancelled, any other status failed.
export function resultOf(state: BuildState, status: unknown): BuildResult | null {
  if (state !== 'finished') {
    return null;
  }
  switch (status) {
    case 'SUCCESS':
      return 'success';
    case 'UNKNOWN':
      return 'cancelled';
    default:
      return 'failure';
  }
}

// The revision most jobs share, a tie going to the one seen first; null when no job has one.
function mostCommonRevision(revisions: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const revision of revisions) {
    if (revision !== null) {
      counts.set(revision, (counts.get(revision) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [revision, count] of counts) {
    if (count > bestCount) {
      best = revision;
      bestCount = count;
    }
  }
  return best;
}

function roundedMean(values: (number | null)[]): number | null {
  const present = values.filter((value) => value !== null);
  return present.length === 0
    ? null
    : Math.round(present.reduce((sum, value) => sum + value, 0) / present.length);
}

function largest(values: (number | null)[]): number | null {
  const present = values.filter((value) => value !== null);
  return present.length === 0 ? null : Math.max(...present);
}

const FIREBASE_RELEASE =
  /https:\/\/appdistribution\.firebase\.google\.com\/[^\s"'<>]+/g;

// Each Firebase App Distribution URL of a deploy log, once, in log order, labelled by its platform.
export function readFirebaseLinks(log: string): BuildLink[] {
  const urls = new Set(log.match(FIREBASE_RELEASE) ?? []);
  return [...urls].map((url) => ({ label: platformLabel(url), url }));
}

function platformLabel(url: string): string {
  if (url.includes(':ios:')) {
    return 'iOS';
  }
  return url.includes(':android:') ? 'Android' : 'Install';
}

function isBuildState(value: unknown): value is BuildState {
  return value === 'queued' || value === 'running' || value === 'finished';
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}
