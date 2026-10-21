import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentSidebar, ApprovalModeSelector, type AgentApprovalMode } from '../src';

describe('approval mode selector', () => {
  it('shows three modes and updates only after the host saves', async () => {
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    function Host() {
      const [value, setValue] = useState<AgentApprovalMode>('auto');
      return <ApprovalModeSelector value={value} onChange={async mode => { await save(); setValue(mode); }} />;
    }
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: '审批模式：帮我批准' }));
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    fireEvent.click(screen.getByRole('radio', { name: /完全访问/ }));
    expect(screen.getByRole('radio', { name: /完全访问/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '审批模式：帮我批准' })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: '审批模式：完全访问' })).toBeEnabled());
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('retains the previous selection and surfaces a failed save', async () => {
    render(<ApprovalModeSelector value="auto" onChange={async () => { throw new Error('无法保存审批设置'); }} />);
    fireEvent.click(screen.getByRole('button', { name: '审批模式：帮我批准' }));
    fireEvent.click(screen.getByRole('radio', { name: /完全访问/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('无法保存审批设置');
    expect(screen.getByRole('radio', { name: /帮我批准/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /完全访问/ })).not.toBeChecked();
  });

  it('blocks sending while the policy loads and switching while generating', () => {
    const onSend = vi.fn();
    const props = { open: true, onOpenChange: vi.fn(), sessions: [{ id: 'one', title: '对话', messages: [] }], activeSessionId: 'one', onSend, approvalMode: 'auto' as const, onApprovalModeChange: vi.fn() };
    const { rerender } = render(<AgentSidebar {...props} approvalModePending />);
    expect(screen.getByRole('button', { name: '审批模式：帮我批准' })).toBeDisabled();
    fireEvent.input(screen.getByRole('textbox'), { target: { textContent: '发送任务' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    rerender(<AgentSidebar {...props} isGenerating />);
    expect(screen.getByRole('button', { name: '审批模式：帮我批准' })).toBeDisabled();
  });
});
