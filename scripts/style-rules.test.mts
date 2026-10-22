import { describe, expect, it } from 'vitest';
import {
  cssViolations,
  inlineStyleViolations,
  legacyListProblems,
  parseStyleArguments,
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

describe('legacyListProblems', () => {
  it('legacyListProblems_ForbiddenFolder_Fails', () => {
    const file = 'src/shared/page/ui/row.css';
    expect(legacyListProblems([file], new Set([file]), new Set())).toEqual({
      failures: [
        'src/shared/page/ui/row.css: may not be on the legacy list; fix it instead',
      ],
      notes: [],
    });
  });

  it('legacyListProblems_MissingFile_Fails', () => {
    const problems = legacyListProblems(
      ['src/plugins/gone/page/gone.css'],
      new Set(),
      new Set(),
    );
    expect(problems.failures).toEqual([
      'src/plugins/gone/page/gone.css: on the legacy list but not in src; remove it from the legacy list',
    ]);
  });

  it('legacyListProblems_ListedFileThatPasses_Notes', () => {
    const file = 'src/plugins/docs/page/docs.css';
    expect(legacyListProblems([file], new Set([file]), new Set())).toEqual({
      failures: [],
      notes: [
        'src/plugins/docs/page/docs.css: on the legacy list but passes every rule',
      ],
    });
    expect(
      legacyListProblems([file], new Set([file]), new Set([file])),
    ).toEqual({ failures: [], notes: [] });
  });
});

describe('parseStyleArguments', () => {
  it('parseStyleArguments_NoLegacyWithPaths_KeepsThePaths', () => {
    expect(
      parseStyleArguments(['--no-legacy', 'src/a.css'], new Set(['src/a.css'])),
    ).toEqual({ ignoreLegacy: true, paths: ['src/a.css'], failures: [] });
  });

  it('parseStyleArguments_NoLegacyAlone_JudgesEveryFile', () => {
    expect(parseStyleArguments(['--no-legacy'], new Set())).toEqual({
      ignoreLegacy: true,
      paths: [],
      failures: [],
    });
  });

  it('parseStyleArguments_PathOutsideSrcOrMissing_Fails', () => {
    const parsed = parseStyleArguments(
      ['--no-legacy', 'README.md', 'src/nope.css'],
      new Set(),
    );
    expect(parsed.failures).toEqual([
      'check-styles: README.md is not under src/',
      'check-styles: src/nope.css is not a checked file in src',
    ]);
  });

  it('parseStyleArguments_PathWithoutFlagOrUnknownFlag_Fails', () => {
    const filesInSrc = new Set(['src/a.css']);
    expect(parseStyleArguments(['src/a.css'], filesInSrc).failures).toEqual([
      'check-styles: unknown argument src/a.css',
    ]);
    expect(parseStyleArguments(['--verbose'], filesInSrc).failures).toEqual([
      'check-styles: unknown argument --verbose',
    ]);
  });
});
