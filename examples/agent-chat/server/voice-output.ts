import type { AgentOutput } from '../../../src/components/agent-sidebar/types';
import { AgentFailure } from './errors';

const invalidOutput = (message: string, source?: string) => new AgentFailure('model', 'VOICE_OUTPUT_INVALID', message, true, '点击“重新生成”重试；若反复出现，请检查语音输出规则或更换模型。', source ? { cause: new Error(`输出片段：${source.slice(0, 300)}`) } : undefined);

/** Parse complete output records without exposing partial JSON in the chat. */
export class VoiceOutputParser {
  private pending = '';
  private count = 0;

  push(text: string, final = false): AgentOutput[] {
    this.pending += text;
    if (this.pending.length > 500_000) throw invalidOutput('语音模式输出记录过长');
    const lines = this.pending.split('\n');
    this.pending = final ? '' : lines.pop()!;
    const outputs: AgentOutput[] = [];
    for (const line of lines) {
      const source = line.trim();
      if (!source || /^```(?:json|jsonl|ndjson)?$/.test(source)) continue;
      let value: unknown;
      try { value = JSON.parse(source); } catch { throw invalidOutput('Agent 未返回有效的分渠道输出，请重新生成', source); }
      const item = value as Partial<AgentOutput> | null;
      if (!item || !['text', 'speech'].includes(item.output_type || '') || typeof item.content !== 'string' || !item.content.trim()) throw invalidOutput('Agent 输出渠道或内容无效，请重新生成');
      if (item.output_type === 'speech' && item.content.length > 2000) throw invalidOutput('语音输出段落过长，请重新生成');
      outputs.push({ output_type: item.output_type!, content: item.content });
      this.count += 1;
      if (this.count > 500) throw invalidOutput('Agent 输出段落过多');
    }
    if (final && !this.count) throw invalidOutput('Agent 没有返回可用内容');
    return outputs;
  }
}
