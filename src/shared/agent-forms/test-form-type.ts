import type { AgentFormType } from '../../contracts/agent-forms';
import { isJsonObject, isStringArray } from '../json';

// The form type the shared lifecycle's tests run on: a heading and a list of
// items, answered with one note.

export const TEST_FORM_ERROR_NAME = 'TestFormError';

export interface TestForm {
  heading: string;
  items: string[];
}

export interface TestBody {
  note: string;
}

export interface TestPayload {
  outcome: string;
  heading: string;
  note: string;
  earlier_heading?: string;
  notShown?: true;
  blockingHeading?: string | null;
}

export function testFormError(message: string): Error {
  const error = new Error(message);
  error.name = TEST_FORM_ERROR_NAME;
  return error;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function parseTestForm(args: unknown): TestForm {
  const fields = isJsonObject(args) ? args : {};
  if (!isNonBlankString(fields.heading)) {
    throw testFormError('heading must be a non-blank string');
  }
  const items = fields.items;
  if (!isStringArray(items) || items.length === 0) {
    throw testFormError('items must be a non-empty array of strings');
  }
  return { heading: fields.heading, items };
}

function testPayload(
  form: TestForm,
  outcome: string,
  body: TestBody,
): TestPayload {
  return { outcome, heading: form.heading, note: body.note };
}

export const TEST_FORM_TYPE: AgentFormType<TestForm, TestBody, TestPayload> = {
  openTool: 'open_form',
  collectTool: 'collect_last_form',
  noun: 'form',
  // The prefix shows a test that the shared code words an args error with
  // this text, not the error's message.
  argsErrorText: (error) =>
    error instanceof Error && error.name === TEST_FORM_ERROR_NAME
      ? `Bad form: ${error.message}`
      : null,
  parse: parseTestForm,
  // A re-send under a reworded heading matches, as a round's does.
  fingerprint: (form) => form.items.join('\n'),
  heading: (form) => form.heading,
  savedHeading: (args) => {
    const heading = isJsonObject(args) ? args.heading : undefined;
    return isNonBlankString(heading) ? heading : null;
  },
  readBody: (_form, raw) => {
    const note = isJsonObject(raw) ? raw.note : undefined;
    return { note: typeof note === 'string' ? note : '' };
  },
  // The prefix shows a test which `finished` the service passed.
  prefill: (_form, saved, finished) => ({
    note: finished ? `finished: ${saved.note}` : saved.note,
  }),
  payload: testPayload,
  handedBackPayload: (form, outcome, body) => ({
    ...testPayload(form, outcome, body),
    earlier_heading: form.heading,
  }),
  noFormPayload: () => ({ outcome: 'no_form', heading: '', note: '' }),
  notShownPayload: (form, blockingHeading) => ({
    outcome: 'draft',
    heading: form.heading,
    note: '',
    notShown: true,
    blockingHeading,
  }),
};
