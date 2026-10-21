import type { AgentOutput } from '../../../src/components/agent-sidebar/types';
import { jsonSchema, Output } from 'ai';
import { AgentFailure } from './errors';

const invalidOutput = (message: string, source?: string) => new AgentFailure('model', 'VOICE_OUTPUT_INVALID', message, true, '点击“重新生成”重试；若反复出现，请检查语音输出规则或更换模型。', source ? { cause: new Error(`输出片段：${source.slice(0, 300)}`) } : undefined);

const voiceResponseSchema = jsonSchema<{ outputs: AgentOutput[] }>({
  type: 'object', additionalProperties: false, required: ['outputs'],
  properties: {
    outputs: {
      type: 'array', minItems: 1, maxItems: 500,
      items: {
        type: 'object', additionalProperties: false, required: ['output_type', 'content'],
        properties: { output_type: { type: 'string', enum: ['text', 'speech'] }, content: { type: 'string', minLength: 1 } },
      },
    },
  },
});

export function voiceOutputFormat(protocol: 'openai-completions' | 'openai-responses') {
  // Compatible Chat APIs support JSON mode; Responses supports schema constraints.
  return protocol === 'openai-responses' ? Output.object({ schema: voiceResponseSchema }) : Output.json();
}

function outputRecord(source: string): AgentOutput {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw invalidOutput('Agent 未返回有效的分渠道输出，请重新生成', source); }
  const item = value as Partial<AgentOutput> | null;
  if (!item || Object.keys(item).length !== 2 || !['text', 'speech'].includes(item.output_type || '') || typeof item.content !== 'string' || !item.content.trim()) throw invalidOutput('Agent 输出渠道或内容无效，请重新生成');
  if (item.output_type === 'speech' && item.content.length > 2000) throw invalidOutput('语音输出段落过长，请重新生成');
  return { output_type: item.output_type!, content: item.content };
}

/** Emit only complete outputs, including separate JSON responses across tool steps. */
export class VoiceOutputParser {
  private source = '';
  private offset = 0;
  private count = 0;
  private phase: 'header' | 'record' | 'separator' | 'end' = 'header';
  private start = -1;
  private depth = 0;
  private quoted = false;
  private escaped = false;

  push(text: string, final = false): AgentOutput[] {
    this.source += text;
    if (this.source.length > 500_000) throw invalidOutput('语音模式输出记录过长');
    const outputs: AgentOutput[] = [];
    while (this.offset < this.source.length) {
      const char = this.source[this.offset];
      if (this.phase === 'header') {
        if (/[ \t\r\n]/.test(char)) { this.offset += 1; continue; }
        const header = /^\{[ \t\r\n]*("(?:[^"\\]|\\.)*")[ \t\r\n]*:[ \t\r\n]*\[/.exec(this.source.slice(this.offset));
        if (!header) break;
        let key: unknown;
        try { key = JSON.parse(header[1]); } catch { throw invalidOutput('Agent 未返回有效的分渠道输出，请重新生成'); }
        if (key !== 'outputs') throw invalidOutput('Agent 未返回有效的分渠道输出，请重新生成');
        this.offset += header[0].length;
        this.phase = 'record';
        continue;
      }
      if (this.phase === 'record') {
        if (this.start < 0) {
          if (/[ \t\r\n]/.test(char)) { this.offset += 1; continue; }
          if (char !== '{') throw invalidOutput('Agent 输出渠道或内容无效，请重新生成');
          this.start = this.offset;
        }
        if (this.quoted) {
          if (this.escaped) this.escaped = false;
          else if (char === '\\') this.escaped = true;
          else if (char === '"') this.quoted = false;
        } else if (char === '"') this.quoted = true;
        else if (char === '{' || char === '[') this.depth += 1;
        else if (char === '}' || char === ']') this.depth -= 1;
        this.offset += 1;
        if (this.depth === 0) {
          if (++this.count > 500) throw invalidOutput('Agent 输出段落过多');
          outputs.push(outputRecord(this.source.slice(this.start, this.offset)));
          this.start = -1;
          this.phase = 'separator';
        }
        continue;
      }
      if (/[ \t\r\n]/.test(char)) { this.offset += 1; continue; }
      if (this.phase === 'separator' && (char === ',' || char === ']')) this.phase = char === ',' ? 'record' : 'end';
      else if (this.phase === 'end' && char === '}') this.phase = 'header';
      else throw invalidOutput('Agent 未返回有效的分渠道输出，请重新生成');
      this.offset += 1;
    }
    if (final && (this.phase !== 'header' || this.offset !== this.source.length)) throw invalidOutput('Agent 未返回有效的分渠道输出，请重新生成', this.source.slice(this.offset));
    if (final && !this.count) throw invalidOutput('Agent 没有返回可用内容');
    return outputs;
  }
}
