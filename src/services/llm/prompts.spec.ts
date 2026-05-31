import { describe, expect, it } from 'vitest';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompts.ts';
import type { Rule } from '../../shared/rules/types.ts';

const grammarRule: Rule = {
  id: 'grammar',
  name: 'Grammar',
  category: 'grammar',
  instruction: 'Flag grammar errors.',
  enabled: true,
  builtin: true,
  runner: 'llm',
};

describe('SYSTEM_PROMPT', () => {
  it('requires strict JSON output', () => {
    expect(SYSTEM_PROMPT).toMatch(/JSON only/i);
  });

  it('mentions the per-paragraph contract', () => {
    expect(SYSTEM_PROMPT).toMatch(/target paragraph/i);
  });
});

describe('buildUserPrompt', () => {
  it('includes target paragraph id and text', () => {
    const prompt = buildUserPrompt({
      rules: [grammarRule],
      target: { id: 'p2', text: 'He go to school.' },
    });
    expect(prompt).toContain('Target paragraph (id: p2');
    expect(prompt).toContain('He go to school.');
    expect(prompt).toContain('grammar (Grammar, grammar)');
  });

  it('omits surrounding paragraphs when not supplied', () => {
    const prompt = buildUserPrompt({
      rules: [grammarRule],
      target: { id: 'p1', text: 'Only paragraph.' },
    });
    expect(prompt).not.toContain('Previous paragraph');
    expect(prompt).not.toContain('Next paragraph');
  });

  it('includes the document title when supplied', () => {
    const prompt = buildUserPrompt({
      rules: [grammarRule],
      target: { id: 'p1', text: 'Body.' },
      documentTitle: 'My Doc',
    });
    expect(prompt).toContain('Document title: My Doc');
  });

  it('includes previous and next paragraph context when supplied', () => {
    const prompt = buildUserPrompt({
      rules: [grammarRule],
      target: { id: 'p5', text: 'Target line.' },
      previous: { id: 'p4', text: 'Before line.' },
      next: { id: 'p6', text: 'After line.' },
    });
    expect(prompt).toContain('Previous paragraph (id: p4');
    expect(prompt).toContain('Before line.');
    expect(prompt).toContain('Next paragraph (id: p6');
    expect(prompt).toContain('After line.');
  });
});
