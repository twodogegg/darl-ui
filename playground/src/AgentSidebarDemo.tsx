import { useEffect, useState } from 'react';
import { Bot, CheckCircle2, ExternalLink, PanelRight, Settings2, ShieldCheck } from 'lucide-react';
import { AgentSidebar, DefaultModelSelector, type AgentExecutionEvent, type AgentToolCall, type AgentSendRequest, type AgentApplication, type AgentModel, type AgentSession, type AgentSkill, type DefaultModelDraft, type DefaultModelOption, type DefaultModelSelection } from '../../src';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const applications: AgentApplication[] = [
  { id: 'orders', name: '订单系统', description: '查询订单、修改地址、查看物流', icon: '▣', status: 'connected', tools: [{ name: 'get_order', title: '查询订单', risk: 'read' }, { name: 'update_address', title: '修改收货地址', risk: 'write' }, { name: 'get_tracking', title: '查询物流', risk: 'read' }] },
  { id: 'knowledge', name: '知识库', description: '搜索和读取网站帮助文档', icon: '▤', status: 'connected', tools: [{ name: 'search_pages', title: '搜索文档', risk: 'read' }] },
  { id: 'github', name: 'GitHub', description: '查看仓库和创建 Issue', icon: '◈', status: 'needs-auth', tools: [{ name: 'search_code', title: '搜索代码', risk: 'read' }] },
];
const initialSkills: AgentSkill[] = [
  { id: 'support', name: '客服问题处理', description: '按客服流程分析用户问题并给出下一步', version: '1.0', scope: 'custom', category: '通用', enabled: true, instructions: '# 工作流程\n1. 先确认用户要解决的问题。\n2. 区分已知信息和待补充信息。\n3. 给出清晰的下一步操作。\n\n## 输出\n先给结论，再列出需要用户补充的内容。', resources: [{ path: 'references/support.md', content: '客服处理时保留用户原话，不编造订单或退款信息。' }] },
  { id: 'report', name: '报告整理', description: '把材料整理成结论、证据与行动项', version: '1.0', scope: 'custom', category: '通用', enabled: true, instructions: '# 报告整理\n\n## 工作流程\n1. 明确报告的受众和目标。\n2. 区分事实、判断和缺失信息。\n3. 输出摘要、主要发现和行动项。\n4. 检查来源和表述一致性。\n\n## 边界\n不编造证据，不自动调用外部应用。', resources: [{ path: 'references/report-template.md', content: '# 报告模板\n\n## 摘要\n\n## 主要发现\n\n## 行动项' }] },
];
const models: AgentModel[] = [
  { id: 'gpt-6', name: 'GPT-6', description: '适合复杂的多步骤任务', reasoningEfforts: ['低', '中', '高'] },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', description: '响应更快，适合日常问答', reasoningEfforts: ['低', '中'] },
];
const mediaModels: DefaultModelOption[] = [
  { id: 'gpt-image-2', name: 'GPT Image 2', type: 'image', description: '图片生成模型', capabilities: { resolutions: ['1K', '2K', '4K'], aspectRatios: ['1:1', '3:4', '4:3', '16:9', '9:16'] }, defaults: { resolution: '2K', aspectRatio: '16:9' } },
  { id: 'minimax-h3-flash', name: 'MiniMax H3 Flash', type: 'video', description: '快速视频生成模型', capabilities: { resolutions: ['480P'], aspectRatios: ['16:9'] }, defaults: { resolution: '480P', aspectRatio: '16:9' } },
];

const firstSession: AgentSession = {
  id: 'welcome', title: '订单状态查询', updatedAt: '今天', messages: [
    { id: 'welcome-1', role: 'user', content: '帮我查一下订单 #1024 的状态。' },
    { id: 'welcome-tool', role: 'assistant', content: '我查到了订单信息。', timeline: [
      { id: 'welcome-run-start', source: 'agent', status: 'started', name: '网站助手', timestamp: '2026-10-17T00:00:00.000Z', runId: 'welcome-run' },
      { id: 'welcome-tool-start', source: 'tool', status: 'started', name: '查询订单', timestamp: '2026-10-17T00:00:00.100Z', runId: 'welcome-run', toolCallId: 'call-1' },
      { id: 'welcome-tool-done', source: 'tool', status: 'success', name: '查询订单', timestamp: '2026-10-17T00:00:00.200Z', durationMs: 100, runId: 'welcome-run', toolCallId: 'call-1' },
      { id: 'welcome-run-done', source: 'agent', status: 'success', name: '网站助手', timestamp: '2026-10-17T00:00:00.300Z', durationMs: 300, runId: 'welcome-run' },
    ] satisfies AgentExecutionEvent[], toolCalls: [{ id: 'call-1', appId: 'orders', appName: '订单系统', toolName: 'get_order', toolTitle: '查询订单', status: 'success', input: { orderId: '1024' }, output: { status: '待发货', logisticsCompany: '顺丰' } }] },
    { id: 'welcome-2', role: 'assistant', content: '订单 **#1024** 当前状态是“待发货”，物流公司为顺丰。' },
  ],
};

