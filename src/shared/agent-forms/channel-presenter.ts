import type {
  AgentFormChannel,
  AgentFormListener,
  AgentFormPresenter,
  AgentFormSessions,
  PresentedAgentForm,
} from '../../contracts/agent-forms';
import type { Alerts } from '../../contracts/alerts';
import type { Log } from '../../contracts/log';
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
}

// Shows forms on the page over the type's channel, each marked on its
// session's row; keeps that row from closing while the form is open and
// releases it when the form closes. Registers its channel handlers and close guard once, so it lives as long as
// the app. `source` is the open count's source and the log's; `announceTitle`
// titles each form's notification.
export function createAgentFormChannelPresenter<Form, Body>(deps: {
  channel: Pick<MainChannel<AgentFormChannel<Form, Body>>, 'handle' | 'send'>;
  alerts: Alerts;
  source: string;
  announceTitle: string;
  window: { show(): void };
  log: Log;
  sessions: AgentFormSessions;
}): AgentFormChannelPresenter<Form, Body> {
  const { channel, alerts, source, announceTitle, window, log, sessions } =
    deps;
  const open = new Map<string, OpenForm<Form, Body>>();
  const updateOpenCount = () =>
    alerts.setOpenCount(
      source,
      [...open.values()].filter((entry) => !entry.quiet).length,
    );
  const hasOpenForm = (sessionId: string) =>
    [...open.values()].some((entry) => entry.form.sessionId === sessionId);

  // The form whose `finish` the page invoked, while that handler runs.
  let finishingFormId: string | null = null;

  sessions.addCloseGuard((sessionId) => !hasOpenForm(sessionId));

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
    sessions.mark(form.sessionId);
    channel.send('formShown', form);
    log(source, `form shown: ${form.label}`);
    if (quiet) {
      return;
    }
    updateOpenCount();
    // A notification click is the user's own act, so it selects the form's
    // session and brings the window forward.
    alerts.announce(announceTitle, form.label, () => {
      sessions.activate(form.sessionId);
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
  };
}
