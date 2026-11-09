import type { Timers } from '../../../contracts/ambient';
import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';
import type { ChatMainExports } from '../../chat/contract';
import type { AgentSession } from '../../sessions/contract';
import type { Attempt } from '../contract';
import { practiceManifest } from '../manifest';
import { IMPORT_INSTRUCTIONS, INTERVIEWER_INSTRUCTIONS } from './instructions';
import type { ProblemStore } from './problem-store';
import type { Progress, ProgressFile } from './progress';

// How long a new interviewer waits for chat's `sessionOpened` to name its
// host id.
export const HOST_ID_WAIT_MS = 2_000;

export interface PracticeSessionsDeps {
  chat: Pick<
    ChatMainExports,
    'launch' | 'resume' | 'defaultProfile' | 'profileOf' | 'send' | 'close'
  >;
  store: ProblemStore;
  progress: Progress;
  files: Pick<Files, 'makeFolder'>;
  paths: Paths;
  timers: Timers;
  log(line: string): void;
}

// The import session and each attempt's interviewer, both run in the practice
// folder under chat's default profile; every launch and resume rejects with
// `Chat has no profiles.` when chat has none. `startImport` launches an
// ordinary chat row. An interviewer is owned by practice, so it has no
// Sessions row; it belongs to the current attempt (the last in
// `progress.json`). `askInterviewer` sends to that attempt's interviewer,
// brought back when gone, or launches one and stores its row and host ids,
// closing the latest earlier attempt's interviewer chat still holds; asks for
// one slug run one at a time. `interviewerOf` resolves null when the current
// attempt has no interviewer, and resumes a row chat no longer holds,
// concurrent calls for one slug sharing one resume; a resume chat refuses
// clears the stored interviewer, so the next ask launches a fresh one.
// `opened`, `closed` and `cleared` hear chat's `sessionOpened`,
// `sessionClosed` and `sessionCleared`.
// `interviewerSlug` names the problem whose current attempt's interviewer is
// `session`, null for any other session.
export interface PracticeSessions {
  startImport(request: string): Promise<string>;
  askInterviewer(slug: string, text: string): Promise<string>;
  interviewerOf(slug: string): Promise<string | null>;
  interviewerSlug(session: AgentSession): Promise<string | null>;
  opened(event: {
    sessionId: string;
    hostSessionId: string;
    projectDir: string;
  }): void;
  closed(event: { sessionId: string }): void;
  cleared(event: { sessionId: string; newHostSessionId: string }): void;
}

type Interviewer = NonNullable<Attempt['interviewer']>;

