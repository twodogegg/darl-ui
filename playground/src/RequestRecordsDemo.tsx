import { useCallback, useState } from 'react';
import { RequestRecords, type RequestRecord, type RequestRecordFilters, type RequestRecordRetention } from '../../src';

const samples: RequestRecord[] = [
  { id: 'demo-text', type: 'text', modelId: 'text', modelName: '文本模型 · 本地示例', providerId: 'demo', providerName: '本地演示', status: 'success', createdAt: new Date().toISOString(), durationMs: 1240, text: '## 请求记录预览\n\n支持 **文本、图片、音频、视频** 类型筛选。', parameters: { prompt: '展示请求记录组件' }, inputTokens: 38, outputTokens: 25 },
  { id: 'demo-image', type: 'image', modelId: 'image', modelName: '图片模型 · 本地示例', providerId: 'demo', providerName: '本地演示', status: 'success', createdAt: new Date().toISOString(), durationMs: 8320, references: [{ type: 'image', name: '参考图', url: '/media-workspace/scene-1.svg' }], results: [{ type: 'image', name: '图片展示示例', url: '/media-workspace/scene-2.svg' }], parameters: { aspectRatio: '16:9' } },
  { id: 'demo-video', type: 'video', modelId: 'video', modelName: '视频模型 · 本地示例', providerId: 'demo', providerName: '本地演示', status: 'success', createdAt: new Date().toISOString(), durationMs: 24800, results: [{ type: 'video', name: '视频展示示例', url: '/media-workspace/city.mp4' }] },
  { id: 'demo-audio', type: 'audio', modelId: 'audio', modelName: '音频模型 · 本地示例', providerId: 'demo', providerName: '本地演示', status: 'error', createdAt: new Date().toISOString(), durationMs: 520, error: '本地错误展示示例；没有发起外部请求', results: [{ type: 'audio', name: '已删除的素材示例', unavailable: true }] },
];
const loadRecord = async (id: string) => {
  const record = samples.find(item => item.id === id);
  if (!record) throw new Error('记录不存在');
  return record;
};
const loadRecords = async (filters: RequestRecordFilters) => {
  const items = samples.filter(item => (!filters.type || item.type === filters.type) && (!filters.status || item.status === filters.status) && (!filters.modelId || item.modelId === filters.modelId) && (!filters.query || JSON.stringify(item).includes(filters.query)) && (!filters.from || item.createdAt >= filters.from) && (!filters.to || item.createdAt.slice(0, 10) <= filters.to));
  return { items: items.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize), total: items.length, models: samples.map(item => ({ id: item.modelId, name: item.modelName })), providers: [{ id: 'demo', name: '本地演示' }] };
};

export function RequestRecordsDemo() {
  const [retention, setRetention] = useState<RequestRecordRetention>({ enabled: true, days: 30 });
  const loadRetention = useCallback(async () => retention, [retention]);
  return <><p className="demo-mock-hint">本地交互演示，使用示例文字与仓库素材，不发起模型请求。真实记录见 Agent Chat → 设置 → 请求记录。</p><RequestRecords loadRecords={loadRecords} loadRecord={loadRecord} loadRetention={loadRetention} saveRetention={async value => { setRetention(value); return value; }} /></>;
}
