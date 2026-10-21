import { describe, expect, it } from 'vitest';
import { findLanguageByFile, findLanguageByName } from './languages';

describe('language lookup', () => {
  it('finds a language by file name', () => {
    expect(findLanguageByFile('SKILL.md')?.name).toBe('Markdown');
    expect(findLanguageByFile('/x/settings.local.json')?.name).toBe('JSON');
    expect(findLanguageByFile('config.toml')?.name).toBe('TOML');
    expect(findLanguageByFile('a.yml')?.name).toBe('YAML');
    expect(findLanguageByFile('notes.xyz')).toBeNull();
  });

  it('finds a language by name or alias, ignoring case', () => {
    expect(findLanguageByName('TS')?.name).toBe('TypeScript');
    expect(findLanguageByName('bash')?.name).toBe('Shell');
    expect(findLanguageByName('nosuchlang')).toBeNull();
    expect(findLanguageByName('')).toBeNull();
  });
});
