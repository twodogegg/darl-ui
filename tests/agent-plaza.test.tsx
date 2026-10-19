import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentPlaza, type AgentConfig } from '../src';

const base = { instructions: 'x', providerId: 'p', modelId: 'm' };
const agents: AgentConfig[] = [
  { ...base, id: 'main', name: '主 Agent', avatar: '🎯', description: '主 Agent 描述', type: 'main_agent', selectable: true },
  { ...base, id: 'sub', name: 'Sub Agent', avatar: '🔧', description: '不应展示', type: 'sub_agent', selectable: false },
];

describe('AgentPlaza', () => {
  it('only renders selectable main Agents and returns the selected Agent', () => {
    const onSelect = vi.fn();
    render(<AgentPlaza agents={agents} onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: /主 Agent 主 Agent 描述/ })).toBeInTheDocument();
    expect(screen.queryByText('Sub Agent')).not.toBeInTheDocument();
    const card = screen.getByRole('button', { name: /主 Agent 主 Agent 描述/ });
    expect(card).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(onSelect).toHaveBeenCalledWith(agents[0]);
  });
});
