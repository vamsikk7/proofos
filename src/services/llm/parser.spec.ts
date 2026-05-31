import { describe, expect, it } from 'vitest';
import { extractFirstJsonObject, parseLlmResponse, stripThinkBlocks } from './parser.ts';
import type { Rule } from '../../shared/rules/types.ts';

const spellingRule: Rule = {
  id: 'spelling',
  name: 'Spelling',
  category: 'spelling',
  instruction: '',
  enabled: true,
  builtin: true,
  runner: 'llm',
};

describe('stripThinkBlocks', () => {
  it('removes single <think>...</think> block', () => {
    const cleaned = stripThinkBlocks('<think>reasoning</think>{"issues":[]}');
    expect(cleaned).toBe('{"issues":[]}');
  });

  it('removes multiple think blocks across lines', () => {
    const input = '<think>step 1</think>\n<think>step 2</think>\n{"issues":[]}';
    expect(stripThinkBlocks(input)).toBe('{"issues":[]}');
  });

  it('leaves untouched content alone', () => {
    expect(stripThinkBlocks('{"issues":[]}')).toBe('{"issues":[]}');
  });
});

describe('extractFirstJsonObject', () => {
  it('returns the first balanced object', () => {
    expect(extractFirstJsonObject('prefix {"a":1} suffix')).toBe('{"a":1}');
  });

  it('handles nested braces', () => {
    expect(extractFirstJsonObject('{"a":{"b":2}}')).toBe('{"a":{"b":2}}');
  });

  it('ignores braces inside strings', () => {
    expect(extractFirstJsonObject('{"a":"}"}')).toBe('{"a":"}"}');
  });

  it('returns null when no object is present', () => {
    expect(extractFirstJsonObject('no json here')).toBeNull();
  });
});

describe('parseLlmResponse', () => {
  const text = 'teh quick brown fox';

  it('parses valid response into issues with computed offsets', () => {
    const raw = JSON.stringify({
      issues: [
        {
          ruleId: 'spelling',
          original: 'teh',
          suggestion: 'the',
          explanation: 'typo',
        },
      ],
    });

    const issues = parseLlmResponse(raw, text, [spellingRule]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'spelling',
      original: 'teh',
      suggestion: 'the',
      startIndex: 0,
      endIndex: 3,
    });
  });

  it('strips reasoning blocks before parsing', () => {
    const raw = `<think>thinking</think>\n${JSON.stringify({
      issues: [{ ruleId: 'spelling', original: 'teh', suggestion: 'the', explanation: '' }],
    })}`;
    const issues = parseLlmResponse(raw, text, [spellingRule]);
    expect(issues).toHaveLength(1);
  });

  it('drops issues with snippets not found in the document', () => {
    const raw = JSON.stringify({
      issues: [
        { ruleId: 'spelling', original: 'wholly-fabricated', suggestion: 'x', explanation: '' },
      ],
    });
    expect(parseLlmResponse(raw, text, [spellingRule])).toEqual([]);
  });

  it('drops issues that reference an unknown rule id', () => {
    const raw = JSON.stringify({
      issues: [{ ruleId: 'nonexistent', original: 'teh', suggestion: 'the', explanation: '' }],
    });
    expect(parseLlmResponse(raw, text, [spellingRule])).toEqual([]);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseLlmResponse('definitely-not-json', text, [spellingRule])).toThrow();
  });
});
