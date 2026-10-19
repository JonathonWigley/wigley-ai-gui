import { describe, expect, it } from 'vitest';
import { createScopeStack } from './key-scope';

describe('createScopeStack', () => {
  it('keeps a pushed scope on top while the base changes under it', () => {
    const stack = createScopeStack('any');
    stack.setBase('forms.review');
    const help = stack.push('keys.help');

    stack.setBase('forms.forms');
    expect(stack.current()).toBe('keys.help');

    help.pop();
    expect(stack.current()).toBe('forms.forms');
  });

  it('pops an entry under the top and keeps the top', () => {
    const stack = createScopeStack('forms.forms');
    const first = stack.push('a.first');
    stack.push('b.second');

    first.pop();
    expect(stack.current()).toBe('b.second');
  });

  it('throws on a second pop of one handle, naming the scope', () => {
    const stack = createScopeStack('forms.forms');
    const help = stack.push('keys.help');
    help.pop();

    expect(() => help.pop()).toThrow(/keys\.help/);
  });

  it('tells its listeners only when the current scope changes', () => {
    const stack = createScopeStack('forms.forms');
    const heard: string[] = [];
    stack.onChange((scope) => heard.push(scope));

    const help = stack.push('keys.help');
    stack.setBase('forms.review');
    stack.setBase('forms.review');
    const first = stack.push('a.first');
    stack.push('b.second');
    first.pop();
    help.pop();

    expect(heard).toEqual(['keys.help', 'a.first', 'b.second']);
  });

  it('tells a pushed scope of each base change under it until its pop', () => {
    const stack = createScopeStack('forms.forms');
    const help = stack.push('keys.help');
    const heard: string[] = [];
    help.onBaseChanged((base) => heard.push(base));

    stack.setBase('forms.confirm');
    stack.setBase('forms.confirm');
    help.pop();
    stack.setBase('forms.forms');

    expect(heard).toEqual(['forms.confirm']);
  });

  it('lets a pushed scope pop itself when the base changes', () => {
    const stack = createScopeStack('forms.forms');
    const help = stack.push('keys.help');
    const heard: string[] = [];
    stack.onChange((scope) => heard.push(scope));
    help.onBaseChanged(() => help.pop());

    stack.setBase('forms.confirm');

    expect(stack.current()).toBe('forms.confirm');
    expect(heard).toEqual(['forms.confirm']);
  });
});
