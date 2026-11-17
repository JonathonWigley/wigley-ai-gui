import { describe, expect, it } from 'vitest';
import { readAccountStatus, signInLink } from './claude-auth';

describe('readAccountStatus', () => {
  it('readAccountStatus_SignedIn_LabelsEmailAndPlan', () => {
    const stdout = JSON.stringify({
      loggedIn: true,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
      email: 'jo@example.com',
      orgName: 'Jo',
      subscriptionType: 'max',
      configDirectory: '/Users/jo/.claude',
    });

    const status = readAccountStatus(`${stdout}\n`);

    expect(status.signedIn).toBe(true);
    expect(status.account).toContain('jo@example.com');
    expect(status.account).toContain('max');
  });

  it('readAccountStatus_SignedInNoPlan_LabelsEmail', () => {
    const stdout = JSON.stringify({ loggedIn: true, email: 'jo@example.com' });

    expect(readAccountStatus(stdout)).toEqual({
      signedIn: true,
      account: 'jo@example.com',
    });
  });

  it('readAccountStatus_SignedOut_NullAccount', () => {
    const stdout = JSON.stringify({
      loggedIn: false,
      authMethod: 'none',
      apiProvider: 'firstParty',
      configDirectory: '/Users/jo/.claude-work',
    });

    expect(readAccountStatus(stdout)).toEqual({
      signedIn: false,
      account: null,
    });
  });

  it('readAccountStatus_NotJson_Throws', () => {
    expect(() => readAccountStatus('oops')).toThrow(/oops/);
  });
});

describe('signInLink', () => {
  const url =
    'https://claude.ai/oauth/authorize?code=true&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback';

  it('signInLink_OscWrappedLine_ReturnsUrlOnce', () => {
    const belLine = `If the browser didn't open, visit: \x1b]8;;${url}\x07${url}\x1b]8;;\x07\n`;
    const stTerminatedLine = `If the browser didn't open, visit: \x1b]8;;${url}\x1b\\${url}\x1b]8;;\x1b\\\n`;

    expect(
      signInLink(
        `Opening browser to sign in…\n${belLine}Paste code here if prompted > `,
      ),
    ).toBe(url);
    expect(signInLink(stTerminatedLine)).toBe(url);
  });

  it('signInLink_LineNotEnded_Null', () => {
    expect(signInLink(`visit: \x1b]8;;${url}\x07${url}`)).toBeNull();
  });

  it('signInLink_NoVisitLine_Null', () => {
    expect(signInLink('Opening browser to sign in…\n')).toBeNull();
  });
});
