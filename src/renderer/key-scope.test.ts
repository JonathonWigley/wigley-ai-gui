import { describe, expect, it } from 'vitest';
import { createScopeStack, type ScopeStack } from './key-scope';

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

  it('reports a scope pushed until the last pop, one equal to the base included', () => {
    const stack = createScopeStack('forms.forms');
    const first = stack.push('forms.forms');
    const second = stack.push('keys.help');

    second.pop();
    expect(stack.anyPushed()).toBe(true);

    first.pop();
    expect(stack.anyPushed()).toBe(false);
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

  it.each([
    {
      action: 'setBase to another scope',
      run: (stack: ScopeStack) => stack.setBase('other'),
      heard: ['other'],
    },
    {
      action: 'setBase to the same base',
      run: (stack: ScopeStack) => stack.setBase('forms.forms'),
      heard: [],
    },
    {
      action: 'a push',
      run: (stack: ScopeStack) => stack.push('keys.help'),
      heard: [],
    },
    {
      action: 'a pop',
      run: (stack: ScopeStack) => stack.push('keys.help').pop(),
      heard: [],
    },
    {
      action: 'setBase under a pushed scope',
      run: (stack: ScopeStack) => {
        stack.push('keys.help');
        stack.setBase('other');
      },
      heard: ['other'],
    },
  ])(
    'tells onBaseChange only when the base moves: $action',
    ({ run, heard }) => {
      const stack = createScopeStack('forms.forms');
      const told: string[] = [];
      stack.onBaseChange((base) => told.push(base));

      run(stack);

      expect(told).toEqual(heard);
    },
  );

  it('tells onBaseChange after a pushed scope closed itself', () => {
    const stack = createScopeStack('forms.forms');
    const help = stack.push('keys.help');
    const order: string[] = [];
    stack.onBaseChange(() => order.push('onBaseChange'));
    stack.onChange(() => order.push('onChange'));
    help.onBaseChanged(() => {
      help.pop();
      order.push('onBaseChanged');
    });

    stack.setBase('other');

    expect(order).toEqual(['onChange', 'onBaseChanged', 'onBaseChange']);
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
