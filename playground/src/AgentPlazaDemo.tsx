import { useState } from 'react';
import { AgentPlaza, type AgentConfig } from '../../src';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const agents: AgentConfig[] = [
  { id: 'research', name: '资料研究助手', avatar: '🔍', description: '整理资料、核对来源并输出清晰结论。', type: 'main_agent', selectable: true, callable: true, instructions: '', providerId: '', modelId: '' },
  { id: 'creative', name: '创意策划助手', avatar: '✨', description: '把想法变成可执行的内容方案。', type: 'main_agent', selectable: true, callable: true, instructions: '', providerId: '', modelId: '' },
  { id: 'retrieval', name: '网页检索助手', avatar: '🌐', description: '仅供主 Agent 委派调用的检索助手。', type: 'sub_agent', selectable: false, callable: true, instructions: '', providerId: '', modelId: '' },
];

export function AgentPlazaDemo() {
  const [selected, setSelected] = useState<AgentConfig>();
  return <div className="demo-agent-page"><div className="demo-heading"><div><p className="demo-eyebrow">高级页面模板</p><h1>Agent 广场</h1><p className="demo-description">广场只展示可被用户主动选择的主 Agent；Sub Agent 会被系统过滤。</p></div></div><Card><CardHeader><CardTitle>选择主 Agent</CardTitle><CardDescription>点击卡片进入对应对话。</CardDescription></CardHeader><CardContent><AgentPlaza agents={agents} onSelect={setSelected} />{selected && <p className="demo-mock-hint" role="status">已选择：{selected.name}</p>}</CardContent></Card></div>;
}
