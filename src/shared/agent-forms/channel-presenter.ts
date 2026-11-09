import type {
  AgentFormChannel,
  AgentFormListener,
  AgentFormPresenter,
  AgentFormSessions,
  PresentedAgentForm,
} from '../../contracts/agent-forms';
import type { Alerts } from '../../contracts/alerts';
import type { PluginLog } from '../../contracts/log';
import type { MainChannel } from '../../contracts/plugin';

interface OpenForm<Form, Body> {
  form: PresentedAgentForm<Form, Body>;
  listener: AgentFormListener<Body>;
  // A quiet form raises no alert and leaves the open count.
  quiet: boolean;
}

// The presenter that announces each form and counts it open, and `quiet`,
// a view onto the same open forms whose own forms do neither.
export interface AgentFormChannelPresenter<
  Form,
  Body,
> extends AgentFormPresenter<Form, Body> {
  quiet: AgentFormPresenter<Form, Body>;
  // The refusal for the first open form that is not quiet, in the order the
  // forms were shown, or null. It only reads.
  mayStop(): string | null;
}

// Shows forms on the page over the type's channel, each marked on its
// session's row with `markText` of the row's label and `markAction`; refuses
// that row's close while the form is open, cancels the form when the close key
// closes the session at once, and releases the row when the form closes.
// Registers its channel handlers and close guard once, which the plugin's stop
// removes. `source` names only the alert open count; `announceTitle` titles
// each form's notification; `noun` names one form in the refusal, which a
// close and a switch-off read alike.
export function createAgentFormChannelPresenter<Form, Body>(deps: {
  channel: Pick<MainChannel<AgentFormChannel<Form, Body>>, 'handle' | 'send'>;
  alerts: Alerts;
  source: string;
  announceTitle: string;
  noun: string;
  markText(label: string): string;
  markAction: string;
  window: { show(): void };
  log: PluginLog;
  sessions: AgentFormSessions;
}): AgentFormChannelPresenter<Form, Body> {
  const {
    channel,
    alerts,
    source,
    announceTitle,
    noun,
    window,
    log,
    sessions,
  } = deps;
  const open = new Map<string, OpenForm<Form, Body>>();
  const updateOpenCount = () =>
    alerts.setOpenCount(
      source,
      [...open.values()].filter((entry) => !entry.quiet).length,
    );
  const openFormsOf = (sessionId: string) =>
    [...open.values()].filter((entry) => entry.form.sessionId === sessionId);

  // The form whose `finish` the page invoked, while that handler runs.
  let finishingFormId: string | null = null;

  const refusalFor = (held: OpenForm<Form, Body> | undefined) =>
    held === undefined
      ? null
      : `Finish or cancel ${held.form.label}'s ${noun} first`;
  const refusal = (sessionId: string) => refusalFor(openFormsOf(sessionId)[0]);
  // Not a finish, so the page drops each form quietly.
  const cancelHold = (sessionId: string) => {
    for (const entry of openFormsOf(sessionId)) {
      log(`closing the session cancels ${entry.form.label}`);
      entry.listener.cancel();
      close(entry.form.formId);
    }
  };
  sessions.addCloseGuard(refusal, cancelHold);

  channel.handle('openForms', () =>
    [...open.values()].map((entry) => entry.form),
  );
  // A failed write throws out of the listener, which rejects the page's invoke.
  channel.handle('draft', (formId, body) => {
    const entry = open.get(formId);
    if (!entry) {
      return;
    }
    entry.form = { ...entry.form, draft: body };
    entry.listener.draft(body);
  });
  // A listener that throws leaves the form open and rejects the page's invoke.
  // The close this finish makes reaches the page marked `byFinish`.
  channel.handle('finish', (formId, end) => {
    const entry = open.get(formId);
    if (!entry) {
      return;
    }
    finishingFormId = formId;
    try {
      entry.listener.finish(end);
      close(formId);
    } finally {
      finishingFormId = null;
    }
  });

  const show = (
    form: PresentedAgentForm<Form, Body>,
    listener: AgentFormListener<Body>,
    quiet: boolean,
  ) => {
    open.set(form.formId, { form, listener, quiet });
    sessions.mark(form.sessionId, {
      text: deps.markText(sessions.label(form.sessionId) ?? form.label),
      action: deps.markAction,
    });
    channel.send('formShown', form);
    log(`form shown: ${form.label}`);
    if (quiet) {
      return;
    }
    updateOpenCount();
    // A notification click is the user's own act, so it selects the form's
    // session's row, when the session still holds one, and brings the window
    // forward.
    alerts.announce(announceTitle, form.label, () => {
      sessions.activateExistingRow(form.sessionId);
      window.show();
    });
  };
  const close = (formId: string) => {
    const entry = open.get(formId);
    if (!entry) {
      return;
    }
    open.delete(formId);
    channel.send('formClosed', {
      formId,
      byFinish: formId === finishingFormId,
    });
    if (!entry.quiet) {
      updateOpenCount();
    }
    sessions.release(entry.form.sessionId);
  };

  return {
    show: (form, listener) => show(form, listener, false),
    close,
    quiet: {
      show: (form, listener) => show(form, listener, true),
      close,
    },
    mayStop: () => refusalFor([...open.values()].find((entry) => !entry.quiet)),
  };
}
