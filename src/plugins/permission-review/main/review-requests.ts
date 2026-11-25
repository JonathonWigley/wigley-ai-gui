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

const CONFIRM_KEY_PREFIX = confirmReviewKey('');
const TIMED_OUT: Review = {
  state: 'unavailable',
  reason: `the review took longer than ${REVIEW_TIMEOUT_MS / 1000} s`,
};

// Reviews each request once, on arrival, into `reviews`: each unanswered
// permission entry `chatEntries` puts under a chat session, and each round
// `confirms` sets. A review whose request goes (a `replace` that drops its
// entry, its round leaving `confirms`, `forgetSession` of its session) is
// aborted and deleted, and an aborted review writes and logs nothing. At start
// it deletes the held reviews still `reviewing` and those whose request went,
// then reviews every request waiting with no review. `dispose` aborts every
// running review.
export function watchReviewRequests(
  deps: ReviewRequestDeps,
): { forgetSession(sessionId: string): void } & Disposable {
  const { chatSessions, chatEntries, confirms, reviews } = deps;
  const seen = new Set<string>();
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
    seen.add(key);
    startReview(key, sessionId, {
      toolName: entry.toolName,
      input: entry.input,
    });
  }

  function reviewConfirm(roundId: string, confirm: OpenConfirm) {
    const key = confirmReviewKey(roundId);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    startReview(key, confirm.sessionId, confirm.subject);
  }

  function drop(key: string) {
    running.get(key)?.();
    running.delete(key);
    reviews.delete(key);
    seen.delete(key);
  }

  // The chat keys of `sessionId`'s reviews, with each one's entry id.
  function chatKeysOf(sessionId: string): { key: string; entryId: string }[] {
    const prefix = chatReviewKey(sessionId, '');
    return [...seen]
      .filter((key) => key.startsWith(prefix))
      .map((key) => ({ key, entryId: key.slice(prefix.length) }));
  }

  function dropReviewsLeftBy(sessionId: string, items: readonly ChatEntry[]) {
    const keptIds = new Set(items.map(({ id }) => id));
    for (const { key, entryId } of chatKeysOf(sessionId)) {
      if (!keptIds.has(entryId)) {
        drop(key);
      }
    }
  }

  function isRequestOpen(key: string): boolean {
    if (key.startsWith(CONFIRM_KEY_PREFIX)) {
      return confirms.all().has(key.slice(CONFIRM_KEY_PREFIX.length));
    }
    const at = key.indexOf('/');
    const sessionId = key.slice(0, at);
    const entryId = key.slice(at + 1);
    const isChatSession = at !== -1 && chatSessions.all().has(sessionId);
    return (
      isChatSession &&
      chatEntries
        .get(sessionId)
        .some((entry) => entry.kind === 'permission' && entry.id === entryId)
    );
  }

  for (const [key, held] of reviews.all()) {
    const isHeldResult = held.state !== 'reviewing' && isRequestOpen(key);
    if (isHeldResult) {
      seen.add(key);
    } else {
      reviews.delete(key);
    }
  }
  for (const sessionId of chatSessions.all().keys()) {
    for (const entry of chatEntries.get(sessionId)) {
      reviewEntry(sessionId, entry);
    }
  }
  for (const [roundId, confirm] of confirms.all()) {
    reviewConfirm(roundId, confirm);
  }

  const listeners = [
    chatEntries.on((sessionId, change) => {
      if (change.kind === 'put') {
        reviewEntry(sessionId, change.item);
      } else if (change.kind === 'replace') {
        dropReviewsLeftBy(sessionId, change.items);
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
      for (const { key } of chatKeysOf(sessionId)) {
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
