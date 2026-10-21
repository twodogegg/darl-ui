import { describe, expect, it } from 'vitest';
import { VoiceOutputParser } from '../examples/agent-chat/server/voice-output';
import { speechTranscript, spokenText } from '../src/components/agent-sidebar/voice-playback';

describe('separate spoken and written output', () => {
  it('preserves open-ended Fish cues for synthesis but hides them in the readable transcript', () => {
    const speech = '[warm and reassuring] 别着急。[break] 我们先看 [emphasis] 最重要的一步。';
    expect(spokenText(speech)).toBe(speech);
    const outputs = [{ output_type: 'speech' as const, content: speech }, { output_type: 'text' as const, content: '[保留文字区的方括号]' }];
    expect(speechTranscript(outputs)).toBe('别着急。 我们先看 最重要的一步。');
    expect(outputs[0].content).toBe(speech);
    expect(speechTranscript(undefined)).toBe('');
  });
  it('emits complete records before the entire reply finishes across every chunk boundary', () => {
    const first = JSON.stringify({ output_type: 'speech', content: '我先检查一下。' }) + '\n';
    const second = JSON.stringify({ output_type: 'text', content: '```js\nconst answer = 42;\n```' });
    for (let split = 0; split <= first.length; split += 1) {
      const parser = new VoiceOutputParser();
      const outputs = [...parser.push(first.slice(0, split)), ...parser.push(first.slice(split))];
      expect(outputs).toEqual([{ output_type: 'speech', content: '我先检查一下。' }]);
      expect(parser.push(second)).toEqual([]);
      expect(parser.push('', true)).toEqual([{ output_type: 'text', content: '```js\nconst answer = 42;\n```' }]);
    }
  });

  it('rejects malformed, unknown and empty outputs instead of sending raw JSON to speech', () => {
    for (const source of ['plain answer', '{"output_type":"tool","content":"run"}', '{"output_type":"speech","content":""}', 'null']) {
      expect(() => new VoiceOutputParser().push(source, true)).toThrow();
    }
    expect(() => new VoiceOutputParser().push('', true)).toThrow();
    expect(() => new VoiceOutputParser().push(JSON.stringify({ output_type: 'speech', content: 'a'.repeat(2001) }), true)).toThrow();
  });

  it('reports voice protocol failures with a specific actionable error', () => {
    expect(() => new VoiceOutputParser().push('普通文本', true)).toThrow(expect.objectContaining({
      stage: 'model', code: 'VOICE_OUTPUT_INVALID', retryable: true,
      message: 'Agent 未返回有效的分渠道输出，请重新生成',
    }));
  });

  it('preserves already-delivered content if a later record is invalid', () => {
    const parser = new VoiceOutputParser();
    expect(parser.push('{"output_type":"text","content":"完整材料"}\n')).toHaveLength(1);
    expect(() => parser.push('{"output_type":', true)).toThrow();
  });

  it('filters code and URL addresses without changing the written content', () => {
    expect(spokenText('结果如下。\n```ts\nsecret();\n```\n[说明](https://example.com)\n| A | B |\n`npm run dev`')).toBe('结果如下。\n说明');
    expect(spokenText('```js\nnot finished')).toBe('');
    expect(spokenText('你好，结果已经准备好了。')).toBe('你好，结果已经准备好了。');
  });
});
