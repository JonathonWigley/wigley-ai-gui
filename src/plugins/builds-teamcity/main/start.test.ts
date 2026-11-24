import { describe, expect, it } from 'vitest';
import {
  fakeDependency,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { type BackendKind, buildsMainKey } from '../../builds/contract';
import { buildsTeamcityMainPart } from './start';

describe('buildsTeamcityMainPart', () => {
  it('adds the teamcity backend kind to builds', () => {
    const added: BackendKind[] = [];
    const builds = fakeDependency(buildsMainKey, () => ({
      addBackend: (kind: BackendKind) => {
        added.push(kind);
        return { dispose: () => undefined };
      },
    }));

    startMainPart(buildsTeamcityMainPart, { dependencies: [builds] });

    expect(added.map((kind) => kind.kind)).toEqual(['teamcity']);
  });
});
