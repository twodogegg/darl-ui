import type { AgentToolCall, ConfirmAnswers, ConfirmQuestion } from '../../../src/index';

const text = { type: 'string', minLength: 1, maxLength: 2000 };
export const USER_INPUT_TOOL = {
  name: 'builtin_request_user_input',
  title: '询问用户',
  description: '需要用户选择或补充信息时调用。以交互弹窗展示单选、多选和文字问题，等待真实回答后继续；取消会返回 cancelled。多选题使用 multiple。',
  risk: 'read' as const,
  appId: 'builtin:interaction',
  appName: '用户交互',
  parameters: {
    type: 'object', additionalProperties: false, required: ['title', 'questions'],
    properties: {
      title: text, description: text,
      questions: {
        type: 'array', minItems: 1, maxItems: 8,
        items: {
          type: 'object', additionalProperties: false, required: ['id', 'label', 'type'],
          properties: {
            id: { ...text, maxLength: 80 }, label: text,
            type: { type: 'string', enum: ['single', 'multiple', 'text', 'textarea'] },
            description: text, required: { type: 'boolean' }, placeholder: text,
            defaultValue: { anyOf: [text, { type: 'array', maxItems: 30, uniqueItems: true, items: text }] },
            options: {
              type: 'array', minItems: 1, maxItems: 30,
              items: {
                type: 'object', additionalProperties: false, required: ['value', 'label'],
                properties: { value: text, label: text, description: text, disabled: { type: 'boolean' } },
              },
            },
          },
        },
      },
    },
  },
};

export function validateUserInput(value: unknown): NonNullable<AgentToolCall['userInput']> {
  // The model runtime validates the JSON schema before execution; check cross-field constraints here.
  const input = value as NonNullable<AgentToolCall['userInput']>;
  if (!input || typeof input.title !== 'string' || !input.title.trim() || !Array.isArray(input.questions) || !input.questions.length || input.questions.length > 8) throw new Error('请提供标题和 1–8 个问题');
  const ids = new Set<string>();
  for (const question of input.questions) {
    if (!question || !question.id?.trim() || !question.label?.trim() || !['single', 'multiple', 'text', 'textarea'].includes(question.type) || ids.has(question.id)) throw new Error('问题 ID 必须唯一，标题与类型必须有效');
    ids.add(question.id);
    if (question.type === 'single' || question.type === 'multiple') {
      const options = question.options ?? [];
      if (!options.length || !options.some(option => !option.disabled) || new Set(options.map(option => option.value)).size !== options.length) throw new Error('选择题需要可选且值不重复的选项');
    }
    if (question.defaultValue !== undefined) validateAnswer(question, question.defaultValue, false);
  }
  return input;
}

function validateAnswer(question: ConfirmQuestion, value: unknown, required = question.required) {
  const choices = question.options?.filter(option => !option.disabled).map(option => option.value) ?? [];
  if (question.type === 'multiple') {
    if (!Array.isArray(value) || value.length > 30 || value.some(item => typeof item !== 'string' || !choices.includes(item)) || new Set(value).size !== value.length || (required && !value.length)) throw new Error(`请为「${question.label}」选择有效选项`);
  } else if (typeof value !== 'string' || value.length > 10_000 || (required && !value.trim()) || (question.type === 'single' && value !== '' && !choices.includes(value))) {
    throw new Error(`请填写「${question.label}」的有效答案`);
  }
}

export function validateUserAnswers(input: NonNullable<AgentToolCall['userInput']>, value: unknown): ConfirmAnswers | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请提交答案或取消');
  const answers = value as ConfirmAnswers;
  if (Object.keys(answers).some(id => !input.questions.some(question => question.id === id))) throw new Error('答案包含未知问题');
  return Object.fromEntries(input.questions.map(question => {
    const answer = Object.hasOwn(answers, question.id) ? answers[question.id] : question.type === 'multiple' ? [] : '';
    validateAnswer(question, answer);
    return [question.id, answer];
  }));
}