export function AgentSidebarDemo() {
  const [open, setOpen] = useState(true);
  const [skills, setSkills] = useState(initialSkills);
  const importSkill = (skill: AgentSkill) => setSkills((current) => [...current.filter((item) => item.id !== skill.id), skill]);
  const [sessions, setSessions] = useState<AgentSession[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('darl-agent-demo') || 'null');
      if (Array.isArray(stored) && stored.length && stored.every((item) => item && typeof item.id === 'string' && typeof item.title === 'string' && Array.isArray(item.messages))) return stored;
    } catch { /* Use the local example when storage is unavailable. */ }
    return [firstSession, { id: 'help', title: '网站帮助文档', updatedAt: '昨天', messages: [{ id: 'help-1', role: 'user', content: '网站的退款规则是什么？' }] }];
  });
  const [activeSessionId, setActiveSessionId] = useState('welcome');
  const [applicationIds, setApplicationIds] = useState<string[]>([]);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [modelId, setModelId] = useState(models[0].id);
  const [effort, setEffort] = useState('中');
  const [defaultModelsOpen, setDefaultModelsOpen] = useState(false);
  const [defaultModelSelection, setDefaultModelSelection] = useState<DefaultModelDraft>({
    image: { modelId: 'gpt-image-2', resolution: '2K', aspectRatio: '16:9' },
    video: { modelId: 'minimax-h3-flash', resolution: '480P', aspectRatio: '16:9' },
  });
  useEffect(() => { try { localStorage.setItem('darl-agent-demo', JSON.stringify(sessions)); } catch { /* In-memory history remains usable. */ } }, [sessions]);

  const newSession = () => {
    const session: AgentSession = { id: `session-${Date.now()}`, title: '新对话', updatedAt: '刚刚', messages: [] };
    setSessions((current) => [session, ...current]); setActiveSessionId(session.id); setOpen(true);
  };
  const send = async ({ sessionId, content, files, applicationIds: usedApps, skillIds: usedSkills, modelId: usedModel, reasoningEffort }: AgentSendRequest) => {
    const userMessage = { id: `user-${Date.now()}`, role: 'user' as const, content, attachments: files?.map((file) => file.name) };
    setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, title: session.title === '新对话' ? content.slice(0, 24) : session.title, updatedAt: '刚刚', messages: [...session.messages, userMessage] } : session));
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    const selectedApp = applications.find((app) => usedApps.includes(app.id));
    const selectedSkill = skills.find((skill) => usedSkills.includes(skill.id));
    const assistantMessage = { id: `assistant-${Date.now()}`, role: 'assistant' as const, content: `这是本地交互演示。\n\n当前模型：${models.find((model) => model.id === usedModel)?.name || '未选择'} · 思考：${reasoningEffort || '中'}${selectedSkill ? `\n\n已选择 Skill：${selectedSkill.name}` : ''}${selectedApp ? `\n\n已启用应用：${selectedApp.name}。接入真实 MCP 后，这里会展示实际工具调用结果。` : ''}` };
    setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, updatedAt: '刚刚', messages: [...session.messages, assistantMessage] } : session));
  };
  const previewConfirmation = () => {
    const call: AgentToolCall = { id: crypto.randomUUID(), appId: 'orders', appName: '本地演示', toolName: 'preview_confirmation', toolTitle: '确认交互预览', status: 'confirmation', input: { action: '仅预览确认按钮，不执行网站操作' } };
    setSessions((current) => current.map((session) => session.id === activeSessionId ? { ...session, messages: [...session.messages, { id: crypto.randomUUID(), role: 'assistant', content: '这是本地确认交互演示，不调用外部服务。', toolCalls: [call] }] } : session));
    setOpen(true);
  };
  const previewMediaConfirmation = () => {
    const call: AgentToolCall = { id: crypto.randomUUID(), appId: 'builtin:media', appName: '媒体生成', toolName: 'generate_media', toolTitle: '生成图片', status: 'confirmation', risk: 'write', input: { modelId: 'gpt-image-2', prompt: '雨夜的霓虹街道，湿润路面反射彩色灯光，电影质感。', options: { size: '1536x1024', aspectRatio: '16:9', count: 2 } } };
    setSessions((current) => current.map((session) => session.id === activeSessionId ? { ...session, messages: [...session.messages, { id: crypto.randomUUID(), role: 'assistant', content: '这是本地媒体生成确认预览，不会提交任何生成任务。', toolCalls: [call] }] } : session));
    setOpen(true);
  };
  const confirmToolCall = (id: string, approved: boolean) => setSessions((current) => current.map((session) => ({ ...session, messages: session.messages.map((message) => ({ ...message, toolCalls: message.toolCalls?.map((call) => call.id === id && call.status === 'confirmation' ? { ...call, status: approved ? 'success' as const : 'error' as const, output: approved ? '已允许本地预览，未执行网站操作。' : undefined, error: approved ? undefined : '已拒绝本地预览。' } : call) })) })));
  const regenerate = (messageId: string) => setSessions((current) => current.map((session) => ({ ...session, messages: session.messages.map((message) => message.id === messageId ? { ...message, content: `${message.content}\n\n本地演示：已重新生成。` } : message) })));

  return <div className="demo-agent-page">
    <div className="demo-heading"><div><p className="demo-eyebrow">高级页面模板</p><h1>AgentSidebar</h1><p className="demo-description">嵌入普通网站的辅助 Agent 侧栏。会话、历史、应用、Skill、模型和 Markdown 消息都在同一个工作区内完成。</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setDefaultModelsOpen(true)}><Settings2 data-icon="inline-start" />默认模型</Button><Button variant="outline" onClick={() => setOpen(true)}><PanelRight data-icon="inline-start" />打开侧栏</Button></div></div>
    <Card className="demo-agent-card"><CardHeader><CardTitle className="flex items-center gap-2"><Bot />网站工作区</CardTitle><CardDescription>侧栏打开后，网站内容继续保持可见。当前演示使用本地数据；真实模型与 MCP 调用请使用 Agent Chat 示例。</CardDescription></CardHeader><CardContent><div className="demo-agent-frame"><div className="demo-agent-host"><div className="demo-agent-host-nav"><strong>订单管理</strong><span>首页　订单　帮助</span><Button variant="outline" size="sm" onClick={() => setOpen(true)}><PanelRight data-icon="inline-start" />助手</Button></div><div className="demo-agent-host-body"><div><p className="demo-eyebrow">订单 #1024</p><h2>待发货</h2><p>用户可以继续浏览和操作网站，同时在右侧向 Agent 提问。</p></div><div className="demo-agent-info-grid"><div><span>收货人</span><strong>林晓</strong></div><div><span>物流公司</span><strong>顺丰</strong></div><div><span>下单时间</span><strong>2026-10-14 10:32</strong></div></div><div className="demo-agent-callout"><ShieldCheck size={17} /><span>在消息中引用应用和 Skill，描述需要完成的任务。</span></div><div className="demo-agent-default-config"><div><span>默认图片</span><strong>{defaultModelSelection.image?.modelId || '未设置'} · {defaultModelSelection.image?.resolution || '—'} · {defaultModelSelection.image?.aspectRatio || '—'}</strong></div><div><span>默认视频</span><strong>{defaultModelSelection.video?.modelId || '未设置'} · {defaultModelSelection.video?.resolution || '—'} · {defaultModelSelection.video?.aspectRatio || '—'}</strong></div></div></div></div>{<AgentSidebar className="demo-agent-embedded" open={open} onOpenChange={setOpen} sessions={sessions} activeSessionId={activeSessionId} onSessionChange={setActiveSessionId} onNewSession={newSession} onSend={send} onToolConfirm={confirmToolCall} onRegenerate={regenerate} onSkillImport={importSkill} applications={applications} skills={skills} models={models} selectedApplicationIds={applicationIds} onSelectedApplicationIdsChange={setApplicationIds} selectedSkillIds={skillIds} onSelectedSkillIdsChange={setSkillIds} selectedModelId={modelId} onSelectedModelIdChange={setModelId} selectedReasoningEffort={effort} onSelectedReasoningEffortChange={setEffort} />}{!open && <div className="demo-agent-open"><CheckCircle2 /><span>侧栏已关闭</span><Button onClick={() => setOpen(true)}>重新打开助手</Button></div>}</div></CardContent></Card>
    <DefaultModelSelector models={mediaModels} kinds={['image', 'video']} value={defaultModelSelection} onChange={setDefaultModelSelection} open={defaultModelsOpen} onOpenChange={setDefaultModelsOpen} onComplete={(selection: DefaultModelSelection) => { setDefaultModelSelection(selection); setDefaultModelsOpen(false); }} />
    <Button variant="outline" onClick={previewConfirmation}>演示工具确认</Button>
    <Button variant="outline" onClick={previewMediaConfirmation}>演示生成确认</Button>
    <p className="demo-mock-hint"><ExternalLink aria-hidden="true" />本地演示不会调用真实网站工具，也不会上传 Skill 文件。</p>
  </div>;
}
