import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentSettingsCard, type AgentSettingsCardProps } from '../src';

function Host({ onSave }: Pick<AgentSettingsCardProps, 'onSave'>) {
  const [systemPrompt, setSystemPrompt] = useState('原有指令');
  return <AgentSettingsCard systemPrompt={systemPrompt} onSave={async (value) => { await onSave(value); setSystemPrompt(value); }} />;
}

describe('AgentSettingsCard', () => {
  it('saves the exact text and retains feedback after the host updates its value', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<Host onSave={onSave} />);
    const content = '# 助手\n\n请简短回答。\n';
    fireEvent.change(screen.getByRole('textbox', { name: '系统提示词' }), { target: { value: content } });
    fireEvent.click(screen.getByRole('button', { name: '保存提示词' }));
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已保存，下次发送消息时生效。'));
    expect(onSave).toHaveBeenCalledWith(content);
    expect(screen.getByRole('textbox', { name: '系统提示词' })).toHaveValue(content);
    expect(screen.getByRole('button', { name: '保存提示词' })).toBeDisabled();
  });

  it('retains unsaved edits and permits retry when persistence fails', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('文件不可写')).mockResolvedValue(undefined);
    render(<Host onSave={onSave} />);
    fireEvent.change(screen.getByRole('textbox', { name: '系统提示词' }), { target: { value: '修改后的指令' } });
    fireEvent.click(screen.getByRole('button', { name: '保存提示词' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('文件不可写');
    expect(screen.getByRole('textbox', { name: '系统提示词' })).toHaveValue('修改后的指令');
    expect(screen.getByRole('status')).not.toHaveTextContent('已保存');
    fireEvent.click(screen.getByRole('button', { name: '保存提示词' }));
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已保存'));
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('rejects an empty prompt and disables editing while saving', async () => {
    let complete!: () => void;
    const onSave = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
    render(<Host onSave={onSave} />);
    const input = screen.getByRole('textbox', { name: '系统提示词' });
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存提示词' }));
    expect(screen.getByRole('alert')).toHaveTextContent('不能为空');
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '有效指令' } });
    fireEvent.click(screen.getByRole('button', { name: '保存提示词' }));
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: '正在保存…' })).toBeDisabled();
    complete();
    await vi.waitFor(() => expect(input).not.toBeDisabled());
  });
});
