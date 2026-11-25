import type {
  AgentHarness,
  AgentHarnessInfo,
  AgentHarnessRegistry,
  ChatEntry,
} from '../../../contracts/agent';
import type { Timers } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import type {
  KeyedSlotReader,
  KeyedSlotWriter,
  ListSlotReader,
} from '../../../contracts/state';
import { errorText } from '../../../shared/error-text';
import { registeredProfiles } from '../../../shared/harness-profiles';
import type { ChatMainExports, ChatSessionInfo } from '../../chat/contract';
import type { OpenConfirm } from '../../forms/contract';
import type { SessionsMainExports } from '../../sessions/contract';
import { chatReviewKey, confirmReviewKey, type Review } from '../contract';
import { previewReviews } from './preview-reviews';
import {
  parseReviewReply,
  REVIEW_INSTRUCTIONS,
  reviewPrompt,
  type ReviewSubject,
} from './review-prompt';

// How long a review's ask may run before it is unavailable.
export const REVIEW_TIMEOUT_MS = 60_000;

// The harness and profile folder a session's requests are reviewed on, with
// the project folder the reviewer is told of; or why there is none.
export type Reviewer =
  | { harness: AgentHarness; profileDir: string; projectDir: string | null }
  | { reason: string };

export interface ReviewerDeps {
  chatSessions: Pick<KeyedSlotReader<ChatSessionInfo>, 'get'>;
  harnessInfos: Pick<KeyedSlotReader<AgentHarnessInfo>, 'get' | 'all'>;
  harnesses: Pick<AgentHarnessRegistry, 'get'>;
  defaultProfile: ChatMainExports['defaultProfile'];
}

export interface ReviewRequestDeps extends Omit<ReviewerDeps, 'chatSessions'> {
  chatSessions: Pick<KeyedSlotReader<ChatSessionInfo>, 'get' | 'all'>;
  chatEntries: Pick<ListSlotReader<ChatEntry>, 'get' | 'on'>;
  confirms: Pick<KeyedSlotReader<OpenConfirm>, 'all' | 'on'>;
  reviews: KeyedSlotWriter<Review>;
  label: SessionsMainExports['label'];
  // Whether `sessionId` is chat's layout preview session.
  isPreview(sessionId: string): boolean;
  timers: Pick<Timers, 'set' | 'clear'>;
  log(line: string): void;
}

// The reviewer of `sessionId`'s requests: a session chat owns is reviewed on
// its own harness and profile, in its project folder; any other on chat's
// default profile for it, searched in every registered harness, with no
// project folder. `profileDir` is the profile's `configDir` as published.
export function findReviewer(sessionId: string, deps: ReviewerDeps): Reviewer {
  const session = deps.chatSessions.get(sessionId);
  if (session !== undefined) {
    const harness = deps.harnesses.get(session.harness);
    if (harness === null) {
      return { reason: `no agent harness "${session.harness}"` };
    }
    const profile = deps.harnessInfos
      .get(session.harness)
      ?.profiles.find(({ name }) => name === session.profile);
    if (profile === undefined) {
      return { reason: `no profile "${session.profile}"` };
    }
    return {
      harness,
      profileDir: profile.configDir,
      projectDir: session.projectDir,
    };
  }
  const profileName = deps.defaultProfile(sessionId);
  if (profileName === null) {
    return { reason: 'no profile to review with' };
  }
  const profile = registeredProfiles(deps.harnessInfos.all()).find(
    ({ name }) => name === profileName,
  );
  if (profile === undefined) {
    return { reason: `no profile "${profileName}"` };
  }
  const harness = deps.harnesses.get(profile.harnessId);
  if (harness === null) {
    return { reason: `no agent harness "${profile.harnessId}"` };
  }
  return { harness, profileDir: profile.configDir, projectDir: null };
}

const TIMED_OUT: Review = {
  state: 'unavailable',
  reason: `the review took longer than ${REVIEW_TIMEOUT_MS / 1000} s`,
};

// The request a held review key is for: a chat permission entry of
// `sessionId`, or (`entryId` null) a confirm round asked in `sessionId`.
interface ReviewedRequest {
  sessionId: string;
  entryId: string | null;
}

