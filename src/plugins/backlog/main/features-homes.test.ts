import { describe, expect, it } from 'vitest';
import { inRepoHomeParts, templateProblem } from './features-homes';

describe('features-home templates', () => {
  // `parts`: the in-repo folder parts, null for a template of no in-repo shape.
  it.each<{ template: string; parts: string[] | null; isRefused: boolean }>([
    {
      template: '{repo}/docs/features',
      parts: ['docs', 'features'],
      isRefused: false,
    },
    { template: '{repo}/./notes/', parts: ['notes'], isRefused: false },
    { template: '~/wigley-features/{name}', parts: null, isRefused: false },
    { template: '/srv/features/{name}', parts: null, isRefused: false },
    { template: 'docs/features', parts: null, isRefused: true },
    { template: '{repo}/../x', parts: null, isRefused: true },
    { template: '{repo}/', parts: null, isRefused: true },
    { template: '{repo}/{name}', parts: null, isRefused: true },
    { template: 'wigley-features/{name}', parts: null, isRefused: true },
    { template: '~/x/{name}/y', parts: null, isRefused: true },
    { template: '~/{name}', parts: null, isRefused: true },
  ])(
    'template $template reads as in-repo $parts, refused $isRefused',
    ({ template, parts, isRefused }) => {
      expect({
        parts: inRepoHomeParts([template]),
        isRefused: templateProblem(template) !== null,
      }).toEqual({ parts: parts === null ? [] : [parts], isRefused });
    },
  );

  it('templateProblem_RefusedTemplate_NamesItAndBothShapes', () => {
    expect(templateProblem('docs/features')).toBe(
      '"docs/features" is neither {repo}/<folder> nor <folder>/{name}',
    );
  });

  it('inRepoHomeParts_MixedList_EachInRepoTemplateInOrder', () => {
    const homes = [
      '~/b/{name}',
      '{repo}/docs/features',
      'bad',
      '{repo}/notes',
      '/a/{name}',
    ];

    expect(inRepoHomeParts(homes)).toEqual([['docs', 'features'], ['notes']]);
  });
});