export function createPracticeSessions(
  deps: PracticeSessionsDeps,
): PracticeSessions {
  const { chat, store, progress, paths, timers, log } = deps;
  const owner = practiceManifest.id;
  // Row id → host id, from `sessionOpened` in the practice folder, until read
  // or closed.
  const hostIds = new Map<string, string>();
  // Row id → the `hostIdOf` read waiting for its `sessionOpened`.
  const waitingReads = new Map<string, (hostSessionId: string) => void>();
  const resumes = new Map<string, Promise<string | null>>();
  const asks = new Map<string, Promise<unknown>>();

  const requireProfile = (): string => {
    const profile = chat.defaultProfile(null);
    if (profile === null) {
      throw new Error('Chat has no profiles.');
    }
    return profile;
  };
  const interviewerInstructions = async (): Promise<string> => {
    const text = await store.interviewerText();
    return text !== null && text.trim() !== ''
      ? text
      : INTERVIEWER_INSTRUCTIONS;
  };
  const currentAttempt = async (slug: string): Promise<Attempt | null> =>
    (await progress.read(slug)).attempts.at(-1) ?? null;

  // The host id `sessionOpened` named for row `id`, waiting up to
  // HOST_ID_WAIT_MS for it; null when none came.
  const hostIdOf = (id: string): Promise<string | null> => {
    const hostSessionId = hostIds.get(id);
    if (hostSessionId !== undefined) {
      hostIds.delete(id);
      return Promise.resolve(hostSessionId);
    }
    return new Promise((resolve) => {
      const timer = timers.set(() => {
        waitingReads.delete(id);
        resolve(null);
      }, HOST_ID_WAIT_MS);
      waitingReads.set(id, (heard) => {
        timers.clear(timer);
        waitingReads.delete(id);
        resolve(heard);
      });
    });
  };

  const closeLogged = async (id: string, label: string): Promise<void> => {
    try {
      await chat.close(id, 'finished');
    } catch (error) {
      log(`${label} ${id} not closed: ${errorText(error)}`);
    }
  };

  // Runs `work` after every earlier ask for `slug` has settled.
  const inTurn = <T>(slug: string, work: () => Promise<T>): Promise<T> => {
    const turn = (asks.get(slug) ?? Promise.resolve()).then(work);
    const settled = turn.catch(() => undefined);
    asks.set(slug, settled);
    void settled.then(() => {
      if (asks.get(slug) === settled) {
        asks.delete(slug);
      }
    });
    return turn;
  };

  const launchInterviewer = async (
    slug: string,
    file: ProgressFile,
    attempt: Attempt,
    text: string,
  ): Promise<string> => {
    const profile = requireProfile();
    const id = await chat.launch({
      projectDir: store.folder(),
      profile,
      message: { text, images: [] },
      instructions: [await interviewerInstructions()],
      owner,
    });
    const hostSessionId = await hostIdOf(id);
    if (hostSessionId === null) {
      log(
        `interviewer ${id} sent no sessionOpened in ${String(HOST_ID_WAIT_MS)} ms`,
      );
      await closeLogged(id, 'interviewer');
      throw new Error(`Chat sent no sessionOpened for interviewer ${id}.`);
    }
    try {
      await progress.setInterviewer(slug, attempt.id, {
        sessionId: id,
        hostSessionId,
      });
    } catch (error) {
      await closeLogged(id, 'unstored interviewer');
      throw error;
    }
    const old =
      file.attempts
        .slice(0, file.attempts.indexOf(attempt))
        .findLast((earlier) => earlier.interviewer !== null)?.interviewer ??
      null;
    if (old !== null && chat.profileOf(old.sessionId) !== null) {
      await closeLogged(old.sessionId, 'old interviewer');
    }
    return id;
  };

  const bringBack = async (slug: string): Promise<string | null> => {
    const attempt = await currentAttempt(slug);
    const interviewer = attempt?.interviewer ?? null;
    if (attempt === null || interviewer === null) {
      return null;
    }
    if (chat.profileOf(interviewer.sessionId) !== null) {
      return interviewer.sessionId;
    }
    const profile = requireProfile();
    const [problem, instructions] = await Promise.all([
      store.readProblem(slug),
      interviewerInstructions(),
    ]);
    let id: string;
    try {
      id = await chat.resume({
        projectDir: store.folder(),
        profile,
        hostSessionId: interviewer.hostSessionId,
        title: `Interviewer: ${problem.title}`,
        instructions: [instructions],
        owner,
      });
    } catch (error) {
      log(
        `interviewer ${interviewer.sessionId} not resumed, so cleared: ${errorText(error)}`,
      );
      await progress.setInterviewer(slug, attempt.id, null);
      return null;
    }
    if (id !== interviewer.sessionId) {
      await progress.setInterviewer(slug, attempt.id, {
        sessionId: id,
        hostSessionId: interviewer.hostSessionId,
      });
    }
    return id;
  };

  const interviewerOf = (slug: string): Promise<string | null> => {
    const pending = resumes.get(slug);
    if (pending !== undefined) {
      return pending;
    }
    const resume = bringBack(slug).finally(() => resumes.delete(slug));
    resumes.set(slug, resume);
    return resume;
  };

  // Every problem's slug with its attempt whose interviewer `matches`, among
  // its current attempt alone when `currentOnly`; a progress file that fails
  // to read is skipped.
  const findInterviewer = async (
    matches: (interviewer: Interviewer) => boolean,
    currentOnly: boolean,
  ): Promise<{ slug: string; attempt: Attempt } | null> => {
    for (const slug of await store.slugs()) {
      let attempts: Attempt[];
      try {
        attempts = (await progress.read(slug)).attempts;
      } catch {
        continue;
      }
      const searched = currentOnly ? attempts.slice(-1) : attempts;
      const attempt = searched.find(
        (candidate) =>
          candidate.interviewer !== null && matches(candidate.interviewer),
      );
      if (attempt !== undefined) {
        return { slug, attempt };
      }
    }
    return null;
  };

  // Stores `newHostSessionId` on the attempt whose interviewer is row
  // `sessionId`, so a later resume brings back the cleared conversation.
  const moveHostId = async (
    sessionId: string,
    newHostSessionId: string,
  ): Promise<void> => {
    const found = await findInterviewer(
      (interviewer) => interviewer.sessionId === sessionId,
      false,
    );
    if (found !== null) {
      await progress.setInterviewer(found.slug, found.attempt.id, {
        sessionId,
        hostSessionId: newHostSessionId,
      });
    }
  };

  return {
    async startImport(request) {
      if (request.trim() === '') {
        throw new Error('Write what to add.');
      }
      const profile = requireProfile();
      await deps.files.makeFolder(store.folder());
      return chat.launch({
        projectDir: store.folder(),
        profile,
        message: { text: request, images: [] },
        instructions: [IMPORT_INSTRUCTIONS],
      });
    },
    askInterviewer: (slug, text) =>
      inTurn(slug, async () => {
        const file = await progress.read(slug);
        const attempt = file.attempts.at(-1);
        if (attempt === undefined) {
          throw new Error(`${slug} has no attempt; open it first.`);
        }
        if (attempt.interviewer === null) {
          return launchInterviewer(slug, file, attempt, text);
        }
        const id = await interviewerOf(slug);
        if (id !== null) {
          await chat.send(id, { text, images: [] });
          return id;
        }
        // The resume failed and cleared the interviewer, or the attempt
        // changed under the ask.
        const now = await progress.read(slug);
        const current = now.attempts.at(-1);
        const isClearedAttempt =
          current?.id === attempt.id && current.interviewer === null;
        if (current === undefined || !isClearedAttempt) {
          throw new Error(`${slug} has no interviewer; ask again.`);
        }
        return launchInterviewer(slug, now, current, text);
      }),
    interviewerOf,
    async interviewerSlug(session) {
      const found = await findInterviewer(
        (interviewer) =>
          interviewer.sessionId === session.id ||
          interviewer.hostSessionId === session.info.sessionId,
        true,
      );
      return found?.slug ?? null;
    },
    opened(event) {
      if (!paths.samePath(event.projectDir, store.folder())) {
        return;
      }
      const waitingRead = waitingReads.get(event.sessionId);
      if (waitingRead !== undefined) {
        waitingRead(event.hostSessionId);
        return;
      }
      hostIds.set(event.sessionId, event.hostSessionId);
    },
    closed(event) {
      hostIds.delete(event.sessionId);
    },
    cleared(event) {
      void moveHostId(event.sessionId, event.newHostSessionId).catch((error) =>
        log(
          `interviewer ${event.sessionId} host id not moved: ${errorText(error)}`,
        ),
      );
    },
  };
}