// Reviews each request once, on arrival, into `reviews`: each unanswered
// permission entry `chatEntries` puts under a chat session, or a `replace`
// holds that it has not seen for that session, and each round `confirms`
// sets. A review whose request goes (a `replace` that drops its entry, its
// round leaving `confirms`, `forgetSession` of its session) is aborted and
// deleted, and an aborted review writes and logs nothing. The `isPreview`
// session is never reviewed: its permission entries get `previewReviews`'
// samples instead, which go as its reviews do. At start it deletes the held
// reviews still `reviewing` and those whose request went, then reviews every
// request waiting with no review. `dispose` aborts every running review.
export function watchReviewRequests(
  deps: ReviewRequestDeps,
): { forgetSession(sessionId: string): void } & Disposable {
  const { chatSessions, chatEntries, confirms, reviews } = deps;
  const seen = new Map<string, ReviewedRequest>();
  // Each running ask's stop, by review key.
  const running = new Map<string, () => void>();

  function startReview(
    key: string,
    sessionId: string,
    call: Omit<ReviewSubject, 'projectDir'>,
  ) {
    reviews.set(key, { state: 'reviewing' });
    const reviewer = findReviewer(sessionId, deps);
    if ('reason' in reviewer) {
      writeAndLog(key, sessionId, call.toolName, {
        state: 'unavailable',
        reason: reviewer.reason,
      });
      return;
    }
    const subject: ReviewSubject = {
      toolName: call.toolName,
      input: call.input,
      projectDir: reviewer.projectDir,
    };
    const controller = new AbortController();
    let isSettled = false;
    const settle = (result: Review) => {
      if (isSettled) {
        return;
      }
      isSettled = true;
      deps.timers.clear(timer);
      running.delete(key);
      writeAndLog(key, sessionId, subject.toolName, result);
    };
    const timer = deps.timers.set(() => {
      settle(TIMED_OUT);
      controller.abort();
    }, REVIEW_TIMEOUT_MS);
    running.set(key, () => {
      isSettled = true;
      deps.timers.clear(timer);
      controller.abort();
    });
    reviewer.harness
      .ask({
        profileDir: reviewer.profileDir,
        instructions: REVIEW_INSTRUCTIONS,
        prompt: reviewPrompt(subject),
        signal: controller.signal,
      })
      .then(
        (text) => settle(parseReviewReply(text)),
        (error: unknown) =>
          settle({ state: 'unavailable', reason: errorText(error) }),
      );
  }

  function writeAndLog(
    key: string,
    sessionId: string,
    toolName: string,
    result: Review,
  ) {
    reviews.set(key, result);
    const name = deps.label(sessionId) ?? sessionId;
    if (result.state === 'done') {
      deps.log(
        `reviewed ${toolName} in ${name}: ${result.verdict} · ${result.risk}`,
      );
    } else if (result.state === 'unavailable') {
      deps.log(
        `review unavailable for ${toolName} in ${name}: ${result.reason}`,
      );
    }
  }

  function reviewEntry(sessionId: string, entry: ChatEntry) {
    const key = chatReviewKey(sessionId, entry.id);
    const isWaitingPermission =
      entry.kind === 'permission' && entry.answer === null;
    if (!isWaitingPermission || seen.has(key)) {
      return;
    }
    seen.set(key, { sessionId, entryId: entry.id });
    startReview(key, sessionId, {
      toolName: entry.toolName,
      input: entry.input,
    });
  }

  // Sets the preview session's sample reviews over `entries`.
  function showPreviewReviews(
    sessionId: string,
    entries: readonly ChatEntry[],
  ) {
    for (const [entryId, review] of previewReviews(entries)) {
      const key = chatReviewKey(sessionId, entryId);
      seen.set(key, { sessionId, entryId });
      reviews.set(key, review);
    }
  }

  // Reviews `entries` of `sessionId`; the preview session instead takes its
  // samples over every entry it holds.
  function reviewEntries(sessionId: string, entries: readonly ChatEntry[]) {
    if (deps.isPreview(sessionId)) {
      showPreviewReviews(sessionId, chatEntries.get(sessionId));
      return;
    }
    for (const entry of entries) {
      reviewEntry(sessionId, entry);
    }
  }

  function reviewConfirm(roundId: string, confirm: OpenConfirm) {
    const key = confirmReviewKey(roundId);
    if (seen.has(key)) {
      return;
    }
    seen.set(key, { sessionId: confirm.sessionId, entryId: null });
    startReview(key, confirm.sessionId, confirm.subject);
  }

  function drop(key: string) {
    running.get(key)?.();
    running.delete(key);
    reviews.delete(key);
    seen.delete(key);
  }

  // The keys of `sessionId`'s chat entry reviews.
  function chatKeysOf(sessionId: string): string[] {
    return [...seen]
      .filter(
        ([, request]) =>
          request.sessionId === sessionId && request.entryId !== null,
      )
      .map(([key]) => key);
  }

  function dropReviewsLeftBy(sessionId: string, items: readonly ChatEntry[]) {
    const keptKeys = new Set(
      items.map(({ id }) => chatReviewKey(sessionId, id)),
    );
    for (const key of chatKeysOf(sessionId)) {
      if (!keptKeys.has(key)) {
        drop(key);
      }
    }
  }

  // Each open request's review key, with the request.
  function openRequests(): Map<string, ReviewedRequest> {
    const open = new Map<string, ReviewedRequest>();
    for (const sessionId of chatSessions.all().keys()) {
      for (const entry of chatEntries.get(sessionId)) {
        if (entry.kind === 'permission') {
          open.set(chatReviewKey(sessionId, entry.id), {
            sessionId,
            entryId: entry.id,
          });
        }
      }
    }
    for (const [roundId, confirm] of confirms.all()) {
      open.set(confirmReviewKey(roundId), {
        sessionId: confirm.sessionId,
        entryId: null,
      });
    }
    return open;
  }

  const open = openRequests();
  for (const [key, held] of reviews.all()) {
    const request = open.get(key);
    if (held.state !== 'reviewing' && request !== undefined) {
      seen.set(key, request);
    } else {
      reviews.delete(key);
    }
  }
  for (const sessionId of chatSessions.all().keys()) {
    reviewEntries(sessionId, chatEntries.get(sessionId));
  }
  for (const [roundId, confirm] of confirms.all()) {
    reviewConfirm(roundId, confirm);
  }

  const listeners = [
    chatEntries.on((sessionId, change) => {
      if (change.kind === 'put') {
        reviewEntries(sessionId, [change.item]);
      } else if (change.kind === 'replace') {
        dropReviewsLeftBy(sessionId, change.items);
        reviewEntries(sessionId, change.items);
      }
    }),
    confirms.on((roundId, confirm) => {
      if (confirm === undefined) {
        drop(confirmReviewKey(roundId));
      } else {
        reviewConfirm(roundId, confirm);
      }
    }),
  ];

  return {
    forgetSession(sessionId) {
      for (const key of chatKeysOf(sessionId)) {
        drop(key);
      }
    },
    dispose() {
      for (const listener of listeners) {
        listener.dispose();
      }
      for (const stop of running.values()) {
        stop();
      }
      running.clear();
    },
  };
}
