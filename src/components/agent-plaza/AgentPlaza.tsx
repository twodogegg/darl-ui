import { useMemo, useState } from 'react';
import type { AgentConfig, AgentType } from '../settings/types';
import './agent-plaza.css';

export interface AgentPlazaProps {
  agents: AgentConfig[];
  onSelect?: (agent: AgentConfig) => void;
  selectedAgentId?: string | null;
  className?: string;
}
function Avatar({ agent }: { agent: AgentConfig }) {
  const value = agent.avatar;
  if (value?.startsWith('/') || value?.startsWith('http') || value?.startsWith('data:image/')) {
    return <img className="darl-agent-plaza-avatar" src={value} alt="" />;
  }
  return <span className="darl-agent-plaza-avatar" aria-hidden="true">{value || agent.name.slice(0, 1).toUpperCase()}</span>;
}

/** A compact directory of Agents that users are allowed to start a conversation with. */
export function AgentPlaza({ agents, onSelect, selectedAgentId, className = '' }: AgentPlazaProps) {
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);
  const selectable = useMemo(
    () => agents.filter((agent) => (agent.type || 'main_agent') === ('main_agent' satisfies AgentType) && agent.selectable !== false && agent.enabled !== false),
    [agents],
  );
  return <section className={`darl-agent-plaza ${className}`.trim()} aria-labelledby="darl-agent-plaza-title">
    <header className="darl-agent-plaza-header">
      <div><span className="darl-agent-plaza-eyebrow">AGENT PLAZA</span><h1 id="darl-agent-plaza-title">选择一个 Agent 开始对话</h1><p>每个 Agent 都有自己的工作方式，选择后会进入对应的对话。</p></div>
    </header>
    {selectable.length ? <div className="darl-agent-plaza-grid">{selectable.map((agent) => {
      const isSelected = (selectedAgentId ?? localSelectedId) === agent.id;
      return <button type="button" aria-pressed={isSelected} className={`darl-agent-plaza-card${isSelected ? ' is-selected' : ''}`} key={agent.id} onClick={() => { setLocalSelectedId(agent.id); onSelect?.(agent); }}>
      <Avatar agent={agent} />
      <span className="darl-agent-plaza-card-copy"><strong>{agent.name}</strong><small>{agent.description || '专业 Agent'}</small></span>
      {isSelected && <span className="darl-agent-plaza-selected" aria-hidden="true">✓</span>}
    </button>;
    })}</div> : <p className="darl-agent-plaza-empty">暂无可用 Agent</p>}
  </section>;
}
