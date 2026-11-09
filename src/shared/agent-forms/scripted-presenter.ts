import type {
  AgentFormListener,
  AgentFormPresenter,
  PresentedAgentForm,
} from '../../contracts/agent-forms';

// The test adapter: records what the service shows and closes, and plays the
// user's side through each shown form's listener.
export class ScriptedFormPresenter<Form, Body> implements AgentFormPresenter<
  Form,
  Body
> {
  readonly shown: PresentedAgentForm<Form, Body>[] = [];
  readonly closed: string[] = [];
  private readonly listeners = new Map<string, AgentFormListener<Body>>();

  show(
    form: PresentedAgentForm<Form, Body>,
    listener: AgentFormListener<Body>,
  ) {
    this.shown.push(form);
    this.listeners.set(form.formId, listener);
  }

  close(formId: string) {
    this.closed.push(formId);
  }

  // The form shown most recently.
  latest(): PresentedAgentForm<Form, Body> {
    const form = this.shown.at(-1);
    if (form === undefined) {
      throw new Error('No form has been shown');
    }
    return form;
  }

  draft(formId: string, body: Body) {
    this.listenerFor(formId).draft(body);
  }

  submit(formId: string, body: Body) {
    this.listenerFor(formId).finish({ kind: 'submitted', body });
  }

  cancel(formId: string, body: Body) {
    this.listenerFor(formId).finish({ kind: 'cancelled', body });
  }

  // The closing session's cancel, which ends the form with its saved answers.
  cancelHold(formId: string) {
    this.listenerFor(formId).cancel();
  }

  private listenerFor(formId: string): AgentFormListener<Body> {
    const listener = this.listeners.get(formId);
    if (listener === undefined) {
      throw new Error(`No form ${formId} was shown`);
    }
    return listener;
  }
}
