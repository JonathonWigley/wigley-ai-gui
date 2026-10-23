import { describe, expect, it } from 'vitest';
import {
  argumentFailures,
  cssViolations,
  inlineStyleViolations,
} from './style-rules.mts';

describe('cssViolations', () => {
  it('cssViolations_RemPadding_ReportsEachLength', () => {
    const css = '.a {\n  color: var(--wg-fg);\n  padding: 0.5rem 0.9rem;\n}';
    expect(cssViolations(css, false)).toEqual([
      { line: 3, rule: 'raw-length', text: '0.5rem in padding: 0.5rem 0.9rem' },
      { line: 3, rule: 'raw-length', text: '0.9rem in padding: 0.5rem 0.9rem' },
    ]);
  });

  it('cssViolations_AllowedValues_ReportsNothing', () => {
    const css =
      '.a { margin: 0; border: 1px solid var(--wg-border-subtle); top: -1px; width: 50%; grid-template-columns: 1fr auto; height: 100vh; gap: calc(var(--wg-space-2) * 2); }';
    expect(cssViolations(css, false)).toEqual([]);
  });

  it('cssViolations_TokenNameWithDigits_ReportsNothing', () => {
    const css =
      '.a { font-size: var(--wg-text-13); padding: var(--wg-space-0_5); }';
    expect(cssViolations(css, false)).toEqual([]);
  });

  it('cssViolations_MediaQueryLength_ReportsNothing', () => {
    const css = '@media (max-width: 800px) { .a { color: var(--wg-fg); } }';
    expect(cssViolations(css, false)).toEqual([]);
  });

  it('cssViolations_WhereSelector_ReportsNothing', () => {
    const css =
      ':where(.form-tab) .choice {\n  padding: var(--wg-space-1) 0;\n}\n';
    expect(cssViolations(css, false)).toEqual([]);
  });

  it('cssViolations_HexInIdSelector_ReportsNothing', () => {
    expect(cssViolations('#add { color: var(--wg-fg); }', false)).toEqual([]);
  });

  it('cssViolations_RawColours_ReportsEach', () => {
    const css =
      '.a { color: #fff; background: rgb(0 0 0 / 0.5); border-color: red; }';
    const violations = cssViolations(css, false);
    expect(violations.map((violation) => violation.rule)).toEqual([
      'raw-colour',
      'raw-colour',
      'raw-colour',
    ]);
    expect(violations[0].text.startsWith('#fff')).toBe(true);
    expect(violations[1].text.startsWith('rgb(')).toBe(true);
    expect(violations[2].text.startsWith('red')).toBe(true);
  });

  it('cssViolations_NamedColourWordOutsideColourProperty_ReportsNothing', () => {
    expect(cssViolations('.a { grid-area: tan; }', false)).toEqual([]);
  });

  it('cssViolations_ColorMixOfTokens_ReportsNothing', () => {
    const css =
      '.a { color: color-mix(in srgb, var(--wg-fg) 50%, transparent); }';
    expect(cssViolations(css, false)).toEqual([]);
  });

  it('cssViolations_RawDuration_Reports', () => {
    expect(
      cssViolations('.a { transition: opacity 120ms ease; }', false),
    ).toEqual([
      {
        line: 1,
        rule: 'raw-duration',
        text: '120ms in transition: opacity 120ms ease',
      },
    ]);
  });

  it('cssViolations_UpperCaseDuration_Reports', () => {
    expect(
      cssViolations('.a { transition: opacity 200MS ease; }', false),
    ).toEqual([
      {
        line: 1,
        rule: 'raw-duration',
        text: '200MS in transition: opacity 200MS ease',
      },
    ]);
  });

  it('cssViolations_NegativeLength_Reports', () => {
    expect(cssViolations('.a { margin-top: -4px; }', false)).toEqual([
      { line: 1, rule: 'raw-length', text: '-4px in margin-top: -4px' },
    ]);
  });

  it('cssViolations_QuotedStringHoldsRawValue_ReportsNothing', () => {
    expect(cssViolations('.a { content: "12px 200ms"; }', false)).toEqual([]);
  });

  it('cssViolations_UrlHoldsRawValue_ReportsNothing', () => {
    expect(
      cssViolations('.a { background-image: url(12px.svg); }', false),
    ).toEqual([]);
  });

  it('cssViolations_LineAfterMultiLineUrl_CountsLines', () => {
    const css = '.a {\n  background: url(\n    a.svg\n  );\n  gap: 4px;\n}';
    const violations = cssViolations(css, false);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ line: 5, rule: 'raw-length' });
  });

  it('cssViolations_ZeroDuration_ReportsNothing', () => {
    expect(cssViolations('.a { transition-delay: 0s; }', false)).toEqual([]);
  });

  it('cssViolations_FontStack_Reports', () => {
    const violations = cssViolations(
      '.a { font-family: "Inter", sans-serif; }',
      false,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ line: 1, rule: 'font-stack' });
  });

  it('cssViolations_SingleFamilyOrToken_ReportsNothing', () => {
    const css =
      '.a { font-family: codicon; } .b { font-family: var(--wg-font-mono); }';
    expect(cssViolations(css, false)).toEqual([]);
  });

  it('cssViolations_BackdropFilterNotAllowed_Reports', () => {
    const css = '.a { backdrop-filter: var(--wg-material-chrome-filter); }';
    const violations = cssViolations(css, false);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('backdrop-filter');
  });

  it('cssViolations_BackdropFilterAllowed_ReportsNothing', () => {
    const css = '.a { backdrop-filter: var(--wg-material-chrome-filter); }';
    expect(cssViolations(css, true)).toEqual([]);
  });

  it('cssViolations_CommentHoldsRawValue_ReportsNothing', () => {
    expect(
      cssViolations('/* 12px gutters */\n.a { margin: 0; }', false),
    ).toEqual([]);
  });

  it('cssViolations_LineAfterMultiLineComment_CountsLines', () => {
    const violations = cssViolations('/* a\nb */\n.a {\n  gap: 4px;\n}', false);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ line: 4, rule: 'raw-length' });
  });
});

