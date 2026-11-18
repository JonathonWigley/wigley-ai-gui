import type {
  AgentFormOwner,
  AgentFormService,
} from '../../contracts/agent-forms';
import type { Disposable } from '../../contracts/disposable';
import { createAgentFormPreview } from './agent-form-preview';

// `forms` is a form type's sample service: a memory store, the quiet
// presenter and no wake, so a sample saves no form and wakes no session.
// `activate` selects a session's row; `noun` names the form type in the log:
// `<noun> sample closed: <outcome>`.
export interface SampleFormDeps<Payload> {
  forms: AgentFormService<Payload>;
  activate(sessionId: string): void;
  log: (line: string) => void;
  noun: string;
}

// The owner of a demo step's sample form: the demo session by its app id, with
// no host session or project folder.
export function sampleFormOwner(sessionId: string): AgentFormOwner {
  return { id: sessionId, info: { sessionId: null, projectDir: null } };
}

// Opens `args` once as a sample form in `owner`'s session, which already has
// its row, so no row is connected. A draft collects again; a submit or a
// cancel ends the form and logs its outcome. Dispose ends an open form and
// does nothing on an ended one.
export function openSampleForm<Payload extends { outcome: string }>(
  deps: SampleFormDeps<Payload>,
  owner: AgentFormOwner,
  args: unknown,
): Disposable {
  let isDisposed = false;
  // Logs a final answer the preview acts on; the preview handles a rejection.
  const loggingFinal = (answer: Promise<Payload>): Promise<Payload> => {
    answer.then(
      (payload) => {
        if (!isDisposed && payload.outcome !== 'draft') {
          deps.log(`${deps.noun} sample closed: ${payload.outcome}`);
        }
      },
      () => undefined,
    );
    return answer;
  };
  const forms: AgentFormService<Payload> = {
    startSession: (formOwner) => {
      const session = deps.forms.startSession(formOwner);
      return {
        open: (formArgs, toolUseId, signal) =>
          loggingFinal(session.open(formArgs, toolUseId, signal)),
        collect: (wait, signal) => loggingFinal(session.collect(wait, signal)),
        end: () => session.end(),
      };
    },
    detach: () => deps.forms.detach(),
  };
  const preview = createAgentFormPreview({
    session: owner,
    sessions: {
      connect: () => ({ session: owner, end() {} }),
      activate: deps.activate,
    },
    forms,
    log: deps.log,
    noun: deps.noun,
  });
  preview.show();
  preview.ask(args);
  return {
    dispose() {
      isDisposed = true;
      preview.dispose();
    },
  };
}
