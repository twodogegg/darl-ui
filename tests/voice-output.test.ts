import { describe, expect, it } from 'vitest';
import { VoiceOutputParser, voiceOutputFormat } from '../examples/agent-chat/server/voice-output';
import { speechTranscript, spokenText } from '../src/components/agent-sidebar/voice-playback';

describe('separate spoken and written output', () => {
  it('requests JSON mode for compatible Chat APIs and a channel schema for Responses', async () => {
    expect(await voiceOutputFormat('openai-completions').responseFormat).toEqual({ type: 'json' });
    expect(await voiceOutputFormat('openai-responses').responseFormat).toMatchObject({
      type: 'json', schema: { type: 'object', required: ['outputs'], properties: {
        outputs: { type: 'array', minItems: 1, maxItems: 500, items: {
          required: ['output_type', 'content'], properties: { output_type: { enum: ['text', 'speech'] } },
        } },
      } },
    });
  });

  it('preserves open-ended Fish cues for synthesis but hides them in the readable transcript', () => {
    const speech = '[warm and reassuring] 别着急。[break] 我们先看 [emphasis] 最重要的一步。';
    expect(spokenText(speech)).toBe(speech);
    const outputs = [{ output_type: 'speech' as const, content: speech }, { output_type: 'text' as const, content: '[保留文字区的方括号]' }];
    expect(speechTranscript(outputs)).toBe('别着急。 我们先看 最重要的一步。');
    expect(outputs[0].content).toBe(speech);
    expect(speechTranscript(undefined)).toBe('');
  });
  it('emits complete records before the entire reply finishes across every chunk boundary', () => {
    const first = '{"outputs":[' + JSON.stringify({ output_type: 'speech', content: '我先检查一下。' });
    const second = JSON.stringify({ output_type: 'text', content: '```js\nconst answer = 42;\n```' });
    for (let split = 0; split <= first.length; split += 1) {
      const parser = new VoiceOutputParser();
      const outputs = [...parser.push(first.slice(0, split)), ...parser.push(first.slice(split))];
      expect(outputs).toEqual([{ output_type: 'speech', content: '我先检查一下。' }]);
      expect(parser.push(',' + second.slice(0, -1))).toEqual([]);
      expect(parser.push('}')).toEqual([{ output_type: 'text', content: '```js\nconst answer = 42;\n```' }]);
      expect(parser.push(']}', true)).toEqual([]);
    }
  });

  it('preserves escapes, newlines and JSON delimiters in strings at every chunk boundary', () => {
    const outputs = [{ output_type: 'speech', content: '[warm] 你好。' }, { output_type: 'text', content: '括号 {}[]，引号 "，反斜杠 \\，换行\n中文。' }];
    const source = JSON.stringify({ outputs }, null, 2);
    for (let split = 0; split <= source.length; split += 1) {
      const parser = new VoiceOutputParser();
      expect([...parser.push(source.slice(0, split)), ...parser.push(source.slice(split), true)]).toEqual(outputs);
    }
    const parser = new VoiceOutputParser();
    expect([...source].flatMap((char) => parser.push(char)).concat(parser.push('', true))).toEqual(outputs);
  });

  it('accepts separate structured responses before and after a tool step without duplicates', () => {
    const parser = new VoiceOutputParser();
    expect(parser.push('{"outputs":[{"output_type":"speech","content":"我先检查。"}]}')).toHaveLength(1);
    expect(parser.push('\n{ "outputs": [{"output_type":"text","content":"已检查。"}]}', true)).toEqual([{ output_type: 'text', content: '已检查。' }]);
  });

  it('recognizes escaped JSON keys and reports malformed keys as voice protocol errors', () => {
    expect(new VoiceOutputParser().push('{"out\\u0070uts":[{"output_type":"speech","content":"在。"}]}', true)).toEqual([{ output_type: 'speech', content: '在。' }]);
    for (const source of ['{"out\\quts":[]}', '{"outputs":\u000b[{"output_type":"speech","content":"在。"}]}']) {
      expect(() => new VoiceOutputParser().push(source, true)).toThrow(expect.objectContaining({ code: 'VOICE_OUTPUT_INVALID' }));
    }
  });

  it('rejects malformed, unknown and empty outputs instead of sending raw JSON to speech', () => {
    for (const source of ['在。', 'null', '[]', '{}', '{"outputs":[]}', '{"outputs":[null]}', '{"outputs":[{"output_type":"tool","content":"run"}]}', '{"outputs":[{"output_type":"speech","content":" "}]}', '{"outputs":[{"output_type":"text","content":"ok","extra":true}]}', '{"outputs":[{"output_type":"speech","content":"ok"},]}', '{"outputs":[{"output_type":"text","content":"ok"}],"extra":true}', '```json\n{"outputs":[]}\n```']) {
      expect(() => new VoiceOutputParser().push(source, true)).toThrow();
    }
    expect(() => new VoiceOutputParser().push('', true)).toThrow();
    expect(() => new VoiceOutputParser().push(JSON.stringify({ outputs: [{ output_type: 'speech', content: 'a'.repeat(2001) }] }), true)).toThrow('过长');
    expect(() => new VoiceOutputParser().push(JSON.stringify({ outputs: Array.from({ length: 501 }, () => ({ output_type: 'text', content: 'a' })) }), true)).toThrow('过多');
    expect(() => new VoiceOutputParser().push(' '.repeat(500_001))).toThrow('过长');
  });

  it('reports voice protocol failures with a specific actionable error', () => {
    expect(() => new VoiceOutputParser().push('普通文本', true)).toThrow(expect.objectContaining({
      stage: 'model', code: 'VOICE_OUTPUT_INVALID', retryable: true,
      message: 'Agent 未返回有效的分渠道输出，请重新生成',
    }));
  });

  it('preserves already-delivered content if a later record is invalid', () => {
    const parser = new VoiceOutputParser();
    expect(parser.push('{"outputs":[{"output_type":"text","content":"完整材料"}')).toHaveLength(1);
    expect(() => parser.push(',{"output_type":', true)).toThrow();
    expect(() => new VoiceOutputParser().push('{"outputs":[{"output_type":"speech","content":"未完成', true)).toThrow();
  });

  it('filters code and URL addresses without changing the written content', () => {
    expect(spokenText('结果如下。\n```ts\nsecret();\n```\n[说明](https://example.com)\n| A | B |\n`npm run dev`')).toBe('结果如下。\n说明');
    expect(spokenText('```js\nnot finished')).toBe('');
    expect(spokenText('你好，结果已经准备好了。')).toBe('你好，结果已经准备好了。');
  });
});
