// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateUserAnswers, validateUserInput } from '../examples/agent-chat/server/user-input';
import { ToolConfirmations } from '../examples/agent-chat/server/mcp';
import type { ConfirmAnswers } from '../src';

const input = validateUserInput({ title: '选择功能', questions: [
  { id: 'features', label: '所需功能', type: 'multiple', required: true, options: [{ value: 'upload', label: '上传' }, { value: 'search', label: '搜索' }, { value: 'disabled', label: '不可选', disabled: true }] },
  { id: 'mode', label: '模式', type: 'single', options: [{ value: 'simple', label: '简洁' }] },
  { id: 'notes', label: '补充要求', type: 'textarea' },
] });

describe('Agent interactive user input', () => {
  it('returns structured multiple choices and optional text, and preserves explicit cancellation', () => {
    expect(validateUserAnswers(input, { features: ['upload', 'search'], notes: '移动端优先' })).toEqual({ features: ['upload', 'search'], mode: '', notes: '移动端优先' });
    expect(validateUserAnswers(input, null)).toBeNull();
  });

  it('rejects empty required answers, invalid or disabled choices, duplicate choices and unknown questions', () => {
    for (const answers of [undefined, {}, { features: [] }, { features: 'upload' }, { features: ['unknown'] }, { features: ['disabled'] }, { features: ['upload', 'upload'] }, { features: ['upload'], mode: ['simple'] }, { features: ['upload'], unexpected: '' }, { features: ['upload'], notes: 'x'.repeat(10_001) }]) {
      expect(() => validateUserAnswers(input, answers)).toThrow();
    }
  });

  it('rejects empty forms, duplicate question IDs, duplicate option values and invalid defaults', () => {
    for (const value of [
      { ...input, questions: [] },
      { ...input, questions: [input.questions[0], input.questions[0]] },
      { ...input, questions: [{ ...input.questions[0], options: [] }] },
      { ...input, questions: [{ ...input.questions[0], options: [{ value: 'same', label: '一' }, { value: 'same', label: '二' }] }] },
      { ...input, questions: [{ ...input.questions[0], defaultValue: ['missing'] }] },
    ]) expect(() => validateUserInput(value)).toThrow();
  });

  it('keeps invalid submissions pending for retry and makes answered, cancelled and aborted requests expire', async () => {
    const requests = new ToolConfirmations<ConfirmAnswers | null>();
    const controller = new AbortController();
    const answer = requests.wait('answer', controller.signal, value => validateUserAnswers(input, value));
    expect(() => requests.decide('answer', { features: [] })).toThrow();
    requests.decide('answer', { features: ['search'] });
    await expect(answer).resolves.toEqual({ features: ['search'], mode: '', notes: '' });
    expect(() => requests.decide('answer', null)).toThrow(/过期/);
    const cancelled = requests.wait('cancel', controller.signal);
    requests.decide('cancel', null);
    await expect(cancelled).resolves.toBeNull();
    const aborted = requests.wait('abort', controller.signal);
    controller.abort();
    await expect(aborted).rejects.toThrow(/停止/);
    expect(() => requests.decide('abort', { features: ['upload'] })).toThrow(/过期/);
  });
});