describe('inlineStyleViolations', () => {
  it('inlineStyleViolations_TemplateRemLength_Reports', () => {
    expect(
      inlineStyleViolations('a.ts', 'el.style.paddingLeft = `${depth}rem`;'),
    ).toEqual([
      { line: 1, rule: 'raw-length', text: '9rem in padding-left: 9rem' },
    ]);
  });

  it('inlineStyleViolations_TemplatePercent_ReportsNothing', () => {
    expect(
      inlineStyleViolations('a.ts', 'el.style.width = `${share}%`;'),
    ).toEqual([]);
  });

  it('inlineStyleViolations_CustomPropertySetProperty_ReportsNothing', () => {
    const source =
      "root.style.setProperty('--wg-status-bar-height', `${h}px`);";
    expect(inlineStyleViolations('a.ts', source)).toEqual([]);
  });

  it('inlineStyleViolations_StandardPropertySetProperty_Reports', () => {
    const violations = inlineStyleViolations(
      'a.ts',
      "el.style.setProperty('margin-top', '4px');",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('raw-length');
  });

  it('inlineStyleViolations_CssText_ReportsEach', () => {
    const violations = inlineStyleViolations(
      'a.ts',
      "el.style.cssText = 'color: #000; gap: 8px';",
    );
    expect(violations.map((violation) => violation.rule)).toEqual([
      'raw-colour',
      'raw-length',
    ]);
  });

  it('inlineStyleViolations_SetAttributeStyle_Reports', () => {
    expect(
      inlineStyleViolations('a.ts', "el.setAttribute('style', 'gap: 8px');"),
    ).toEqual([{ line: 1, rule: 'raw-length', text: '8px in gap: 8px' }]);
  });

  it('inlineStyleViolations_StyleAssignment_Reports', () => {
    expect(inlineStyleViolations('a.ts', "el.style = 'margin: 4px';")).toEqual([
      { line: 1, rule: 'raw-length', text: '4px in margin: 4px' },
    ]);
  });

  it('inlineStyleViolations_WebkitBackdropFilter_Reports', () => {
    const violations = inlineStyleViolations(
      'a.ts',
      "el.style.webkitBackdropFilter = 'var(--wg-material-chrome-filter)';",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      line: 1,
      rule: 'backdrop-filter',
    });
  });

  it('inlineStyleViolations_NonLiteralValue_ReportsNothing', () => {
    expect(
      inlineStyleViolations('a.ts', 'el.style.width = widthOf(row);'),
    ).toEqual([]);
  });
});

describe('argumentFailures', () => {
  it('argumentFailures_AnyArgument_FailsEach', () => {
    expect(argumentFailures(['--no-legacy', 'src/a.css'])).toEqual([
      'check-styles: unknown argument --no-legacy',
      'check-styles: unknown argument src/a.css',
    ]);
  });

  it('argumentFailures_NoArguments_ReportsNothing', () => {
    expect(argumentFailures([])).toEqual([]);
  });
});
