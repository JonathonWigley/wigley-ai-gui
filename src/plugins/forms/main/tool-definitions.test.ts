import { describe, expect, it } from 'vitest';
import { FORMS_TOOLS } from './tool-definitions';

interface ItemsSchema {
  required: string[];
  additionalProperties: boolean;
  properties: Record<
    string,
    {
      type?: string;
      enum?: string[];
      default?: unknown;
      minItems?: number;
      maxItems?: number;
      items?: ItemsSchema;
    }
  >;
}

interface ArraySchema {
  type: string;
  maxItems: number;
  items: ItemsSchema;
}

interface AskRoundSchema {
  required: string[];
  properties: {
    layout: { type: string };
    questions: ArraySchema;
    findings: ArraySchema;
    notices: ArraySchema;
  };
}

interface CollectLastRoundSchema {
  required?: string[];
  properties: { wait: { type: string; default: unknown } };
}

function schemaOf(name: string): Record<string, unknown> {
  const tool = FORMS_TOOLS.find((each) => each.name === name);
  if (tool === undefined) {
    throw new Error(`FORMS_TOOLS has no ${name}`);
  }
  return tool.inputSchema;
}

function descriptionOf(name: string): string {
  return FORMS_TOOLS.find((each) => each.name === name)?.description ?? '';
}

const askRound = schemaOf('ask_round') as unknown as AskRoundSchema;
const collectLastRound = schemaOf(
  'collect_last_round',
) as unknown as CollectLastRoundSchema;

describe('FORMS_TOOLS', () => {
  it('publishes ask_round and collect_last_round', () => {
    expect(FORMS_TOOLS.map((tool) => tool.name)).toEqual([
      'ask_round',
      'collect_last_round',
    ]);
  });

  it('requires only heading and overview of ask_round', () => {
    expect(askRound.required).toEqual(['heading', 'overview']);
  });

  it('declares notices with title and context required and nothing else allowed', () => {
    const notices = askRound.properties.notices;

    expect(notices.type).toBe('array');
    expect(notices.items.required).toEqual(['title', 'context']);
    expect(notices.items.additionalProperties).toBe(false);
  });

  it('offers the badge as an optional closed set defaulting to Applied', () => {
    const notices = askRound.properties.notices;

    expect(notices.items.properties.badge.enum).toEqual([
      'Applied',
      'Dispatched',
      'Decided',
    ]);
    expect(notices.items.properties.badge.default).toBe('Applied');
    expect(notices.items.required).not.toContain('badge');
  });

  it('declares findings with every field but severity, recommend, layout and action_reasons required and nothing else allowed', () => {
    const findings = askRound.properties.findings;

    expect(findings.type).toBe('array');
    expect(findings.items.required).toEqual([
      'title',
      'origin',
      'impact',
      'finding',
      'proof',
      'choices',
      'recommend_action',
    ]);
    expect(findings.items.additionalProperties).toBe(false);
  });

  it('declares origin and severity as enums', () => {
    const properties = askRound.properties.findings.items.properties;

    expect(properties.origin.enum).toEqual([
      'caused',
      'pre_existing',
      'design',
      'nit',
    ]);
    expect(properties.severity.enum).toEqual([
      'critical',
      'important',
      'minor',
    ]);
  });

  it('declares each finding choice as text and reason with an optional action', () => {
    const choices = askRound.properties.findings.items.properties.choices;

    expect(choices.minItems).toBe(1);
    expect(choices.maxItems).toBe(10);
    expect(choices.items?.required).toEqual(['text', 'reason']);
    expect(choices.items?.additionalProperties).toBe(false);
    expect(choices.items?.properties.action.enum).toEqual([
      'fix_now',
      'follow_up',
      'leave_it',
    ]);
    expect(choices.items?.properties.action.default).toBe('fix_now');
  });

  it('declares action_reasons with only follow_up and leave_it', () => {
    const actionReasons = askRound.properties.findings.items.properties
      .action_reasons as unknown as ItemsSchema;

    expect(Object.keys(actionReasons.properties)).toEqual([
      'follow_up',
      'leave_it',
    ]);
    expect(actionReasons.additionalProperties).toBe(false);
  });

  it('declares an optional layout on the round and on every item kind', () => {
    const { properties } = askRound;
    const itemKinds = [
      properties.notices,
      properties.findings,
      properties.questions,
    ];

    expect(properties.layout.type).toBe('string');
    expect(askRound.required).not.toContain('layout');
    for (const kind of itemKinds) {
      expect(kind.items.properties.layout.type).toBe('string');
      expect(kind.items.required).not.toContain('layout');
    }
  });

  it('caps questions and findings at 20 and notices at 50', () => {
    expect(askRound.properties.questions.maxItems).toBe(20);
    expect(askRound.properties.findings.maxItems).toBe(20);
    expect(askRound.properties.notices.maxItems).toBe(50);
  });

  it('describes the Notes box, never the what and why boxes', () => {
    expect(descriptionOf('ask_round')).toContain('the Notes box');
    expect(descriptionOf('ask_round')).not.toContain("'what'");
  });

  it('sends review findings that need a decision to findings', () => {
    expect(descriptionOf('ask_round')).toContain(
      "Use 'findings' for review findings that need the user's decision",
    );
  });

  it("names each card's origins and action words", () => {
    expect(descriptionOf('ask_round')).toContain(
      'a Defect (caused or pre_existing; actions Fix now, Follow-up, Leave ' +
        'it), a Decision (design; actions Decide now, Plan it, Drop it) or a ' +
        'Nit (nit; actions Fix anyway, Leave it).',
    );
  });

  it('describes choices grouped under their actions, with header picks', () => {
    const description = descriptionOf('ask_round');

    expect(description).toContain(
      'A card shows the finding and a brief proof, then a verdict',
    );
    expect(description).toContain(
      'an action with no choices shows as a header the user picks alone',
    );
    expect(description).toContain('One pick sets the choice and its action.');
  });

  it('never describes an action control', () => {
    expect(descriptionOf('ask_round')).not.toContain('action control');
  });

  it('describes round and item layouts and the unknown-name failure', () => {
    expect(descriptionOf('ask_round')).toContain(
      'A name the folder lacks fails the call with the names it holds.',
    );
  });

  it('says a header pick answers with choice 0', () => {
    expect(descriptionOf('ask_round')).toContain(
      '0 when the user picked an action with no choices.',
    );
  });

  it('sends needs_manual_open back to ask_round, never collect_last_round', () => {
    expect(descriptionOf('ask_round')).toContain(
      "Outcome 'needs_manual_open' means the relay could not start the app",
    );
    expect(descriptionOf('collect_last_round')).not.toContain(
      'needs_manual_open',
    );
  });

  it('sends a round queued past its deadline back to ask_round', () => {
    expect(descriptionOf('ask_round')).toContain(
      'the round was not opened: send it again with ask_round, not collect_last_round.',
    );
  });

  it('gives collect_last_round one optional wait flag defaulting to true', () => {
    expect(collectLastRound.required).toBeUndefined();
    expect(collectLastRound.properties.wait).toMatchObject({
      type: 'boolean',
      default: true,
    });
  });
});
