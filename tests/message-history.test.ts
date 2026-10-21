import { describe, expect, it } from 'vitest';
import { messageTextForModel, toolHistoryForModel } from '../examples/agent-chat/client/message-history';

describe('tool history sent to the model', () => {
  it('preserves speech-only replies and independent speech alongside written content', () => {
    expect(messageTextForModel({ id: 'spoken', role: 'assistant', content: '', outputs: [{ output_type: 'speech', content: '请告诉我你希望的风格。' }] })).toBe('[语音回复]\n请告诉我你希望的风格。');
    expect(messageTextForModel({ id: 'both', role: 'assistant', content: '完整材料', outputs: [{ output_type: 'text', content: '完整材料' }, { output_type: 'speech', content: '注意最后一项。' }] })).toBe('完整材料\n\n[语音回复]\n注意最后一项。');
  });
  it('preserves completed child-agent results for follow-up turns', () => {
    expect(toolHistoryForModel({
      id: 'answer', role: 'assistant', content: '已查询。', toolCalls: [{
        id: 'call', appId: 'asset-hub', appName: '素材中心', toolName: 'search_assets', toolTitle: '搜索素材', status: 'success', output: { total: 29 },
      }],
    })).toContain('返回数据：{"total":29}');
  });

  it('does not turn pending calls into facts', () => {
    expect(toolHistoryForModel({
      id: 'answer', role: 'assistant', content: '', toolCalls: [{ id: 'call', appId: 'asset-hub', appName: '素材中心', toolName: 'search_assets', status: 'running' }],
    })).toBe('');
  });
});
