import type {
  AgentFormOwner,
  AgentFormService,
  AgentFormSession,
} from '../../contracts/agent-forms';
import type { Log } from '../../contracts/log';
import { errorText } from '../error-text';

// The preview's session as the sessions plugin connects it; `end` removes its
// row. The sessions plugin's `ConnectedSession` satisfies it.
export interface PreviewConnection {
  session: AgentFormOwner;
  end(): void;
}

// `session` is what the preview's session connects with (the sessions
// plugin's `SessionInfo`). `forms` is a service of the preview's own, whose
// forms raise no alert and write no file. `logSource` and `noun` name the
// form type in the log: `preview <noun> failed`.
export interface AgentFormPreviewDeps<Info, Payload> {
  session: Info;
  sessions: {
    connect(info: Info): PreviewConnection;
    activate(sessionId: string): void;
  };
  forms: AgentFormService<Payload>;
  log: Log;
  logSource: string;
  noun: string;
}

// A sample form type's layout preview, in a session of its own. A send or
// cancel ends the session, and the next `show` connects it again; a draft
// (the deadline passed) waits on.
export interface AgentFormPreview {
  // Selects the preview's row, connecting its session first when none is
  // open; true when this call connected it.
  show(): boolean;
  // Opens `args` in the preview's session, aborting the form the last `ask`
  // opened, whose answer is then ignored. Throws before a `show`.
  ask(args: unknown): void;
}

interface OpenPreview<Payload> {
  connected: PreviewConnection;
  form: AgentFormSession<Payload>;
  // Aborting it closes the form the last ask opened.
  asking: AbortController;
}

export function createAgentFormPreview<
  Info,
  Payload extends { outcome: string },
>(deps: AgentFormPreviewDeps<Info, Payload>): AgentFormPreview {
  let preview: OpenPreview<Payload> | null = null;

  const end = (ended: OpenPreview<Payload>) => {
    if (preview === ended) {
      preview = null;
    }
    ended.form.end();
    ended.connected.end();
  };

  const settle = (
    shown: OpenPreview<Payload>,
    signal: AbortSignal,
    answer: Promise<Payload>,
  ) => {
    answer.then(
      (payload) => {
        if (signal.aborted) {
          return;
        }
        if (payload.outcome === 'draft') {
          settle(shown, signal, shown.form.collect(true, signal));
          return;
        }
        end(shown);
      },
      (error: unknown) => {
        if (signal.aborted) {
          return;
        }
        deps.log(
          deps.logSource,
          `preview ${deps.noun} failed: ${errorText(error)}`,
        );
        end(shown);
      },
    );
  };

  return {
    show() {
      let isConnecting = false;
      if (preview === null) {
        isConnecting = true;
        const connected = deps.sessions.connect(deps.session);
        preview = {
          connected,
          form: deps.forms.startSession(connected.session),
          asking: new AbortController(),
        };
      }
      deps.sessions.activate(preview.connected.session.id);
      return isConnecting;
    },
    ask(args) {
      if (preview === null) {
        throw new Error(`preview ${deps.noun} asked before show`);
      }
      preview.asking.abort();
      const asking = new AbortController();
      preview.asking = asking;
      settle(
        preview,
        asking.signal,
        preview.form.open(args, null, asking.signal),
      );
    },
  };
}
