import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PromptSettingsCard } from '../src';

const prompts = {
  system: '当前系统提示词',
  voice: '当前语音提示词',
  defaults: { system: '默认系统提示词', voice: '默认语音提示词' },
};

describe('PromptSettingsCard', () => {
  it('可独立编辑普通和 H3 优化模板', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PromptSettingsCard prompts={{ ...prompts, optimization: '普通规则', h3Optimization: 'H3 规则' }} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: /普通提示词优化/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '普通提示词优化' }), { target: { value: '按当前生成模型优化' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ optimization: '按当前生成模型优化' }));
    fireEvent.click(screen.getByRole('button', { name: /H3 提示词优化/ }));
    expect(screen.getByRole('textbox', { name: 'H3 提示词优化' })).toHaveValue('H3 规则');
  });
  it('编辑并保存当前提示词，切换项不串内容', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PromptSettingsCard prompts={prompts} onSave={onSave} />);
    // 默认在系统提示词
    const systemArea = screen.getByRole('textbox', { name: '系统提示词' });
    expect(systemArea).toHaveValue('当前系统提示词');
    fireEvent.change(systemArea, { target: { value: '新的系统提示词' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ system: '新的系统提示词' }));

    // 切到语音提示词，编辑器内容随之切换
    fireEvent.click(screen.getByRole('button', { name: /语音提示词/ }));
    const voiceArea = screen.getByRole('textbox', { name: '语音提示词' });
    expect(voiceArea).toHaveValue('当前语音提示词');
    fireEvent.change(voiceArea, { target: { value: '新的语音提示词' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ voice: '新的语音提示词' }));
  });

  it('拒绝保存空内容并提示错误', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PromptSettingsCard prompts={prompts} onSave={onSave} />);
    fireEvent.change(screen.getByRole('textbox', { name: '系统提示词' }), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('系统提示词不能为空');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('恢复默认只载入默认内容，需再保存才提交', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PromptSettingsCard prompts={prompts} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }));
    expect(screen.getByRole('textbox', { name: '系统提示词' })).toHaveValue('默认系统提示词');
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ system: '默认系统提示词' }));
  });
});
