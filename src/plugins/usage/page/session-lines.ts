import { callEach } from '../../../shared/call-each';
import type { UsageLinePart, UsageSnapshot } from '../contract';
import type { RowLineInput, SessionLineInput } from '../layouts/layout';
import type { Drawn, UsageParts } from './layout/usage-parts';
import {
  rowLineInput,
  rowLineText,
  sessionLineInput,
  sessionLineText,
} from './usage-view-model';

// Which usage line a host's part draws: `input` reads a session's input from a
// snapshot, the zero line while it has no usage; `text` is the input as the
// page log writes it; `draw` draws it through usage's layout.
export interface SessionLineKind<I> {
  input(snapshot: UsageSnapshot, sessionId: string, now: number): I;
  text(input: I): string;
  draw(parent: HTMLElement, input: I): Drawn;
}

// The full session line: context, cache and spend.
export function sessionLineKind(
  parts: Pick<UsageParts, 'sessionLine'>,
): SessionLineKind<SessionLineInput> {
  return {
    input: sessionLineInput,
    text: sessionLineText,
    draw: (parent, input) => parts.sessionLine(parent, input),
  };
}

// The side-bar row's line: context alone.
export function rowLineKind(
  parts: Pick<UsageParts, 'rowLine'>,
): SessionLineKind<RowLineInput> {
  return {
    input: rowLineInput,
    text: rowLineText,
    draw: (parent, input) => parts.rowLine(parent, input),
  };
}

// `id` is the part's id on its host's surface; `line` the line it draws.
// `nameOf` is a session's name in the log, its side-bar label, or its id while
// none is known. `latest` is the page's last snapshot and the time to draw it
// at, null until the first snapshot lands.
export interface SessionLinesDeps<I> {
  id: string;
  line: SessionLineKind<I>;
  log: (line: string) => void;
  nameOf(sessionId: string): string;
  latest(): { snapshot: UsageSnapshot; now: number } | null;
}

// `part` draws a session's usage line into the wrapper its host hands it (a
// Chat status line, a tab bar or a side-bar row), the zero line while the
// session has no usage.
// `redraw` draws every held session's line again from `latest`, nothing before
// the first snapshot; `forget` drops a session that left.
export interface SessionLines {
  part: UsageLinePart;
  redraw(): void;
  forget(sessionId: string): void;
}

// A wrapper the host handed `part.build`, and the line drawn into it last.
interface HeldWrapper {
  wrapper: HTMLElement;
  line: Drawn | null;
}

// Each session's logged text outlives its wrapper, which a host redraw builds
// and disposes many times. After each draw it logs
// `session line in <name>: <text>` when the text differs from the last one
// logged for that session, so a session's first draw always logs and a host
// redraw or a name change alone logs nothing new.
export function createSessionLines<I>(deps: SessionLinesDeps<I>): SessionLines {
  const held = new Map<string, HeldWrapper>();
  const loggedTexts = new Map<string, string>();

  const logText = (sessionId: string, text: string) => {
    if (text === loggedTexts.get(sessionId)) {
      return;
    }
    loggedTexts.set(sessionId, text);
    deps.log(`session line in ${deps.nameOf(sessionId)}: ${text}`);
  };

  // Draws the line again, the last draw disposed first.
  const draw = (
    sessionId: string,
    holder: HeldWrapper,
    snapshot: UsageSnapshot,
    now: number,
  ) => {
    const input = deps.line.input(snapshot, sessionId, now);
    const last = holder.line;
    holder.line = null;
    callEach<() => void>(
      [
        () => last?.dispose(),
        () => {
          holder.line = deps.line.draw(holder.wrapper, input);
        },
      ],
      (step) => step(),
    );
    logText(sessionId, deps.line.text(input));
  };

  return {
    part: {
      id: deps.id,
      build(wrapper, sessionId) {
        const holder: HeldWrapper = { wrapper, line: null };
        held.set(sessionId, holder);
        const latest = deps.latest();
        if (latest !== null) {
          draw(sessionId, holder, latest.snapshot, latest.now);
        }
        return {
          dispose() {
            if (held.get(sessionId) === holder) {
              held.delete(sessionId);
            }
            const line = holder.line;
            holder.line = null;
            line?.dispose();
          },
        };
      },
    },
    redraw() {
      const latest = deps.latest();
      if (latest === null) {
        return;
      }
      callEach([...held], ([sessionId, holder]) =>
        draw(sessionId, holder, latest.snapshot, latest.now),
      );
    },
    forget(sessionId) {
      held.delete(sessionId);
      loggedTexts.delete(sessionId);
    },
  };
}
