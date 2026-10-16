import { describe, expect, it } from 'vitest';
import { toolHistoryForModel } from '../examples/agent-chat/client/message-history';

describe('tool history sent to the model', () => {
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
